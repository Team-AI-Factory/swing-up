import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import ts from "typescript";

const nodeRequire = createRequire(import.meta.url);
const objects = new Map();
let revision = 0;

function putObject(key, value) {
  revision += 1;
  objects.set(key, { text: JSON.stringify(value), etag: `etag-${revision}` });
}

const r2 = {
  readVersionedTextFromR2: async (key) => {
    const current = objects.get(key);
    return current
      ? { found: true, text: current.text, etag: current.etag }
      : { found: false, text: null, etag: null };
  },
  writeVersionedJsonToR2: async (key, value, options = {}) => {
    const current = objects.get(key);
    if (options.createOnly && current) return { written: false, conflict: true, etag: current.etag };
    if (options.expectedEtag && current?.etag !== options.expectedEtag) return { written: false, conflict: true, etag: current?.etag ?? null };
    putObject(key, value);
    return { written: true, conflict: false, etag: objects.get(key).etag };
  },
};

function loadTypeScript(relativePath, stubs) {
  const source = readFileSync(new URL(relativePath, import.meta.url), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: relativePath,
  }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", output)((name) => {
    if (name in stubs) return stubs[name];
    return nodeRequire(name);
  }, loaded, loaded.exports);
  return loaded.exports;
}

const prefix = "branch-labs/pr-262/";
const sensor = loadTypeScript("../lib/opportunity-engine/pr262-change-sensor.ts", {
  "@/lib/r2-warehouse": r2,
  "@/lib/opportunity-engine/pr262-storage": { pr262StorageKey: (relative) => `${prefix}${relative}` },
});

const sensorStateKey = `${prefix}sensor/state-v1.json`;
const valueStateKey = `${prefix}value-investing/resumable/state.json`;
const now = new Date("2026-09-02T04:00:00.000Z");

function mappedEvent(overrides = {}) {
  return {
    id: "news:base",
    source: "company_news",
    sourceProvider: "v3_google_news",
    sourceHealthStatus: "connected",
    observedAt: new Date(now.getTime() - 60 * 60_000).toISOString(),
    title: "NASDAQ: TWST opens a new research facility - Reuters",
    url: "https://example.test/news/base",
    sourceUrl: "https://example.test/news/base",
    ticker: "TWST",
    company: "Twist Bioscience Corporation",
    kind: "news",
    priority: 65,
    reason: "Low-cost secondary discovery.",
    cik: null,
    form: null,
    accession: null,
    canonicalSecIndexUrl: null,
    identityMethod: "not_applicable",
    mappingStatus: "mapped",
    mappingMethod: "structured_ticker",
    mappingReason: "Exact structured ticker.",
    queueAttempts: 0,
    queueNextAttemptAt: null,
    queueLastAttemptAt: null,
    queueLastError: null,
    ...overrides,
  };
}

const olderDuplicate = mappedEvent({
  id: "news:duplicate-older",
  observedAt: new Date(now.getTime() - 2 * 60 * 60_000).toISOString(),
});
const bestDuplicate = mappedEvent({
  id: "news:duplicate-best",
  sourceProvider: "gdelt",
  title: "$TWST opens new research facility | Yahoo Finance",
  priority: 70,
});
const otherTicker = mappedEvent({
  id: "news:other-ticker",
  ticker: "DTST",
  company: "Data Storage Corporation",
  title: "$DTST opens new research facility | Yahoo Finance",
});
const priorDay = mappedEvent({
  id: "news:prior-day",
  title: "$TWST opens new research facility | Yahoo Finance",
  observedAt: "2026-09-01T23:30:00.000Z",
});
const inverseMeaning = mappedEvent({
  id: "news:inverse-meaning",
  title: "$TWST research facility opens new | Yahoo Finance",
});
const highValueOne = mappedEvent({ id: "news:material-one", priority: 90 });
const highValueTwo = mappedEvent({ id: "news:material-two", priority: 90, observedAt: new Date(now.getTime() - 30 * 60_000).toISOString() });
const boundaryHighValue = mappedEvent({
  id: "news:material-at-six-hour-boundary",
  priority: 80,
  observedAt: new Date(now.getTime() - 6 * 60 * 60_000).toISOString(),
});
const retryProtectedHighValue = mappedEvent({
  id: "news:material-retry-after-six-hours",
  priority: 100,
  observedAt: new Date(now.getTime() - 6 * 60 * 60_000 - 1).toISOString(),
  queueAttempts: 4,
  queueNextAttemptAt: new Date(now.getTime() + 60 * 60_000).toISOString(),
});
const retryGraceProtectedHighValue = mappedEvent({
  id: "news:material-within-retry-grace",
  priority: 100,
  observedAt: new Date(now.getTime() - 7 * 60 * 60_000).toISOString(),
  queueAttempts: 4,
  queueNextAttemptAt: new Date(now.getTime() - 5 * 60_000).toISOString(),
});
const expiredAfterRetryGrace = mappedEvent({
  id: "news:material-retry-grace-expired",
  priority: 100,
  observedAt: new Date(now.getTime() - 7 * 60 * 60_000).toISOString(),
  queueAttempts: 4,
  queueNextAttemptAt: new Date(now.getTime() - 16 * 60_000).toISOString(),
});
const expiredAtHardMaximum = mappedEvent({
  id: "news:material-over-forty-eight-hours-old",
  priority: 100,
  observedAt: new Date(now.getTime() - 48 * 60 * 60_000 - 1).toISOString(),
  queueAttempts: 4,
  queueNextAttemptAt: new Date(now.getTime() + 60 * 60_000).toISOString(),
});
const staleUnresolvedHighValue = mappedEvent({
  id: "news:unresolved-material-over-six-hours-old",
  priority: 100,
  observedAt: new Date(now.getTime() - 7 * 60 * 60_000).toISOString(),
  mappingStatus: "unmapped",
  mappingMethod: undefined,
});
const staleLowValue = mappedEvent({
  id: "news:stale-low-value",
  title: "$TWST hosts routine community event",
  observedAt: new Date(now.getTime() - 7 * 60 * 60_000).toISOString(),
});
const sec = mappedEvent({
  id: "sec:0001581280-26-000001",
  source: "sec",
  sourceProvider: "sec_broad",
  title: "Twist Bioscience filed Form 8-K",
  priority: 80,
  cik: "0001581280",
  form: "8-K",
  accession: "0001581280-26-000001",
  canonicalSecIndexUrl: "https://www.sec.gov/Archives/edgar/data/1581280/000158128026000001/0001581280-26-000001-index.html",
  identityMethod: "official_sec_archive_link",
  mappingMethod: "official_sec_cik_exact",
  observedAt: new Date(now.getTime() - 7 * 60 * 60_000).toISOString(),
});
const directIssuer = mappedEvent({
  id: "issuer:TWST:guidance",
  source: "official",
  sourceProvider: "issuer_ir_twst",
  title: "Twist Bioscience investor announcement",
  priority: 80,
  observedAt: new Date(now.getTime() - 7 * 60 * 60_000).toISOString(),
});
const governmentOfficial = mappedEvent({
  id: "official:fda:twst",
  source: "official",
  sourceProvider: "v3_fda_medwatch",
  title: "FDA official notice for TWST",
  priority: 80,
  observedAt: new Date(now.getTime() - 7 * 60 * 60_000).toISOString(),
});
const legacyDirectIssuerNews = mappedEvent({
  id: "issuer-sec:TWST:legacy-guidance",
  source: "company_news",
  sourceProvider: "issuer_sec_twst",
  title: "Twist Bioscience official issuer filing",
  priority: 80,
  observedAt: new Date(now.getTime() - 7 * 60 * 60_000).toISOString(),
});
const legacyDirectIrNews = mappedEvent({
  id: "issuer-ir:TWST:legacy-guidance",
  source: "company_news",
  sourceProvider: "issuer_ir_twst",
  title: "Twist Bioscience official investor-relations announcement",
  priority: 80,
  observedAt: new Date(now.getTime() - 8 * 60 * 60_000).toISOString(),
});
const noisyHighPriorityRetry = mappedEvent({
  id: "news:noisy-retry",
  priority: 100,
  queueAttempts: 3,
  queueNextAttemptAt: now.toISOString(),
});

const result = sensor.partitionPr262PendingEventsWithTelemetry([
  olderDuplicate,
  bestDuplicate,
  otherTicker,
  priorDay,
  inverseMeaning,
  highValueOne,
  highValueTwo,
  boundaryHighValue,
  retryProtectedHighValue,
  retryGraceProtectedHighValue,
  expiredAfterRetryGrace,
  expiredAtHardMaximum,
  staleUnresolvedHighValue,
  staleLowValue,
  noisyHighPriorityRetry,
  governmentOfficial,
  directIssuer,
  legacyDirectIssuerNews,
  legacyDirectIrNews,
  sec,
], now);

assert.deepEqual(
  result.pending.slice(0, 5).map((event) => event.id),
  [sec.id, directIssuer.id, legacyDirectIssuerNews.id, legacyDirectIrNews.id, governmentOfficial.id],
  "Fresh SEC, direct-company, and official-government evidence must lead the queue even ahead of a p100 secondary retry.",
);
assert.equal(result.pending.some((event) => event.id === olderDuplicate.id), false);
assert.equal(result.pending.some((event) => event.id === bestDuplicate.id), true, "The better/newer normalized duplicate must survive.");
assert.equal(result.pending.some((event) => event.id === otherTicker.id), true, "A different exact ticker must remain separate.");
assert.equal(result.pending.some((event) => event.id === priorDay.id), true, "A different UTC day must remain separate.");
assert.equal(result.pending.some((event) => event.id === inverseMeaning.id), true, "Token order is preserved so inverse meanings cannot collapse.");
assert.equal(result.pending.some((event) => event.id === highValueOne.id), true, "Potentially material company news is never semantic-deduplicated.");
assert.equal(result.pending.some((event) => event.id === highValueTwo.id), true, "Every high-value evidence ID must remain independent.");
assert.equal(result.pending.some((event) => event.id === boundaryHighValue.id), true, "Fresh high-value secondary news remains eligible through the exact six-hour boundary.");
assert.equal(result.pending.some((event) => event.id === retryProtectedHighValue.id), true, "A valid scheduled retry must keep secondary news through the retry plus one sensor-cycle grace.");
assert.equal(result.pending.some((event) => event.id === retryGraceProtectedHighValue.id), true, "Secondary news must remain available during the full sensor-cycle grace after its retry became due.");
assert.equal(result.pending.some((event) => event.id === expiredAfterRetryGrace.id), false, "Secondary news must expire once its scheduled retry grace has passed.");
assert.equal(result.pending.some((event) => event.id === expiredAtHardMaximum.id), false, "A scheduled retry must never extend secondary news beyond the original forty-eight-hour ready-event ceiling.");
assert.equal(result.pending.some((event) => event.id === staleUnresolvedHighValue.id), false, "Unresolved secondary news must obey the same six-hour age bound.");
assert.equal(result.pending.some((event) => event.id === staleLowValue.id), false, "Low-value secondary news must expire after six hours.");
assert.equal(result.pending.some((event) => event.id === sec.id), true, "Fresh SEC evidence must not use the six-hour news TTL.");
assert.equal(result.pending.some((event) => event.id === directIssuer.id), true, "Fresh direct-company evidence must not use the six-hour news TTL.");
assert.equal(result.pending.some((event) => event.id === legacyDirectIssuerNews.id), true, "A legacy direct-issuer row classified as company news must still be protected from the secondary-news TTL.");
assert.equal(result.pending.some((event) => event.id === legacyDirectIrNews.id), true, "A legacy investor-relations row classified as company news must still be protected from the secondary-news TTL.");
assert.equal(result.pending.some((event) => event.id === governmentOfficial.id), true, "Fresh official-government evidence must not use the six-hour news TTL.");
assert.deepEqual(new Set(result.droppedEventIds), new Set([
  olderDuplicate.id,
  expiredAfterRetryGrace.id,
  expiredAtHardMaximum.id,
  staleUnresolvedHighValue.id,
  staleLowValue.id,
]));
assert.equal(result.hygiene.duplicateLowValueCompanyNewsDropped, 1);
assert.equal(result.hygiene.staleSecondaryCompanyNewsDropped, 4);
assert.equal(result.hygiene.retryProtectedSecondaryCompanyNewsCount, 2);
assert.equal(result.hygiene.staleLowValueCompanyNewsDropped, 1, "The compatibility field must retain its original low-value-only meaning.");
assert.equal(result.hygiene.retainedAuthoritativeEventCount, 5);
assert.equal(result.hygiene.retainedDirectIssuerEventCount, 3);

putObject(valueStateKey, { qualityPriceWatchlist: [] });
putObject(sensorStateKey, {
  version: 2,
  updatedAt: now.toISOString(),
  seen: [],
  pending: [
    olderDuplicate,
    bestDuplicate,
    boundaryHighValue,
    retryProtectedHighValue,
    retryGraceProtectedHighValue,
    expiredAfterRetryGrace,
    expiredAtHardMaximum,
    staleUnresolvedHighValue,
    staleLowValue,
    sec,
    directIssuer,
    legacyDirectIssuerNews,
    legacyDirectIrNews,
    governmentOfficial,
  ],
  lastMarketWatchAt: null,
  cursors: { secUrgentFormIndex: 0, newsQueryIndex: 0, officialFeedIndex: 0, directIssuerFeedIndex: 0 },
  sourceHealth: {},
  sensorReadiness: { version: 1, checkedAt: now.toISOString(), universeReady: true, universeEntries: 1, exposureReady: true, exposureEntries: 1 },
  cloudflareSensor: null,
});

const emptyFeedFetch = async (input) => {
  const url = String(input);
  const body = url.includes("sec.gov/cgi-bin/browse-edgar")
    ? "<feed xmlns=\"http://www.w3.org/2005/Atom\"></feed>"
    : "<rss><channel></channel></rss>";
  return { ok: true, status: 200, text: async () => body };
};
const cleanupCycle = await sensor.runPr262ChangeSensor(now, { fetchImpl: emptyFeedFetch });
const persisted = JSON.parse(objects.get(sensorStateKey).text);
assert.deepEqual(
  new Set(persisted.pending.map((event) => event.id)),
  new Set([bestDuplicate.id, boundaryHighValue.id, retryProtectedHighValue.id, retryGraceProtectedHighValue.id, sec.id, directIssuer.id, legacyDirectIssuerNews.id, legacyDirectIrNews.id, governmentOfficial.id]),
);
assert.equal(persisted.seen.includes(olderDuplicate.id), true, "A collapsed identity must be tombstoned in seen IDs.");
assert.equal(persisted.seen.includes(staleLowValue.id), true, "An expired identity must be tombstoned in seen IDs.");
assert.equal(persisted.seen.includes(expiredAfterRetryGrace.id), true, "Expired p100 secondary news must be tombstoned after its retry grace.");
assert.equal(persisted.seen.includes(expiredAtHardMaximum.id), true, "The hard forty-eight-hour ceiling must tombstone even a future-scheduled secondary retry.");
assert.equal(persisted.seen.includes(staleUnresolvedHighValue.id), true, "Expired unresolved secondary news must be tombstoned too.");
assert.equal(cleanupCycle.persistedState.queueHygieneAtLoad.duplicateLowValueCompanyNewsDropped, 1, "Load-time migration must expose deduplication that occurs before the provider cycle.");
assert.equal(cleanupCycle.persistedState.queueHygieneAtLoad.staleSecondaryCompanyNewsDropped, 4, "Load-time migration must expose all stale secondary trimming instead of returning a clean-looking zero.");
assert.equal(cleanupCycle.persistedState.queueHygieneAtLoad.staleLowValueCompanyNewsDropped, 1);
assert.equal(cleanupCycle.persistedState.queueHygieneAtLoad.retryProtectedSecondaryCompanyNewsCount, 2);

console.log(JSON.stringify({
  ok: true,
  authoritativeEvidencePrioritized: true,
  lowValueCompanyNewsNormalizedDuplicatesCollapsed: true,
  inverseMeaningsRemainSeparate: true,
  unscheduledSecondaryCompanyNewsExpiresAfterSixHours: true,
  scheduledSecondaryCompanyNewsSurvivesThroughRetryGrace: true,
  scheduledSecondaryCompanyNewsStillHonorsFortyEightHourCeiling: true,
  freshHighValueCompanyNewsUnaffected: true,
  directIssuerRowsProtectedFromSecondaryNewsExpiry: true,
  trimmedIdsPersistInSeenState: true,
}, null, 2));
