import crypto from "node:crypto";
import { runAiCommittee, TRUSTED_IN_MEMORY_EVIDENCE } from "@/lib/ai-committee/orchestrator";
import type { AiCommitteeEvidencePack, EvidenceStrength } from "@/lib/ai-committee/evidence-pack";
import { getAiCommitteeProviderStatus } from "@/lib/ai-committee/provider";
import { buildImpactCandidates, fingerprintCandidate, reassessCandidateAfterFundamentals } from "@/lib/equity-signal/analysis";
import { collectEventSources } from "@/lib/equity-signal/event-sources";
import { enrichCandidateFundamentals } from "@/lib/equity-signal/fundamentals";
import { bootstrapPublicHistoricalSignals, mergeHistoricalSignals } from "@/lib/equity-signal/historical-bootstrap";
import { fetchMacroContext } from "@/lib/equity-signal/macro";
import { enrichCandidateQuotes } from "@/lib/equity-signal/market";
import { summarizeEarlyOneDayOutcomes, type HistoricalSignalRecord } from "@/lib/equity-signal/historical-analogs";
import type { ImpactCandidate, MacroContext, MarketQuote, ProviderResult } from "@/lib/equity-signal/types";
import { loadEquityUniverse } from "@/lib/equity-signal/universe";

export type EquityProviderCallRequest = {
  provider: string;
  quotaKey: string;
  cadenceKey: string;
  checkedAt: string;
  rollingWindowMs: number;
  maximumCallsInWindow: number;
  minimumIntervalMs: number;
};

export type EquityProviderCallDecision = {
  allowed: boolean;
  nextRetryAt: string | null;
  reason: "reserved" | "cadence_guard" | "rolling_quota_guard";
};

export type EquitySignalLabInput = {
  allowOpenAi?: boolean;
  fetchImpl?: typeof fetch;
  now?: Date;
  outcomeTickers?: string[];
  historicalSignals?: HistoricalSignalRecord[];
  skipOpenAiCandidateFingerprints?: string[];
  beforeOpenAiCall?: (reservation: { candidateFingerprint: string; checkedAt: string; ticker: string; direction: "upside" | "downside" }) => Promise<boolean>;
  beforeProviderCall?: (request: EquityProviderCallRequest) => Promise<EquityProviderCallDecision>;
};

const FORECAST_HORIZON_DAYS = { "1D": 1, "3D": 3, "7D": 7, "30D": 30, "90D": 90 } as const;

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

type FindingAuditTelemetryInput = {
  ticker: string;
  rootEventKey: string;
  trackingDisposition: "qualified" | "shadow_near_miss" | "rejected";
  failedGateChecks: string[];
};

function currentScanLearningTelemetry(findings: FindingAuditTelemetryInput[]) {
  const dispositions = ["qualified", "shadow_near_miss", "rejected"] as const;
  const byDisposition = Object.fromEntries(dispositions.map((disposition) => {
    const matching = findings.filter((finding) => finding.trackingDisposition === disposition);
    return [disposition, {
      findingCount: matching.length,
      distinctRootEventCount: new Set(matching.map((finding) => finding.rootEventKey).filter(Boolean)).size,
    }];
  }));
  const failedGateGroups = [...new Set(findings.flatMap((finding) => finding.failedGateChecks))]
    .sort()
    .map((failedGateCheck) => {
      const matching = findings.filter((finding) => finding.failedGateChecks.includes(failedGateCheck));
      return {
        failedGateCheck,
        findingCount: matching.length,
        distinctRootEventCount: new Set(matching.map((finding) => finding.rootEventKey).filter(Boolean)).size,
        qualifiedFindingCount: matching.filter((finding) => finding.trackingDisposition === "qualified").length,
        shadowNearMissFindingCount: matching.filter((finding) => finding.trackingDisposition === "shadow_near_miss").length,
        rejectedFindingCount: matching.filter((finding) => finding.trackingDisposition === "rejected").length,
      };
    })
    .sort((left, right) => right.findingCount - left.findingCount || left.failedGateCheck.localeCompare(right.failedGateCheck));
  const rootGroups = new Map<string, FindingAuditTelemetryInput[]>();
  for (const finding of findings) {
    if (!finding.rootEventKey) continue;
    rootGroups.set(finding.rootEventKey, [...(rootGroups.get(finding.rootEventKey) ?? []), finding]);
  }
  const rootEventGroups = [...rootGroups.entries()]
    .map(([rootEventKey, rootFindings]) => ({
      rootEventKey,
      findingCount: rootFindings.length,
      tickers: [...new Set(rootFindings.map((finding) => finding.ticker).filter(Boolean))].sort(),
      dispositions: [...new Set(rootFindings.map((finding) => finding.trackingDisposition))].sort(),
      failedGateChecks: [...new Set(rootFindings.flatMap((finding) => finding.failedGateChecks))].sort(),
    }))
    .sort((left, right) => right.findingCount - left.findingCount || left.rootEventKey.localeCompare(right.rootEventKey));
  return {
    reportingOnly: true,
    changesSeriousSignalPermission: false,
    changesCurrentEvidenceGate: false,
    findingCount: findings.length,
    distinctRootEventCount: rootEventGroups.length,
    byDisposition,
    failedGateGroups,
    rootEventGroups,
  };
}

function withPriceForecast(candidate: ImpactCandidate, now: Date): ImpactCandidate {
  const analog = candidate.historicalAnalog;
  const quote = candidate.quote;
  const enoughRealHistory = analog.leakageSafe
    && analog.sampleSize >= 3
    && analog.selectedHorizon !== null
    && analog.medianDirectionAdjustedReturnPercent !== null
    && analog.p25DirectionAdjustedReturnPercent !== null
    && analog.p75DirectionAdjustedReturnPercent !== null;
  if (!quote || !enoughRealHistory) return candidate;
  const rawReturns = [
    analog.p25DirectionAdjustedReturnPercent!,
    analog.medianDirectionAdjustedReturnPercent!,
    analog.p75DirectionAdjustedReturnPercent!,
  ].map((value) => candidate.direction === "downside" ? -value : value);
  const prices = rawReturns.map((value) => quote.price * (1 + value / 100)).sort((left, right) => left - right);
  const medianRawReturn = candidate.direction === "downside"
    ? -analog.medianDirectionAdjustedReturnPercent!
    : analog.medianDirectionAdjustedReturnPercent!;
  const horizonDays = FORECAST_HORIZON_DAYS[analog.selectedHorizon!];
  const status = analog.sampleSize >= 20 && analog.strength === "strong"
    ? "calibrated" as const
    : analog.sampleSize >= 8
      ? "calibrating" as const
      : "provisional" as const;
  return {
    ...candidate,
    priceForecast: {
      status,
      horizon: analog.selectedHorizon,
      probabilityDirectionCorrectPercent: analog.conservativeHitProbabilityPercent,
      sampleSize: analog.sampleSize,
      medianReturnPercent: round(medianRawReturn),
      pessimisticReturnPercent: round(rawReturns[0]),
      optimisticReturnPercent: round(rawReturns[2]),
      medianPrice: round(quote.price * (1 + medianRawReturn / 100)),
      lowPrice: round(prices[0]),
      highPrice: round(prices[2]),
      forecastExpiresAt: new Date(now.getTime() + horizonDays * 24 * 60 * 60 * 1000).toISOString(),
      basedOnMarketRelativeOutcomes: (analog.marketRelative?.sampleSize ?? 0) >= 3,
      warning: status === "provisional"
        ? "Provisional range from fewer than eight independent historical events. This affects range uncertainty only; it never blocks or permits a serious current signal."
        : status === "calibrating"
          ? "The range is still calibrating and is not yet backed by twenty independent historical events. Current-signal permission remains independent."
          : "Calibrated from point-in-time real outcomes; it remains probabilistic, can be wrong, and is not an alert gate.",
    },
  };
}

function seriousActionEligible(candidate: ImpactCandidate) {
  return candidate.gatePassed
    && Boolean(candidate.quote)
    && candidate.quote?.marketSession !== "halted"
    && !["financing_proposal", "regulatory_advisory"].includes(candidate.eventFamily)
    && candidate.eventTruth >= 80
    && candidate.mappingConfidence >= 95
    && candidate.materiality >= 65
    && candidate.transmissionConfidence >= 70
    && candidate.evidenceIndependence >= 78
    && !candidate.rumour
    && candidate.contradictionPenalty < 50
    && candidate.pricedInPenalty < 50;
}

function alertReadiness(candidate: ImpactCandidate) {
  if (!candidate.quote) return "watch_quote_unavailable";
  if (candidate.quote.marketSession === "halted") return "watch_trading_halt";
  if (["financing_proposal", "regulatory_advisory"].includes(candidate.eventFamily)) return "watch_event_stage";
  if (candidate.pricedInPenalty >= 50) return "watch_already_repriced";
  return seriousActionEligible(candidate) ? "actionable_candidate" : "watch_only";
}

function prioritizeCommitteeReview<T extends { candidate: ImpactCandidate }>(items: T[]) {
  return items
    .map((item, originalIndex) => ({
      item,
      originalIndex,
      priority: seriousActionEligible(item.candidate) ? 0 : 1,
    }))
    .sort((left, right) =>
      left.priority - right.priority
      || right.item.candidate.score - left.item.candidate.score
      || left.originalIndex - right.originalIndex)
    .map(({ item }) => item);
}

function section(available: boolean, strength: EvidenceStrength, summary: string, items: Array<Record<string, unknown>>) {
  return { available, strength, summary, items };
}

function freshness(now: Date, publishedAt: string) {
  const ageHours = Math.max(0, (now.getTime() - Date.parse(publishedAt)) / 3_600_000);
  return { ageHours, freshness: ageHours <= 24 ? "fresh" as const : ageHours <= 168 ? "stale" as const : "old" as const };
}

function providerConfiguration() {
  const configured = (name: string) => Boolean(process.env[name]?.trim());
  return {
    secEdgar: { keyRequired: false, configured: true },
    nasdaqTrader: { keyRequired: false, configured: true },
    nasdaqTradeHalts: { keyRequired: false, configured: true },
    googleNewsRss: { keyRequired: false, configured: true },
    gdelt: { keyRequired: false, configured: true },
    federalRegister: { keyRequired: false, configured: true },
    officialGovernmentFeeds: { keyRequired: false, configured: true },
    openFda: { variable: "OPENFDA_API_KEY", keyRequired: false, configured: configured("OPENFDA_API_KEY") },
    fred: { variable: "FRED_API_KEY", keyRequired: false, configured: configured("FRED_API_KEY") },
    marketaux: { variable: "MARKETAUX_API_KEY", keyRequired: true, configured: configured("MARKETAUX_API_KEY") },
    alphaVantage: { variable: "ALPHA_VANTAGE_API_KEY", keyRequired: true, configured: configured("ALPHA_VANTAGE_API_KEY") },
    fmp: { variable: "FMP_API_KEY", keyRequired: true, configured: configured("FMP_API_KEY") },
  };
}

function evidencePack(candidate: ImpactCandidate, providers: ProviderResult[], macro: MacroContext, now: Date, fingerprint: string, benchmarkQuote: MarketQuote | null): AiCommitteeEvidencePack {
  const currentEvidenceProviders = providers.filter((provider) => provider.provider !== "public_historical_price_bootstrap");
  const receipts = candidate.receipts;
  const filingItems = receipts.filter((receipt) => receipt.channel === "sec_current_filings").map((receipt) => ({ title: receipt.title, summary: receipt.summary, url: receipt.url, publisher: receipt.publisher, publishedAt: receipt.publishedAt, form: receipt.rawEventType }));
  const newsItems = receipts.map((receipt) => ({ title: receipt.title, summary: receipt.summary, url: receipt.url, publisher: receipt.publisher, publishedAt: receipt.publishedAt, channel: receipt.channel, primarySource: receipt.primarySource, official: receipt.official }));
  const fdaItems = receipts.filter((receipt) => receipt.channel === "openfda").map((receipt) => ({ title: receipt.title, summary: receipt.summary, url: receipt.url, publishedAt: receipt.publishedAt }));
  const fundamentalItems = candidate.fundamentals?.items.map((item) => ({ ...item, sourceUrl: candidate.fundamentals?.sourceUrl })) ?? [];
  const macroItems = macro.series.map((item) => ({ seriesId: item.seriesId, label: item.label, latestDate: item.latestDate, value: item.value, previousValue: item.previousValue, change: item.change, changePercentile: item.changePercentile, changeZScore: item.changeZScore, observationCount: item.observationCount, sourceUrl: item.sourceUrl }));
  const quoteItems = [
    ...(candidate.quote ? [{ ...candidate.quote, role: "candidate_entry_anchor" }] : []),
    ...(benchmarkQuote ? [{ ...benchmarkQuote, role: "broad_market_benchmark" }] : []),
  ];
  const sourceNames = [...new Set(receipts.map((receipt) => receipt.publisher).concat(currentEvidenceProviders.map((provider) => provider.provider), ["Nasdaq Trader equity universe", "FRED macro regime"]))];
  const sourceLinks = [...new Set(receipts.map((receipt) => receipt.url).concat(macro.series.map((item) => item.sourceUrl)).filter(Boolean))];
  const filingRelevant = ["earnings_guidance", "financing_dilution", "insider_ownership", "merger_acquisition", "leadership_change"].includes(candidate.eventFamily);
  const fundamentalsRelevant = ["earnings_guidance", "financing_dilution", "contract_award", "merger_acquisition"].includes(candidate.eventFamily);
  const missingEvidence = [
    ...(!candidate.quote ? ["priceVolumeEvidence"] : []),
    ...(filingRelevant && !filingItems.length ? ["filingEvidence"] : []),
    ...(fundamentalsRelevant && !candidate.fundamentals?.available ? ["fundamentalsEvidence"] : []),
  ];
  const dataFreshnessWarnings = [
    ...receipts.filter((receipt) => freshness(now, receipt.publishedAt).freshness !== "fresh").map((receipt) => `${receipt.publisher} receipt is older than 24 hours.`),
    ...(candidate.quote && (candidate.quote.delayedMinutes ?? 0) > 30 ? [`Market snapshot is ${candidate.quote.delayedMinutes} minutes behind the scan time; treat it as an entry-readiness warning, never as proof that the event worked.`] : []),
  ];
  return {
    assetClass: "public_equity",
    candidateAlertId: `branch-equity-${fingerprint}`,
    rawSignalIds: [],
    ticker: candidate.ticker,
    company: candidate.company,
    actionLabel: seriousActionEligible(candidate)
      ? candidate.direction === "upside" ? "BUY alert candidate" : "SELL alert candidate"
      : candidate.direction === "upside" ? "Serious upside watch" : "Serious downside watch",
    eventHeadline: candidate.eventHeadline,
    whatHappened: `${candidate.whatHappened} Causal path: ${candidate.causalChain.join(" -> ")}. No prior price movement was required for detection.`,
    sourceNames,
    sourceLinks,
    sourceFreshness: receipts.map((receipt) => ({ source: receipt.publisher, collectedAt: receipt.publishedAt, ...freshness(now, receipt.publishedAt) })),
    sourceHealth: currentEvidenceProviders.map((provider) => ({ source: provider.provider, status: provider.status, checkedAt: provider.checkedAt, lastSuccessAt: provider.status === "connected" ? provider.checkedAt : null, responseTimeMs: provider.responseTimeMs ?? null, problem: provider.error, notes: `${provider.recordsRead} real record(s) read; cached=${provider.cached}; cacheAgeMs=${provider.cacheAgeMs ?? "n/a"}; consecutiveFailures=${provider.consecutiveFailures ?? 0}. Connectivity alone adds no score.` })),
    proofBundleSummary: { proofCount: sourceLinks.length, proofTypes: ["official_event", "independent_news", "macro_regime", ...(candidate.quote ? ["market_snapshot"] : [])], uniquePublishers: candidate.independentPublishers, liveOnly: true, priorPriceMoveRequired: false },
    filingEvidence: section(filingItems.length > 0, filingItems.length ? "strong" : "missing", filingItems.length ? `${filingItems.length} official SEC filing receipt(s) are linked.` : "No event-specific SEC filing receipt was matched.", filingItems),
    newsEvidence: section(newsItems.length > 0, candidate.primarySource || candidate.independentPublishers >= 2 ? "strong" : "weak", `${newsItems.length} event receipt(s), ${candidate.independentPublishers} independent publisher(s), primarySource=${candidate.primarySource}.`, newsItems),
    priceVolumeEvidence: section(quoteItems.length > 0, quoteItems.length ? "medium" : "missing", quoteItems.length ? "A current or latest-available public-equity quote anchors execution and later outcome measurement; price movement was not used to discover or qualify the event." : "No usable market quote was available, so the item cannot become a final serious signal.", quoteItems),
    fundamentalsEvidence: section(fundamentalItems.length > 0, candidate.fundamentals?.available ? "medium" : "missing", fundamentalItems.length ? `SEC Company Facts supplied ${fundamentalItems.length} latest filed metrics. They provide scale and balance-sheet context but do not replace event-specific guidance or filing text.` : fundamentalsRelevant ? "Event-specific financial magnitude is unavailable, so the committee must not approve an unsupported earnings or valuation impact." : "Company fundamentals are optional for this event family unless a revenue, cost, balance-sheet, or valuation claim is made.", fundamentalItems),
    macroEvidence: section(macro.series.length > 0, macro.status === "connected" ? "strong" : macro.series.length ? "medium" : "missing", `Macro regime: ${macro.regime.join(", ")}. Historical changes are context, not a fabricated event backtest.`, macroItems),
    fdaRegulatoryEvidence: section(fdaItems.length > 0, fdaItems.length ? "strong" : "missing", fdaItems.length ? "Official FDA event evidence is linked." : "FDA evidence is not applicable unless this event concerns a regulated health product.", fdaItems),
    cryptoFxEvidence: section(false, "missing", "Digital-asset evidence is not applicable; this branch scans public equities only.", []),
    finraShortPressureEvidence: section(false, "missing", "Short-pressure data is optional and no short-squeeze claim is made.", []),
    wikidataRippleRelationships: section(candidate.relationship !== "direct", candidate.relationship === "direct" ? "missing" : "medium", candidate.causalChain.join(" -> "), [{ relationship: candidate.relationship, causalChain: candidate.causalChain, transmissionConfidence: candidate.transmissionConfidence }]),
    historicalPatternMatch: section(
      false,
      "missing",
      "Historical outcomes are deliberately excluded from this committee pack, permission decision, and current-evidence score. They remain in R2 only for separate forecast calibration.",
      [],
    ),
    previousSimilarOutcomes: section(
      false,
      "missing",
      "Previous outcomes cannot make a current event serious and are not supplied to the approval committee. They are retained in R2 for later forecast calibration only.",
      [],
    ),
    score: { actionStrength: candidate.score, profitPotential: candidate.score, evidenceConfidence: Math.round((candidate.eventTruth + candidate.evidenceIndependence + candidate.mappingConfidence) / 3), riskLevel: candidate.contradictionPenalty >= 50 ? "high" : candidate.relationship === "direct" ? "medium" : "medium_high", pricedInCheck: candidate.quote ? "market_snapshot_checked_but_no_prior_move_required" : "not_checked", eventTruth: candidate.eventTruth, mappingConfidence: candidate.mappingConfidence, materiality: candidate.materiality, transmissionConfidence: candidate.transmissionConfidence, historicalSupport: 0, contradictionPenalty: candidate.contradictionPenalty, priorPriceMoveRequired: false, gateChecks: candidate.gateChecks, createdAt: now.toISOString(), persisted: false },
    currentRiskLabels: [`direction:${candidate.direction}`, `relationship:${candidate.relationship}`, `event_family:${candidate.eventFamily}`, `historical_comparison_required:false`, `historical_permission_weight:0`, `alert_readiness:${alertReadiness(candidate)}`, ...(candidate.rumour ? ["rumour"] : []), ...(!candidate.quote ? ["market_quote_unavailable"] : []), ...(candidate.pricedInPenalty >= 50 ? ["already_materially_repriced"] : [])],
    missingEvidence,
    dataFreshnessWarnings,
    compatibility: { callsOpenAi: false, publishes: false, sendsTelegram: false, writesDatabase: false },
  };
}

function sourceSummary(providers: ProviderResult[]) {
  return Object.fromEntries(providers.map((provider) => [provider.provider, provider.status]));
}

function providerDetails(providers: ProviderResult[]) {
  return Object.fromEntries(providers.map((provider) => [provider.provider, { status: provider.status, checkedAt: provider.checkedAt, nextRetryAt: provider.nextRetryAt, cached: provider.cached, cacheAgeMs: provider.cacheAgeMs ?? null, consecutiveFailures: provider.consecutiveFailures ?? 0, responseTimeMs: provider.responseTimeMs ?? null, realReceipts: provider.receipts.length, recordsRead: provider.recordsRead, error: provider.error, entitlementVerified: provider.entitlementVerified, sourceUrls: provider.sourceUrls }]));
}

function outcomeTrackingCandidate(
  candidate: ImpactCandidate,
  fingerprint: string,
  macro: MacroContext,
  benchmarkTicker: string,
  benchmarkQuote: MarketQuote | null,
  now: Date,
) {
  return {
    ticker: candidate.ticker,
    company: candidate.company,
    cik: candidate.cik,
    price: candidate.quote?.price ?? null,
    marketObservedAt: candidate.quote?.observedAt ?? null,
    marketSource: candidate.quote?.source ?? null,
    benchmarkTicker,
    benchmarkPrice: benchmarkQuote?.price ?? null,
    benchmarkObservedAt: benchmarkQuote?.observedAt ?? null,
    benchmarkSource: benchmarkQuote?.source ?? null,
    direction: candidate.direction,
    eventFamily: candidate.eventFamily,
    relationship: candidate.relationship,
    eventHeadline: candidate.eventHeadline,
    eventObservedAt: candidate.eventObservedAt,
    evidenceFingerprint: fingerprint,
    rootEventKey: candidate.rootEventKey,
    findingDisposition: candidate.trackingDisposition,
    learningUse: candidate.trackingDisposition === "qualified" ? "pending_committee_review" : "diagnostics_only",
    causalChain: candidate.causalChain,
    causalExposure: candidate.causalExposure,
    eventMagnitude: candidate.eventMagnitude,
    failedGateChecks: candidate.failedGateChecks,
    macroRegime: macro.regime,
    featuresAsOf: now.toISOString(),
    receipts: candidate.receipts,
    priceForecast: candidate.priceForecast,
  };
}

export async function runEquitySignalLab(input: EquitySignalLabInput = {}) {
  const now = input.now ?? new Date();
  const fetchImpl = input.fetchImpl ?? fetch;
  const mode = "railway_branch_live_read_only";
  const startedAt = Date.now();
  try {
    // The universe is required for every downstream mapping. Resolve it first
    // so a missing universe cannot consume news or price-history allowances.
    const universeResult = await loadEquityUniverse(fetchImpl, now);
    const [eventResult, macroResult, historicalBootstrap] = await Promise.all([
      collectEventSources(fetchImpl, now),
      fetchMacroContext(fetchImpl, now),
      bootstrapPublicHistoricalSignals(input.historicalSignals ?? [], fetchImpl, now),
    ]);
    const historicalSignals = mergeHistoricalSignals(input.historicalSignals ?? [], historicalBootstrap.records);
    const realHistoricalSignals = historicalSignals.filter((record) => record.dataQuality === "real");
    const swingUpForwardSignals = realHistoricalSignals.filter((record) => record.provenance?.origin === "swing_up_forward_outcome");
    const publicBootstrapSignals = realHistoricalSignals.filter((record) => record.provenance?.origin === "public_historical_bootstrap");
    const earlyOneDayOutcomeTelemetry = summarizeEarlyOneDayOutcomes(realHistoricalSignals, { asOf: now.toISOString() });
    const mapped = buildImpactCandidates(eventResult.receipts, universeResult.snapshot, macroResult.context, now, historicalSignals);
    const activeHaltReceipts = eventResult.receipts.filter((receipt) =>
      receipt.channel === "nasdaq_trade_halts"
      && receipt.rawEventType?.endsWith(":active"));
    const activeHaltByTicker = new Map(activeHaltReceipts.flatMap((receipt) =>
      receipt.symbolHints.map((ticker) => [ticker, receipt] as const)));
    for (const candidate of mapped.candidates) {
      const haltReceipt = activeHaltByTicker.get(candidate.ticker);
      if (haltReceipt && !candidate.receipts.some((receipt) => receipt.id === haltReceipt.id)) candidate.receipts.push(haltReceipt);
    }
    const reviewedFingerprints = new Set(input.skipOpenAiCandidateFingerprints ?? []);
    const quotePriorityCandidates = mapped.candidates
      .map((candidate, originalIndex) => ({
        candidate,
        originalIndex,
        priority: candidate.gatePassed && !reviewedFingerprints.has(fingerprintCandidate(candidate))
          ? 0
          : candidate.gatePassed
            ? 1
            : candidate.trackingDisposition === "shadow_near_miss"
              ? 2
              : 3,
      }))
      .sort((left, right) => left.priority - right.priority || left.originalIndex - right.originalIndex)
      .map((item) => item.candidate);
    const quoted = await enrichCandidateQuotes(quotePriorityCandidates, fetchImpl, now, 3, input.outcomeTickers ?? []);
    for (const candidate of quoted.candidates) {
      if (candidate.quote && activeHaltByTicker.has(candidate.ticker)) candidate.quote.marketSession = "halted";
    }
    const ranked = quoted.candidates.map((candidate) => withPriceForecast(candidate, now));
    const scaleDependentShadows = ranked.filter((candidate) => candidate.quote
      && candidate.trackingDisposition === "shadow_near_miss"
      && candidate.failedGateChecks.includes("eventMagnitudeActionable"))
      .slice(0, 2);
    const initiallyQualified = ranked.filter((candidate) => candidate.gatePassed);
    const initiallyQuotedQualified = initiallyQualified.filter((candidate) => candidate.quote);
    const preferredQualified = initiallyQuotedQualified.find((candidate) => !reviewedFingerprints.has(fingerprintCandidate(candidate)))
      ?? initiallyQuotedQualified[0]
      ?? initiallyQualified[0]
      ?? null;
    const seenFundamentalsCandidates = new Set<string>();
    const fundamentalsCandidates = [...scaleDependentShadows, preferredQualified]
      .filter((candidate): candidate is ImpactCandidate => Boolean(candidate))
      .filter((candidate) => {
        const fingerprint = fingerprintCandidate(candidate);
        if (seenFundamentalsCandidates.has(fingerprint)) return false;
        seenFundamentalsCandidates.add(fingerprint);
        return true;
      })
      .slice(0, 3);
    const fundamentalsResults = fundamentalsCandidates.length
      ? await Promise.all(fundamentalsCandidates.map((candidate) => enrichCandidateFundamentals(candidate, fetchImpl, now)))
      : [await enrichCandidateFundamentals(null, fetchImpl, now)];
    for (const result of fundamentalsResults) reassessCandidateAfterFundamentals(result.candidate, now);
    ranked.sort((left, right) => right.score - left.score || right.eventTruth - left.eventTruth);
    const finalCandidateStates = new Map(ranked.map((candidate) => [
      `${candidate.rootEventKey}|${candidate.ticker}|${candidate.eventFamily}|${candidate.direction}`,
      candidate,
    ]));
    const learningTelemetryFindings = mapped.findingAuditLedger.map((finding) => {
      const finalCandidate = finalCandidateStates.get(
        `${finding.rootEventKey}|${finding.ticker}|${finding.eventFamily}|${finding.direction}`,
      );
      return {
        ticker: finding.ticker,
        rootEventKey: finding.rootEventKey,
        trackingDisposition: finalCandidate?.trackingDisposition ?? finding.trackingDisposition,
        failedGateChecks: finalCandidate?.failedGateChecks ?? finding.failedGateChecks,
      };
    });
    const gatePassed = ranked.filter((candidate) => candidate.gatePassed);
    const qualifiedWithFingerprints = gatePassed.map((candidate) => ({ candidate, fingerprint: fingerprintCandidate(candidate) }));
    const quotedQualified = qualifiedWithFingerprints.filter((item) => item.candidate.quote);
    const unreviewedQuoted = quotedQualified.filter((item) => !reviewedFingerprints.has(item.fingerprint));
    const prioritizedUnreviewed = prioritizeCommitteeReview(unreviewedQuoted);
    const prioritizedQuoted = prioritizeCommitteeReview(quotedQualified);
    const selectedForReview = input.allowOpenAi ? prioritizedUnreviewed[0] ?? prioritizedQuoted[0] : prioritizedQuoted[0];
    const best = selectedForReview?.candidate ?? gatePassed[0] ?? null;
    const shadowTracked = ranked
      .filter((candidate) => candidate.trackingDisposition === "shadow_near_miss" && candidate.quote)
      .slice(0, 2)
      .map((candidate) => ({ candidate, fingerprint: fingerprintCandidate(candidate) }));
    const baseProviders = [...eventResult.providers, historicalBootstrap.provider, quoted.provider];
    const providers = [...baseProviders, ...fundamentalsResults.map((result) => result.provider)];
    const common = {
      ok: true,
      mode,
      assetClass: "public_equity",
      universeScope: universeResult.snapshot.scope,
      checkedAt: now.toISOString(),
      durationMs: Date.now() - startedAt,
      sources: sourceSummary(providers),
      providerDetails: providerDetails(providers),
      fundamentalsCandidateChecks: fundamentalsResults.map((result) => ({
        ticker: result.candidate?.ticker ?? null,
        status: result.provider.status,
        checkedAt: result.provider.checkedAt,
        recordsRead: result.provider.recordsRead,
        error: result.provider.error,
        sourceUrls: result.provider.sourceUrls,
      })),
      secFilingDetails: eventResult.secFilingDetails,
      providerConfiguration: providerConfiguration(),
      universe: { constructionMode: universeResult.snapshot.constructionMode, refreshedAt: universeResult.snapshot.refreshedAt, cache: universeResult.cache, refreshedThisRun: universeResult.refreshed, r2Write: universeResult.r2Write, coverage: universeResult.snapshot.coverage, sources: universeResult.snapshot.sources },
      mappedFindingReceiptProofDictionary: mapped.findingReceiptProofDictionary,
      candidateLearningTelemetry: currentScanLearningTelemetry(learningTelemetryFindings),
      candidateFunnel: {
        stocksInUniverse: universeResult.snapshot.entries.length,
        realEventReceipts: eventResult.receipts.length,
        mappedRelationships: mapped.diagnostics.mappedRelationships,
        mappedFindingsPermanentlyAudited: mapped.findingAuditLedger.length,
        eventClusters: mapped.diagnostics.eventClusters,
        directCandidates: mapped.diagnostics.directCandidates,
        knockOnCandidates: mapped.diagnostics.rippleCandidates,
        candidatesPassingCurrentEvidenceGate: gatePassed.length,
        shadowNearMissesTracked: shadowTracked.length,
        candidatesWithMarketQuote: quotedQualified.length,
        candidatesSkippedBecauseRecentlyReviewed: quotedQualified.length - unreviewedQuoted.length,
        unreviewedCandidatesAvailable: unreviewedQuoted.length,
        committeeCandidates: best?.quote && !reviewedFingerprints.has(fingerprintCandidate(best)) ? 1 : 0,
      },
      historicalLearning: {
        realPointInTimeSignalsAvailable: realHistoricalSignals.length,
        swingUpForwardSignalsAvailable: swingUpForwardSignals.length,
        publicBootstrapSignalsAvailable: publicBootstrapSignals.length,
        unclassifiedRealSignalsAvailable: realHistoricalSignals.length - swingUpForwardSignals.length - publicBootstrapSignals.length,
        publicBootstrapSignalsAddedThisRun: historicalBootstrap.records.length,
        publicBootstrapSeedsAvailable: historicalBootstrap.seedsAvailable,
        publicBootstrapSeedsRemaining: historicalBootstrap.seedsRemaining,
        doesNotWaitForAllCheckpoints: true,
        earliestEligibleCheckpoint: "1D",
        checkpointsUsedOnlyAfterTheyAreObservable: true,
        numericForecastRequiresIndependentRealEvents: 3,
        historicalComparisonRequiredForSeriousSignal: false,
        historicalPermissionWeight: 0,
        findingsAndLaterOutcomesStoredInR2: true,
        actionableBuySellRequiresCalibratedHistory: false,
        outcomeUsefulnessRule: "at_least_0.5_percent_in_predicted_direction_and_better_than_SPY",
        earlyOneDayOutcomeTelemetry,
        forecastEligibleRecords: realHistoricalSignals.filter((record) => record.learningUse === "forecast_eligible" || (!record.learningUse && record.provenance?.origin === "public_historical_bootstrap")).length,
        diagnosticOnlyRecords: realHistoricalSignals.filter((record) => record.learningUse === "diagnostics_only").length,
        quarantinedRecords: realHistoricalSignals.filter((record) => record.learningUse === "quarantined").length,
        automaticRuleRewritingEnabled: false,
        learningPolicy: "Outcomes update forecast context only after strict trust and point-in-time checks; they never rewrite the serious-signal gate automatically.",
      },
      _historicalSignalLibraryAdditions: historicalBootstrap.records,
      mappedFindingAuditLedger: mapped.findingAuditLedger,
      outcomeTrackingCandidates: quotedQualified.map(({ candidate, fingerprint }) => outcomeTrackingCandidate(candidate, fingerprint, macroResult.context, quoted.benchmarkTicker, quoted.benchmarkQuote, now)),
      shadowOutcomeTrackingCandidates: shadowTracked.map(({ candidate, fingerprint }) => outcomeTrackingCandidate(candidate, fingerprint, macroResult.context, quoted.benchmarkTicker, quoted.benchmarkQuote, now)),
      scheduledEventWatchlist: eventResult.receipts.filter((receipt) => receipt.scheduled).slice(0, 100).map((receipt) => ({ title: receipt.title, scheduledAt: receipt.publishedAt, tickerHints: receipt.symbolHints, companyHints: receipt.companyHints, publisher: receipt.publisher, sourceUrl: receipt.url, predictionStatus: "awaiting_verified_event_content_and_direction" })),
      unmappedOfficialEventWatchlist: eventResult.receipts.filter((receipt) => receipt.official && !receipt.symbolHints.length && !receipt.companyHints.length).slice(0, 100).map((receipt) => ({ title: receipt.title, summary: receipt.summary, observedAt: receipt.publishedAt, publisher: receipt.publisher, channel: receipt.channel, sourceUrl: receipt.url, predictionStatus: "global_event_seen_mapping_or_direction_not_yet_proven" })),
      macroContext: macroResult.context,
      macroProvider: macroResult.provider,
      liveSourcePolicy: { eventFirst: true, priorTwoPercentMoveRequired: false, postEventOnePercentMoveRequired: false, waitsForOutcomeCheckpointBeforeSeriousSignal: false, historicalComparisonRequiredForSeriousSignal: false, priceUsedForDiscovery: false, priceUsedForExecutionAndOutcomeTrackingOnly: true, extendedHoursPriceAnchorsEnabled: true, materiallyRepricedEventsBecomeWatchInsteadOfBuySell: true, stagedOfferingProposalCanBecomeWatch: true, fdaAdvisoryVoteCanBecomeWatch: true, officialTradingHaltForcesWatch: true, primarySourceCanAdvanceWithoutSecondaryNews: true, unofficialClaimRequiresIndependentPublishers: 2, genericSectorBasketsCanQualify: false, companyRelativeMagnitudeRequiredForContractAndDilution: true, cryptoScanningEnabled: false, providerFailureIsolation: true, connectivityAloneAddsScore: false },
      assetsChecked: universeResult.snapshot.entries.length,
      candidatesChecked: ranked.length,
      databaseWrites: false,
      publishing: false,
      notifications: false,
      realProviderResponsesOnly: true,
      failureScope: "none",
      repairEligible: false,
      marketSnapshot: quoted.marketSnapshot,
      benchmarkSnapshot: quoted.benchmarkQuote,
      rankedCandidates: ranked.slice(0, 100).map((candidate) => ({ ticker: candidate.ticker, company: candidate.company, cik: candidate.cik, rootEventKey: candidate.rootEventKey, direction: candidate.direction, eventFamily: candidate.eventFamily, relationship: candidate.relationship, eventHeadline: candidate.eventHeadline, eventObservedAt: candidate.eventObservedAt, primarySource: candidate.primarySource, independentPublishers: candidate.independentPublishers, eventTruth: candidate.eventTruth, mappingConfidence: candidate.mappingConfidence, materiality: candidate.materiality, transmissionConfidence: candidate.transmissionConfidence, historicalSupport: candidate.historicalSupport, evidenceIndependence: candidate.evidenceIndependence, contradictionPenalty: candidate.contradictionPenalty, pricedInPenalty: candidate.pricedInPenalty, score: candidate.score, gateChecks: candidate.gateChecks, gatePassed: candidate.gatePassed, trackingDisposition: candidate.trackingDisposition, failedGateChecks: candidate.failedGateChecks, eventMagnitude: candidate.eventMagnitude, causalExposure: candidate.causalExposure, quote: candidate.quote, fundamentals: candidate.fundamentals, causalChain: candidate.causalChain, falsifiers: candidate.falsifiers, historicalAnalog: candidate.historicalAnalog, priceForecast: candidate.priceForecast, alertReadiness: candidate.trackingDisposition === "shadow_near_miss" ? "diagnostic_shadow" : alertReadiness(candidate) })),
      sourceFailures: providers.filter((provider) => !["connected", "not_due"].includes(provider.status)).map((provider) => ({ provider: provider.provider, status: provider.status, error: provider.error, nextRetryAt: provider.nextRetryAt })),
    };
    if (!best) {
      return { ...common, status: "no_qualified_signal", seriousSignalFound: false, openAiCalled: false, qualityScore: ranked[0]?.score ?? 0, blockers: ["No current event passed verified event truth, exact issuer mapping, company-relative materiality where required, causal transmission, freshness, and contradiction gates. No price move, historical comparison, or later outcome was required."], technicalFailureFingerprint: null };
    }
    const fingerprint = fingerprintCandidate(best);
    const selectedCandidate = { ticker: best.ticker, company: best.company, cik: best.cik, rootEventKey: best.rootEventKey, price: best.quote?.price ?? null, marketObservedAt: best.quote?.observedAt ?? null, marketSource: best.quote?.source ?? null, benchmarkTicker: quoted.benchmarkTicker, benchmarkPrice: quoted.benchmarkQuote?.price ?? null, benchmarkObservedAt: quoted.benchmarkQuote?.observedAt ?? null, benchmarkSource: quoted.benchmarkQuote?.source ?? null, direction: best.direction, eventFamily: best.eventFamily, relationship: best.relationship, eventHeadline: best.eventHeadline, eventObservedAt: best.eventObservedAt, evidenceFingerprint: fingerprint, score: best.score, gateChecks: best.gateChecks, trackingDisposition: best.trackingDisposition, failedGateChecks: best.failedGateChecks, eventMagnitude: best.eventMagnitude, causalExposure: best.causalExposure, causalChain: best.causalChain, falsifiers: best.falsifiers, receipts: best.receipts, quote: best.quote, fundamentals: best.fundamentals, historicalAnalog: best.historicalAnalog, priceForecast: best.priceForecast, alertReadiness: alertReadiness(best) };
    if (!best.quote) return { ...common, status: "qualified_event_market_quote_unavailable", seriousSignalFound: false, openAiCalled: false, candidateFingerprint: fingerprint, selectedCandidate, qualityScore: best.score, blockers: ["The event qualified before the market moved, but no usable price anchor was available for a safe entry or outcome record. The event remains on the watch queue; no OpenAI budget was spent."], technicalFailureFingerprint: null };
    if (input.skipOpenAiCandidateFingerprints?.includes(fingerprint)) return { ...common, status: "qualified_candidate_already_reviewed", seriousSignalFound: false, openAiCalled: false, candidateFingerprint: fingerprint, selectedCandidate, qualityScore: best.score, blockers: ["The same event evidence was reviewed recently, so OpenAI was not called again."], technicalFailureFingerprint: null };
    const aiProvider = getAiCommitteeProviderStatus();
    if (!input.allowOpenAi) return { ...common, status: "qualified_signal_openai_not_requested", seriousSignalFound: false, openAiCalled: false, candidateFingerprint: fingerprint, selectedCandidate, qualityScore: best.score, committee: { configured: aiProvider.configured, enabled: aiProvider.enabled }, blockers: ["The rolling OpenAI review budget was not available; the qualified event remains recorded without another paid call."], technicalFailureFingerprint: null };
    if (!aiProvider.configured || !aiProvider.enabled) return { ...common, ok: false, status: "configuration_blocker", seriousSignalFound: false, openAiCalled: false, candidateFingerprint: fingerprint, selectedCandidate, qualityScore: best.score, blockers: [aiProvider.configured ? "AI committee is disabled." : "OPENAI_API_KEY is not available in this deployment."], technicalFailureFingerprint: aiProvider.configured ? "ai_committee_disabled" : "openai_key_missing", failureScope: "configuration", repairEligible: false };
    if (input.beforeOpenAiCall && !await input.beforeOpenAiCall({ candidateFingerprint: fingerprint, checkedAt: now.toISOString(), ticker: best.ticker, direction: best.direction })) return { ...common, status: "qualified_signal_openai_reservation_denied", seriousSignalFound: false, openAiCalled: false, candidateFingerprint: fingerprint, selectedCandidate, qualityScore: best.score, blockers: ["The durable committee budget or same-evidence lock denied this paid review."], technicalFailureFingerprint: null };
    const selectedFundamentalsProvider = fundamentalsResults
      .find((result) => result.candidate === best)?.provider;
    const committeeProviders = [
      ...baseProviders,
      ...(selectedFundamentalsProvider ? [selectedFundamentalsProvider] : []),
    ];
    const pack = evidencePack(best, committeeProviders, macroResult.context, now, fingerprint, quoted.benchmarkQuote);
    const committee = await runAiCommittee({ [TRUSTED_IN_MEMORY_EVIDENCE]: pack, persistResult: false, dryRun: false, confirmRun: true, mode: "preview", maxAgents: 13, maxCostUsd: 0.75 });
    const results = Array.isArray(committee.agentResults) ? committee.agentResults : [];
    const completed = results.filter((result) => result.status === "completed").length;
    const failed = results.filter((result) => result.status === "failed").length;
    const finalJudge = results.find((result) => result.agentId === "final_judge");
    const recommendation = committee.committeeOutput?.overallRecommendation ?? "needs_more_data";
    const seriousSignalFound = committee.ok === true && completed === 14 && failed === 0 && recommendation === "approve" && finalJudge?.verdict === "positive" && (finalJudge.confidence ?? 0) >= 80 && best.gatePassed && Boolean(best.quote);
    const actionableSignalFound = seriousSignalFound && seriousActionEligible(best);
    const alertType = !seriousSignalFound ? null : actionableSignalFound ? best.direction === "upside" ? "buy" : "sell" : "watch";
    return { ...common, status: seriousSignalFound ? `serious_${alertType}` : "candidate_needs_more_data", seriousSignalFound, actionableSignalFound, alertType, openAiCalled: true, candidateFingerprint: fingerprint, selectedCandidate, qualityScore: Math.round((best.score * 0.45 + (committee.committeeOutput?.evidenceConfidenceScore ?? 0) * 0.25 + (finalJudge?.confidence ?? 0) * 0.3) * 100) / 100, committee: { ok: committee.ok, status: committee.status, agentsPlanned: committee.plannedAgents?.length ?? 0, agentsCompleted: completed, agentsFailed: failed, finalJudge: finalJudge ? { verdict: finalJudge.verdict, confidence: finalJudge.confidence, concerns: finalJudge.concerns, missingData: finalJudge.missingData, followUpChecks: finalJudge.followUpChecks } : null, output: committee.committeeOutput, writesDatabase: committee.compatibility?.writesDatabase ?? false }, blockers: seriousSignalFound ? [] : [...new Set([...(committee.committeeOutput?.missingEvidence ?? []), ...(finalJudge?.missingData ?? []), ...(finalJudge?.concerns ?? [])])].slice(0, 12), technicalFailureFingerprint: committee.ok ? null : `committee_${committee.status}`, failureScope: committee.ok ? "none" : "external_provider", repairEligible: false };
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 200) : "equity_signal_lab_failed";
    const external = /(?:http_|rate|quota|cadence|temporarily|unavailable|timeout|fetch|official_equity_universe)/i.test(message);
    return { ok: false, mode, assetClass: "public_equity", status: external ? "source_temporarily_unavailable" : "technical_failure", checkedAt: now.toISOString(), durationMs: Date.now() - startedAt, seriousSignalFound: false, openAiCalled: false, databaseWrites: false, publishing: false, notifications: false, realProviderResponsesOnly: true, qualityScore: 0, blockers: [external ? "A required universe source was temporarily unavailable and no real cached universe existed yet. No substitute or invented data was used." : message], technicalFailureFingerprint: external ? "external_provider_equity_universe" : message.replace(/\d+/g, "#"), failureScope: external ? "external_provider" : "application", repairEligible: !external };
  }
}

export function syntheticEquityFingerprintForTest(input: string) {
  return crypto.createHash("sha256").update(input).digest("hex").slice(0, 20);
}
