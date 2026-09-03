import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import ts from "typescript";

const require = createRequire(import.meta.url);
const policySource = readFileSync(new URL("../lib/opportunity-engine/pr262-queue-reset-policy.ts", import.meta.url), "utf8");
const routeSource = readFileSync(new URL("../app/api/internal/combined-opportunity-engine/queue-reset/route.ts", import.meta.url), "utf8");
const launcherSource = readFileSync(new URL("./pr262-queue-reset-once.mjs", import.meta.url), "utf8");

function transpile(source) {
  return ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
}

function loadModule(source, localRequire) {
  const loaded = { exports: {} };
  new Function("require", "module", "exports", transpile(source))(localRequire, loaded, loaded.exports);
  return loaded.exports;
}

const policy = loadModule(policySource, require);
const {
  PR262_QUEUE_STALE_COMPANY_NEWS_MS,
  selectPr262PendingForOneTimeCleanup,
} = policy;

assert.equal(PR262_QUEUE_STALE_COMPANY_NEWS_MS, 6 * 60 * 60_000);

const fixedNow = new Date();
const hoursBefore = (hours) => new Date(fixedNow.getTime() - hours * 60 * 60_000).toISOString();
const pending = [
  {
    id: "sec:0001292814-26-004456",
    source: "sec",
    sourceProvider: "sec_edgar",
    observedAt: hoursBefore(240),
    priority: 1,
    identityMethod: "official_sec_archive_link",
    canonicalSecIndexUrl: "https://www.sec.gov/Archives/edgar/data/1292814/000129281426004456/nu-20260903.htm",
  },
  { id: "official:old", source: "official", sourceProvider: "official_fda", observedAt: hoursBefore(240), priority: 1 },
  { id: "official-provider-legacy", source: "company_news", sourceProvider: "official_fed", observedAt: hoursBefore(240), priority: 1 },
  { id: "issuer:NU:one", source: "company_news", sourceProvider: "issuer_ir_nu", observedAt: hoursBefore(240), priority: 1 },
  { id: "legacy-direct", source: "company_news", mappingMethod: "direct_issuer_feed_ticker", observedAt: hoursBefore(240), priority: 1 },
  { id: "authority-field", source: "company_news", primarySource: true, observedAt: hoursBefore(240), priority: 1 },
  { id: "news:fresh-high", source: "company_news", sourceProvider: "google_news", observedAt: hoursBefore(1), priority: 90 },
  { id: "news:stale-high", source: "company_news", sourceProvider: "google_news", observedAt: hoursBefore(7), priority: 90 },
  { id: "news:fresh-low", source: "company_news", sourceProvider: "google_news", observedAt: hoursBefore(1), priority: 65 },
  { id: "news:stale-low", source: "company_news", sourceProvider: "google_news", observedAt: hoursBefore(12), priority: 65 },
  { id: "news:malformed", source: "company_news", priority: 1 },
  { id: "market:fresh", source: "market_price", observedAt: hoursBefore(1), priority: 1 },
  "legacy-malformed-row",
];

const selected = selectPr262PendingForOneTimeCleanup(pending, fixedNow);
assert.deepEqual(selected.removed.map((event) => event.id), [
  "news:stale-high",
  "news:fresh-low",
  "news:stale-low",
]);
assert.deepEqual(selected.retained.map((event) => typeof event === "string" ? event : event.id), [
  "sec:0001292814-26-004456",
  "official:old",
  "official-provider-legacy",
  "issuer:NU:one",
  "legacy-direct",
  "authority-field",
  "news:fresh-high",
  "news:malformed",
  "market:fresh",
  "legacy-malformed-row",
]);
assert.deepEqual(selected.removedCountsBySource, {
  sec: 0,
  official: 0,
  direct_issuer: 0,
  company_news: 3,
  market_price: 0,
  unknown: 0,
});
assert.deepEqual(selected.retainedCountsBySource, {
  sec: 1,
  official: 3,
  direct_issuer: 2,
  company_news: 2,
  market_price: 1,
  unknown: 1,
});
assert.deepEqual(selected.removalReasons, {
  stale_company_news: 2,
  low_value_non_authoritative_company_news: 1,
});

const stateKey = "production/pr262/sensor/state-v1.json";
const discoveryKey = "production/pr262/sensor/direct-company-feeds-v1.json";
const initialState = {
  version: 2,
  updatedAt: "2026-09-03T00:00:00.000Z",
  seen: ["seen:a", "seen:b", "sec:already-processed"],
  pending,
  cursors: { secUrgentFormIndex: 3, newsQueryIndex: 2, officialFeedIndex: 1, directIssuerFeedIndex: 77 },
  sourceHealth: { sec: { status: "connected" } },
  sensorReadiness: { version: 1, universeReady: true, universeEntries: 4_945 },
  cloudflareSensor: { version: 1, owner: "cloudflare_worker", lastScanId: "scan-1" },
  futureStateField: { mustSurvive: [1, 2, 3] },
};
const initialDiscovery = {
  version: 1,
  discoveryCursor: 353,
  entries: [{ ticker: "NU", cik: "0001292814", feedUrl: "https://investors.nu/feed" }],
};

function jsonResponse(body, init = {}) {
  const status = init.status ?? 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    body,
    async json() { return body; },
  };
}

function routeHarness({ forceConflict = false, corruptReadBack = false } = {}) {
  const objects = new Map([
    [stateKey, { text: JSON.stringify(initialState), etag: '"state-v1"' }],
    [discoveryKey, { text: JSON.stringify(initialDiscovery), etag: '"discovery-v1"' }],
  ]);
  const writes = [];
  const reads = [];
  let stateWritten = false;
  const storage = {
    async readVersionedTextFromR2(key) {
      reads.push(key);
      const found = objects.get(key);
      if (!found) return { found: false, text: null, etag: null };
      if (key === stateKey && stateWritten && corruptReadBack) {
        const corrupted = JSON.parse(found.text);
        corrupted.seen = ["read-back-corruption"];
        return { found: true, text: JSON.stringify(corrupted), etag: found.etag };
      }
      return { found: true, ...found };
    },
    async writeVersionedJsonToR2(key, payload, options = {}) {
      writes.push({ key, payload: structuredClone(payload), options: { ...options } });
      const current = objects.get(key);
      if (options.createOnly) {
        if (current) return { written: false, conflict: true, etag: null };
        const etag = `"backup-${writes.length}"`;
        objects.set(key, { text: JSON.stringify(payload), etag });
        return { written: true, conflict: false, etag };
      }
      if (forceConflict || !current || options.expectedEtag !== current.etag) {
        return { written: false, conflict: true, etag: null };
      }
      const etag = '"state-v2"';
      objects.set(key, { text: JSON.stringify(payload), etag });
      stateWritten = true;
      return { written: true, conflict: false, etag };
    },
  };
  const route = loadModule(routeSource, (specifier) => {
    if (specifier === "next/server") return { NextResponse: { json: jsonResponse } };
    if (specifier === "@/lib/internal-api-auth") return { internalApiScopeAuthorized: () => true };
    if (specifier === "@/lib/opportunity-engine/pr262-queue-reset-policy") return policy;
    if (specifier === "@/lib/opportunity-engine/pr262-storage") {
      return {
        pr262StorageKey: (suffix) => `production/pr262/${suffix}`,
        resolvePr262StoragePrefix: () => "production/pr262/",
      };
    }
    if (specifier === "@/lib/r2-warehouse") return storage;
    return require(specifier);
  });
  return { route, objects, reads, writes };
}

process.env.SWING_UP_PR262_QUEUE_RESET_ENABLED = "true";
process.env.SWING_UP_R2_WRITE_PREFIX = "production/pr262/";
const request = {
  headers: new Headers(),
  async json() {
    return { confirmation: "REMOVE_STALE_OR_LOW_VALUE_COMPANY_NEWS_KEEP_AUTHORITY_V1" };
  },
};

const successful = routeHarness();
const response = await successful.route.POST(request);
assert.equal(response.status, 200);
assert.equal(response.body.ok, true);
assert.equal(response.body.originalPendingCount, pending.length);
assert.equal(response.body.removedCount, 3);
assert.equal(response.body.retainedCount, 10);
assert.equal(response.body.pendingCount, 10);
assert.equal(response.body.preservedSeen, true);
assert.equal(response.body.preservedDiscovery, true);
assert.equal(response.body.discoveryStateWritten, false);
assert.equal(response.body.preservedAllOtherState, true);
assert.equal(response.body.authoritativeAndDirectIssuerEventsAlwaysRetained, true);
assert.deepEqual(response.body.removedCountsBySource, selected.removedCountsBySource);
assert.deepEqual(response.body.retainedCountsBySource, selected.retainedCountsBySource);

const backupWrite = successful.writes.find((write) => write.key.includes("/rollback/queue-reset-"));
const stateWrite = successful.writes.find((write) => write.key === stateKey);
assert.ok(backupWrite, "A full rollback backup must be written before queue cleanup.");
assert.ok(stateWrite, "The selected pending queue must be written.");
assert.equal(successful.writes.indexOf(backupWrite) < successful.writes.indexOf(stateWrite), true);
assert.deepEqual(backupWrite.options, { createOnly: true });
assert.deepEqual(backupWrite.payload.state, initialState, "The rollback backup must contain the complete original state.");
assert.equal(backupWrite.payload.sourceEtag, '"state-v1"');
assert.deepEqual(stateWrite.options, { expectedEtag: '"state-v1"' });
assert.deepEqual(stateWrite.payload.seen, initialState.seen);
assert.ok(stateWrite.payload.pending.some((event) => event?.id === "sec:0001292814-26-004456"));
assert.ok(stateWrite.payload.pending.some((event) => event?.id === "official:old"));
assert.ok(stateWrite.payload.pending.some((event) => event?.id === "issuer:NU:one"));
assert.ok(stateWrite.payload.pending.some((event) => event?.id === "news:fresh-high"));
assert.equal(successful.writes.some((write) => write.key === discoveryKey), false, "Discovery state must never be written.");
assert.deepEqual(JSON.parse(successful.objects.get(discoveryKey).text), initialDiscovery);
assert.equal(successful.reads.filter((key) => key === stateKey).length, 2, "State must be read before and after the ETag-guarded write.");

const verifiedState = JSON.parse(successful.objects.get(stateKey).text);
const expectedOtherState = structuredClone(initialState);
const actualOtherState = structuredClone(verifiedState);
delete expectedOtherState.pending;
delete expectedOtherState.updatedAt;
delete actualOtherState.pending;
delete actualOtherState.updatedAt;
assert.deepEqual(actualOtherState, expectedOtherState, "All state outside pending/updatedAt must remain byte-semantically unchanged.");

const conflict = routeHarness({ forceConflict: true });
const conflictResponse = await conflict.route.POST(request);
assert.equal(conflictResponse.status, 409);
assert.equal(conflictResponse.body.queueUntouched, true);
assert.deepEqual(JSON.parse(conflict.objects.get(stateKey).text), initialState, "An ETag conflict must leave the queue untouched.");
assert.ok(conflict.writes.some((write) => write.options.createOnly === true), "The rollback backup must exist even when the guarded state write conflicts.");

const corrupted = routeHarness({ corruptReadBack: true });
const corruptedResponse = await corrupted.route.POST(request);
assert.equal(corruptedResponse.status, 503);
assert.equal(corruptedResponse.body.error, "pr262_queue_reset_verification_failed");
assert.ok(corrupted.writes.some((write) => write.options.createOnly === true), "A read-back verification failure must still have a rollback backup.");

assert.match(launcherSource, /body\.pendingCount === body\.retainedCount/);
assert.doesNotMatch(launcherSource, /body\.pendingCount !== 0/);
assert.match(launcherSource, /body\.preservedDiscovery !== true/);
assert.match(launcherSource, /body\.authoritativeAndDirectIssuerEventsAlwaysRetained !== true/);

console.log(JSON.stringify({
  ok: true,
  staleThresholdHours: 6,
  originalPendingCount: pending.length,
  retainedCount: selected.retained.length,
  removedCount: selected.removed.length,
  exactNuSecEventRetained: true,
  allSecOfficialAndDirectIssuerEventsRetained: true,
  freshHighValueCompanyNewsRetained: true,
  staleOrLowValueCompanyNewsRemoved: true,
  malformedRowsRetainedFailClosed: true,
  completeRollbackStateBackedUp: true,
  seenDiscoveryAndAllOtherStatePreserved: true,
  etagConflictLeavesQueueUntouched: true,
  readBackMismatchDetected: true,
  removedCountsBySource: selected.removedCountsBySource,
  retainedCountsBySource: selected.retainedCountsBySource,
}, null, 2));
