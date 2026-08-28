import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import ts from "typescript";

const nodeRequire = createRequire(import.meta.url);
const objects = new Map();
let revision = 0;

const directAnnouncementSource = readFileSync(new URL("../lib/opportunity-engine/pr262-direct-announcements.ts", import.meta.url), "utf8");
assert.match(directAnnouncementSource, /redirect: "manual"/, "Direct issuer feeds must never auto-follow an unvalidated redirect.");
assert.match(directAnnouncementSource, /current = new URL\(location, url\)\.toString\(\)/, "Every direct issuer redirect must be resolved and revalidated.");
assert.match(directAnnouncementSource, /direct_feed_redirect_limit/, "Direct issuer redirect chains must be bounded.");

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

const sensor = loadTypeScript("../lib/opportunity-engine/pr262-change-sensor.ts", {
  "@/lib/r2-warehouse": r2,
  "@/lib/opportunity-engine/pr262-storage": { pr262StorageKey: (relative) => `branch-labs/pr-262/${relative}` },
});

const valueStateKey = "branch-labs/pr-262/value-investing/resumable/state.json";
const universeKey = "branch-labs/pr-262/equity-universe/v1.json";
const sensorStateKey = "branch-labs/pr-262/sensor/state-v1.json";
const directoryKey = "branch-labs/pr-262/sensor/company-directory-v1.json";
const batchKey = "branch-labs/pr-262/value-investing/resumable/cycles/cycle-test/batches/0000.json";
const now = new Date("2026-08-28T04:00:00.000Z");
const atom = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <title>8-K - Twist Bioscience signs storage agreement mentioning Data Storage Corporation (DTST)</title>
    <link rel="alternate" type="text/html" href="https://www.sec.gov/Archives/edgar/data/1581280/000119312526123456/twist-20260811.htm" />
    <category term="8-K" />
    <updated>2026-08-28T03:58:00Z</updated>
    <summary type="html">Filed: 2026-08-28 AccNo: 0001193125-26-123456</summary>
  </entry>
</feed>`;
const parsed = sensor.parseSecAtomForSensor(atom, { now, provider: "sec_broad", requestedForm: null });
assert.equal(parsed.recordsRead, 1);
assert.equal(parsed.invalidIdentityCount, 0);
assert.equal(parsed.events[0].cik, "0001581280");
assert.equal(parsed.events[0].form, "8-K");
assert.equal(parsed.events[0].accession, "0001193125-26-123456");
assert.equal(parsed.events[0].ticker, null);
assert.equal(parsed.events[0].identityMethod, "official_sec_archive_link");
assert.equal(
  parsed.events[0].canonicalSecIndexUrl,
  "https://www.sec.gov/Archives/edgar/data/1581280/000119312526123456/0001193125-26-123456-index.html",
);
const inlineAtom = atom.replace(
  "https://www.sec.gov/Archives/edgar/data/1581280/000119312526123456/twist-20260811.htm",
  "https://www.sec.gov/ix?doc=/Archives/edgar/data/1581280/000119312526123456/twist-20260811.htm",
);
const inlineParsed = sensor.parseSecAtomForSensor(inlineAtom, { now, provider: "sec_urgent_8-k", requestedForm: "8-K" });
assert.equal(inlineParsed.events[0].cik, "0001581280");
assert.equal(inlineParsed.events[0].accession, "0001193125-26-123456");

const pendingFreshSec = sensor.partitionPr262PendingEvents([parsed.events[0]], now);
assert.equal(pendingFreshSec.length, 1, "A fresh SEC filing must receive one authoritative CIK mapping attempt.");
const pendingFailedSec = sensor.partitionPr262PendingEvents([{
  ...parsed.events[0],
  mappingStatus: "unmapped",
  mappingMethod: "sec_cik_unknown_fail_closed",
  mappingReason: "The official issuer CIK is not present in the stored company directory.",
}], now);
assert.equal(pendingFailedSec.length, 0, "An SEC identity that already failed authoritative mapping must not remain backlog.");
const pendingFailedTicker = sensor.partitionPr262PendingEvents([{
  ...parsed.events[0],
  id: "news:unknown-ticker",
  source: "company_news",
  sourceProvider: "v3_google_news",
  identityMethod: "not_applicable",
  ticker: "UNKNOWN",
  cik: null,
  accession: null,
  canonicalSecIndexUrl: null,
  mappingStatus: "unmapped",
  mappingMethod: "structured_ticker_unknown_fail_closed",
  mappingReason: "The structured ticker is not present in the stored company directory.",
}], now);
assert.equal(pendingFailedTicker.length, 0, "An unknown structured ticker must not be retried after fail-closed mapping.");

const missingTimestampAtom = atom.replace("    <updated>2026-08-28T03:58:00Z</updated>\n", "");
const missingTimestamp = sensor.parseSecAtomForSensor(missingTimestampAtom, { now, provider: "sec_broad", requestedForm: null });
assert.equal(missingTimestamp.recordsRead, 1);
assert.equal(missingTimestamp.events.length, 0);
assert.equal(missingTimestamp.status, "partial");
assert.equal(missingTimestamp.invalidTimestampCount, 1);
const missingTimestampAgain = sensor.parseSecAtomForSensor(missingTimestampAtom, { now, provider: "sec_broad", requestedForm: null });
assert.deepEqual(missingTimestampAgain.events, []);

const futureTimestampAtom = atom.replace("2026-08-28T03:58:00Z", "2026-08-28T04:06:00Z");
const futureTimestamp = sensor.parseSecAtomForSensor(futureTimestampAtom, { now, provider: "sec_broad", requestedForm: null });
assert.equal(futureTimestamp.events.length, 0);
assert.equal(futureTimestamp.status, "partial");
assert.equal(futureTimestamp.invalidTimestampCount, 1);

const rssMissingTimestamp = sensor.parseRssForPr262Sensor(
  "<rss><channel><item><title>NASDAQ: TWST filing update</title><link>https://example.test/twst</link></item></channel></rss>",
  "company_news",
  "company_news",
  "news",
  now,
);
assert.equal(rssMissingTimestamp.events.length, 0);
assert.equal(rssMissingTimestamp.status, "partial");
const rssFutureTimestamp = sensor.parseRssForPr262Sensor(
  "<rss><channel><item><title>NASDAQ: TWST filing update</title><link>https://example.test/twst</link><pubDate>2026-08-28T04:06:00Z</pubDate></item></channel></rss>",
  "company_news",
  "company_news",
  "news",
  now,
);
assert.equal(rssFutureTimestamp.events.length, 0);
assert.equal(rssFutureTimestamp.status, "partial");

const twoPartialSecFeeds = sensor.summarizePr262SensorCoverage({
  secBroad: { status: "partial", attemptedThisCycle: true },
  secUrgent: { status: "partial", attemptedThisCycle: true },
  companyNews: { status: "connected", attemptedThisCycle: true },
  official: { status: "connected", attemptedThisCycle: true },
});
assert.equal(twoPartialSecFeeds.groups.find((group) => group.source === "sec").status, "partial");
assert.equal(twoPartialSecFeeds.status, "partial");
assert.equal(twoPartialSecFeeds.reliableNoEventConclusion, false);

const failedCalls = [];
const blind = await sensor.runPr262ChangeSensor(now, {
  fetchImpl: async (input) => {
    failedCalls.push(String(input));
    throw new Error("simulated_timeout");
  },
});
assert.equal(blind.ok, false);
assert.equal(blind.coverageStatus, "blind");
assert.equal(blind.sourceCoverage.reliableNoEventConclusion, false);
assert.equal(blind.newEventCount, 0);
assert.deepEqual(blind.specialistQueue, []);
assert.equal(blind.sensorCostPolicy.aiCalls, 0);
assert.equal(blind.sensorCostPolicy.deepAnalysisCalls, 0);
assert.equal(blind.sensorCostPolicy.secFeedCallsAttempted, 2);
assert.equal(failedCalls.filter((url) => url.includes("sec.gov/cgi-bin/browse-edgar")).length, 2);
const blindState = JSON.parse(objects.get(sensorStateKey).text);
assert.equal(blindState.version, 2);
assert.equal(blindState.cursors.secUrgentFormIndex, 0);
assert.ok(blindState.sourceHealth.sec_broad.nextRetryAt);
assert.equal(blindState.sourceHealth.sec_broad.consecutiveFailures, 1);

objects.delete(sensorStateKey);
putObject(valueStateKey, { qualityPriceWatchlist: [] });
const cadenceCalls = [];
const feedFetch = async (input) => {
  const url = String(input);
  cadenceCalls.push(url);
  const text = url.includes("sec.gov/cgi-bin/browse-edgar")
    ? "<feed xmlns=\"http://www.w3.org/2005/Atom\"></feed>"
    : "<rss><channel></channel></rss>";
  return { ok: true, status: 200, text: async () => text };
};
const firstCadence = await sensor.runPr262ChangeSensor(now, { fetchImpl: feedFetch });
assert.equal(cadenceCalls.length, 4);
assert.equal(firstCadence.coverageStatus, "complete");
assert.equal(firstCadence.sourceCoverage.reliableNoEventConclusion, true);
assert.equal(firstCadence.sensorCostPolicy.secFeedCallsAttempted, 2);
assert.equal(firstCadence.sensorCostPolicy.aiCalls, 0);
assert.equal(firstCadence.sensorCostPolicy.deepAnalysisCalls, 0);

const afterFirstCadenceCalls = cadenceCalls.length;
const oneMinuteLater = new Date(now.getTime() + 60_000);
const skippedCadence = await sensor.runPr262ChangeSensor(oneMinuteLater, { fetchImpl: feedFetch });
assert.equal(cadenceCalls.length, afterFirstCadenceCalls);
assert.equal(skippedCadence.coverageStatus, "complete");
assert.equal(skippedCadence.sourceCoverage.reliableNoEventConclusion, false);
assert.equal(skippedCadence.sensorCostPolicy.secFeedCallsAttempted, 0);
assert.equal(skippedCadence.sourceHealth.length, 5);
for (const health of skippedCadence.sourceHealth) {
  const priorHealth = firstCadence.sourceHealth.find((item) => item.provider === health.provider);
  assert.equal(health.status, "not_due");
  assert.equal(health.attemptedThisCycle, false);
  assert.equal(health.skipReason, "healthy_success_cadence");
  assert.equal(health.lastSuccessStatus, "connected");
  assert.deepEqual(health.sourceUrls, priorHealth.sourceUrls);
}
assert.equal(skippedCadence.sourceCoverage.marketWatch.requiredThisCycle, false);

const fiveMinutesLater = new Date(now.getTime() + 5 * 60_000);
const beforeFiveMinuteCalls = cadenceCalls.length;
const fiveMinuteCadence = await sensor.runPr262ChangeSensor(fiveMinutesLater, { fetchImpl: feedFetch });
assert.equal(cadenceCalls.length - beforeFiveMinuteCalls, 2);
assert.equal(fiveMinuteCadence.sensorCostPolicy.secFeedCallsAttempted, 1);
assert.equal(fiveMinuteCadence.sourceHealth.find((health) => health.provider === "sec_urgent").status, "not_due");
assert.equal(fiveMinuteCadence.sourceHealth.find((health) => health.provider === "official").status, "not_due");
assert.equal(fiveMinuteCadence.sourceHealth.find((health) => health.provider === "market_price").status, "not_due");

const fifteenMinutesLater = new Date(now.getTime() + 15 * 60_000);
const beforeFifteenMinuteCalls = cadenceCalls.length;
const fifteenMinuteCadence = await sensor.runPr262ChangeSensor(fifteenMinutesLater, { fetchImpl: feedFetch });
assert.equal(cadenceCalls.length - beforeFifteenMinuteCalls, 4);
assert.equal(fifteenMinuteCadence.sensorCostPolicy.secFeedCallsAttempted, 2);
assert.equal(fifteenMinuteCadence.sourceCoverage.reliableNoEventConclusion, true);
assert.equal(fifteenMinuteCadence.marketWatchlistChecked, 0);
assert.equal(fifteenMinuteCadence.persistedState.cursors.secUrgentFormIndex, 2);
assert.equal(fifteenMinuteCadence.persistedState.cursors.officialFeedIndex, 2);

const directory = loadTypeScript("../lib/opportunity-engine/pr262-company-directory.ts", {
  "@/lib/r2-warehouse": r2,
  "@/lib/opportunity-engine/pr262-change-sensor": sensor,
  "@/lib/opportunity-engine/pr262-storage": {
    pr262StorageKey: (relative) => `branch-labs/pr-262/${relative}`,
    resolvePr262StoragePrefix: () => "branch-labs/pr-262/",
  },
});

putObject(valueStateKey, { cycleId: "cycle-test", completedBatchKeys: [batchKey] });
putObject(batchKey, {
  version: 1,
  kind: "us_value_investing_company_batch",
  cycleId: "cycle-test",
  analyses: [
    { ticker: "TWST", company: "Twist Bioscience Corporation", tradingViewSymbol: "NASDAQ:TWST", fairValue: { baseValue: 42 } },
    { ticker: "DTST", company: "Data Storage Corporation", tradingViewSymbol: "NASDAQ:DTST", fairValue: { baseValue: 8 } },
    { ticker: "UNSAFE", company: "Unsafe Preferred Holdings", tradingViewSymbol: "NYSE:UNSAFE", fairValue: { baseValue: 1 } },
  ],
});
const freshUniverseAt = new Date().toISOString();
putObject(universeKey, {
  version: 1,
  scope: "active_us_exchange_listed_common_equities_and_adrs",
  constructionMode: "nasdaq_plus_sec",
  refreshedAt: freshUniverseAt,
  entries: [
    { ticker: "TWST", name: "Twist Bioscience Corporation", exchange: "NASDAQ", cik: "0001581280", aliases: [], securityType: "common_stock", sourceNames: ["SEC company_tickers_exchange"] },
    { ticker: "DTST", name: "Data Storage Corporation", exchange: "NASDAQ", cik: "0001419951", aliases: [], securityType: "common_stock", sourceNames: ["SEC company_tickers_exchange"] },
  ],
  coverage: { eligibleEquities: 2, cikMapped: 2 },
  sources: [],
});
putObject(directoryKey, {
  version: 3,
  cycleId: "cycle-test",
  updatedAt: freshUniverseAt,
  universeRefreshedAt: freshUniverseAt,
  batchKeys: [batchKey],
  recordsRead: 1,
  entriesWithCik: 1,
  entries: [{
    ticker: "UNSAFE",
    tradingViewSymbol: "NYSE:UNSAFE",
    company: "Unsafe Preferred Holdings",
    cik: "0001999999",
    isPrimaryListing: false,
    exchange: null,
    securityType: null,
    batchKey,
    analysisIndex: 2,
    valueCycleId: "cycle-test",
    universeRefreshedAt: freshUniverseAt,
  }],
});
putObject(sensorStateKey, {
  version: 2,
  updatedAt: now.toISOString(),
  seen: [parsed.events[0].id],
  pending: [parsed.events[0]],
  lastMarketWatchAt: null,
  cursors: { secUrgentFormIndex: 1, newsQueryIndex: 1, officialFeedIndex: 1, directIssuerFeedIndex: 37 },
  sourceHealth: {},
  sensorReadiness: {
    version: 1,
    checkedAt: now.toISOString(),
    universeReady: true,
    universeEntries: 2,
    exposureReady: true,
    exposureEntries: 2,
  },
  cloudflareSensor: {
    version: 1,
    owner: "cloudflare_worker",
    lastScanId: "cf-scan-test",
    lastRunKey: "branch-labs/pr-262/cloudflare-shadow/sensor/runs/test.json",
    checkedAt: now.toISOString(),
  },
});

const mapping = await directory.enrichPr262SensorCompanyMappings();
assert.equal(mapping.mapped, 1);
assert.equal(mapping.failClosed, 0);
assert.equal(mapping.directoryCompanies, 2);
assert.equal(mapping.directoryCompaniesWithCik, 2);
const rebuiltDirectory = JSON.parse(objects.get(directoryKey).text);
assert.equal(rebuiltDirectory.version, 5);
assert.match(rebuiltDirectory.entriesDigest, /^[0-9a-f]{64}$/);
assert.deepEqual(rebuiltDirectory.entries.map((entry) => entry.ticker), ["DTST", "TWST"]);
const mappedState = JSON.parse(objects.get(sensorStateKey).text);
assert.equal(mappedState.pending[0].ticker, "TWST");
assert.notEqual(mappedState.pending[0].ticker, "DTST");
assert.equal(mappedState.pending[0].mappingMethod, "official_sec_cik_exact");

putObject(directoryKey, {
  ...rebuiltDirectory,
  entriesWithCik: 1,
  entries: rebuiltDirectory.entries.slice(0, 1),
});
const recoveredDirectoryMapping = await directory.enrichPr262SensorCompanyMappings();
assert.equal(recoveredDirectoryMapping.directoryCompanies, 2, "A truncated cached directory must fail its digest and rebuild from immutable batches.");
assert.equal(JSON.parse(objects.get(directoryKey).text).entries.length, 2);

const resolved = await directory.readPr262ResolvedSensorCompany(parsed.events[0].id);
assert.equal(resolved.event.ticker, "TWST");
assert.equal(resolved.directoryEntry.batchKey, batchKey);
assert.equal(resolved.directoryEntry.analysisIndex, 0);
assert.equal(resolved.directoryEntry.cik, "0001581280");
assert.equal(resolved.valueAnalysis.ticker, "TWST");
assert.equal(resolved.valueAnalysis.cik, undefined);

const unknownCik = directory.resolvePr262SensorDirectoryEntry({
  source: "sec",
  cik: "0009999999",
  ticker: "DTST",
  title: "Twist filing mentions Data Storage Corporation",
}, [resolved.directoryEntry]);
assert.equal(unknownCik.entry, null);
assert.equal(unknownCik.status, "unmapped");
assert.equal(unknownCik.method, "sec_cik_unknown_fail_closed");

const nameOnlyNonSec = directory.resolvePr262SensorDirectoryEntry({
  source: "company_news",
  cik: null,
  ticker: null,
  title: "Twist Bioscience Corporation announces a material contract",
}, rebuiltDirectory.entries);
assert.equal(nameOnlyNonSec.entry, null);
assert.equal(nameOnlyNonSec.method, "structured_ticker_required_fail_closed");
const explicitTickerNonSec = directory.resolvePr262SensorDirectoryEntry({
  source: "company_news",
  cik: null,
  ticker: "DTST",
  title: "A headline mentioning Twist Bioscience Corporation",
}, rebuiltDirectory.entries);
assert.equal(explicitTickerNonSec.entry.ticker, "DTST");
assert.equal(explicitTickerNonSec.method, "structured_ticker_exact");

for (const unsafeEntry of [
  { ...resolved.directoryEntry, isPrimaryListing: false },
  { ...resolved.directoryEntry, securityType: null },
  { ...resolved.directoryEntry, exchange: null },
]) {
  const unsafeSecResolution = directory.resolvePr262SensorDirectoryEntry({
    source: "sec",
    cik: "0001581280",
    ticker: "TWST",
    title: "Official filing",
  }, [unsafeEntry]);
  assert.equal(unsafeSecResolution.entry, null);
  const unsafeTickerResolution = directory.resolvePr262SensorDirectoryEntry({
    source: "company_news",
    cik: null,
    ticker: "TWST",
    title: "Structured ticker item",
  }, [unsafeEntry]);
  assert.equal(unsafeTickerResolution.entry, null);
}

const next = await sensor.readNextPr262PendingSensorEvent({ now, minimumPriority: 80 });
assert.equal(next.id, parsed.events[0].id);
const nextRetryAt = new Date(now.getTime() + 30 * 60_000).toISOString();
const retry = await sensor.retryPr262PendingSensorEvent({
  eventId: parsed.events[0].id,
  error: "temporary source failure",
  nextRetryAt,
  attemptedAt: now,
});
assert.equal(retry.retried, true);
assert.equal(await sensor.readNextPr262PendingSensorEvent({ now, minimumPriority: 80 }), null);
const afterRetry = await sensor.readPr262ChangeSensorState();
assert.equal(afterRetry.pending[0].queueAttempts, 1);
assert.equal(afterRetry.pending[0].queueNextAttemptAt, nextRetryAt);
assert.equal(afterRetry.cursors.directIssuerFeedIndex, 37);
assert.equal(afterRetry.cloudflareSensor.owner, "cloudflare_worker");
assert.equal(afterRetry.cloudflareSensor.lastScanId, "cf-scan-test");
assert.equal(afterRetry.sensorReadiness.exposureReady, true);
const acknowledged = await sensor.acknowledgePr262PendingSensorEvent(parsed.events[0].id);
assert.equal(acknowledged.acknowledged, true);
const afterAcknowledgement = await sensor.readPr262ChangeSensorState();
assert.equal(afterAcknowledgement.pending.length, 0);
assert.equal(afterAcknowledgement.cursors.directIssuerFeedIndex, 37);
assert.equal(afterAcknowledgement.cloudflareSensor.owner, "cloudflare_worker");
assert.equal(afterAcknowledgement.cloudflareSensor.lastRunKey, "branch-labs/pr-262/cloudflare-shadow/sensor/runs/test.json");
assert.equal(afterAcknowledgement.sensorReadiness.universeReady, true);

const batchMappedBase = {
  ...parsed.events[0],
  source: "company_news",
  sourceProvider: "batch_test_news",
  ticker: "TWST",
  company: "Twist Bioscience Corporation",
  tradingViewSymbol: "NASDAQ:TWST",
  mappingStatus: "mapped",
  mappingMethod: "structured_ticker_exact",
  cik: null,
  form: null,
  accession: null,
  canonicalSecIndexUrl: null,
  identityMethod: "not_applicable",
};
const batchAcknowledged = { ...batchMappedBase, id: "sec:batch-acknowledged", queueAttempts: 0 };
const batchRetried = { ...batchMappedBase, id: "sec:batch-retried", queueAttempts: 1 };
putObject(sensorStateKey, { ...afterAcknowledgement, pending: [batchAcknowledged, batchRetried] });
const revisionBeforeBatch = revision;
const batchRetryAt = new Date(now.getTime() + 45 * 60_000).toISOString();
const batchMutation = await sensor.applyPr262PendingSensorEventMutations([
  { action: "acknowledge", eventId: batchAcknowledged.id },
  { action: "retry", eventId: batchRetried.id, error: "bounded retry", nextRetryAt: batchRetryAt, attemptedAt: now },
]);
assert.equal(batchMutation.writes, 1, "A cycle must checkpoint all queue outcomes with one R2 upload.");
assert.equal(revision, revisionBeforeBatch + 1, "Acknowledgements and retries must not rewrite the full queue once per event.");
assert.equal(batchMutation.acknowledged, 1);
assert.equal(batchMutation.retried, 1);
const afterBatchMutation = await sensor.readPr262ChangeSensorState();
assert.deepEqual(afterBatchMutation.pending.map((event) => event.id), [batchRetried.id]);
assert.equal(afterBatchMutation.pending[0].queueAttempts, 2);
assert.equal(afterBatchMutation.pending[0].queueNextAttemptAt, batchRetryAt);

const mappedDueRetry = {
  ...parsed.events[0],
  id: "sec:mapped-due-retry",
  ticker: "TWST",
  company: "Twist Bioscience Corporation",
  mappingStatus: "mapped",
  mappingMethod: "official_sec_cik_exact",
  priority: 80,
  queueAttempts: 2,
  queueNextAttemptAt: now.toISOString(),
};
const unmappedFlood = Array.from({ length: 2_500 }, (_, index) => ({
  ...parsed.events[0],
  id: `sec:unmapped-${index}`,
  ticker: null,
  company: null,
  mappingStatus: "unmapped",
  mappingMethod: "sec_cik_unknown_fail_closed",
  priority: 100,
  observedAt: new Date(now.getTime() - 60_000).toISOString(),
}));
const partitionedQueue = sensor.partitionPr262PendingEvents([...unmappedFlood, mappedDueRetry], now);
assert.equal(partitionedQueue[0].id, mappedDueRetry.id, "A due mapped retry must outrank unmapped discovery noise");
assert.equal(partitionedQueue.filter((item) => item.mappingStatus !== "mapped").length, 500, "Unresolved discovery has its own bounded partition");
assert.equal(partitionedQueue.some((item) => item.id === mappedDueRetry.id), true, "Unmapped SEC volume must not evict a mapped retry");
const expiredUnmapped = { ...unmappedFlood[0], id: "sec:expired-unmapped", observedAt: new Date(now.getTime() - 25 * 60 * 60_000).toISOString() };
assert.equal(sensor.partitionPr262PendingEvents([expiredUnmapped, mappedDueRetry], now).some((item) => item.id === expiredUnmapped.id), false, "Unmapped discovery must expire after one day");
const olderUntouched = { ...mappedDueRetry, id: "sec:older-untouched", priority: 100, queueAttempts: 0, queueNextAttemptAt: null, observedAt: new Date(now.getTime() - 10 * 60_000).toISOString() };
const freshUntouched = { ...olderUntouched, id: "sec:fresh-untouched", observedAt: new Date(now.getTime() - 60_000).toISOString() };
const freshPriorityQueue = sensor.partitionPr262PendingEvents([olderUntouched, freshUntouched], now);
assert.deepEqual(freshPriorityQueue.map((item) => item.id), [freshUntouched.id, olderUntouched.id], "Untouched equal-priority filings must be newest-first");
const expiredMapped = { ...mappedDueRetry, id: "sec:expired-mapped", observedAt: new Date(now.getTime() - 49 * 60 * 60_000).toISOString() };
assert.equal(sensor.partitionPr262PendingEvents([expiredMapped], now).length, 0, "A mapped event must not become a permanent analysis backlog after 48 hours.");
const secondaryNews = { ...freshUntouched, id: "news:secondary", source: "company_news", priority: 100 };
const permanentlyUnmappableNews = {
  ...secondaryNews,
  id: "news:no-structured-ticker",
  ticker: null,
  company: null,
  mappingStatus: "unmapped",
  mappingMethod: "structured_ticker_required_fail_closed",
};
assert.equal(sensor.partitionPr262PendingEvents([permanentlyUnmappableNews, mappedDueRetry], now).some((item) => item.id === permanentlyUnmappableNews.id), false, "Tickerless non-SEC research can never satisfy the exact-issuer gate and must not become backlog.");
const officialSec = { ...olderUntouched, id: "sec:official-first", source: "sec", priority: 80 };
assert.equal(sensor.partitionPr262PendingEvents([secondaryNews, officialSec], now)[0].id, officialSec.id, "Fresh SEC and issuer evidence must be analyzed before secondary news noise.");
const retriedSecondaryNews = { ...secondaryNews, id: "news:retried-secondary", queueAttempts: 3, queueNextAttemptAt: now.toISOString() };
assert.equal(sensor.partitionPr262PendingEvents([retriedSecondaryNews, officialSec], now)[0].id, officialSec.id, "A noisy retry must never jump ahead of fresh SEC evidence.");
const contextualFanout = {
  ...officialSec,
  id: "official:macro:fanout:SAFE",
  source: "official",
  mappingMethod: "deterministic_sector_fanout",
};
assert.equal(sensor.partitionPr262PendingEvents([contextualFanout, officialSec], now).some((item) => item.id === contextualFanout.id), false, "Broad sector fan-out belongs in context telemetry, not the issuer evidence queue.");
const legacyEnrichedFanout = {
  ...contextualFanout,
  mappingMethod: "structured_ticker_exact",
  mappingReason: "An explicit source ticker matched the authoritative U.S. universe.",
};
assert.equal(sensor.partitionPr262PendingEvents([legacyEnrichedFanout, officialSec], now).some((item) => item.id === legacyEnrichedFanout.id), false, "Directory enrichment must not disguise an older context-only fan-out as issuer evidence.");
const legacyMarketEvent = {
  ...mappedDueRetry,
  id: "v3-market:legacy-minute-one",
  source: "market_price",
  sourceProvider: "tradingview_quality_watchlist_v3",
  kind: "strong_buy_price_crossed",
  observedAt: "2026-08-27T09:00:00.000Z",
  queueAttempts: 0,
  queueNextAttemptAt: null,
};
const repeatedLegacyMarketEvent = {
  ...legacyMarketEvent,
  id: "v3-market:legacy-minute-two",
  observedAt: "2026-08-27T09:05:00.000Z",
};
const nextDayMarketEvent = {
  ...legacyMarketEvent,
  id: "v3-market:next-day",
  observedAt: "2026-08-28T03:00:00.000Z",
};
const compactedMarketQueue = sensor.partitionPr262PendingEvents([legacyMarketEvent, repeatedLegacyMarketEvent, nextDayMarketEvent], now);
assert.deepEqual(
  compactedMarketQueue.map((item) => item.id),
  [],
  "Legacy price-only research must leave the Serious Signal evidence queue; its current value is carried by the compact Watchlist snapshot.",
);

putObject(universeKey, {
  version: 1,
  scope: "active_us_exchange_listed_common_equities_and_adrs",
  constructionMode: "nasdaq_plus_sec",
  refreshedAt: new Date(Date.now() - 2 * 24 * 60 * 60_000).toISOString(),
  entries: [{ ticker: "TWST", name: "Twist Bioscience Corporation", exchange: "NASDAQ", cik: "0001581280", securityType: "common_stock" }],
});
await assert.rejects(
  () => directory.enrichPr262SensorCompanyMappings(),
  /pr262_authoritative_equity_universe_stale/,
);
objects.delete(universeKey);
await assert.rejects(
  () => directory.enrichPr262SensorCompanyMappings(),
  /pr262_authoritative_equity_universe_missing/,
);

console.log(JSON.stringify({
  ok: true,
  officialSecIdentityParsedFromArchiveLink: true,
  inlineXbrlSecLinkCanonicalized: true,
  missingAndFutureFeedTimestampsFailClosed: true,
  invalidFeedTimestampsReportPartialCoverage: true,
  twoPartialSecFeedsRemainPartial: true,
  secCompanyMappingUsesExactCikOnly: true,
  nonSecCompanyNameFallbackRemoved: true,
  explicitStructuredTickerMappingRetained: true,
  valueRowsWithoutCikJoinFreshCachedUniverse: true,
  unsafeOldDirectoryCacheVersionRebuilt: true,
  nonPrimaryAndNullSecurityRowsRejected: true,
  wrongMentionedTickerBlocked: true,
  unknownCikFailsClosed: true,
  exactValueBatchPointerPreserved: true,
  staleUniverseFailsClosed: true,
  missingUniverseFailsClosed: true,
  blindProviderStateIsReported: true,
  successfulProviderCadencesPersisted: true,
  healthySkippedSourcesReportedAsNotDue: true,
  providerAndEventRetriesPersistedInR2: true,
  eventAcknowledgementPreservesQueueState: true,
  railwayAnalysisPreservesCloudflareOwnershipMetadata: true,
  mappedRetriesProtectedFromUnmappedQueueFloods: true,
  unresolvedQueuePartitionExpiresAfterOneDay: true,
  mappedQueueExpiresAfterFortyEightHours: true,
  officialEvidencePrioritized: true,
  freshEqualPriorityFilingsRunNewestFirst: true,
  legacyMarketQueueMovesToWatchlistResearch: true,
  maximumSecFeedCallsPerCycle: 2,
  quietCycleAiCalls: 0,
  quietCycleDeepAnalysisCalls: 0,
}, null, 2));
