import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import crypto from "node:crypto";
import https from "node:https";
import net from "node:net";
import { Readable } from "node:stream";
import ts from "typescript";

const source = readFileSync(new URL("../lib/opportunity-engine/pr262-event-job.ts", import.meta.url), "utf8");
assert.match(source, /FULL_SOURCE_ABSOLUTE_TIMEOUT_MS = 15_000/, "Full-source reads need a fixed wall-clock deadline");
assert.match(source, /request\.destroy\(new Error\("full_source_timeout"\)\)/, "The fixed deadline must terminate the pinned HTTPS request and its body stream");
assert.doesNotMatch(source, /request\.setTimeout\(/, "A socket-inactivity timeout cannot replace the absolute full-source deadline");
const testableSource = source.replace("async function fetchFullSource(", "export async function fetchFullSource(");
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
  company: "Exact Issuer Corp",
  observedAt: "2026-08-11T00:00:00.000Z",
  currentPrice: 40,
  fairValue: { conservativeValue: 60, baseValue: 75, optimisticValue: 90, buyBelowPrice: 55 },
  scores: { businessQuality: 85, risk: 25, fairValueConfidence: 88 },
  fundamentals: { revenue: 2_000_000_000, freeCashFlow: 300_000_000 },
  decision: { tier: "quality_price_watchlist" },
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
  return { written: true, conflict: false, etag };
}

let runnerCalls = 0;
let valueRefreshCalls = 0;
let acknowledgements = 0;
let retryCalls = 0;
let decisionGradeSecSource = true;
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
  "@/lib/branch-signal-lab-policy": { providerCallBudgetDecision: () => ({ allowed: true, nextRetryAt: null, reason: "reserved" }) },
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
      assert.equal(input.requirePilotBeforeOpenAi, true, "Pilot must precede committee");
      assert.equal(input.targetedContext.universe.entries.length, 1, "Only one company may enter the runner");
      assert.equal(input.targetedContext.universe.entries[0].cik, "0001234567", "Exact CIK must survive");
      assert.equal(input.targetedContext.storedCompanyAnalysis.ticker, "EXCT", "Refreshed company must remain exact");
      assert.ok(input.targetedContext.providers.some((provider) => provider.provider === "nasdaq_trade_halts"));
      assert.equal(input.historicalSignals.length, 5, "Pilot history must load");
      const reserved = await input.beforeOpenAiCall({ candidateFingerprint: "fingerprint-1", checkedAt: "2026-08-11T10:00:00.000Z", ticker: "EXCT", direction: "upside" });
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
        evidenceFingerprint: "fingerprint-1",
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
        candidateFingerprint: "fingerprint-1",
        selectedCandidate,
        historicalPilot: { passed: true, independentRealEventCount: 5, observedDirectionalHitRatePercent: 80 },
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
    enrichSecFilingDetails: async (receipts) => ({
      provider: { provider: "sec_filing_details", status: "connected", checkedAt: "2026-08-11T10:00:00.000Z", nextRetryAt: null, sourceUrls: [receipts[0].url], recordsRead: 1, error: null, entitlementVerified: true, cached: false },
      details: decisionGradeSecSource ? [
        { receipt: { ...receipts[0], id: "different-accession" }, form: "8-K", indexUrl: "https://www.sec.gov/other", primaryDocumentUrl: null, exhibitDocumentUrl: null, exhibitDocumentType: null, eventExhibitMissing: false, documentsFetched: 1, text: "Unrelated cached filing text ".repeat(20), textLength: 560, truncated: false, fetchedAt: "2026-08-11T10:00:00.000Z" },
        { receipt: receipts[0], form: "8-K", indexUrl: receipts[0].url, primaryDocumentUrl: `${receipts[0].url}/primary`, exhibitDocumentUrl: `${receipts[0].url}/exhibit-99-1`, exhibitDocumentType: "EX-99.1", eventExhibitMissing: false, documentsFetched: 2, text: "Decision-grade filing text ".repeat(20), textLength: 540, truncated: false, fetchedAt: "2026-08-11T10:00:00.000Z" },
      ] : [
        { receipt: { ...receipts[0], id: "different-accession" }, form: "8-K", indexUrl: "https://www.sec.gov/other", primaryDocumentUrl: null, exhibitDocumentUrl: null, exhibitDocumentType: null, eventExhibitMissing: false, documentsFetched: 1, text: "Unrelated cached filing text ".repeat(20), textLength: 560, truncated: false, fetchedAt: "2026-08-11T10:00:00.000Z" },
      ],
      diagnostics: { selected: 1, enriched: 1, failed: 0 },
    }),
  },
  "@/lib/r2-warehouse": {
    readVersionedTextFromR2: async (key) => readObject(key),
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
    refreshUsValueCompany: async ({ ticker, now }) => {
      valueRefreshCalls += 1;
      return { ...analysis, ticker, observedAt: now.toISOString(), currentPrice: 41 };
    },
  },
};

const cjsModule = { exports: {} };
new Function("require", "module", "exports", output)((name) => {
  if (name in stubs) return stubs[name];
  throw new Error(`Unexpected event-job import: ${name}`);
}, cjsModule, cjsModule.exports);

const { fetchFullSource, runPr262EventJob, PR262_EVENT_JOB_KEYS } = cjsModule.exports;

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

const oversized = await fetchFullSource(sourceReceipt, sourceEvent, "Exact Issuer Corp", "EXCT", async () => new Response("x".repeat(500_001), { status: 200, headers: { "content-type": "text/plain" } }), securityNow, publicDns);
assert.equal(oversized.decisionGrade, false, "A streamed source over 500 KB must fail closed");
assert.equal(oversized.providers[0].error, "full_source_body_too_large");

const wrongContentType = await fetchFullSource(sourceReceipt, sourceEvent, "Exact Issuer Corp", "EXCT", async () => new Response(confirmedBody, { status: 200, headers: { "content-type": "application/json" } }), securityNow, publicDns);
assert.equal(wrongContentType.decisionGrade, false, "Unsupported content types must not unlock analysis");
assert.equal(wrongContentType.providers[0].error, "full_source_content_type_unsupported");

const unrelatedPage = await fetchFullSource(sourceReceipt, sourceEvent, "Exact Issuer Corp", "EXCT", async () => new Response("Unrelated Company announced a dividend. ".repeat(20), { status: 200, headers: { "content-type": "text/plain" } }), securityNow, publicDns);
assert.equal(unrelatedPage.decisionGrade, false, "A long but issuer/event-unconfirmed page must remain discovery-only");
assert.equal(unrelatedPage.providers[0].error, "full_source_issuer_or_event_unconfirmed");

const first = await runPr262EventJob({ now: new Date("2026-08-11T10:00:00.000Z"), allowOpenAi: true });
assert.equal(first.ok, true);
assert.equal(first.eventsProcessed, 1);
assert.equal(first.seriousSignalFound, true);
assert.equal(first.outboxKey, "branch-labs/pr-262/serious-signal/outbox/event-job/buy/EXCT/fingerprint-1.json");
assert.equal(first.costControl.companiesOpened, 1);
assert.equal(first.costControl.fullCompanyWarehouseRebuilds, 0);
assert.equal(first.costControl.affectedCompanyValuationRefreshes, 1);
assert.equal(runnerCalls, 1);
assert.equal(valueRefreshCalls, 1);
assert.equal(retryCalls, 0);
assert.equal(acknowledgements, 1);
assert.equal(objects.get(PR262_EVENT_JOB_KEYS.STATE_KEY).value.runs.length, 1);
assert.equal(objects.get(historyKey).value.records.length, 6);
assert.ok(objects.has(first.resultKey));
assert.ok(objects.has(first.outboxKey));

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

setSecEventIdentity("000003", "2026-08-01T10:00:00.000Z");
const expiredUnread = await runPr262EventJob({ now: new Date("2026-08-11T10:04:00.000Z"), allowOpenAi: true });
assert.equal(expiredUnread.status, "source_evidence_expired_unread");
assert.equal(expiredUnread.seriousSignalFound, false);
assert.equal(expiredUnread.outboxKey, null);
assert.equal(runnerCalls, 1, "An expired unread source must be archived without analysis");
assert.equal(valueRefreshCalls, 1, "An expired unread source must be archived without valuation work");
assert.equal(objects.get(historyKey).value.records.length, 6, "An unread discovery item must never enter historical findings");
assert.equal(objects.get(expiredUnread.resultKey).value.report.selectedCandidate, null);

console.log(JSON.stringify({
  ok: true,
  exactCikCompanyOnly: true,
  fullSecFilingAndExhibitRead: true,
  oneStoredCompanyOpened: true,
  pilotBeforeCommitteeContract: true,
  allFourteenCommitteeResultsRequiredForOutbox: true,
  idempotentR2RunAndOutbox: true,
  orphanedResultRecoveredWithoutSecondCommittee: true,
  wrongCachedSecAccessionCannotSupplyDecisionGrade: true,
  affectedCompanyValuationRefreshedOnce: true,
  noBroadWarehouseRebuild: true,
  nonSecFullSourceSecurityCovered: true,
  validatedDnsAddressPinnedIntoTransport: true,
  fullSourceAbsoluteDeadlineEnforced: true,
  unreadSourceRetriesThenExpiresWithoutHistory: true,
}, null, 2));
