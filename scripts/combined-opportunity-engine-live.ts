import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { evaluateEvent, evaluateFoundation } from "../lib/opportunity-engine/engine";
import { fetchLiveOpportunityUniverse, type LiveOpportunitySnapshot } from "../lib/opportunity-engine/live-data";
import type { EventDecision, FoundationDecision, StoredThesisSnapshot } from "../lib/opportunity-engine/types";

const integer = (value: string | undefined, fallback: number, minimum: number, maximum: number) => {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
};

const roundNumber = (value: number | null, digits = 6) => value === null ? null : Number(value.toFixed(digits));
const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const roundsRequested = integer(process.env.LIVE_TEST_ROUNDS, 3, 3, 5);
const minimumStableTickers = integer(process.env.LIVE_TEST_MIN_TICKERS, 3, 3, 5);
const tickersRequested = (process.env.LIVE_TEST_TICKERS ?? "AAPL,MSFT,NVDA,XOM,KO")
  .split(",")
  .map((ticker) => ticker.trim().toUpperCase())
  .filter(Boolean)
  .slice(0, 5);
const outputPath = process.env.LIVE_TEST_REPORT_PATH ?? "artifacts/combined-opportunity-engine-live-report.json";

type EvaluatedSnapshot = {
  round: number;
  ticker: string;
  company: string;
  metadata: LiveOpportunitySnapshot["metadata"];
  foundationInput: {
    fiscalPeriod: string | null;
    metrics: Record<string, number | null>;
    valuation: Record<string, number | null>;
    market: Record<string, number | string | null>;
    missingFields: string[];
    warnings: string[];
  };
  foundationDecision: FoundationDecision;
  eventDecision: EventDecision;
  sourceChecks: {
    secCompanyFacts: boolean;
    secFiling: boolean;
    realMarketData: boolean;
    noSyntheticData: boolean;
    currentPricePositive: boolean;
    officialReceipts: number;
    marketAgeDays: number | null;
    filingAgeDays: number | null;
  };
  fundamentalFingerprint: string;
  classificationSignature: string;
};

type RoundResult = {
  round: number;
  startedAt: string;
  completedAt: string;
  snapshots: EvaluatedSnapshot[];
  errors: Array<{ ticker: string; message: string }>;
};

function ageDays(value: string): number | null {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return null;
  return Math.max(0, (Date.now() - time) / 86_400_000);
}

function thesisFrom(decision: FoundationDecision): StoredThesisSnapshot {
  return {
    id: null,
    ticker: decision.ticker,
    company: decision.company,
    companyStatus: decision.thesisStatus,
    securityReadiness: decision.securityReadiness,
    candidateBucket: decision.candidateBucket,
    opportunityScore: decision.scores.opportunityScore,
    evidenceConfidence: decision.scores.evidenceConfidence,
    riskScore: decision.scores.riskScore,
    originalUnderwriting: decision,
    currentAssessment: decision,
    updatedAt: decision.evaluatedAt,
  };
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function evaluate(snapshot: LiveOpportunitySnapshot, round: number): EvaluatedSnapshot {
  const foundationDecision = evaluateFoundation(snapshot.foundation);
  const eventDecision = evaluateEvent(snapshot.event, thesisFrom(foundationDecision));
  const officialReceipts = snapshot.foundation.receipts.filter((receipt) => receipt.reliability === "official").length;
  const raw = snapshot.foundation.raw ?? {};
  const sourceChecks = {
    secCompanyFacts: snapshot.metadata.companyFactsUrl.startsWith("https://data.sec.gov/api/xbrl/companyfacts/"),
    secFiling: snapshot.metadata.filingUrl.startsWith("https://www.sec.gov/Archives/edgar/data/"),
    realMarketData: /^https:\/\/stooq\.com\//.test(snapshot.metadata.marketSourceUrl),
    noSyntheticData: raw.noSyntheticData === true && snapshot.event.payload.noSyntheticData === true,
    currentPricePositive: (snapshot.foundation.market.currentPrice ?? 0) > 0,
    officialReceipts,
    marketAgeDays: ageDays(`${snapshot.metadata.marketDate}T00:00:00.000Z`),
    filingAgeDays: ageDays(`${snapshot.metadata.latestFilingDate}T00:00:00.000Z`),
  };
  const fundamentalState = {
    ticker: snapshot.foundation.ticker,
    fiscalPeriod: snapshot.foundation.fiscalPeriod,
    comparisonPeriod: snapshot.metadata.comparisonPeriod,
    filingAccession: snapshot.metadata.latestFilingAccession,
    metrics: Object.fromEntries(Object.entries(snapshot.foundation.metrics).map(([key, value]) => [key, roundNumber(value)])),
    trailingValuationInputs: {
      priceToSales: roundNumber(snapshot.foundation.valuation.priceToSales),
      priceToEarnings: roundNumber(snapshot.foundation.valuation.priceToEarnings),
      freeCashFlowYield: roundNumber(snapshot.foundation.valuation.freeCashFlowYield),
    },
  };
  const classification = {
    candidateBucket: foundationDecision.candidateBucket,
    foundationAlertType: foundationDecision.alertType,
    companyThesisStatus: foundationDecision.thesisStatus,
    securityReadiness: foundationDecision.securityReadiness,
    eventDirection: eventDecision.impact.direction,
    eventSeverity: eventDecision.impact.severity,
    eventAlertType: eventDecision.alertType,
    eventThesisStatusAfter: eventDecision.thesisStatusAfter,
    filingAccession: snapshot.metadata.latestFilingAccession,
    fiscalPeriod: snapshot.foundation.fiscalPeriod,
  };
  return {
    round,
    ticker: snapshot.foundation.ticker,
    company: snapshot.foundation.company,
    metadata: snapshot.metadata,
    foundationInput: {
      fiscalPeriod: snapshot.foundation.fiscalPeriod,
      metrics: Object.fromEntries(Object.entries(snapshot.foundation.metrics).map(([key, value]) => [key, roundNumber(value)])),
      valuation: Object.fromEntries(Object.entries(snapshot.foundation.valuation).map(([key, value]) => [key, roundNumber(value)])),
      market: {
        currentPrice: roundNumber(snapshot.foundation.market.currentPrice),
        priceChange1d: roundNumber(snapshot.foundation.market.priceChange1d),
        priceChange20d: roundNumber(snapshot.foundation.market.priceChange20d),
        priceChange90d: roundNumber(snapshot.foundation.market.priceChange90d),
        volumeRatio: roundNumber(snapshot.foundation.market.volumeRatio),
        priceObservedAt: snapshot.foundation.market.priceObservedAt,
      },
      missingFields: snapshot.foundation.missingFields,
      warnings: snapshot.foundation.warnings,
    },
    foundationDecision,
    eventDecision,
    sourceChecks,
    fundamentalFingerprint: fingerprint(fundamentalState),
    classificationSignature: fingerprint(classification),
  };
}

const rounds: RoundResult[] = [];
for (let round = 1; round <= roundsRequested; round += 1) {
  const startedAt = new Date().toISOString();
  const live = await fetchLiveOpportunityUniverse(tickersRequested, new Date());
  rounds.push({
    round,
    startedAt,
    completedAt: new Date().toISOString(),
    snapshots: live.snapshots.map((snapshot) => evaluate(snapshot, round)),
    errors: live.errors,
  });
  if (round < roundsRequested) await sleep(1_000);
}

const records = rounds.flatMap((round) => round.snapshots);
const consistencyByTicker = tickersRequested.map((ticker) => {
  const tickerRecords = records.filter((record) => record.ticker === ticker);
  const scores = tickerRecords.map((record) => record.foundationDecision.scores.opportunityScore);
  const prices = tickerRecords.map((record) => record.foundationInput.market.currentPrice).filter((value): value is number => typeof value === "number");
  const scoreRange = scores.length ? Math.max(...scores) - Math.min(...scores) : null;
  const priceRangePercent = prices.length && Math.min(...prices) > 0
    ? ((Math.max(...prices) - Math.min(...prices)) / Math.min(...prices)) * 100
    : null;
  const classificationSignatures = [...new Set(tickerRecords.map((record) => record.classificationSignature))];
  const fundamentalFingerprints = [...new Set(tickerRecords.map((record) => record.fundamentalFingerprint))];
  const allSourceChecksPass = tickerRecords.every((record) =>
    record.sourceChecks.secCompanyFacts
    && record.sourceChecks.secFiling
    && record.sourceChecks.realMarketData
    && record.sourceChecks.noSyntheticData
    && record.sourceChecks.currentPricePositive
    && record.sourceChecks.officialReceipts >= 2
    && record.sourceChecks.marketAgeDays !== null
    && record.sourceChecks.marketAgeDays <= 10
    && record.sourceChecks.filingAgeDays !== null
    && record.sourceChecks.filingAgeDays <= 550
  );
  const consistent = tickerRecords.length === roundsRequested
    && classificationSignatures.length === 1
    && fundamentalFingerprints.length === 1
    && scoreRange !== null
    && scoreRange <= 2
    && priceRangePercent !== null
    && priceRangePercent <= 2.5
    && allSourceChecksPass;
  const latest = tickerRecords.at(-1);
  return {
    ticker,
    roundsCompleted: tickerRecords.length,
    consistent,
    scoreRange,
    priceRangePercent: priceRangePercent === null ? null : Number(priceRangePercent.toFixed(4)),
    classificationSignatures,
    fundamentalFingerprints,
    allSourceChecksPass,
    latestResult: latest ? {
      company: latest.company,
      fiscalPeriod: latest.metadata.fiscalPeriod,
      latestFiling: `${latest.metadata.latestFilingForm} ${latest.metadata.latestFilingDate} ${latest.metadata.latestFilingAccession}`,
      marketDate: latest.metadata.marketDate,
      opportunityScore: latest.foundationDecision.scores.opportunityScore,
      evidenceConfidence: latest.foundationDecision.scores.evidenceConfidence,
      riskScore: latest.foundationDecision.scores.riskScore,
      candidateBucket: latest.foundationDecision.candidateBucket,
      userAlertEligible: latest.foundationDecision.userAlertEligible,
      foundationBlockedReasons: latest.foundationDecision.blockedReasons,
      eventDirection: latest.eventDecision.impact.direction,
      eventAlertType: latest.eventDecision.alertType,
      eventUserAlertEligible: latest.eventDecision.userAlertEligible,
      sourceChecks: latest.sourceChecks,
    } : null,
  };
});

const stable = consistencyByTicker.filter((row) => row.consistent);
const latestStableRecords = stable.flatMap((row) => {
  const record = records.filter((candidate) => candidate.ticker === row.ticker).at(-1);
  return record ? [record] : [];
});
const nonNeutralEventCount = latestStableRecords.filter((record) => record.eventDecision.impact.direction !== "neutral").length;
const allRoundsMeetMinimum = rounds.every((round) => round.snapshots.length >= minimumStableTickers);
const allStableSourcesReal = latestStableRecords.every((record) => record.sourceChecks.noSyntheticData && record.sourceChecks.secCompanyFacts && record.sourceChecks.secFiling && record.sourceChecks.realMarketData);
const failureReasons = [
  ...(stable.length < minimumStableTickers ? [`only_${stable.length}_stable_tickers_minimum_${minimumStableTickers}`] : []),
  ...(!allRoundsMeetMinimum ? ["one_or_more_rounds_below_minimum_live_ticker_coverage"] : []),
  ...(!allStableSourcesReal ? ["one_or_more_stable_results_failed_real_source_checks"] : []),
  ...(nonNeutralEventCount < 1 ? ["no_real_filing_changed_any_thesis"] : []),
];
const passed = failureReasons.length === 0;
const report = {
  version: 1,
  passed,
  checkedAt: new Date().toISOString(),
  sourceMode: "real_live_sec_and_market_data",
  methodology: {
    roundsRequested,
    minimumStableTickers,
    tickersRequested,
    officialFoundationSource: "SEC Company Facts API",
    officialEventSource: "SEC Submissions and filing archives",
    marketSource: "Stooq public daily market CSV",
    classificationConsistency: "Same fiscal period, SEC accession, normalized fundamentals, candidate bucket, thesis state, and event result in every round.",
    numericTolerance: { opportunityScorePoints: 2, priceRangePercent: 2.5 },
    noMockFixtures: true,
  },
  summary: {
    roundsCompleted: rounds.length,
    stableTickerCount: stable.length,
    stableTickers: stable.map((row) => row.ticker),
    nonNeutralRealFilingEvents: nonNeutralEventCount,
    allRoundsMeetMinimum,
    allStableSourcesReal,
    totalLiveSnapshots: records.length,
    totalProviderErrors: rounds.reduce((sum, round) => sum + round.errors.length, 0),
    failureReasons,
  },
  consistencyByTicker,
  rounds,
  safety: {
    databaseWrites: false,
    alertPublishing: false,
    notifications: false,
    payments: false,
    openAiCalls: false,
  },
};

await mkdir(outputPath.split("/").slice(0, -1).join("/") || ".", { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  passed,
  sourceMode: report.sourceMode,
  roundsCompleted: report.summary.roundsCompleted,
  stableTickerCount: report.summary.stableTickerCount,
  stableTickers: report.summary.stableTickers,
  nonNeutralRealFilingEvents: report.summary.nonNeutralRealFilingEvents,
  totalProviderErrors: report.summary.totalProviderErrors,
  failureReasons,
  reportPath: outputPath,
  latestResults: consistencyByTicker.map((row) => row.latestResult).filter(Boolean),
  safety: report.safety,
}, null, 2));
assert.equal(passed, true, `Live consistency test failed: ${failureReasons.join(", ")}`);
