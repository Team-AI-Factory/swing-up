import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadTsModule } from "./helpers/load-typescript-module.mjs";

const cohort = JSON.parse(readFileSync(new URL("../config/simple-alert-pilot.json", import.meta.url))).companies;
const seeds = JSON.parse(readFileSync(new URL("../config/simple-alert-issuer-sources.json", import.meta.url))).companies;
assert.equal(cohort.length, 25);
assert.equal(seeds.length, 25);
assert.equal(new Set(seeds.map(row => `${row.ticker}:${row.cik}`)).size, 25);
for (const seed of seeds) {
  assert.ok(cohort.some(row => row.ticker === seed.ticker && row.cik === seed.cik));
  assert.match(seed.investorWebsite, /^https:\/\//);
  assert.ok(seed.sourcePageUrl && Number.isFinite(Date.parse(seed.verifiedAt)));
}
const orchestrator = readFileSync(new URL("../lib/opportunity-engine/pr262-cron-orchestrator.ts", import.meta.url), "utf8");
const sensor = readFileSync(new URL("../lib/opportunity-engine/pr262-lightweight-sensor-v3.ts", import.meta.url), "utf8");
assert.match(orchestrator, /PILOT_MAX_CYCLE_MS = 540_000/);
assert.match(orchestrator, /PILOT_MIN_PAID_REVIEW_BUDGET_MS = 335_000/);
assert.match(orchestrator, /PILOT_DELIVERY_RESERVE_MS = 45_000/);
assert.match(orchestrator, /REPORTING_RESERVE_MS = 15_000/);
assert.match(sensor, /Math.min\(startedAtMs \+ 60_000, input.deadlineAtMs \?\? startedAtMs \+ 45_000\)/);
assert.equal(540_000 - 30_000 - 60_000 - 55_000 - 45_000 - 15_000, 335_000,
  "Early recovery, source window and pre-admission overhead preserve paid and delivery reserves.");
assert.match(sensor, /newEvents: direct.events.length - \(direct.initialCatchupEvents \?\? 0\)/,
  "First-read catch-up cannot count as newly monitored live events.");
const realDate = Date;
let clock = realDate.parse("2026-10-03T16:45:00.000Z");
class TestDate extends realDate {
  constructor(...args) { super(...(args.length ? args : [clock])); }
  static now() { return clock; }
}
globalThis.Date = TestDate;
let objects = new Map(), revision = 0, network = [];
let storageDelayMs = 0, sourceDelayMs = 0, registryFault = null;
const prefix = "branch-labs/simple-alerts/cohorts/test/";
const overrides = {
  "@/lib/simple-alert-pilot-runtime": { isSimpleAlertPilot: () => true },
  "@/lib/simple-alert-pilot-scope": { pilotCompanies: () => cohort },
  "@/lib/opportunity-engine/pr262-storage": { pr262StorageKey: relative => prefix + relative },
  "node:dns/promises": { lookup: async () => [{ address: "93.184.216.34", family: 4 }] },
  "node:timers/promises": { setTimeout: async ms => { clock += ms; } },
  "@/lib/r2-warehouse": {
    readVersionedTextFromR2: async key => {
      clock += storageDelayMs;
      if (registryFault === "read" && key.endsWith("direct-company-feeds-v1.json")) throw new Error("r2_state_read_http_502");
      const saved = objects.get(key);
      return { found: Boolean(saved), text: saved ? JSON.stringify(saved.value) : null, etag: saved?.etag ?? null };
    },
    writeVersionedJsonToR2: async (key, value, options) => {
      clock += storageDelayMs;
      if (registryFault === "write" && key.endsWith("direct-company-feeds-v1.json")) throw new Error("r2_state_write_http_502");
      const prior = objects.get(key);
      if ((options?.createOnly && prior) || (options?.expectedEtag && options.expectedEtag !== prior?.etag)) return { written: false, conflict: true, etag: null };
      const etag = `test-${++revision}`;
      objects.set(key, { value: structuredClone(value), etag });
      return { written: true, conflict: false, etag };
    },
  },
};
const budgetModule = loadTsModule("@/lib/opportunity-engine/pr262-sensor-fetch-budget", overrides);
const direct = loadTsModule("@/lib/opportunity-engine/pr262-direct-announcements", overrides);
const rootUrl = row => `https://data.sec.gov/submissions/CIK${row.cik}.json`;
const body = row => ({ cik: Number(row.cik), tickers: [row.ticker], filings: { recent: { accessionNumber: [], form: [], filingDate: [], primaryDocument: [] }, files: [] } });
const count = () => Object.values(objects.get(prefix + "sensor/provider-budgets-v1.json").value.hourlyCounts.sensor_sec_submissions).reduce((sum, v) => sum + v, 0);
const makeBudget = async (custom) => budgetModule.createPr262SensorBudgetedFetch({ fetchImpl: async (request, init) => {
  network.push(String(request));
  assert.ok(objects.has(prefix + "sensor/provider-budgets-v1.json"), "Reservation precedes network.");
  return custom ? custom(request, init) : new Response(JSON.stringify(body(cohort[0])), { headers: { "content-type": "application/json" } });
} });
try {
  const first = await makeBudget();
  const response = await first.fetchImpl(rootUrl(cohort[0]));
  const fetchedAt = response.headers.get("x-swingup-submissions-fetched-at");
  assert.equal(response.headers.get("x-swingup-submissions-cache"), "network");
  assert.equal(count(), 1);
  clock += 10 * 60_000;
  const restarted = await makeBudget();
  const hit = await restarted.fetchImpl(rootUrl(cohort[0]));
  assert.equal(hit.headers.get("x-swingup-submissions-cache"), "hit");
  assert.equal(hit.headers.get("x-swingup-submissions-fetched-at"), fetchedAt, "Cache reads must not freshen source timestamps.");
  assert.equal(network.length, 1);
  assert.equal(count(), 1, "Cache reuse cannot consume or erase reservations.");
  const abort = new AbortController(); abort.abort();
  await assert.rejects(() => restarted.fetchImpl(rootUrl(cohort[0]), { signal: abort.signal }));
  clock += 19 * 60_000;
  const renewed = await restarted.fetchImpl(rootUrl(cohort[0]));
  assert.equal(renewed.headers.get("x-swingup-submissions-cache"), "network");
  assert.equal(count(), 2);
  assert.equal(network.length, 2);
  const cacheKey = prefix + `sensor/submissions-cache/${cohort[0].cik}.json`;
  objects.get(cacheKey).value.cik = cohort[1].cik;
  await assert.rejects(() => restarted.fetchImpl(rootUrl(cohort[0])), /minimum_interval/, "Invalid cache identity must fall back to unchanged hard guard.");
  assert.equal(network.length, 2);

  // Wrong issuer/invalid response is never persisted as reusable evidence.
  const mismatch = await makeBudget(() => new Response(JSON.stringify(body(cohort[0]))));
  await mismatch.fetchImpl(rootUrl(cohort[1]));
  assert.equal(objects.has(prefix + `sensor/submissions-cache/${cohort[1].cik}.json`), false);
  await assert.rejects(() => mismatch.fetchImpl(rootUrl(cohort[1])), /minimum_interval/);

  // A syntactically complete 206 is still a partial HTTP representation and
  // must neither populate a snapshot nor be silently promoted to status 200.
  const partial = await makeBudget(() => new Response(JSON.stringify(body(cohort[2])), { status: 206 }));
  const partialResponse = await partial.fetchImpl(rootUrl(cohort[2]));
  assert.equal(partialResponse.status, 206);
  assert.equal(partialResponse.headers.get("x-swingup-submissions-cache"), null);
  assert.equal(objects.has(prefix + `sensor/submissions-cache/${cohort[2].cik}.json`), false);

  // No cache widening to historical archives or issuers outside the fixed 25.
  const outside = await makeBudget(() => new Response(JSON.stringify({ cik: 1, tickers: ["OTHER"], filings: { recent: { accessionNumber: [] } } })));
  await outside.fetchImpl("https://data.sec.gov/submissions/CIK0000000001.json");
  await outside.fetchImpl(`https://data.sec.gov/submissions/CIK${cohort[0].cik}-submissions-001.json`);
  assert.ok([...objects.keys()].filter(key => key.includes("submissions-cache/")).every(key => key === cacheKey));

  objects = new Map(); network = []; clock = realDate.parse("2026-10-03T16:45:00.000Z");
  const exposure = cohort.map(row => ({ ...row, currentPrice: null, strongBuyBelowPrice: null, buyBelowPrice: null, trimAbovePrice: null, businessQuality: 70, marketCap: null }));
  const registeredOnly = await direct.runPr262DirectAnnouncementMonitor({ exposure, now: new Date(), deadlineAtMs: clock + 4999,
    fetchImpl: async () => { throw new Error("Registration must not invent a source read."); } });
  assert.equal(registeredOnly.issuerSourceCoverage.length, 25);
  assert.ok(registeredOnly.issuerSourceCoverage.every(row => row.sec.status === "not_checked"
    && row.ir.lastSuccessAt === null && row.ir.seedVerifiedAt && row.ir.seedRegistrationIsSuccessfulPoll === false));
  assert.equal(registeredOnly.events.length, 0);
  const calls = [];
  const makeMonitorBudget = () => budgetModule.createPr262SensorBudgetedFetch({ fetchImpl: async request => {
    const url = String(request); calls.push(url);
    if (url.startsWith("https://data.sec.gov/submissions/")) {
      const company = cohort.find(row => rootUrl(row) === url); assert.ok(company);
      clock += sourceDelayMs;
      return new Response(JSON.stringify(body(company)));
    }
    if (seeds.some(row => row.feedUrl === url)) return new Response("<rss><channel></channel></rss>");
    return new Response("<html><body>No linked feed</body></html>");
  } });
  const observed = new Set();
  for (let turn = 0; turn < 4; turn++) {
    const started = clock;
    const budget = await makeMonitorBudget();
    const result = await direct.runPr262DirectAnnouncementMonitor({ exposure, now: new Date(), fetchImpl: budget.fetchImpl, deadlineAtMs: clock + 25_000 });
    assert.ok(clock - started <= 25_000);
    assert.ok(result.secCheckAttempts <= 13);
    assert.equal(result.issuerSourceCoverage.length, 25);
    assert.equal(result.currentEligibleCompaniesKnown, 25);
    assert.equal(result.events.length, 0, "Registration and old feed metadata cannot invent news.");
    for (const row of result.issuerSourceCoverage) if (row.sec.snapshotFetchedAt) observed.add(row.ticker);
    if (turn >= 1) {
      assert.equal(observed.size, 25, "All exact CIKs receive independent submission coverage within two fast cycles.");
      assert.ok(result.issuerSourceCoverage.every(row => row.sec.status === "current_snapshot"),
        "Two rotating batches must keep all 25 snapshots current at each completed scheduled cycle.");
    }
    clock = started + 15 * 60_000;
  }
  assert.equal(observed.size, 25, "All exact CIKs receive independent submission coverage within two fast cycles.");
  // R2 reads/writes and provider latency make the real path slower than the
  // 1/sec pacing alone. Thirteen checks still fit the bounded SEC / direct
  // slices in this deterministic 200ms-storage + 800ms-network scenario.
  storageDelayMs = 200; sourceDelayMs = 800;
  const delayedBudget = await makeMonitorBudget();
  const delayedStart = clock;
  const delayed = await direct.runPr262DirectAnnouncementMonitor({ exposure, now: new Date(), fetchImpl: delayedBudget.fetchImpl,
    deadlineAtMs: delayedStart + 45_000 });
  assert.equal(delayed.secCheckAttempts, 13);
  assert.ok(clock - delayedStart > 14_000, "Regression must exceed the inadequate old SEC slice.");
  assert.ok(clock - delayedStart < 35_000, "Bounded simulated overhead must preserve the absolute sensor window.");
  assert.ok(delayed.issuerSourceCoverage.every(row => row.sec.status === "current_snapshot"));
  storageDelayMs = 0; sourceDelayMs = 0;
  // Busy SEC/feed cycles can truthfully defer discovery. Give a current SEC
  // issuer a separate complete optional slice before asserting no-feed backoff.
  const pendingFeedless = objects.get(prefix + "sensor/direct-company-feeds-v1.json").value.entries.find(row => !row.feedUrl);
  await direct.runPr262DirectAnnouncementMonitor({ exposure: exposure.filter(row => row.ticker === pendingFeedless.ticker),
    now: new Date(), fetchImpl: (await makeMonitorBudget()).fetchImpl });
  const registry = objects.get(prefix + "sensor/direct-company-feeds-v1.json").value;
  const feedless = registry.entries.find(row => !row.feedUrl && row.error === "issuer_rss_feed_not_discovered");
  assert.ok(Date.parse(feedless.nextCheckAt) > clock + 20 * 86400_000);
  const secBefore = calls.filter(url => url === rootUrl(feedless)).length;
  clock += 31 * 60_000;
  await direct.runPr262DirectAnnouncementMonitor({ exposure: exposure.filter(row => row.ticker === feedless.ticker), now: new Date(), fetchImpl: (await makeMonitorBudget()).fetchImpl });
  assert.equal(calls.filter(url => url === rootUrl(feedless)).length, secBefore + 1, "30-day no-RSS retry must never stop ongoing SEC monitoring.");

  // First-read catch-up retains true dates, labels provenance, and avoids the
  // old common-URL-prefix collision. Stale articles never become events.
  objects = new Map();
  const company = cohort[0];
  const publishedAt = new Date(clock - 3600_000).toISOString();
  const freshFeed = `<rss><channel>${["one", "two"].map(label => `<item><title>${label}</title><link>https://same.example/very/long/shared/path/${label}</link><pubDate>${publishedAt}</pubDate></item>`).join("")}<item><title>old</title><link>https://same.example/old</link><pubDate>2020-01-01T00:00:00Z</pubDate></item></channel></rss>`;
  const firstRead = await direct.runPr262DirectAnnouncementMonitor({ exposure: [exposure[0]], now: new Date(), fetchImpl: async request => {
    if (String(request) === rootUrl(company)) return new Response(JSON.stringify(body(company)));
    return new Response(freshFeed);
  } });
  assert.equal(firstRead.events.length, 2);
  assert.equal(new Set(firstRead.events.map(row => row.id)).size, 2);
  assert.ok(firstRead.events.every(row => row.observedAt === publishedAt && row.reason.includes("Initial source catch-up")));
  assert.equal(firstRead.initialCatchupEvents, 2);
  const expired = await direct.runPr262DirectAnnouncementMonitor({ exposure: [exposure[0]], now: new Date(), deadlineAtMs: clock + 4999, fetchImpl: async () => { throw new Error("deadline bypass"); } });
  assert.equal(expired.attemptCount, 0);
  assert.equal(expired.sourceCollectionDeadlineReached, true);
  assert.equal(expired.issuerSourceCoverage[0].sec.snapshotFetchedAt, firstRead.issuerSourceCoverage[0].sec.snapshotFetchedAt);

  objects = new Map();
  let refusedSecCalls = 0;
  const refused = await direct.runPr262DirectAnnouncementMonitor({ exposure, now: new Date(), fetchImpl: async request => {
    if (String(request).startsWith("https://data.sec.gov/")) { refusedSecCalls++; return new Response("rate limited", { status: 429 }); }
    return new Response("<rss><channel></channel></rss>");
  } });
  assert.equal(refusedSecCalls, 1, "Explicit SEC rate refusal must stop that cycle's issuer rotation.");
  assert.equal(refused.secCheckFailures, 1);
  assert.equal(refused.secCheckAttempts, 1);
  assert.equal(refused.secCheckSuccesses, 0);

  objects = new Map();
  let partialSecCalls = 0;
  const partialDirect = await direct.runPr262DirectAnnouncementMonitor({ exposure: [exposure[0]], now: new Date(), fetchImpl: async request => {
    if (String(request) === rootUrl(cohort[0])) {
      partialSecCalls++;
      return new Response(JSON.stringify(body(cohort[0])), { status: 206 });
    }
    return new Response("<rss><channel></channel></rss>");
  } });
  assert.equal(partialSecCalls, 1);
  assert.equal(partialDirect.secCheckAttempts, 1);
  assert.equal(partialDirect.secCheckFailures, 1);
  assert.equal(partialDirect.secCheckSuccesses, 0);
  assert.equal(partialDirect.secSubmissionsChecked, 0);
  assert.equal(partialDirect.issuerSourceCoverage[0].sec.snapshotFetchedAt, null);

  const schema = loadTsModule("@/lib/opportunity-engine/pr262-sec-submissions-schema", overrides);
  assert.equal(schema.completePr262SecSubmissionsRoot(body(cohort[0]), cohort[0]), true, "Empty aligned arrays are complete.");
  const nonEmptyBody = () => ({ ...body(cohort[0]), filings: { recent: {
    accessionNumber: [`${cohort[0].cik}-26-000999`], form: ["8-K"],
    filingDate: [new Date(clock - 60_000).toISOString().slice(0, 10)], primaryDocument: ["report.htm"],
    acceptanceDateTime: [new Date(clock - 60_000).toISOString()],
  } } });
  assert.equal(schema.completePr262SecSubmissionsRoot(nonEmptyBody(), cohort[0]), true);
  const malformedRoots = [
    (() => { const value = body(cohort[0]); delete value.filings.recent.form; return value; })(),
    (() => { const value = nonEmptyBody(); value.filings.recent.primaryDocument = []; return value; })(),
    (() => { const value = nonEmptyBody(); delete value.filings.recent.acceptanceDateTime; return value; })(),
    (() => { const value = nonEmptyBody(); value.filings.recent.acceptanceDateTime = ["2026-10-03"]; return value; })(),
  ];
  for (const malformed of malformedRoots) {
    assert.equal(schema.completePr262SecSubmissionsRoot(malformed, cohort[0]), false);
    objects = new Map();
    const malformedBudget = await budgetModule.createPr262SensorBudgetedFetch({ fetchImpl: async () => new Response(JSON.stringify(malformed)) });
    await malformedBudget.fetchImpl(rootUrl(cohort[0]));
    assert.equal(objects.has(prefix + `sensor/submissions-cache/${cohort[0].cik}.json`), false,
      "Malformed 200 must never become a reusable complete root snapshot.");
    objects = new Map();
    const malformedDirect = await direct.runPr262DirectAnnouncementMonitor({ exposure: [exposure[0]], now: new Date(), fetchImpl: async request =>
      String(request) === rootUrl(cohort[0]) ? new Response(JSON.stringify(malformed)) : new Response("<rss><channel></channel></rss>") });
    assert.equal(malformedDirect.secCheckAttempts, 1);
    assert.equal(malformedDirect.secCheckSuccesses, 0);
    assert.equal(malformedDirect.secCheckFailures, 1);
    assert.equal(malformedDirect.secSubmissionsChecked, 0);
    assert.equal(malformedDirect.issuerSourceCoverage[0].sec.snapshotFetchedAt, null);
    assert.equal(malformedDirect.events.length, 0);
  }

  // A cached read and a real failed network read give 1 attempt / 1 failure,
  // not 2 attempts / 1 failure. The cache remains outside the paced network
  // callback used by the profile consumer, so it cannot increment requests.
  objects = new Map();
  let consumerRequests = 0;
  const sharedBudget = await budgetModule.createPr262SensorBudgetedFetch({ fetchImpl: async request => {
    consumerRequests++;
    if (String(request) === rootUrl(cohort[0])) return new Response(JSON.stringify(body(cohort[0])));
    return new Response("upstream failure", { status: 500 });
  } });
  await sharedBudget.fetchImpl(rootUrl(cohort[0]));
  assert.equal(consumerRequests, 1);
  await direct.runPr262DirectAnnouncementMonitor({ exposure: exposure.slice(0, 2), now: new Date(), deadlineAtMs: clock + 4999 });
  const cachedRegistry = objects.get(prefix + "sensor/direct-company-feeds-v1.json").value;
  cachedRegistry.lastDiscoveryCycleAt = new Date().toISOString();
  for (const row of cachedRegistry.entries) row.nextCheckAt = new Date(clock + 86400_000).toISOString();
  const mixed = await direct.runPr262DirectAnnouncementMonitor({ exposure: exposure.slice(0, 2), now: new Date(), fetchImpl: sharedBudget.fetchImpl });
  assert.equal(mixed.secCacheHits, 1);
  assert.equal(mixed.secCheckAttempts, 1);
  assert.equal(mixed.secCheckFailures, 1);
  assert.equal(mixed.secCheckSuccesses, 0);
  assert.equal(mixed.attemptCount, 1);
  assert.equal(mixed.failureCount, 1);
  assert.equal(consumerRequests, 2, "Only initial cache fill and genuine failed network call reach consumer pacing/counters.");

  // Exercise the real sensor, direct monitor, queue partition and persistence.
  // Only unrelated external sources are disabled. The first feed read queues
  // catch-up with original dates while daily newEvents remains zero; a later
  // genuinely new release increments newEvents exactly once.
  objects = new Map();
  const disabledProvider = async () => { throw new Error("Unrelated provider should not run in this regression."); };
  const sensorRuntime = loadTsModule("@/lib/opportunity-engine/pr262-lightweight-sensor-v3", {
    ...overrides,
    "@/lib/simple-alert-pilot-scope": { pilotCompanies: () => cohort, pilotSourceEnabled: () => false,
      pilotIncludes: row => cohort.some(company => company.ticker === row.ticker && company.cik === row.cik) },
    "@/lib/opportunity-engine/pr262-pilot-watch-valuation": { pilotWatchExposure: () => [exposure[0]], persistPilotWatchValuations: disabledProvider },
    "@/lib/opportunity-engine/us-value-investing-engine": { US_VALUE_SCANNER_COLUMNS: [] },
    "@/lib/opportunity-engine/pr262-trade-halt-snapshot": { fetchPr262TradeHalts: disabledProvider },
    "@/lib/equity-signal/event-sources": Object.fromEntries(["fetchAlphaEarningsCalendar", "fetchAlphaNews", "fetchCommerceNews", "fetchFederalRegister", "fetchGdeltDiscovery", "fetchMarketauxDiscovery", "fetchOfficialFeeds", "fetchOpenFdaRecalls"].map(name => [name, disabledProvider])),
    "@/lib/equity-signal/macro": { fetchMacroContext: disabledProvider },
    "@/lib/equity-signal/universe": { validEquityUniverseSnapshot: () => true,
      loadEquityUniverse: async () => ({ snapshot: { version: 1, constructionMode: "nasdaq_plus_sec", refreshedAt: new Date().toISOString(), entries: [{ ...cohort[0], name: cohort[0].company }] } }) },
    "@/lib/opportunity-engine/pr262-exposure-index": { loadPr262ExposureIndex: async () => ({ entries: [exposure[0]] }) },
    "@/lib/opportunity-engine/pr262-direct-announcements": direct,
  });
  let sensorFeed = freshFeed;
  const sensorFetch = async request => String(request) === rootUrl(cohort[0])
    ? new Response(JSON.stringify(body(cohort[0]))) : new Response(sensorFeed);
  const firstSensor = await sensorRuntime.runPr262LightweightSensorV3({ now: new Date(), fetchImpl: sensorFetch });
  assert.equal(firstSensor.sourceWindow.allocatedMs, 45_000, "Standalone sensor callers keep the conservative window");
  assert.equal(firstSensor.directAnnouncementMonitoring.directWorkBudgetMs, 40_000, "The conservative standalone envelope still includes its 5s registry reserve");
  assert.equal(firstSensor.newEvents, 0, "First-read catch-up must not inflate top-level daily new-live-case totals.");
  assert.equal(firstSensor.initialCatchupEvents, 2);
  assert.equal(firstSensor.queueAdmissions, 2);
  assert.equal(firstSensor.pendingEventCount, 2);
  const firstQueue = objects.get(prefix + "sensor/state-v1.json").value.pending;
  assert.ok(firstQueue.every(event => event.observedAt === publishedAt && event.reason.includes("Initial source catch-up")));
  const repeatedSensor = await sensorRuntime.runPr262LightweightSensorV3({ now: new Date(), fetchImpl: sensorFetch, deadlineAtMs: clock + 120_000 });
  assert.equal(repeatedSensor.sourceWindow.allocatedMs, 60_000, "An input deadline cannot exceed the source allocation cap");
  assert.equal(repeatedSensor.directAnnouncementMonitoring.directWorkBudgetMs, 55_000, "An explicit 60s envelope may use its otherwise idle remainder while keeping 5s for registry");
  assert.equal(repeatedSensor.newEvents, 0);
  assert.equal(repeatedSensor.initialCatchupEvents, 0);
  assert.equal(repeatedSensor.queueAdmissions, 0);
  clock += 15 * 60_000;
  const laterPublished = new Date(clock - 60_000).toISOString();
  sensorFeed = freshFeed.replace("</channel>", `<item><title>new contract</title><link>https://same.example/genuine-new-release</link><pubDate>${laterPublished}</pubDate></item></channel>`);
  const laterSensor = await sensorRuntime.runPr262LightweightSensorV3({ now: new Date(), fetchImpl: sensorFetch, deadlineAtMs: clock + 30_000 });
  assert.equal(laterSensor.sourceWindow.allocatedMs, 30_000, "A shorter caller envelope must reach the real monitor");
  assert.equal(laterSensor.directAnnouncementMonitoring.directWorkBudgetMs, 25_000);
  assert.equal(laterSensor.newEvents, 1);
  assert.equal(laterSensor.initialCatchupEvents, 0);
  assert.equal(laterSensor.queueAdmissions, 1);
  assert.equal(laterSensor.pendingEventCount, 3);
  const laterQueue = objects.get(prefix + "sensor/state-v1.json").value.pending;
  assert.equal(laterQueue.filter(event => event.observedAt === publishedAt).length, 2);
  assert.equal(laterQueue.filter(event => event.observedAt === laterPublished).length, 1);

  // Exercise real V3 classification and queue persistence across both registry
  // failure boundaries, not just a stubbed monitor result.
  for (const stage of ["read", "write"]) {
    objects = new Map(); registryFault = stage;
    let sourceCalls = 0;
    const failedRegistry = await sensorRuntime.runPr262LightweightSensorV3({ now: new Date(), fetchImpl: async request => {
      sourceCalls++;
      return sensorFetch(request);
    } });
    const summary = failedRegistry.sourceSummary.find(row => row.provider === "direct_issuer_feeds");
    assert.equal(summary.status, "storage_or_preparation_failed");
    assert.equal(summary.attempted, stage === "write");
    assert.equal(summary.attemptCount, sourceCalls);
    assert.equal(summary.successCount, sourceCalls);
    assert.equal(summary.failureCount, 0, "Private registry errors must not inflate source-network failures");
    assert.equal(failedRegistry.directAnnouncementMonitoring.sourcePreparationFailures, 1);
    assert.equal(failedRegistry.directAnnouncementMonitoring.registryPersistence.failureStage, stage === "read" ? "load" : "write");
    if (stage === "read") {
      assert.equal(sourceCalls, 0);
      assert.equal(failedRegistry.directAnnouncementMonitoring.registeredFeeds, null);
      assert.equal(failedRegistry.directAnnouncementMonitoring.issuerSourceCoverage[0].sec.status, "registry_unavailable");
      assert.equal(failedRegistry.queueAdmissions, 0);
    } else {
      assert.equal(sourceCalls, 2);
      assert.equal(failedRegistry.queueAdmissions, 3, "Actual issuer events survive registry publication failure");
      assert.equal(failedRegistry.newEvents, 0, "First-read catch-up must still remain distinct from new live cases");
      assert.equal(objects.get(prefix + "sensor/state-v1.json").value.pending.length, 3);
      assert.equal(failedRegistry.directAnnouncementMonitoring.registryPersistence.telemetryBasis, "unpersisted_observation");
    }
    assert.equal(objects.has(prefix + "sensor/direct-company-feeds-v1.json"), false);
  }
  registryFault = null;

  console.log(JSON.stringify({ ok: true, cohort25: true, independentSecPolling: true, unchangedProviderGuards: true,
    datedPrivateCache: true, identityAndArchiveIsolation: true, initializationWithinTwoCycles: true,
    sourceDeadlineHonored: true, originalPublicationTimes: true, initialCatchupLabeled: true, topLevelCatchupExcluded: true, exact200Required: true, completeRootSchemaRequired: true, cacheExcludedFromSourceAttempts: true, delayedStorageAndNetworkFits: true, distinctFeedIds: true }, null, 2));
} finally { globalThis.Date = realDate; }
