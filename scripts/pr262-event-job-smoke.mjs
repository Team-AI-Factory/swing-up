import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import crypto from "node:crypto";
import https from "node:https";
import net from "node:net";
import { Readable } from "node:stream";
import ts from "typescript";

const source = readFileSync(new URL("../lib/opportunity-engine/pr262-event-job.ts", import.meta.url), "utf8");
assert.match(source, /FULL_SOURCE_ABSOLUTE_TIMEOUT_MS = 15_000/, "Full-source reads need a fixed wall-clock deadline");
assert.match(source, /LEASE_MS = 5 \* 60_000/, "A crashed event job must not retain the old two-hour global lease");
assert.match(source, /LEASE_HEARTBEAT_MS = 60_000/, "A healthy long-running event job must renew its short lease");
assert.match(source, /deadlineAtMs/, "Event processing must accept a hard parent-cycle deadline");
assert.match(source, /alertType === "sell"[\s\S]*?promotePr262SeriousWatchOut\(input\.resultKey\)/, "A qualifying downside risk must become one Watch Out instead of duplicate Sell and Watch Out alerts");
assert.match(source, /request\.destroy\(new Error\("full_source_timeout"\)\)/, "The fixed deadline must terminate the pinned HTTPS request and its body stream");
assert.doesNotMatch(source, /request\.setTimeout\(/, "A socket-inactivity timeout cannot replace the absolute full-source deadline");
assert.match(source, /FULL_SOURCE_CACHE_PREFIX/, "Decision-grade full-source work must be reusable across retries.");
assert.match(source, /FULL_SOURCE_RETRY_COOLDOWN_MS = 2 \* 60 \* 60_000/, "Temporary full-source failures must retry before they are stale.");
assert.match(source, /if \(options\.all\)[\s\S]*callback\(null, \[\{ address, family \}\]\)/, "Pinned HTTPS lookup must support Node's all-address callback contract.");
assert.doesNotMatch(source, /event\.queueAttempts\s*>=\s*2/, "Retry count alone must never turn a transient evidence failure into a permanent rejection.");
assert.match(source, /quotaKey === "pr262_full_source_reads"[\s\S]*cadenceKey\.includes\(":fanout:"\)/, "Obsolete sector fan-out reads must not consume the issuer full-source allowance.");
const testableSource = source
  .replace("async function fetchFullSource(", "export async function fetchFullSource(")
  .replace("async function readCachedFullSource(", "export async function readCachedFullSource(")
  .replace("async function cacheFullSource(", "export async function cacheFullSource(")
  .replace("function pinnedAddressLookup(", "export function pinnedAddressLookup(");
const output = ts.transpileModule(testableSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;

const event = {
  id: "sec:0000000000-26-000001",
  source: "sec",
  sourceProvider: "sec_broad",
  sourceHealthStatus: "connected",
  observedAt: "2026-08-11T10:00:00.000Z",
  title: "8-K - Exact Issuer Corp",
  url: "https://www.sec.gov/Archives/edgar/data/1234567/000000000026000001/0000000000-26-000001-index.html",
  sourceUrl: "https://www.sec.gov/Archives/edgar/data/1234567/000000000026000001/0000000000-26-000001-index.html",
  ticker: "EXCT",
  company: "Exact Issuer Corp",
  kind: "8-K",
  priority: 100,
  reason: "Official material filing.",
  cik: "0001234567",
  form: "8-K",
  accession: "0000000000-26-000001",
  canonicalSecIndexUrl: "https://www.sec.gov/Archives/edgar/data/1234567/000000000026000001/0000000000-26-000001-index.html",
  identityMethod: "official_sec_archive_link",
  mappingStatus: "mapped",
  mappingMethod: "official_sec_cik_exact",
  mappingReason: "Exact official CIK.",
  tradingViewSymbol: "NASDAQ:EXCT",
  queueAttempts: 0,
  queueNextAttemptAt: null,
  queueLastAttemptAt: null,
  queueLastError: null,
};

const analysis = {
  ticker: "EXCT",
  tradingViewSymbol: "NASDAQ:EXCT",
  company: "Exact Issuer Corp",
  exchange: "NASDAQ",
  sector: "Technology",
  industry: "Software",
  currency: "USD",
  observedAt: "2026-08-11T00:00:00.000Z",
  currentPrice: 40,
  marketCap: 4_000_000_000,
  estimatedAverageDollarVolume10d: 20_000_000,
  fairValue: {
    methods: [{ method: "owner_earnings", value: 75, weight: 1, rationale: "Fixture value" }],
    conservativeValue: 60,
    baseValue: 75,
    optimisticValue: 90,
    buyBelowPrice: 55,
    strongBuyBelowPrice: 48,
    trimAbovePrice: 95,
    upsideToBasePercent: 87.5,
    discountToBasePercent: 46.7,
    marginOfSafetyPercent: 46.7,
  },
  valuation: {
    priceToEarnings: 15,
    priceToBook: 3,
    priceToSales: 2,
    enterpriseValueToEbitda: 10,
    providerTargetPrice: 80,
    providerAnalystCount: 12,
  },
  scores: {
    businessQuality: 85,
    profitability: 82,
    balanceSheet: 80,
    growthDurability: 78,
    cashGeneration: 84,
    risk: 25,
    evidenceCompleteness: 92,
    fairValueConfidence: 88,
  },
  fundamentals: { revenue: 2_000_000_000, freeCashFlow: 300_000_000 },
  decision: {
    action: "watch",
    tier: "quality_price_watchlist",
    seriousSignal: false,
    userAlertEligible: false,
    publicationStatus: "watchlist_internal",
    historicallyCertified: false,
    evidenceTriggered: false,
    noNewsRequired: true,
    reasons: ["Fixture"],
    blockers: [],
  },
};

const historicalRecords = Array.from({ length: 5 }, (_, index) => ({
  id: `history-${index}`,
  eventKey: `prior-${index}`,
  ticker: `PEER${index}`,
  eventFamily: "earnings_guidance",
  direction: "upside",
  relationship: "direct",
  causalChain: ["filing", "earnings"],
  macroRegime: ["normal"],
  signalObservedAt: `2025-0${index + 1}-01T00:00:00.000Z`,
  featuresAsOf: `2025-0${index + 1}-01T00:00:00.000Z`,
  dataQuality: "real",
  provenance: { origin: "public_historical_bootstrap", eventPublisher: "SEC", eventSourceUrl: "https://www.sec.gov/", priceSource: "Yahoo", benchmarkSource: "Yahoo SPY", methodologyVersion: "test" },
  checkpoints: { "7D": { returnPercent: 2, benchmarkReturnPercent: 0, observedAt: `2025-0${index + 1}-08T00:00:00.000Z`, source: "Yahoo" } },
}));

const objects = new Map();
const writes = [];
let etagCounter = 0;
const historyKey = "branch-labs/pr-262/serious-signal/equity-history-v1.json";
objects.set(historyKey, { value: { version: 1, records: historicalRecords, updatedAt: "2026-08-11T00:00:00.000Z" }, etag: '"seed"' });

function readObject(key) {
  const stored = objects.get(key);
  return stored
    ? { found: true, text: `${JSON.stringify(stored.value)}\n`, etag: stored.etag }
    : { found: false, text: null, etag: null };
}

async function writeObject(key, payload, options = {}) {
  const current = objects.get(key);
  if (options.createOnly && current) return { written: false, conflict: true, etag: null };
  if (options.expectedEtag && current?.etag !== options.expectedEtag) return { written: false, conflict: true, etag: null };
  const etag = `"etag-${++etagCounter}"`;
  objects.set(key, { value: structuredClone(payload), etag });
  writes.push({ key, payload: structuredClone(payload) });
  return { written: true, conflict: false, etag };
}

let runnerCalls = 0;
let valueRefreshCalls = 0;
let valueSafetyCalls = 0;
let acknowledgements = 0;
let retryCalls = 0;
let decisionGradeSecSource = true;
let failHistoryAccess = false;
let committeeFingerprint = "fingerprint-1";
let runnerResultMode = "serious";
let targetedValueBudgetAllowed = true;
let lastStoredCompanyAnalysis = null;
let expectEmptyStoredCompanyAnalysis = false;
let lastSecDetailOptions = null;
const haltProvider = {
  provider: "nasdaq_trade_halts",
  status: "connected",
  checkedAt: "2026-08-11T10:00:00.000Z",
  nextRetryAt: null,
  sourceUrls: ["https://www.nyse.com/api/trade-halts/current"],
  receipts: [],
  recordsRead: 0,
  error: null,
  entitlementVerified: true,
  cached: false,
};

const stubs = {
  "node:crypto": crypto,
  "node:dns/promises": { lookup: async () => [{ address: "93.184.216.34" }] },
  "node:https": https,
  "node:net": net,
  "node:stream": { Readable },
  "@/lib/branch-signal-lab": { branchProviderCallRequest: () => null },
  "@/lib/opportunity-engine/pr262-storage": { pr262StorageKey: (relative) => `branch-labs/pr-262/${relative}` },
  "@/lib/opportunity-engine/pr262-serious-watch-out-authority": {
    promotePr262SeriousWatchOut: async () => ({ promoted: false, reason: "not_a_watch_out", outboxKey: null }),
  },
  "@/lib/branch-signal-lab-policy": {
    providerCallBudgetDecision: (_reservations, request) => (
      request.provider === "tradingview_targeted_value" && !targetedValueBudgetAllowed
        ? { allowed: false, nextRetryAt: "2026-08-12T00:00:00.000Z", reason: "rolling_quota_guard" }
        : { allowed: true, nextRetryAt: null, reason: "reserved" }
    ),
  },
  "@/lib/equity-signal/historical-bootstrap": {
    mergeHistoricalSignals: (...groups) => [...new Map(groups.flat().map((record) => [record.id, record])).values()],
  },
  "@/lib/equity-signal/event-sources": {
    fetchNasdaqTradeHalts: async () => haltProvider,
    mergeSecFilingDetails: (receipts, details) => receipts.map((receipt) => ({ ...receipt, summary: `${receipt.summary} Official filing content: ${details.find((detail) => detail.receipt.id === receipt.id)?.text ?? ""}` })),
  },
  "@/lib/equity-signal/runner": {
    runEquitySignalLab: async (input) => {
      runnerCalls += 1;
      assert.ok(input.signal instanceof AbortSignal, "The paid Committee must inherit the event-job deadline signal");
      assert.equal(input.requirePilotBeforeOpenAi, false, "Historical cases must remain optional context rather than a committee gate");
      assert.equal(input.targetedContext.universe.entries.length, 1, "Only one company may enter the runner");
      assert.equal(input.targetedContext.universe.entries[0].cik, "0001234567", "Exact CIK must survive");
      if (expectEmptyStoredCompanyAnalysis) {
        assert.equal(input.targetedContext.storedCompanyAnalysis, undefined, "Unavailable valuation context must remain absent.");
      } else {
        assert.equal(input.targetedContext.storedCompanyAnalysis.ticker, "EXCT", "Refreshed company must remain exact");
      }
      lastStoredCompanyAnalysis = structuredClone(input.targetedContext.storedCompanyAnalysis);
      assert.ok(input.targetedContext.providers.some((provider) => provider.provider === "nasdaq_trade_halts"));
      if (!failHistoryAccess) assert.ok(input.historicalSignals.length >= 5, "Available optional history should load");
      else assert.equal(input.historicalSignals.length, 0, "Unavailable optional history must fall back to an empty context");
      if (runnerResultMode === "no_signal") {
        return {
          ok: true,
          checkedAt: "2026-08-11T10:04:30.000Z",
          status: "no_qualified_signal",
          seriousSignalFound: false,
          actionableSignalFound: false,
          alertType: null,
          openAiCalled: false,
          candidateFingerprint: null,
          selectedCandidate: null,
          historicalPilot: null,
          tradingHaltSafety: { currentStateKnown: true },
          committee: null,
        };
      }
      const reserved = await input.beforeOpenAiCall({ candidateFingerprint: committeeFingerprint, checkedAt: "2026-08-11T10:00:00.000Z", ticker: "EXCT", direction: "upside" });
      assert.equal(reserved, true, "Committee reservation must be granted");
      const selectedCandidate = {
        ticker: "EXCT",
        company: "Exact Issuer Corp",
        cik: "0001234567",
        direction: "upside",
        eventFamily: "earnings_guidance",
        relationship: "direct",
        eventHeadline: event.title,
        eventObservedAt: event.observedAt,
        evidenceFingerprint: committeeFingerprint,
        primarySource: true,
        independentPublishers: 1,
        eventTruth: 100,
        mappingConfidence: 100,
        materiality: 90,
        transmissionConfidence: 90,
        historicalSupport: 85,
        evidenceIndependence: 95,
        contradictionPenalty: 0,
        pricedInPenalty: 0,
        rumour: false,
        gatePassed: true,
        causalChain: ["filing", "higher earnings"],
        marketSource: "Yahoo public chart",
        benchmarkSource: "Yahoo public chart SPY",
        receipts: input.targetedContext.receipts,
        quote: {
          source: "Yahoo public chart",
          price: 42,
          marketSession: "regular",
          actionableForSeriousSignal: true,
          observedAt: "2026-08-11T10:00:00.000Z",
          cacheAgeMs: 0,
        },
      };
      return {
        ok: true,
        checkedAt: "2026-08-11T10:00:00.000Z",
        status: "serious_buy",
        seriousSignalFound: true,
        actionableSignalFound: true,
        alertType: "buy",
        openAiCalled: true,
        candidateFingerprint: committeeFingerprint,
        selectedCandidate,
        historicalPilot: { passed: false, reportedSampleSize: 0, independentRealEventCount: 0, observedDirectionalHitRatePercent: 0 },
        tradingHaltSafety: { currentStateKnown: true },
        committee: {
          ok: true,
          agentsCompleted: 14,
          agentsFailed: 0,
          finalJudge: { verdict: "positive", confidence: 85 },
          output: { overallRecommendation: "approve" },
        },
      };
    },
  },
  "@/lib/equity-signal/sec-filing-details": {
    enrichSecFilingDetails: async (receipts, _fetchImpl, _now, _reserveAccessions, options) => {
      lastSecDetailOptions = structuredClone(options);
      const unsupported = receipts[0].rawEventType === "4";
      return {
        provider: { provider: "sec_filing_details", status: unsupported ? "not_due" : "connected", checkedAt: "2026-08-11T10:00:00.000Z", nextRetryAt: null, sourceUrls: [receipts[0].url], recordsRead: decisionGradeSecSource ? 1 : 0, error: null, entitlementVerified: decisionGradeSecSource, cached: false },
        details: decisionGradeSecSource ? [
          { receipt: { ...receipts[0], id: "different-accession" }, form: "8-K", indexUrl: "https://www.sec.gov/other", primaryDocumentUrl: null, exhibitDocumentUrl: null, exhibitDocumentType: null, eventExhibitMissing: false, documentsFetched: 1, text: "Unrelated cached filing text ".repeat(20), textLength: 560, truncated: false, fetchedAt: "2026-08-11T10:00:00.000Z" },
          { receipt: receipts[0], form: "8-K", indexUrl: receipts[0].url, primaryDocumentUrl: `${receipts[0].url}/primary`, exhibitDocumentUrl: `${receipts[0].url}/exhibit-99-1`, exhibitDocumentType: "EX-99.1", eventExhibitMissing: false, documentsFetched: 2, text: "Decision-grade filing text ".repeat(20), textLength: 540, truncated: false, fetchedAt: "2026-08-11T10:00:00.000Z" },
        ] : [
          { receipt: { ...receipts[0], id: "different-accession" }, form: "8-K", indexUrl: "https://www.sec.gov/other", primaryDocumentUrl: null, exhibitDocumentUrl: null, exhibitDocumentType: null, eventExhibitMissing: false, documentsFetched: 1, text: "Unrelated cached filing text ".repeat(20), textLength: 560, truncated: false, fetchedAt: "2026-08-11T10:00:00.000Z" },
        ],
        diagnostics: {
          selected: unsupported ? 0 : 1,
          enriched: decisionGradeSecSource ? 1 : 0,
          failed: 0,
          items: decisionGradeSecSource ? [{ receiptId: receipts[0].id, errorCategory: null }] : [],
          skipped: { unsupported_form: unsupported ? 1 : 0, invalid_url: 0, invalid_date: 0, stale: 0, failure_cooldown: 0, retry_not_due: 0, run_limit: 0 },
        },
      };
    },
  },
  "@/lib/r2-warehouse": {
    readVersionedTextFromR2: async (key) => {
      if (failHistoryAccess && key === historyKey) throw new Error("simulated_optional_history_store_failure");
      return readObject(key);
    },
    writeVersionedJsonToR2: writeObject,
  },
  "@/lib/opportunity-engine/pr262-change-sensor": {
    readNextPr262PendingSensorEvent: async () => event,
    acknowledgePr262PendingSensorEvent: async () => { acknowledgements += 1; return { acknowledged: true, pendingCount: 0 }; },
    retryPr262PendingSensorEvent: async () => { retryCalls += 1; return { retried: true }; },
  },
  "@/lib/opportunity-engine/pr262-company-directory": {
    readPr262ResolvedSensorCompany: async () => ({
      event,
      directoryEntry: {
        ticker: "EXCT",
        tradingViewSymbol: "NASDAQ:EXCT",
        company: "Exact Issuer Corp",
        normalizedCompany: "exact issuer",
        cik: "0001234567",
        isPrimaryListing: true,
        exchange: "NASDAQ",
        securityType: "common_stock",
        batchKey: "branch-labs/pr-262/value-investing/resumable/cycles/test/batch-1.json",
        analysisIndex: 0,
        valueCycleId: "cycle-1",
        universeRefreshedAt: "2026-08-11T00:00:00.000Z",
      },
      valueAnalysis: analysis,
    }),
  },
  "@/lib/opportunity-engine/us-value-investing-engine": {
    refreshUsValueCompany: async ({ ticker, now, beforeFetch }) => {
      valueRefreshCalls += 1;
      await beforeFetch?.();
      return { ...analysis, ticker, observedAt: now.toISOString(), currentPrice: 41 };
    },
  },
  "@/lib/opportunity-engine/us-value-investing-safety": {
    hardenUsValueCompanyAnalysis: (analysis) => {
      valueSafetyCalls += 1;
      return analysis;
    },
  },
};

const cjsModule = { exports: {} };
new Function("require", "module", "exports", output)((name) => {
  if (name in stubs) return stubs[name];
  throw new Error(`Unexpected event-job import: ${name}`);
}, cjsModule, cjsModule.exports);

const { cacheFullSource, fetchFullSource, pinnedAddressLookup, readCachedFullSource, runPr262EventJob, PR262_EVENT_JOB_KEYS } = cjsModule.exports;

const securityNow = new Date("2026-08-11T10:00:00.000Z");
const publicDns = async () => ["93.184.216.34"];
const sourceEvent = {
  ...event,
  id: "news:exact-guidance",
  source: "news",
  sourceProvider: "company_news",
  title: "Exact Issuer Corp raises full-year guidance",
  url: "https://news.example.com/exact-guidance",
  sourceUrl: "https://news.example.com/feed",
  form: null,
  accession: null,
  canonicalSecIndexUrl: null,
  identityMethod: "structured_ticker",
};
const sourceReceipt = {
  id: sourceEvent.id,
  sourceProvider: sourceEvent.sourceProvider,
  title: sourceEvent.title,
  summary: "Discovery headline only.",
  url: sourceEvent.url,
  publisher: "Exact issuer newsroom",
  publishedAt: sourceEvent.observedAt,
  channel: "company_news",
  official: false,
  primarySource: false,
  scheduled: false,
  symbolHints: ["EXCT"],
  companyHints: ["Exact Issuer Corp"],
  rawEventType: "guidance",
};
const confirmedBody = `<html><body>${"Exact Issuer Corp announced higher full-year guidance after stronger demand. ".repeat(12)}</body></html>`;
const okTextResponse = () => new Response(confirmedBody, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });

const validFullSource = await fetchFullSource(sourceReceipt, sourceEvent, "Exact Issuer Corp", "EXCT", async () => okTextResponse(), securityNow, publicDns);
assert.equal(validFullSource.decisionGrade, true, "A bounded public HTTPS source with exact issuer and event evidence should be usable");
const cachedWrite = await cacheFullSource(sourceEvent, validFullSource, securityNow);
assert.equal(cachedWrite.written, true);
const cachedRead = await readCachedFullSource(sourceEvent, new Date("2026-08-11T10:05:00.000Z"));
assert.equal(cachedRead.decisionGrade, true);
assert.equal(cachedRead.providers[0].cached, true, "A later retry must reuse the already verified source without another source request.");
const headlineOnlyEvent = { ...sourceEvent, id: "news:orion-milestone", title: "Exact Issuer Corp completes Orion program milestone" };
const headlineOnlyReceipt = { ...sourceReceipt, id: headlineOnlyEvent.id, title: headlineOnlyEvent.title };
const headlineOnlyBody = `<html><h1>Exact Issuer Corp completes Orion program milestone</h1><p>${"The Orion program reached its planned commercial milestone with customer acceptance. ".repeat(8)}</p></html>`;
const headlineOnlySource = await fetchFullSource(headlineOnlyReceipt, headlineOnlyEvent, "Exact Issuer Corp", "EXCT", async () => new Response(headlineOnlyBody, { status: 200, headers: { "content-type": "text/html" } }), securityNow, publicDns);
assert.equal(headlineOnlySource.decisionGrade, true, "A matching issuer headline must not be rejected merely because it lacks a small hard-coded keyword list.");
let pinnedTransportAddresses = [];
const pinnedFullSource = await fetchFullSource(
  sourceReceipt,
  sourceEvent,
  "Exact Issuer Corp",
  "EXCT",
  async () => { throw new Error("unpinned_fetch_must_not_run"); },
  securityNow,
  async () => ["93.184.216.34"],
  async (_url, addresses) => {
    pinnedTransportAddresses = addresses;
    return okTextResponse();
  },
);
assert.equal(pinnedFullSource.decisionGrade, true);
assert.deepEqual(pinnedTransportAddresses, ["93.184.216.34"], "The production transport must receive and pin the already-validated DNS address");

const pinnedSingleLookup = await new Promise((resolve, reject) => {
  pinnedAddressLookup("93.184.216.34", 4)("news.example.com", { all: false }, (error, address, family) => {
    if (error) reject(error);
    else resolve({ address, family });
  });
});
assert.deepEqual(pinnedSingleLookup, { address: "93.184.216.34", family: 4 });
const pinnedAllLookup = await new Promise((resolve, reject) => {
  pinnedAddressLookup("2606:4700:4700::1111", 6)("news.example.com", { all: true }, (error, addresses) => {
    if (error) reject(error);
    else resolve(addresses);
  });
});
assert.deepEqual(pinnedAllLookup, [{ address: "2606:4700:4700::1111", family: 6 }], "Node 24 all-address lookups must not receive an undefined address.");

for (const blockedUrl of [
  "http://news.example.com/exact-guidance",
  "https://user:secret@news.example.com/exact-guidance",
  "https://news.example.com:444/exact-guidance",
]) {
  let calls = 0;
  const blocked = await fetchFullSource({ ...sourceReceipt, url: blockedUrl }, { ...sourceEvent, url: blockedUrl }, "Exact Issuer Corp", "EXCT", async () => { calls += 1; return okTextResponse(); }, securityNow, publicDns);
  assert.equal(blocked.decisionGrade, false, `${blockedUrl} must fail the HTTPS/origin policy`);
  assert.equal(calls, 0, `${blockedUrl} must be rejected before network fetch`);
}

let privateFetchCalls = 0;
const privateDns = await fetchFullSource(sourceReceipt, sourceEvent, "Exact Issuer Corp", "EXCT", async () => { privateFetchCalls += 1; return okTextResponse(); }, securityNow, async () => ["127.0.0.1"]);
assert.equal(privateDns.decisionGrade, false, "A private DNS result must be blocked");
assert.equal(privateFetchCalls, 0, "A private DNS result must be rejected before fetch");

let redirectCalls = 0;
const downgraded = await fetchFullSource(
  { ...sourceReceipt, url: "https://agency.gov/exact-guidance", official: true, primarySource: true },
  { ...sourceEvent, source: "official", url: "https://agency.gov/exact-guidance" },
  "Exact Issuer Corp",
  "EXCT",
  async () => {
    redirectCalls += 1;
    return redirectCalls === 1
      ? new Response(null, { status: 302, headers: { location: "https://press.example.com/exact-guidance" } })
      : okTextResponse();
  },
  securityNow,
  publicDns,
);
assert.equal(downgraded.decisionGrade, true, "A revalidated public redirect may supply evidence");
assert.equal(downgraded.receipts[0].official, false, "A redirect away from an official host must lose official authority");
assert.equal(downgraded.receipts[0].primarySource, false, "A redirect away from an official host must lose primary-source authority");

let redirectLoopCalls = 0;
const redirectLoop = await fetchFullSource(sourceReceipt, sourceEvent, "Exact Issuer Corp", "EXCT", async () => {
  redirectLoopCalls += 1;
  return new Response(null, { status: 302, headers: { location: `/redirect-${redirectLoopCalls}` } });
}, securityNow, publicDns);
assert.equal(redirectLoop.decisionGrade, false, "More than three redirects must fail closed");
assert.equal(redirectLoop.providers[0].error, "full_source_too_many_redirects");

const oversizedConfirmed = await fetchFullSource(
  sourceReceipt,
  sourceEvent,
  "Exact Issuer Corp",
  "EXCT",
  async () => new Response(`${confirmedBody}${"x".repeat(500_001)}`, { status: 200, headers: { "content-type": "text/html" } }),
  securityNow,
  publicDns,
);
assert.equal(oversizedConfirmed.decisionGrade, true, "A large publisher page may use only its bounded prefix when that prefix independently confirms the issuer and event");
assert.equal(oversizedConfirmed.diagnostics.sourceBodyTruncated, true, "The decision-grade result must disclose that the publisher body was truncated");
assert.equal(oversizedConfirmed.diagnostics.sourceTextBytes, 500_000, "The reader must never retain more than the bounded source limit");

const oversized = await fetchFullSource(sourceReceipt, sourceEvent, "Exact Issuer Corp", "EXCT", async () => new Response("x".repeat(500_001), { status: 200, headers: { "content-type": "text/plain" } }), securityNow, publicDns);
assert.equal(oversized.decisionGrade, false, "An oversized source without confirmed evidence in its bounded prefix must fail closed");
assert.equal(oversized.providers[0].error, "full_source_body_too_large");

const wrongContentType = await fetchFullSource(sourceReceipt, sourceEvent, "Exact Issuer Corp", "EXCT", async () => new Response(confirmedBody, { status: 200, headers: { "content-type": "application/json" } }), securityNow, publicDns);
assert.equal(wrongContentType.decisionGrade, false, "Unsupported content types must not unlock analysis");
assert.equal(wrongContentType.providers[0].error, "full_source_content_type_unsupported");

const unrelatedPage = await fetchFullSource(sourceReceipt, sourceEvent, "Exact Issuer Corp", "EXCT", async () => new Response("Unrelated Company announced a dividend. ".repeat(20), { status: 200, headers: { "content-type": "text/plain" } }), securityNow, publicDns);
assert.equal(unrelatedPage.decisionGrade, false, "A long but issuer/event-unconfirmed page must remain discovery-only");
assert.equal(unrelatedPage.providers[0].error, "full_source_issuer_or_event_unconfirmed");

const first = await runPr262EventJob({ now: new Date("2026-08-11T10:00:00.000Z"), allowOpenAi: true });
assert.equal(first.ok, true);
assert.deepEqual(lastSecDetailOptions?.priorityReceiptIds, [event.id], "The exact current SEC accession must be prioritized over process-wide filing backlog.");
assert.equal(first.eventsProcessed, 1);
assert.equal(first.seriousSignalFound, true);
assert.equal(first.outboxKey, "branch-labs/pr-262/serious-signal/outbox/event-job/buy/EXCT/fingerprint-1.json");
assert.equal(first.costControl.companiesOpened, 1);
assert.equal(first.costControl.fullCompanyWarehouseRebuilds, 0);
assert.equal(first.costControl.affectedCompanyValuationRefreshes, 1);
assert.equal(first.costControl.optionalHistoryContextPreparedBeforeCommittee, true);
assert.equal(runnerCalls, 1);
assert.equal(valueRefreshCalls, 1);
assert.equal(valueSafetyCalls, 1, "A targeted event refresh must pass through the same specialist-sector safety overlay as the daily foundation.");
assert.equal(retryCalls, 0);
assert.equal(acknowledgements, 1);
assert.equal(objects.get(PR262_EVENT_JOB_KEYS.STATE_KEY).value.runs.length, 1);
assert.deepEqual(
  Object.keys(objects.get(PR262_EVENT_JOB_KEYS.STATE_KEY).value).sort(),
  ["runs", "updatedAt", "version"],
  "The durable completion ledger must not carry volatile leases or provider budgets.",
);
assert.equal(objects.get(PR262_EVENT_JOB_KEYS.LEASE_KEY).value.lease, null, "The small runtime lease must be released after completion.");
assert.equal(objects.get(PR262_EVENT_JOB_KEYS.PROVIDER_BUDGET_KEY).value.reservations.length, 1, "Provider reservations must be durable without rewriting the completion ledger.");
assert.equal(objects.get(PR262_EVENT_JOB_KEYS.COMMITTEE_BUDGET_KEY).value.reservations.length, 1, "Paid-call reservations must remain durable in their own compact object.");
assert.equal(objects.get(historyKey).value.records.length, 6);
assert.ok(objects.has(first.resultKey));
assert.ok(objects.has(first.outboxKey));
assert.equal(objects.get(first.outboxKey).value.historicalEvidenceRole, "optional_learning_context_only");

const completedState = objects.get(PR262_EVENT_JOB_KEYS.STATE_KEY).value;
objects.set(PR262_EVENT_JOB_KEYS.STATE_KEY, { value: { ...completedState, lease: null, runs: [] }, etag: `"etag-${++etagCounter}"` });
const recovered = await runPr262EventJob({ now: new Date("2026-08-11T10:01:00.000Z"), allowOpenAi: true });
assert.equal(recovered.recoveredPersistedResult, true);
assert.equal(recovered.eventsProcessed, 0);
assert.equal(runnerCalls, 1);
assert.equal(valueRefreshCalls, 1);
assert.equal(acknowledgements, 2);

const second = await runPr262EventJob({ now: new Date("2026-08-11T10:02:00.000Z"), allowOpenAi: true });
assert.equal(second.status, "already_completed");
assert.equal(runnerCalls, 1);
assert.equal(acknowledgements, 3);

function setSecEventIdentity(sequence, observedAt) {
  const accession = `0000000000-26-${sequence}`;
  const accessionDigits = accession.replace(/-/g, "");
  const url = `https://www.sec.gov/Archives/edgar/data/1234567/${accessionDigits}/${accession}-index.html`;
  Object.assign(event, {
    id: `sec:${accession}`,
    accession,
    observedAt,
    url,
    sourceUrl: url,
    canonicalSecIndexUrl: url,
    queueAttempts: 0,
  });
}

decisionGradeSecSource = false;
setSecEventIdentity("000002", "2026-08-10T10:00:00.000Z");
await assert.rejects(
  () => runPr262EventJob({ now: new Date("2026-08-11T10:03:00.000Z"), allowOpenAi: true }),
  /pr262_event_full_source_incomplete/,
);
assert.equal(runnerCalls, 1, "A fresh unread source must not reach analysis or history");
assert.equal(valueRefreshCalls, 1, "A fresh unread source must not refresh valuation");
assert.equal(retryCalls, 1, "A fresh unread source must remain retryable");

const retriesBeforeUnsupportedForm = retryCalls;
setSecEventIdentity("000009", "2026-08-11T10:03:30.000Z");
event.form = "4";
event.kind = "4";
const unsupportedForm = await runPr262EventJob({ now: new Date("2026-08-11T10:03:45.000Z"), allowOpenAi: true });
assert.equal(unsupportedForm.status, "source_evidence_expired_unread");
assert.equal(unsupportedForm.seriousSignalFound, false);
assert.equal(retryCalls, retriesBeforeUnsupportedForm, "A structurally unsupported SEC form must be retired instead of backlogged forever.");
event.form = "8-K";
event.kind = "8-K";

setSecEventIdentity("000003", "2026-08-01T10:00:00.000Z");
const stateWritesBeforeExpiredUnread = writes.filter((write) => write.key === PR262_EVENT_JOB_KEYS.STATE_KEY).length;
const expiredUnread = await runPr262EventJob({ now: new Date("2026-08-11T10:04:00.000Z"), allowOpenAi: true });
assert.equal(expiredUnread.status, "source_evidence_expired_unread");
assert.equal(expiredUnread.seriousSignalFound, false);
assert.equal(expiredUnread.outboxKey, null);
assert.equal(runnerCalls, 1, "An expired unread source must be archived without analysis");
assert.equal(valueRefreshCalls, 1, "An expired unread source must be archived without valuation work");
assert.equal(objects.get(historyKey).value.records.length, 6, "An unread discovery item must never enter historical findings");
assert.equal(expiredUnread.resultKey, null, "An expired unimportant discovery must not create a full immutable R2 result.");
assert.equal(expiredUnread.r2Persistence.detailedResultWritten, false);
assert.equal(expiredUnread.r2Persistence.operationalLedgerWritten, false);
assert.equal(writes.filter((write) => write.key === PR262_EVENT_JOB_KEYS.STATE_KEY).length, stateWritesBeforeExpiredUnread, "An expired unimportant discovery must not rewrite the completion ledger.");

decisionGradeSecSource = true;
runnerResultMode = "no_signal";
setSecEventIdentity("000006", "2026-08-11T10:04:15.000Z");
const detailedRunCountBeforeQuietAnalysis = [...objects.keys()].filter((key) => key.startsWith(PR262_EVENT_JOB_KEYS.RUN_PREFIX)).length;
const valueRefreshCountBeforeQuietAnalysis = [...objects.keys()].filter((key) => key.includes("/value-investing/event-refresh/")).length;
const stateWritesBeforeQuietAnalysis = writes.filter((write) => write.key === PR262_EVENT_JOB_KEYS.STATE_KEY).length;
const routineNoSignal = await runPr262EventJob({ now: new Date("2026-08-11T10:04:30.000Z"), allowOpenAi: true });
assert.equal(routineNoSignal.status, "no_qualified_signal");
assert.equal(routineNoSignal.resultKey, null, "A routine no-signal analysis must not write a full result object.");
assert.equal(routineNoSignal.r2Persistence.detailedResultWritten, false);
assert.equal(routineNoSignal.r2Persistence.companyRefreshWritten, false, "A routine valuation refresh must stay in memory unless it supports an important finding.");
assert.equal([...objects.keys()].filter((key) => key.startsWith(PR262_EVENT_JOB_KEYS.RUN_PREFIX)).length, detailedRunCountBeforeQuietAnalysis);
assert.equal([...objects.keys()].filter((key) => key.includes("/value-investing/event-refresh/")).length, valueRefreshCountBeforeQuietAnalysis);
assert.equal(writes.filter((write) => write.key === PR262_EVENT_JOB_KEYS.STATE_KEY).length, stateWritesBeforeQuietAnalysis, "Routine no-signal analysis must not rewrite the completion ledger.");

targetedValueBudgetAllowed = false;
setSecEventIdentity("000007", "2026-08-11T10:05:00.000Z");
lastStoredCompanyAnalysis = null;
const valueRefreshCallsBeforeFallback = valueRefreshCalls;
const retryCallsBeforeFallback = retryCalls;
const foundationFallback = await runPr262EventJob({ now: new Date("2026-08-11T10:06:00.000Z"), allowOpenAi: true });
assert.equal(foundationFallback.status, "no_qualified_signal");
assert.equal(foundationFallback.costControl.affectedCompanyValuationRefreshes, 0);
assert.equal(foundationFallback.costControl.affectedCompanyValuationCacheFallbacks, 1);
assert.equal(foundationFallback.costControl.valuationContext.source, "daily_foundation_cache");
assert.equal(foundationFallback.costControl.valuationContext.quotaFallback, true);
assert.equal(foundationFallback.costControl.valuationContext.targetedRefreshBlockedByQuota, true);
assert.equal(foundationFallback.costControl.valuationContext.usableFoundationContext, true);
assert.equal(valueRefreshCalls, valueRefreshCallsBeforeFallback, "A denied targeted quote must not make an unreserved provider call.");
assert.equal(retryCalls, retryCallsBeforeFallback, "Fresh complete daily valuation must prevent a quota-only event deferral.");
assert.equal(lastStoredCompanyAnalysis.currentPrice, 40, "The Committee must receive the exact fresh daily foundation valuation.");

setSecEventIdentity("000008", "2026-08-11T10:06:30.000Z");
const freshObservedAt = analysis.observedAt;
analysis.observedAt = "2026-08-09T00:00:00.000Z";
lastStoredCompanyAnalysis = null;
expectEmptyStoredCompanyAnalysis = true;
const runnerCallsBeforeStaleFallback = runnerCalls;
const staleFoundationContext = await runPr262EventJob({
  now: new Date("2026-08-11T10:07:00.000Z"),
  allowOpenAi: true,
});
assert.equal(staleFoundationContext.status, "no_qualified_signal");
assert.equal(staleFoundationContext.costControl.affectedCompanyValuationRefreshes, 0);
assert.equal(staleFoundationContext.costControl.affectedCompanyValuationCacheFallbacks, 0);
assert.equal(staleFoundationContext.costControl.valuationContext.source, "unavailable_budget_safe");
assert.equal(staleFoundationContext.costControl.valuationContext.targetedRefreshBlockedByQuota, true);
assert.equal(staleFoundationContext.costControl.valuationContext.usableFoundationContext, false);
assert.equal(runnerCalls, runnerCallsBeforeStaleFallback + 1, "Current event evidence must still reach deterministic gates when optional valuation context is unavailable.");
assert.equal(lastStoredCompanyAnalysis, undefined, "Stale or malformed valuation context must never be passed into deterministic gates or the Committee.");
assert.equal(retryCalls, retryCallsBeforeFallback, "A valuation-only quota gap must not backlog current decision-grade event evidence.");
expectEmptyStoredCompanyAnalysis = false;
analysis.observedAt = freshObservedAt;
targetedValueBudgetAllowed = true;
runnerResultMode = "serious";

setSecEventIdentity("000004", "2026-08-11T10:04:00.000Z");
committeeFingerprint = "fingerprint-history-unavailable";
failHistoryAccess = true;
const withoutHistory = await runPr262EventJob({ now: new Date("2026-08-11T10:05:00.000Z"), allowOpenAi: true });
assert.equal(withoutHistory.seriousSignalFound, true, "Approved current evidence must still produce an alert when optional history storage is unavailable.");
assert.equal(withoutHistory.historyWrite.persisted, false);
assert.equal(withoutHistory.historyWrite.reason, "optional_history_write_failed");
assert.equal(objects.get(withoutHistory.resultKey).value.historicalContext.available, false);
assert.ok(objects.has(withoutHistory.outboxKey), "Optional history failure must not block the durable Serious alert outbox.");
failHistoryAccess = false;
committeeFingerprint = "fingerprint-1";

const stateBeforeLegacyCompaction = objects.get(PR262_EVENT_JOB_KEYS.STATE_KEY).value;
const legacyProviderReservations = objects.get(PR262_EVENT_JOB_KEYS.PROVIDER_BUDGET_KEY).value.reservations;
const legacyCommitteeReservations = objects.get(PR262_EVENT_JOB_KEYS.COMMITTEE_BUDGET_KEY).value.reservations;
objects.delete(PR262_EVENT_JOB_KEYS.PROVIDER_BUDGET_KEY);
objects.delete(PR262_EVENT_JOB_KEYS.COMMITTEE_BUDGET_KEY);
objects.set(PR262_EVENT_JOB_KEYS.STATE_KEY, {
  value: {
    ...stateBeforeLegacyCompaction,
    providerReservations: legacyProviderReservations,
    committeeReservations: legacyCommitteeReservations,
    runs: [...stateBeforeLegacyCompaction.runs, {
      eventId: "legacy:oversized-run",
      resultKey: null,
      checkedAt: "2026-08-11T09:00:00.000Z",
      status: "no_qualified_signal",
      seriousSignalFound: false,
      actionableSignalFound: false,
      alertType: null,
      openAiCalled: false,
      candidateFingerprint: null,
      selectedCandidate: { oversizedLegacyEvidence: "x".repeat(100_000) },
      historicalPilot: { oversizedLegacyHistory: "x".repeat(100_000) },
      committee: { oversizedLegacyCommittee: "x".repeat(100_000) },
    }],
  },
  etag: `"etag-${++etagCounter}"`,
});

setSecEventIdentity("000005", "2026-08-11T10:05:00.000Z");
await assert.rejects(
  () => runPr262EventJob({
    now: new Date("2026-08-11T10:06:00.000Z"),
    allowOpenAi: true,
    deadlineAtMs: Date.now() - 1,
  }),
  /pr262_event_job_deadline_exceeded/,
);
assert.equal(objects.get(PR262_EVENT_JOB_KEYS.LEASE_KEY).value.lease, null, "A deadline-aborted job must release its small runtime lease");

committeeFingerprint = "fingerprint-legacy-compaction";
setSecEventIdentity("000007", "2026-08-11T10:06:00.000Z");
await runPr262EventJob({ now: new Date("2026-08-11T10:07:00.000Z"), allowOpenAi: true });
const compactedLegacyRun = objects.get(PR262_EVENT_JOB_KEYS.STATE_KEY).value.runs.find((run) => run.eventId === "legacy:oversized-run");
assert.ok(compactedLegacyRun, "Legacy idempotency must be retained while its oversized evidence is removed.");
assert.equal("selectedCandidate" in compactedLegacyRun, false);
assert.equal("historicalPilot" in compactedLegacyRun, false);
assert.equal("committee" in compactedLegacyRun, false);
assert.equal("providerReservations" in objects.get(PR262_EVENT_JOB_KEYS.STATE_KEY).value, false, "Migrated provider budgets must leave the finding ledger.");
assert.equal("committeeReservations" in objects.get(PR262_EVENT_JOB_KEYS.STATE_KEY).value, false, "Migrated Committee budgets must leave the finding ledger.");
assert.ok(objects.get(PR262_EVENT_JOB_KEYS.PROVIDER_BUDGET_KEY).value.reservations.length >= legacyProviderReservations.length, "Legacy provider reservations must survive the runtime-state split.");
assert.ok(objects.get(PR262_EVENT_JOB_KEYS.COMMITTEE_BUDGET_KEY).value.reservations.length >= legacyCommitteeReservations.length, "Legacy Committee reservations must survive the runtime-state split.");

console.log(JSON.stringify({
  ok: true,
  exactCikCompanyOnly: true,
  fullSecFilingAndExhibitRead: true,
  oneStoredCompanyOpened: true,
  optionalHistoryContextBeforeCommittee: true,
  missingHistoryCannotBlockApprovedCurrentEvidence: true,
  allFourteenCommitteeResultsRequiredForOutbox: true,
  idempotentR2RunAndOutbox: true,
  orphanedResultRecoveredWithoutSecondCommittee: true,
  wrongCachedSecAccessionCannotSupplyDecisionGrade: true,
  affectedCompanyValuationRefreshedOnce: true,
  freshDailyFoundationValuationBridgesTargetedQuota: true,
  staleFoundationValuationExcludedWithoutBlockingEventEvidence: true,
  noBroadWarehouseRebuild: true,
  nonSecFullSourceSecurityCovered: true,
  boundedLargePublisherPrefixCovered: true,
  validatedDnsAddressPinnedIntoTransport: true,
  fullSourceAbsoluteDeadlineEnforced: true,
  paidCommitteeInheritsCycleDeadline: true,
  unreadSourceRetriesThenExpiresWithoutHistory: true,
  unsupportedSecFormsRetireWithoutRetryBacklog: true,
  exactCurrentSecAccessionPrioritized: true,
  routineNoSignalSkipsDetailedR2Writes: true,
  volatileEventRuntimeStateSplitFromFindingLedger: true,
  routineCompanyRefreshStaysInMemory: true,
  shortRenewableLeaseAndDeadlineRecovery: true,
  legacyEventLedgerCompactedWithoutLosingIdempotency: true,
}, null, 2));
