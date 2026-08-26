import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import {
  PR262_CLOUDFLARE_SENSOR_CONTRACT,
  SensorCoordinatorCore,
  buildHandoffRequest,
  countDueAnalysisEvents,
  parseJsonRows,
  parseRss,
  parseSecAtom,
  partitionPendingEvents,
  reserveProvider,
  refreshQueuedMapping,
  safeDirectHttpsUrl,
  shouldInvokeAnalysisHandoff,
  validExposureReference,
  validUniverseReference,
} from "../cloudflare/pr262-sensor-core.mjs";

const now = new Date("2026-08-19T12:00:00.000Z");
const resolver = {
  resolve({ ticker, cik, company }) {
    if (Number(String(cik).replace(/\D/g, "")) === 1581280) return { ticker: "TWST", company: "Twist Bioscience Corporation", cik: "0001581280", tradingViewSymbol: "NASDAQ:TWST", method: "official_sec_cik_exact" };
    if (ticker === "TWST" || company === "Twist Bioscience Corporation") return { ticker: "TWST", company: "Twist Bioscience Corporation", cik: "0001581280", tradingViewSymbol: "NASDAQ:TWST", method: "structured_ticker_exact" };
    return null;
  },
};

const atom = `<?xml version="1.0"?><feed><entry>
  <title>8-K - Twist Bioscience announces material agreement</title>
  <link rel="alternate" href="https://www.sec.gov/Archives/edgar/data/1581280/000119312526123456/twist.htm" />
  <category term="8-K" />
  <updated>2026-08-19T11:58:00Z</updated>
  <summary>AccNo: 0001193125-26-123456</summary>
</entry></feed>`;
const sec = await parseSecAtom(atom, { now, resolver, provider: "cloudflare_sec_broad", sourceUrl: "https://www.sec.gov/cgi-bin/browse-edgar", form: null });
assert.equal(sec.recordsRead, 1);
assert.equal(sec.events.length, 1);
assert.equal(sec.events[0].ticker, "TWST");
assert.equal(sec.events[0].cik, "0001581280");
assert.equal(sec.events[0].accession, "0001193125-26-123456");
assert.equal(sec.events[0].mappingStatus, "mapped");
assert.match(sec.events[0].canonicalSecIndexUrl, /0001193125-26-123456-index\.html$/);

const rss = `<rss><channel><item><title>NASDAQ: TWST raises guidance</title><link>https://example.com/twst-guidance</link><pubDate>2026-08-19T11:59:00Z</pubDate><description>Material earnings guidance</description></item></channel></rss>`;
const news = await parseRss(rss, { now, resolver, provider: "cloudflare_google_news", sourceUrl: "https://news.google.com/rss/search", official: false, kind: "news" });
assert.equal(news.events.length, 1);
assert.equal(news.events[0].ticker, "TWST");
assert.equal(news.events[0].priority, 90);
const missingDate = await parseRss(rss.replace("<pubDate>2026-08-19T11:59:00Z</pubDate>", ""), { now, resolver, provider: "cloudflare_google_news", sourceUrl: "https://news.google.com/rss/search", official: false, kind: "news" });
assert.equal(missingDate.events.length, 0, "Undated events must fail closed");
assert.equal(missingDate.status, "partial", "Invalid feed records must prevent complete-coverage claims.");
const companyNameOnly = await parseRss(
  rss.replace("NASDAQ: TWST raises guidance", "Twist Bioscience Corporation raises guidance"),
  { now, resolver, provider: "cloudflare_google_news", sourceUrl: "https://news.google.com/rss/search", official: false, kind: "news" },
);
assert.equal(companyNameOnly.events[0].ticker, null, "A company name in prose must never become a structured ticker.");
assert.equal(companyNameOnly.events[0].mappingStatus, "unmapped");
const incompleteSec = await parseSecAtom(
  atom.replace("https://www.sec.gov/Archives/edgar/data/1581280/000119312526123456/twist.htm", "https://www.sec.gov/news/test-filing"),
  { now, resolver, provider: "cloudflare_sec_broad", sourceUrl: "https://www.sec.gov/cgi-bin/browse-edgar", form: null },
);
assert.equal(incompleteSec.events[0].ticker, null, "An SEC headline without a complete official filing identity must remain unresolved.");
assert.equal(incompleteSec.events[0].identityMethod, "sec_identity_unavailable");
assert.equal(incompleteSec.events[0].mappingStatus, "unmapped");
assert.equal(incompleteSec.status, "partial", "Incomplete SEC identity must make source coverage partial.");
await assert.rejects(
  () => parseRss("<html><body>temporary upstream page</body></html>", { now, resolver, provider: "cloudflare_google_news", sourceUrl: "https://news.google.com/rss/search", official: false, kind: "news" }),
  /rss_feed_contract_invalid/,
  "An HTTP 200 with the wrong source schema must not certify coverage",
);
const invalidJsonRows = await parseJsonRows(
  { data: [{ message: "quota response disguised as a data row" }] },
  { now, resolver, provider: "marketaux", sourceUrl: "https://api.marketaux.com/v1/news/all", kind: "news" },
);
assert.equal(invalidJsonRows.status, "partial");
assert.equal(invalidJsonRows.events.length, 0);
await assert.rejects(
  () => parseSecAtom("<html><body>temporary upstream page</body></html>", { now, resolver, provider: "cloudflare_sec_broad", sourceUrl: "https://www.sec.gov/cgi-bin/browse-edgar", form: null }),
  /sec_feed_contract_invalid/,
  "An HTTP 200 with the wrong SEC schema must not certify coverage",
);
await assert.rejects(
  () => parseJsonRows({ status: "ok", message: "temporary fallback page" }, { now, resolver, provider: "marketaux", sourceUrl: "https://api.marketaux.com/v1/news/all", kind: "news" }),
  /json_feed_contract_invalid/,
  "A JSON HTTP 200 with an unrecognized provider schema must not certify coverage",
);

const budgetValues = new Map();
const budgetStorage = {
  async transaction(callback) {
    return callback({
      get: async (key) => budgetValues.get(key),
      put: async (key, value) => { budgetValues.set(key, structuredClone(value)); },
    });
  },
};
assert.equal((await reserveProvider(budgetStorage, "official", now.getTime(), "official:fda")).allowed, true);
assert.equal((await reserveProvider(budgetStorage, "official", now.getTime(), "official:sec")).allowed, true, "Separate feeds may use separate cadence clocks.");
assert.equal((await reserveProvider(budgetStorage, "official", now.getTime(), "official:fda")).reason, "minimum_interval");
assert.equal(Object.values(budgetValues.get("providerBudget").hourlyCounts.official)[0], 2, "All official feeds must share one provider-wide rolling quota.");
assert.equal((await reserveProvider(budgetStorage, "direct_issuer", now.getTime(), "direct_issuer:AAA", 14 * 60_000)).allowed, true);
assert.equal((await reserveProvider(budgetStorage, "direct_issuer", now.getTime(), "direct_issuer:BBB", 59 * 60_000)).allowed, true);
assert.equal(Object.values(budgetValues.get("providerBudget").hourlyCounts.direct_issuer)[0], 2, "Issuer feeds must share one daily network budget while retaining per-issuer cadence.");

const ready = Array.from({ length: 2_050 }, (_, index) => ({ ...news.events[0], id: `ready-${index}`, priority: 80 + (index % 20), observedAt: new Date(now.getTime() - index).toISOString() }));
const unresolved = Array.from({ length: 550 }, (_, index) => ({ ...news.events[0], id: `unresolved-${index}`, ticker: null, mappingStatus: "unmapped", observedAt: new Date(now.getTime() - index).toISOString() }));
const partitioned = partitionPendingEvents([...ready, ...unresolved], now);
assert.equal(partitioned.filter((event) => event.ticker).length, 2_000);
assert.equal(partitioned.filter((event) => !event.ticker).length, 500);
assert.equal(shouldInvokeAnalysisHandoff(true, 0), false, "Quiet production scans must not wake Railway.");
assert.equal(shouldInvokeAnalysisHandoff(true, 1), true, "A retained event must wake Railway immediately.");
assert.equal(shouldInvokeAnalysisHandoff(false, 10), false, "Shadow scans must never wake Railway.");
assert.equal(countDueAnalysisEvents(unresolved, now), 0, "Unresolved discovery records must not repeatedly wake deep analysis.");
assert.equal(countDueAnalysisEvents([{ ...news.events[0], queueAttempts: 1, queueNextAttemptAt: new Date(now.getTime() + 60_000).toISOString() }], now), 0, "A future retry must not wake Railway early.");
assert.equal(countDueAnalysisEvents(news.events, now), 1);
const mappedAfterReferenceRefresh = refreshQueuedMapping({ ...news.events[0], mappingStatus: "unmapped", mappingMethod: "deferred" }, resolver);
assert.equal(mappedAfterReferenceRefresh.mappingStatus, "mapped", "Queued structured identity must recover when authoritative reference data becomes ready.");
assert.equal(refreshQueuedMapping(companyNameOnly.events[0], resolver).mappingStatus, "unmapped", "Queued company prose must remain unmapped after reference refresh.");

const universeReference = {
  version: 1,
  scope: "active_us_exchange_listed_common_equities_and_adrs",
  constructionMode: "nasdaq_plus_sec",
  refreshedAt: now.toISOString(),
  entries: [
    { ticker: "TWST", name: "Twist Bioscience Corporation", exchange: "NASDAQ", cik: "0001581280", securityType: "common_stock", sourceNames: ["SEC company_tickers_exchange"] },
  ],
  coverage: { eligibleEquities: 1, cikMapped: 1 },
};
assert.equal(validUniverseReference(universeReference, now), true);
assert.equal(validUniverseReference({ ...universeReference, constructionMode: "partial_nasdaq_plus_sec" }, now), false, "A partial universe must not certify an empty market-wide result.");
assert.equal(validUniverseReference({ ...universeReference, coverage: { eligibleEquities: 2, cikMapped: 1 } }, now), false, "Universe coverage metadata must match its stored rows.");

const exposureReference = {
  version: 2,
  valueCycleId: "cycle-1",
  builtAt: now.toISOString(),
  valueCoverage: { complete: true, totalCompanies: 1, companiesStored: 1, completedBatches: 1, totalBatches: 1 },
  entries: [{ ticker: "TWST", company: "Twist Bioscience Corporation", tradingViewSymbol: "NASDAQ:TWST", cik: "0001581280" }],
};
assert.equal(validExposureReference(exposureReference, now), true);
assert.equal(validExposureReference({ ...exposureReference, entries: [] }, now), false, "A partial exposure array must not inherit complete metadata.");
assert.equal(validExposureReference({ ...exposureReference, valueCoverage: { ...exposureReference.valueCoverage, totalCompanies: 2, companiesStored: 2 }, entries: [...exposureReference.entries, exposureReference.entries[0]] }, now), false, "Duplicate exposure identities must not hide missing company coverage.");

assert.equal(safeDirectHttpsUrl("/feed.xml", "https://investors.example.com/news"), "https://investors.example.com/feed.xml", "Safe relative issuer redirects must remain usable.");
assert.equal(safeDirectHttpsUrl("https://127.0.0.1/feed.xml"), null, "Private address literals must remain blocked across redirects.");

const scanId = crypto.randomUUID();
const payload = {
  version: 1,
  kind: "pr262_cloudflare_sensor_handoff",
  owner: "cloudflare_worker",
  scanId,
  checkedAt: now.toISOString(),
  stateKey: "production/pr262/sensor/state-v1.json",
  stateEtag: "0123456789abcdef0123456789abcdef",
  runKey: `production/pr262/sensor/runs/2026-08-19/20260819120000000-${scanId}.json`,
  runDigest: "a".repeat(64),
  newEvents: 1,
  pendingEvents: 2,
};
const workerSecret = "h".repeat(48);
const sensorToken = "s".repeat(48);
const handoff = await buildHandoffRequest({
  RAILWAY_HANDOFF_URL: "https://swing-up-production.up.railway.app/api/internal/combined-opportunity-engine/cloudflare-sensor-handoff",
  RAILWAY_HANDOFF_HOST_ALLOWLIST: "swing-up-production.up.railway.app",
  RAILWAY_SENSOR_TOKEN: sensorToken,
  RAILWAY_HANDOFF_SECRET: workerSecret,
}, payload, now);
assert.equal(handoff.init.headers["x-swing-up-pr262-sensor-token"], sensorToken);
assert.equal(handoff.init.redirect, "error", "Railway handoff credentials must never follow redirects.");
assert.equal(handoff.init.headers["x-swing-up-sensor-nonce"], scanId);
assert.match(handoff.init.headers["x-swing-up-sensor-signature"], /^v1=[0-9a-f]{64}$/);

const bodyDigest = crypto.createHash("sha256").update(handoff.init.body).digest("hex");
const signedText = `v1\n${Math.floor(now.getTime() / 1_000)}\n${scanId}\nPOST\n/api/internal/combined-opportunity-engine/cloudflare-sensor-handoff\n${bodyDigest}`;
const expectedSignature = `v1=${crypto.createHmac("sha256", workerSecret).update(signedText).digest("hex")}`;
assert.equal(handoff.init.headers["x-swing-up-sensor-signature"], expectedSignature);

const lease = { leaseId: "existing", expiresAt: new Date(Date.now() + 60_000).toISOString() };
const storage = {
  async get(key) { return key === "lease" ? lease : null; },
  async transaction(callback) {
    return callback({ get: this.get, put: async () => { throw new Error("must_not_replace_live_lease"); } });
  },
};
const coordinator = new SensorCoordinatorCore({ storage }, {});
const overlap = await coordinator.fetch(new Request("https://sensor.internal/run", { method: "POST" }));
assert.equal(overlap.status, 409);
assert.equal((await overlap.json()).busy, true);

const workerSource = readFileSync(new URL("../cloudflare/pr262-sensor-core.mjs", import.meta.url), "utf8");
const workerEntrypoint = readFileSync(new URL("../cloudflare/pr262-sensor-worker.mjs", import.meta.url), "utf8");
const routeSource = readFileSync(new URL("../app/api/internal/combined-opportunity-engine/cloudflare-sensor-handoff/route.ts", import.meta.url), "utf8");
const wrangler = readFileSync(new URL("../cloudflare/wrangler.pr262-sensor.toml", import.meta.url), "utf8");
const shadowWrangler = readFileSync(new URL("../cloudflare/wrangler.pr262-sensor-shadow.toml", import.meta.url), "utf8");
for (const forbidden of ["runPr262EventJob(", "runAiCommittee(", "new PrismaClient(", "deliverSeriousSignalOutbox(", "TELEGRAM_BOT_TOKEN", "DATABASE_URL"]) {
  assert.equal(workerSource.includes(forbidden), false, `Cheap Worker must not contain ${forbidden}`);
}
assert.match(workerSource, /MAX_NETWORK_CALLS = 16/);
assert.match(workerSource, /reserveProvider\(storage/);
assert.doesNotMatch(workerSource, /providerBudget:\$\{reservationProvider\}/, "Per-feed ledgers must not bypass the shared provider cap.");
assert.match(workerSource, /etagMatches/);
assert.match(workerSource, /RAILWAY_HANDOFF_HOST_ALLOWLIST/);
assert.match(workerSource, /octets\[0\] === 100 && octets\[1\] >= 64/, "Direct issuer URLs must block carrier-grade private address literals.");
assert.match(workerSource, /fetchDirectBounded/, "Direct issuer redirects must be revalidated by the bounded fetch path.");
assert.match(workerEntrypoint, /extends DurableObject/);
assert.match(routeSource, /runPr262AnalysisOnlyCycle/);
assert.match(routeSource, /verifyPr262CloudflareHandoff/);
assert.match(routeSource, /analysis\.ok !== true/, "A degraded Railway analysis cycle must leave a failed receipt for retry.");
assert.match(routeSource, /cloudflare_handoff_run_contract_mismatch/, "The immutable run must be tied to the signed scan identity, state key, and timestamp.");
assert.match(wrangler, /crons = \["\*\/5 \* \* \* \*"\]/);
assert.match(wrangler, /cpu_ms = 10000/);
assert.match(wrangler, /subrequests = 32/);
assert.match(wrangler, /workers_dev = false/, "Production Worker must not expose a denial-of-wallet HTTP surface.");
assert.match(wrangler, /SENSOR_DEPLOYMENT_MODE = "production"/);
assert.match(wrangler, /ANALYSIS_HANDOFF_ENABLED = "true"/);
assert.match(wrangler, /SENSOR_STATE_KEY = "production\/pr262\/sensor\/state-v1\.json"/);
assert.match(wrangler, /binding = "SENSOR_R2"/);
assert.match(wrangler, /class_name = "SensorCoordinator"/);
assert.match(wrangler, /\[exports\.SensorCoordinator\]/);
assert.match(wrangler, /storage = "sqlite"/);
assert.match(shadowWrangler, /crons = \["\*\/5 \* \* \* \*"\]/);
assert.match(shadowWrangler, /workers_dev = true/, "Shadow needs a temporary verification surface before cutover.");
assert.match(shadowWrangler, /SENSOR_DEPLOYMENT_MODE = "shadow"/);
assert.match(shadowWrangler, /ANALYSIS_HANDOFF_ENABLED = "false"/);
assert.match(shadowWrangler, /branch-labs\/pr-262\/cloudflare-shadow\/sensor\/state-v1\.json/);
assert.match(shadowWrangler, /EQUITY_UNIVERSE_KEY = "branch-labs\/pr-262\/equity-universe\/v1\.json"/);
assert.match(shadowWrangler, /EXPOSURE_INDEX_KEY = "branch-labs\/pr-262\/sensor\/exposure-index-v1\.json"/);
assert.match(shadowWrangler, /binding = "SENSOR_R2"[\s\S]*bucket_name = "replace-with-shadow-bucket"/);
assert.match(shadowWrangler, /binding = "REFERENCE_R2"[\s\S]*bucket_name = "swingup"/);
assert.doesNotMatch(shadowWrangler, /production\/pr262\//);
assert.match(workerSource, /cloudflare_shadow_analysis_handoff_forbidden/);
assert.match(workerSource, /cloudflare_sensor_\$\{kind\}_reference_key_invalid/);
assert.match(workerSource, /const bucket = mode === "shadow" \? env\.REFERENCE_R2 : env\.SENSOR_R2/);
assert.match(workerSource, /Object\.freeze\(\{ get: \(\.\.\.args\) => bucket\.get\(\.\.\.args\) \}\)/);
assert.doesNotMatch(workerSource, /REFERENCE_R2\.(?:put|delete|list|head)/, "Shadow reference binding must remain read-only in code.");
assert.match(workerSource, /referenceData/);
assert.match(workerSource, /sensorReadiness/);
assert.doesNotMatch(workerSource, /company_hint_exact_alias|unique_full_company_alias/, "Cloudflare must not infer issuer identity from company-name prose.");
assert.equal(PR262_CLOUDFLARE_SENSOR_CONTRACT.maxNetworkCalls, 16);
assert.equal(PR262_CLOUDFLARE_SENSOR_CONTRACT.maximumDirectIssuerCalls, 4);
assert.equal(PR262_CLOUDFLARE_SENSOR_CONTRACT.aiCalls, 0);
assert.equal(PR262_CLOUDFLARE_SENSOR_CONTRACT.deepAnalysis, false);
assert.equal(PR262_CLOUDFLARE_SENSOR_CONTRACT.quietScansWakeRailway, false);
assert.equal(PR262_CLOUDFLARE_SENSOR_CONTRACT.directIssuerUrlsRevalidatedAcrossRedirects, true);
assert.equal(PR262_CLOUDFLARE_SENSOR_CONTRACT.completeReferenceContractsRequired, true);
assert.equal(PR262_CLOUDFLARE_SENSOR_CONTRACT.shadowReferenceBindingUsesGetOnlyAdapter, true);
assert.equal(PR262_CLOUDFLARE_SENSOR_CONTRACT.productionPrefix, "production/pr262/");
assert.equal(PR262_CLOUDFLARE_SENSOR_CONTRACT.shadowPrefix, "branch-labs/pr-262/cloudflare-shadow/");

console.log(JSON.stringify({
  passed: true,
  secIdentityAndMapping: true,
  companyNameMappingFailsClosed: true,
  incompleteSecIdentityFailsClosed: true,
  undatedEventsFailClosed: true,
  successfulHttpWithWrongSchemaFailsCoverage: true,
  invalidRowsCannotCertifyCompleteCoverage: true,
  fullUniverseAndExposureContractsRequired: true,
  providerWideQuotaWithPerFeedCadence: true,
  handoffRedirectsForbidden: true,
  directIssuerRedirectsRevalidated: true,
  queueBounds: { ready: 2_000, unresolved: 500 },
  hmacContractVerified: true,
  immutableRunIdentityVerified: true,
  overlappingRunRejected: true,
  nativeR2ConditionalWrites: true,
  hardBudgetsPresent: true,
  analysisRemainsOnRailway: true,
  degradedAnalysisReceiptRetries: true,
  quietScansDoNotWakeRailway: true,
  unresolvedAndFutureRetriesDoNotWakeRailway: true,
  queuedStructuredIdentityCanRecoverAfterReferenceRefresh: true,
  liveShadowCannotInvokeAnalysis: true,
  shadowAndProductionStorageSeparated: true,
  shadowUsesReadOnlyBranchReferenceIndexes: true,
}, null, 2));
