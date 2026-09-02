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
  staleLowValue,
  noisyHighPriorityRetry,
  governmentOfficial,
  directIssuer,
  sec,
], now);

assert.deepEqual(
  result.pending.slice(0, 3).map((event) => event.id),
  [sec.id, directIssuer.id, governmentOfficial.id],
  "Fresh SEC, direct-company, and official-government evidence must lead the queue even ahead of a p100 secondary retry.",
);
assert.equal(result.pending.some((event) => event.id === olderDuplicate.id), false);
assert.equal(result.pending.some((event) => event.id === bestDuplicate.id), true, "The better/newer normalized duplicate must survive.");
assert.equal(result.pending.some((event) => event.id === otherTicker.id), true, "A different exact ticker must remain separate.");
assert.equal(result.pending.some((event) => event.id === priorDay.id), true, "A different UTC day must remain separate.");
assert.equal(result.pending.some((event) => event.id === inverseMeaning.id), true, "Token order is preserved so inverse meanings cannot collapse.");
assert.equal(result.pending.some((event) => event.id === highValueOne.id), true, "Potentially material company news is never semantic-deduplicated.");
assert.equal(result.pending.some((event) => event.id === highValueTwo.id), true, "Every high-value evidence ID must remain independent.");
assert.equal(result.pending.some((event) => event.id === staleLowValue.id), false, "Low-value secondary news must expire after six hours.");
assert.equal(result.pending.some((event) => event.id === sec.id), true, "Fresh SEC evidence must not use the six-hour news TTL.");
assert.equal(result.pending.some((event) => event.id === directIssuer.id), true, "Fresh direct-company evidence must not use the six-hour news TTL.");
assert.equal(result.pending.some((event) => event.id === governmentOfficial.id), true, "Fresh official-government evidence must not use the six-hour news TTL.");
assert.deepEqual(new Set(result.droppedEventIds), new Set([olderDuplicate.id, staleLowValue.id]));
assert.equal(result.hygiene.duplicateLowValueCompanyNewsDropped, 1);
assert.equal(result.hygiene.staleLowValueCompanyNewsDropped, 1);
assert.equal(result.hygiene.retainedAuthoritativeEventCount, 3);
assert.equal(result.hygiene.retainedDirectIssuerEventCount, 1);

putObject(valueStateKey, { qualityPriceWatchlist: [] });
putObject(sensorStateKey, {
  version: 2,
  updatedAt: now.toISOString(),
  seen: [],
  pending: [olderDuplicate, bestDuplicate, staleLowValue],
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
await sensor.runPr262ChangeSensor(now, { fetchImpl: emptyFeedFetch });
const persisted = JSON.parse(objects.get(sensorStateKey).text);
assert.deepEqual(persisted.pending.map((event) => event.id), [bestDuplicate.id]);
assert.equal(persisted.seen.includes(olderDuplicate.id), true, "A collapsed identity must be tombstoned in seen IDs.");
assert.equal(persisted.seen.includes(staleLowValue.id), true, "An expired identity must be tombstoned in seen IDs.");

console.log(JSON.stringify({
  ok: true,
  authoritativeEvidencePrioritized: true,
  lowValueCompanyNewsNormalizedDuplicatesCollapsed: true,
  inverseMeaningsRemainSeparate: true,
  staleLowValueCompanyNewsExpiresAfterSixHours: true,
  highValueCompanyNewsUnaffected: true,
  trimmedIdsPersistInSeenState: true,
}, null, 2));
