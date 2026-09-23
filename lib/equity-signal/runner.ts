import { completeCommitteeReview } from "@/lib/ai-committee/review-policy";
import { PR262_REVIEW_MAX_PROMPT_BYTES, PR262_REVIEW_MAX_COST_USD } from "@/lib/opportunity-engine/pr262-ai-daily-cost";
import { verifiedCompanyProfile, type CompanyIdentity, type VerifiedCompanyProfile } from "@/lib/company-profile";
import { committeeExplanation } from "@/lib/signal-explanation";
import { NEGATIVE_EARNINGS_NOTICE } from "@/lib/valuation-availability";
import crypto from "node:crypto";
import { alertDetails, industryLabel } from "@/lib/alert-details";
import { runAiCommittee, TRUSTED_IN_MEMORY_EVIDENCE } from "@/lib/ai-committee/orchestrator";
import type { AiCommitteeEvidencePack, EvidenceStrength } from "@/lib/ai-committee/evidence-pack";
import { getAiCommitteeProviderStatus } from "@/lib/ai-committee/provider";
import { buildImpactCandidates, fingerprintCandidate } from "@/lib/equity-signal/analysis";
import { reviewEvidenceRevision } from "@/lib/equity-signal/review-evidence-revision";
import { collectEventSources } from "@/lib/equity-signal/event-sources";
import { buildValuationCandidate, reassessValuationCandidate } from "@/lib/equity-signal/valuation-candidate";
import type { UsValueCompanyAnalysis } from "@/lib/opportunity-engine/us-value-investing-engine";
import type { VerifiedFactsCache } from "@/lib/equity-signal/fundamentals";
import { enrichCandidateFundamentals } from "@/lib/equity-signal/fundamentals";
import { bootstrapPublicHistoricalSignals, mergeHistoricalSignals } from "@/lib/equity-signal/historical-bootstrap";
import { fetchMacroContext } from "@/lib/equity-signal/macro";
import { evaluateFiveCasePilotGate } from "@/lib/equity-signal/pilot-serious-signal-policy";
import { enrichCandidateQuotes } from "@/lib/equity-signal/market";
import type { ReserveSecFilingDetailAccessions } from "@/lib/equity-signal/sec-filing-details";
import type { HistoricalSignalRecord } from "@/lib/equity-signal/historical-analogs";
import type { EventReceipt, ImpactCandidate, MacroContext, MarketQuote, ProviderResult } from "@/lib/equity-signal/types";
import { loadEquityUniverse, type EquityUniverseSnapshot } from "@/lib/equity-signal/universe";

export type EquityProviderCallRequest = {
  provider: string;
  quotaKey: string;
  cadenceKey: string;
  checkedAt: string;
  rollingWindowMs: number;
  maximumCallsInWindow: number;
  minimumIntervalMs: number;
  reservationUnits?: number;
};

export type EquityProviderCallDecision = {
  allowed: boolean;
  nextRetryAt: string | null;
  reason: "reserved" | "cadence_guard" | "rolling_quota_guard";
};

export type EquitySignalLabInput = {
  allowOpenAi?: boolean;
  aiProviderBlockedReason?: "authentication" | "permission" | "configured_model_unavailable";
  /** Internal research admission only; publication authority is unchanged. */
  allowIncompleteCommitteeReview?: boolean;
  verifiedFactsCache?: VerifiedFactsCache;
  reserveRejectionAudit?: () => Promise<{
    commit: (now: Date) => Promise<boolean>;
    release: (now: Date) => Promise<void>;
  } | null>;
  fetchImpl?: typeof fetch;
  resolveCompanyProfile?: (identity: CompanyIdentity) => Promise<VerifiedCompanyProfile | null>;
  signal?: AbortSignal;
  now?: Date;
  outcomeTickers?: string[];
  historicalSignals?: HistoricalSignalRecord[];
  skipOpenAiCandidateFingerprints?: string[];
  beforeOpenAiCall?: (reservation: { candidateFingerprint: string; checkedAt: string; ticker: string; direction: "upside" | "downside" | "unknown" }) => Promise<boolean>;
  beforeProviderCall?: (request: EquityProviderCallRequest) => Promise<EquityProviderCallDecision>;
  reserveSecFilingDetailAccessions?: ReserveSecFilingDetailAccessions;
  /**
   * Supplies the already-resolved issuer and one event to the PR #262 event job.
   * When present, the runner must not rebuild the whole U.S. universe or poll
   * broad event and macro feeds.
   */
  targetedContext?: {
    universe: EquityUniverseSnapshot;
    receipts: EventReceipt[];
    providers: ProviderResult[];
    secFilingDetails?: Record<string, unknown>;
    macroContext?: MacroContext;
    macroProvider?: Record<string, unknown>;
    historicalSignalsComplete?: boolean;
    storedCompanyAnalysis?: Record<string, unknown>;
    sourceEvidenceIncomplete?: boolean;
    analysisKind?: "event" | "valuation";
  };
  /** Legacy compatibility switch. The current PR262 policy always keeps history non-blocking. */
  requirePilotBeforeOpenAi?: boolean;
};

const FORECAST_HORIZON_DAYS = { "1D": 1, "3D": 3, "7D": 7, "30D": 30, "90D": 90 } as const;

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function failedGateCounts(candidates: ImpactCandidate[]) {
  const counts: Record<string, number> = {};
  for (const candidate of candidates) {
    for (const gate of candidate.failedGateChecks) counts[gate] = (counts[gate] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])));
}

function noSignalReason(
  receiptCount: number,
  diagnostics: { noiseRejected: number; directionUnknown: number; unmapped: number; mappedRelationships: number },
  candidates: ImpactCandidate[],
) {
  if (receiptCount === 0) return "no_current_event_receipts";
  if (diagnostics.mappedRelationships === 0) {
    if (diagnostics.directionUnknown > 0) return "event_direction_unresolved";
    if (diagnostics.unmapped > 0) return "issuer_or_causal_mapping_unresolved";
    if (diagnostics.noiseRejected > 0) return "all_receipts_filtered_as_noise";
    return "no_mapped_candidate";
  }
  const failures = failedGateCounts(candidates);
  const dominantGate = Object.keys(failures)[0];
  return dominantGate ? `permission_gate_failed:${dominantGate}` : "no_candidate_passed_event_first_gate";
}

function quoteFreshnessBlocker(quote: MarketQuote) {
  const age = (value: number | null | undefined) => value === null || value === undefined
    ? "unknown"
    : `${Math.round(value / 60_000)} minutes`;
  return `The market observation is ${age(quote.quoteAgeMs)} old and the provider response is ${age(quote.cacheAgeMs)} old, so it remains visible for Watch only and no committee budget is spent.`;
}

function withPriceForecast(candidate: ImpactCandidate, now: Date): ImpactCandidate {
  if (candidate.direction === "unknown") return candidate;
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
        ? "Provisional range from fewer than eight independent historical events; use as an early watch, not a proven buy/sell alert."
        : status === "calibrating"
          ? "The range is still calibrating and is not yet backed by twenty independent historical events."
          : "Calibrated from point-in-time real outcomes; it remains probabilistic and can be wrong.",
    },
  };
}

function seriousActionEligible(candidate: ImpactCandidate) {
  return candidate.direction !== "unknown" && candidate.gatePassed
    && Boolean(candidate.quote)
    && candidate.quote?.actionableForSeriousSignal === true
    && candidate.quote?.marketSession !== "halted"
    && candidate.quote?.marketSession !== "unknown"
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

/** Research admission deliberately does not imply verified direction or publication. */
export function committeeResearchAdmission(candidate: ImpactCandidate, now: Date) {
  const eventTime = Date.parse(candidate.eventObservedAt);
  const substantive = candidate.receipts.some((receipt) =>
    Boolean(receipt.url && receipt.publisher) && (receipt.summary?.trim().length ?? 0) >= 200);
  const reasons = [
    ...(!Number.isFinite(candidate.mappingConfidence) || candidate.mappingConfidence < 95 ? ["issuer_identity_not_exact"] : []),
    ...(!Number.isFinite(eventTime) || eventTime > now.getTime() + 5 * 60_000
      || now.getTime() - eventTime > 72 * 60 * 60_000 ? ["event_outside_research_window"] : []),
    ...(!substantive ? ["no_substantive_source_text"] : []),
    ...(!Number.isFinite(candidate.materiality) || !Number.isFinite(candidate.score) || candidate.materiality < 45 || candidate.score < 55 ? ["insufficient_research_priority"] : []),
    ...(candidate.relationship !== "direct" && candidate.causalExposure?.eligibleForSeriousSignal !== true
      ? ["company_exposure_unproven"] : []),
  ];
  return { eligible: reasons.length === 0, reasons, minimumResearchScore: 55, publicationScoreUnchanged: 72 };
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

function evidencePack(candidate: ImpactCandidate, providers: ProviderResult[], macro: MacroContext, now: Date, fingerprint: string, benchmarkQuote: MarketQuote | null, storedCompanyAnalysis?: Record<string, unknown>): AiCommitteeEvidencePack {
  const receipts = candidate.receipts;
  const filingItems = receipts.filter((receipt) => receipt.channel === "sec_current_filings").map((receipt) => ({ title: receipt.title, summary: receipt.summary, url: receipt.url, publisher: receipt.publisher, publishedAt: receipt.publishedAt, form: receipt.rawEventType }));
  const newsItems = receipts.map((receipt) => ({ title: receipt.title, summary: receipt.summary, url: receipt.url, publisher: receipt.publisher, publishedAt: receipt.publishedAt, channel: receipt.channel, primarySource: receipt.primarySource, official: receipt.official }));
  const fdaItems = receipts.filter((receipt) => receipt.channel === "openfda").map((receipt) => ({ title: receipt.title, summary: receipt.summary, url: receipt.url, publishedAt: receipt.publishedAt }));
  const storedCompanyItems = storedCompanyAnalysis ? [{
    source: "pr262_stored_company_analysis",
    ticker: storedCompanyAnalysis.ticker,
    company: storedCompanyAnalysis.company,
    sector: storedCompanyAnalysis.sector,
    industry: storedCompanyAnalysis.industry,
    observedAt: storedCompanyAnalysis.observedAt,
    currentPriceAtAnalysis: storedCompanyAnalysis.currentPrice,
    fairValue: storedCompanyAnalysis.fairValue,
    scores: storedCompanyAnalysis.scores,
    fundamentals: storedCompanyAnalysis.fundamentals,
    decision: storedCompanyAnalysis.decision,
  }] : [];
  const fundamentalItems = [
    ...storedCompanyItems,
    ...(candidate.fundamentals?.items.map((item) => ({ ...item, sourceUrl: candidate.fundamentals?.sourceUrl })) ?? []),
  ];
  const fundamentalsAvailable = candidate.fundamentals?.available === true || storedCompanyItems.length > 0;
  const macroItems = macro.series.map((item) => ({ seriesId: item.seriesId, label: item.label, latestDate: item.latestDate, value: item.value, previousValue: item.previousValue, change: item.change, changePercentile: item.changePercentile, changeZScore: item.changeZScore, observationCount: item.observationCount, sourceUrl: item.sourceUrl }));
  const quoteItems = [
    ...(candidate.quote ? [{ ...candidate.quote, role: "candidate_entry_anchor" }] : []),
    ...(benchmarkQuote ? [{ ...benchmarkQuote, role: "broad_market_benchmark" }] : []),
  ];
  const historicalItems = candidate.historicalAnalog.items;
  const sourceNames = [...new Set(receipts.map((receipt) => receipt.publisher).concat(providers.map((provider) => provider.provider), historicalItems.map((item) => item.provenance?.eventPublisher ?? "").filter(Boolean), ["Nasdaq Trader equity universe", "FRED macro regime"]))];
  const sourceLinks = [...new Set(receipts.map((receipt) => receipt.url).concat(candidate.fundamentals?.sourceUrl ? [candidate.fundamentals.sourceUrl] : []).concat(macro.series.map((item) => item.sourceUrl), historicalItems.map((item) => item.provenance?.eventSourceUrl ?? "")).filter(Boolean))];
  const filingRelevant = ["earnings_guidance", "financing_dilution", "insider_ownership", "merger_acquisition", "leadership_change"].includes(candidate.eventFamily);
  const fundamentalsRelevant = ["valuation_gap", "earnings_guidance", "financing_dilution", "contract_award", "merger_acquisition"].includes(candidate.eventFamily);
  const missingEvidence = [
    ...(!candidate.quote ? ["priceVolumeEvidence"] : []),
    ...(candidate.quote && candidate.quote.actionableForSeriousSignal !== true ? ["currentMarketQuote"] : []),
    ...(filingRelevant && !filingItems.length ? ["filingEvidence"] : []),
    ...(fundamentalsRelevant && !fundamentalsAvailable ? ["fundamentalsEvidence"] : []),
  ];
  const dataFreshnessWarnings = [
    ...(candidate.fundamentals?.error ? [`Financial data refresh is incomplete: ${candidate.fundamentals.error}. Retained facts keep their original dates; requested missing fields remain unresolved.`] : []),
    ...receipts.filter((receipt) => freshness(now, receipt.publishedAt).freshness !== "fresh").map((receipt) => `${receipt.publisher} receipt is older than 24 hours.`),
    ...(candidate.quote?.priceBasis === "last_completed_session" ? ["US trading is closed. This is a dated price from the latest completed trading session, not a live executable quote. Recheck the price when trading resumes."] : []),
    ...(candidate.quote && candidate.quote.priceBasis !== "last_completed_session" && (candidate.quote.delayedMinutes ?? 0) > 30 ? [`Market snapshot is ${candidate.quote.delayedMinutes} minutes behind the scan time; treat it as an entry-readiness warning, never as proof that the event worked.`] : []),
  ];
  return {
    analysisKind: candidate.eventFamily === "valuation_gap" ? "valuation" : "event",
    assetClass: "public_equity",
    candidateAlertId: `branch-equity-${fingerprint}`,
    rawSignalIds: [],
    ticker: candidate.ticker,
    company: candidate.company,
    actionLabel: candidate.direction === "unknown" ? "Research candidate — direction unresolved" : seriousActionEligible(candidate)
      ? candidate.direction === "upside" ? "BUY alert candidate" : "SELL alert candidate"
      : candidate.direction === "upside" ? "Serious upside watch" : "Serious downside watch",
    eventHeadline: candidate.eventHeadline,
    whatHappened: `${candidate.whatHappened} Causal path: ${candidate.causalChain.join(" -> ")}. No prior price movement was required for detection.`,
    sourceNames,
    sourceLinks,
    sourceFreshness: receipts.map((receipt) => ({ source: receipt.publisher, collectedAt: receipt.publishedAt, ...freshness(now, receipt.publishedAt) })),
    sourceHealth: providers.map((provider) => ({ source: provider.provider, status: provider.status, checkedAt: provider.checkedAt, lastSuccessAt: provider.status === "connected" ? provider.checkedAt : null, responseTimeMs: null, problem: provider.error, notes: `${provider.recordsRead} real record(s) read; cached=${provider.cached}. Connectivity alone adds no score.` })),
    proofBundleSummary: { proofCount: sourceLinks.length, proofTypes: ["official_event", "independent_news", "macro_regime", ...(candidate.quote ? ["market_snapshot"] : [])], uniquePublishers: candidate.independentPublishers, liveOnly: true, priorPriceMoveRequired: false },
    filingEvidence: section(filingItems.length > 0, filingItems.length ? "strong" : "missing", filingItems.length ? `${filingItems.length} official SEC filing receipt(s) are linked.` : "No event-specific SEC filing receipt was matched.", filingItems),
    newsEvidence: section(newsItems.length > 0, candidate.primarySource || candidate.independentPublishers >= 2 ? "strong" : "weak", `${newsItems.length} event receipt(s), ${candidate.independentPublishers} independent publisher(s), primarySource=${candidate.primarySource}.`, newsItems),
    priceVolumeEvidence: section(quoteItems.length > 0, quoteItems.length ? "medium" : "missing", quoteItems.length ? "A current or latest-available public-equity quote anchors execution and later outcome measurement; price movement was not used to discover or qualify the event." : "No usable market quote was available, so the item cannot become a final serious signal.", quoteItems),
    fundamentalsEvidence: section(fundamentalItems.length > 0, fundamentalsAvailable ? "medium" : "missing", fundamentalItems.length ? `Current SEC Company Facts and the stored PR #262 company analysis supplied ${fundamentalItems.length} decision-relevant item(s). They provide scale, balance-sheet, quality, risk, and fair-value context but do not replace event-specific filing text.` : fundamentalsRelevant ? "Event-specific financial magnitude is unavailable, so the committee must not approve an unsupported earnings or valuation impact." : "Company fundamentals are optional for this event family unless a revenue, cost, balance-sheet, or valuation claim is made.", fundamentalItems),
    macroEvidence: section(macro.series.length > 0, macro.status === "connected" ? "strong" : macro.series.length ? "medium" : "missing", `Macro regime: ${macro.regime.join(", ")}. Historical changes are context, not a fabricated event backtest.`, macroItems),
    fdaRegulatoryEvidence: section(fdaItems.length > 0, fdaItems.length ? "strong" : "missing", fdaItems.length ? "Official FDA event evidence is linked." : "FDA evidence is not applicable unless this event concerns a regulated health product.", fdaItems),
    cryptoFxEvidence: section(false, "missing", "Digital-asset evidence is not applicable; this branch scans public equities only.", []),
    finraShortPressureEvidence: section(false, "missing", "Short-pressure data is optional and no short-squeeze claim is made.", []),
    wikidataRippleRelationships: section(candidate.relationship !== "direct", candidate.relationship === "direct" ? "missing" : "medium", candidate.causalChain.join(" -> "), [{ relationship: candidate.relationship, causalChain: candidate.causalChain, transmissionConfidence: candidate.transmissionConfidence }]),
    historicalPatternMatch: section(candidate.historicalAnalog.available, candidate.historicalAnalog.strength, `${candidate.historicalAnalog.summary} Forecast status: ${candidate.priceForecast.status}. ${candidate.priceForecast.warning}`, historicalItems),
    previousSimilarOutcomes: section(candidate.historicalAnalog.available && candidate.historicalAnalog.sampleSize > 0, candidate.historicalAnalog.strength, `${candidate.historicalAnalog.summary} Only outcomes observable before this scan were eligible.`, historicalItems),
    score: { direction: candidate.direction, eventMagnitude: candidate.eventMagnitude, causalExposure: candidate.causalExposure, actionStrength: candidate.score, profitPotential: candidate.score, evidenceConfidence: Math.round((candidate.eventTruth + candidate.evidenceIndependence + candidate.mappingConfidence) / 3), riskLevel: candidate.contradictionPenalty >= 50 ? "high" : candidate.relationship === "direct" ? "medium" : "medium_high", pricedInCheck: candidate.quote ? "market_snapshot_checked_but_no_prior_move_required" : "not_checked", eventTruth: candidate.eventTruth, mappingConfidence: candidate.mappingConfidence, materiality: candidate.materiality, transmissionConfidence: candidate.transmissionConfidence, historicalSupport: candidate.historicalSupport, contradictionPenalty: candidate.contradictionPenalty, priorPriceMoveRequired: false, gateChecks: candidate.gateChecks, createdAt: now.toISOString(), persisted: false },
    currentRiskLabels: [`direction:${candidate.direction}`, `relationship:${candidate.relationship}`, `event_family:${candidate.eventFamily}`, `historical_support:${candidate.historicalAnalog.strength}`, "historical_comparison_role:optional_context_only", `alert_readiness:${seriousActionEligible(candidate) ? "actionable_candidate" : "watch_only"}`, ...(candidate.rumour ? ["rumour"] : []), ...(!candidate.quote ? ["market_quote_unavailable"] : []), ...(candidate.quote && candidate.quote.actionableForSeriousSignal !== true ? ["market_quote_stale_for_action"] : [])],
    missingEvidence,
    dataFreshnessWarnings,
    compatibility: { callsOpenAi: false, publishes: false, sendsTelegram: false, writesDatabase: false },
  };
}

function sourceSummary(providers: ProviderResult[]) {
  return Object.fromEntries(providers.map((provider) => [provider.provider, provider.status]));
}

function providerDetails(providers: ProviderResult[]) {
  return Object.fromEntries(providers.map((provider) => [provider.provider, { status: provider.status, checkedAt: provider.checkedAt, nextRetryAt: provider.nextRetryAt, cached: provider.cached, realReceipts: provider.receipts.length, recordsRead: provider.recordsRead, error: provider.error, entitlementVerified: provider.entitlementVerified, sourceUrls: provider.sourceUrls }]));
}

function authoritativeTradingHaltStateKnown(provider: ProviderResult | undefined) {
  if (!provider) return false;
  if (provider.status === "connected") return true;
  return provider.status === "not_due"
    && provider.cached
    && provider.cacheAgeMs !== null
    && provider.cacheAgeMs !== undefined
    && provider.cacheAgeMs <= 15 * 60 * 1000;
}

export async function runEquitySignalLab(input: EquitySignalLabInput = {}) {
  const now = input.now ?? new Date();
  const fetchImpl = input.fetchImpl ?? fetch;
  const targeted = input.targetedContext;
  const mode = targeted ? "pr262_targeted_event_job" : "railway_branch_live_read_only";
  const startedAt = Date.now();
  let paidCommitteeAdmitted = false;
  let admittedCandidateFingerprint: string | null = null;
  let committeeStartedAt: string | null = null;
  let rejectionAuditReservation: Awaited<ReturnType<NonNullable<EquitySignalLabInput["reserveRejectionAudit"]>>> = null;
  let rejectionAuditReview = false;
  const executionTime = () => new Date(now.getTime() + Date.now() - startedAt);
  try {
    // The universe is required for every downstream mapping. Resolve it first
    // so a missing universe cannot consume news or price-history allowances.
    const universeResult = targeted
      ? { snapshot: targeted.universe, cache: "targeted_exact_issuer" as const, refreshed: false, r2Write: false }
      : await loadEquityUniverse(fetchImpl, now);
    const emptyHistoricalProvider: ProviderResult = {
      provider: "targeted_r2_historical_library",
      status: "not_due",
      checkedAt: now.toISOString(),
      nextRetryAt: null,
      sourceUrls: [],
      receipts: [],
      recordsRead: input.historicalSignals?.length ?? 0,
      error: null,
      entitlementVerified: true,
      cached: true,
    };
    const targetedMacro: MacroContext = targeted?.macroContext ?? {
      checkedAt: now.toISOString(),
      status: "failed",
      series: [],
      regime: ["targeted_event_macro_context_not_refreshed"],
      historicalComparisonAvailable: false,
      errors: ["The targeted event job did not run a broad macro refresh."],
    };
    const [eventResult, macroResult, historicalBootstrap] = await Promise.all([
      targeted
        ? Promise.resolve({
            providers: targeted.providers,
            receipts: targeted.receipts,
            secFilingDetails: targeted.secFilingDetails ?? { targeted: true, scheduledForThisRun: false },
          })
        : collectEventSources(fetchImpl, now, input.reserveSecFilingDetailAccessions),
      targeted
        ? Promise.resolve({
            context: targetedMacro,
            provider: targeted.macroProvider ?? {
              provider: "targeted_stored_macro_context",
              status: targetedMacro.status,
              checkedAt: targetedMacro.checkedAt,
              cached: true,
            },
          })
        : fetchMacroContext(fetchImpl, now),
      targeted?.historicalSignalsComplete
        ? Promise.resolve({ records: [] as HistoricalSignalRecord[], provider: emptyHistoricalProvider, seedsAvailable: 0, seedsRemaining: 0 })
        : bootstrapPublicHistoricalSignals(input.historicalSignals ?? [], fetchImpl, now),
    ]);
    const historicalSignals = mergeHistoricalSignals(input.historicalSignals ?? [], historicalBootstrap.records);
    const realHistoricalSignals = historicalSignals.filter((record) => record.dataQuality === "real");
    const swingUpTrackedFindings = realHistoricalSignals.filter((record) =>
      record.provenance?.origin === "swing_up_tracked_finding"
      || (record.provenance?.origin === "swing_up_forward_outcome" && Object.keys(record.checkpoints).length === 0)
    );
    const swingUpForwardSignals = realHistoricalSignals.filter((record) =>
      record.provenance?.origin === "swing_up_forward_outcome" && Object.keys(record.checkpoints).length > 0
    );
    const publicBootstrapSignals = realHistoricalSignals.filter((record) => record.provenance?.origin === "public_historical_bootstrap");
    const inclusiveReview = input.allowIncompleteCommitteeReview === true;
    const mapped = buildImpactCandidates(eventResult.receipts, universeResult.snapshot, macroResult.context, now, historicalSignals, inclusiveReview);
    if (targeted?.analysisKind === "valuation" && targeted.storedCompanyAnalysis) {
      const entry = targeted.universe.entries[0];
      const receipt = eventResult.receipts.find((item) => item.rawEventType === "valuation_review");
      const analysis = targeted.storedCompanyAnalysis as unknown as UsValueCompanyAnalysis;
      const valuation = entry?.cik && receipt && analysis.ticker === entry.ticker
        ? buildValuationCandidate(analysis, entry.cik, receipt, now) : null;
      mapped.candidates = valuation ? [valuation] : [];
      mapped.diagnostics.mappedRelationships = valuation ? 1 : 0;
    }
    const researchPool = inclusiveReview ? mapped.candidates.filter((candidate) => committeeResearchAdmission(candidate, now).eligible) : [];
    const activeHaltReceipts = eventResult.receipts.filter((receipt) =>
      receipt.channel === "nasdaq_trade_halts" && receipt.rawEventType?.endsWith(":active"));
    const activeHaltByTicker = new Map(activeHaltReceipts.flatMap((receipt) =>
      receipt.symbolHints.map((ticker) => [ticker, receipt] as const)));
    const haltProvider = eventResult.providers.find((provider) => provider.provider === "nasdaq_trade_halts");
    const tradingHaltStateKnown = authoritativeTradingHaltStateKnown(haltProvider);
    for (const candidate of mapped.candidates) {
      const haltReceipt = activeHaltByTicker.get(candidate.ticker);
      if (haltReceipt && !candidate.receipts.some((receipt) => receipt.id === haltReceipt.id)) candidate.receipts.push(haltReceipt);
    }
    const quoted = await enrichCandidateQuotes(mapped.candidates, fetchImpl, now, targeted ? 1 : 3, input.outcomeTickers ?? [], researchPool.map((candidate) => candidate.ticker));
    for (const candidate of quoted.candidates) {
      if (!candidate.quote) continue;
      if (activeHaltByTicker.has(candidate.ticker)) candidate.quote.marketSession = "halted";
      else if (!tradingHaltStateKnown) candidate.quote.marketSession = "unknown";
    }
    const ranked = quoted.candidates.map((candidate) => withPriceForecast(candidate, now));
    let gatePassed = ranked.filter((candidate) => candidate.gatePassed);
    let gateFailures = failedGateCounts(ranked);
    const noSignalClassification = noSignalReason(eventResult.receipts.length, mapped.diagnostics, ranked);
    const reviewedFingerprints = new Set(input.skipOpenAiCandidateFingerprints ?? []);
    let qualifiedWithFingerprints = gatePassed.map((candidate) => ({ candidate, fingerprint: fingerprintCandidate(candidate) }));
    const quotedQualified = qualifiedWithFingerprints.filter((item) => item.candidate.quote);
    const unreviewedQuoted = quotedQualified.filter((item) => !reviewedFingerprints.has(item.fingerprint));
    const reviewPool = inclusiveReview
      ? ranked.filter((candidate) => candidate.gatePassed || committeeResearchAdmission(candidate, now).eligible)
        .sort((a, b) => Number(b.gatePassed) - Number(a.gatePassed) || b.score - a.score)
      : gatePassed;
    const unreviewedPool = reviewPool.filter((candidate) => !reviewedFingerprints.has(fingerprintCandidate(candidate)));
    const selectedForReview = input.allowOpenAi ? unreviewedQuoted[0] ?? quotedQualified[0] : quotedQualified[0];
    let bestBeforeFundamentals = inclusiveReview
      ? unreviewedPool[0] ?? reviewPool[0] ?? null
      : selectedForReview?.candidate ?? gatePassed[0] ?? null;
    if (!bestBeforeFundamentals && inclusiveReview && input.allowOpenAi && input.reserveRejectionAudit) {
      const nearMiss = ranked.find(candidate => candidate.mappingConfidence >= 95 && candidate.score >= 45
        && candidate.materiality >= 35 && candidate.relationship === "direct"
        && now.getTime() - Date.parse(candidate.eventObservedAt) <= 72 * 3600000
        && candidate.receipts.some(receipt => (receipt.summary?.length ?? 0) >= 200));
      if (nearMiss) rejectionAuditReservation = await input.reserveRejectionAudit();
      if (nearMiss && rejectionAuditReservation) {
        bestBeforeFundamentals = nearMiss;
        rejectionAuditReview = true;
      }
    }
    const fundamentalsResult = await enrichCandidateFundamentals(bestBeforeFundamentals, fetchImpl, now, input.verifiedFactsCache);
    const best = fundamentalsResult.candidate ? reassessValuationCandidate(fundamentalsResult.candidate, now, targeted?.storedCompanyAnalysis as unknown as UsValueCompanyAnalysis | undefined) : null;
    // Facts may resolve a materiality or valuation gate after initial admission.
    // Record the final gate state in the funnel and finding ledger.
    gatePassed = ranked.filter(candidate => candidate.gatePassed);
    gateFailures = failedGateCounts(ranked);
    qualifiedWithFingerprints = gatePassed.map(candidate => ({ candidate, fingerprint: fingerprintCandidate(candidate) }));
    const providers = [...eventResult.providers, historicalBootstrap.provider, quoted.provider, fundamentalsResult.provider];
    const qualifiedFindings = qualifiedWithFingerprints.map(({ candidate, fingerprint }) => {
      const priceAnchored = Boolean(candidate.quote && quoted.benchmarkQuote);
      return {
        ticker: candidate.ticker,
        company: candidate.company,
        cik: candidate.cik,
        price: candidate.quote?.price ?? null,
        marketObservedAt: candidate.quote?.observedAt ?? null,
        marketSource: candidate.quote?.source ?? null,
        benchmarkTicker: quoted.benchmarkTicker,
        benchmarkPrice: quoted.benchmarkQuote?.price ?? null,
        benchmarkObservedAt: quoted.benchmarkQuote?.observedAt ?? null,
        benchmarkSource: quoted.benchmarkQuote?.source ?? null,
        priceAnchorStatus: priceAnchored ? "anchored" as const : "awaiting_price_anchor" as const,
        outcomeTrackingEligible: priceAnchored,
        direction: candidate.direction,
        eventFamily: candidate.eventFamily,
        relationship: candidate.relationship,
        eventHeadline: candidate.eventHeadline,
        eventObservedAt: candidate.eventObservedAt,
        evidenceFingerprint: fingerprint,
        causalChain: candidate.causalChain,
        macroRegime: macroResult.context.regime,
        featuresAsOf: now.toISOString(),
        receipts: candidate.receipts,
        priceForecast: candidate.priceForecast,
      };
    });
    const common = {
      ok: true,
      mode,
      assetClass: "public_equity",
      universeScope: universeResult.snapshot.scope,
      checkedAt: now.toISOString(),
      durationMs: Date.now() - startedAt,
      sources: sourceSummary(providers),
      providerDetails: providerDetails(providers),
      secFilingDetails: eventResult.secFilingDetails,
      tradingHaltSafety: {
        providerStatus: haltProvider?.status ?? "missing",
        checkedAt: haltProvider?.checkedAt ?? null,
        cached: haltProvider?.cached ?? false,
        cacheAgeMs: haltProvider?.cacheAgeMs ?? null,
        currentStateKnown: tradingHaltStateKnown,
        activeHaltCount: activeHaltByTicker.size,
        unknownStateForcesWatch: true,
      },
      providerConfiguration: providerConfiguration(),
      universe: { constructionMode: universeResult.snapshot.constructionMode, refreshedAt: universeResult.snapshot.refreshedAt, cache: universeResult.cache, refreshedThisRun: universeResult.refreshed, r2Write: universeResult.r2Write, coverage: universeResult.snapshot.coverage, sources: universeResult.snapshot.sources },
      candidateFunnel: {
        stocksInUniverse: universeResult.snapshot.entries.length,
        realEventReceipts: eventResult.receipts.length,
        receiptsConsidered: mapped.diagnostics.receiptsConsidered,
        receiptsFilteredAsNoise: mapped.diagnostics.noiseRejected,
        receiptsWithDirectionUnresolved: mapped.diagnostics.directionUnknown,
        receiptsUnmapped: mapped.diagnostics.unmapped,
        mappedRelationships: mapped.diagnostics.mappedRelationships,
        eventClusters: mapped.diagnostics.eventClusters,
        directCandidates: mapped.diagnostics.directCandidates,
        knockOnCandidates: mapped.diagnostics.rippleCandidates,
        shadowNearMissCandidates: ranked.filter((candidate) => candidate.trackingDisposition === "shadow_near_miss").length,
        rejectedCandidates: ranked.filter((candidate) => candidate.trackingDisposition === "rejected").length,
        failedGateCounts: gateFailures,
        candidatesPassingEventFirstGate: gatePassed.length,
        candidatesWithMarketQuote: quotedQualified.length,
        candidatesSkippedBecauseRecentlyReviewed: quotedQualified.length - unreviewedQuoted.length,
        unreviewedCandidatesAvailable: unreviewedQuoted.length,
        committeeCandidates: best && (inclusiveReview || best.quote) && !reviewedFingerprints.has(fingerprintCandidate(best)) ? 1 : 0,
        researchEligibleCandidates: researchPool.length,
        researchAdmissionEnabled: inclusiveReview,
        researchAdmissionRejected: inclusiveReview ? ranked.filter((candidate) => !candidate.gatePassed && !committeeResearchAdmission(candidate, now).eligible).map((candidate) => ({ ticker: candidate.ticker, reasons: committeeResearchAdmission(candidate, now).reasons })) : [],
      },
      historicalLearning: {
        realPointInTimeSignalsAvailable: realHistoricalSignals.length,
        swingUpTrackedFindingsAvailable: swingUpTrackedFindings.length,
        swingUpForwardSignalsAvailable: swingUpForwardSignals.length,
        publicBootstrapSignalsAvailable: publicBootstrapSignals.length,
        unclassifiedRealSignalsAvailable: realHistoricalSignals.length - swingUpTrackedFindings.length - swingUpForwardSignals.length - publicBootstrapSignals.length,
        publicBootstrapSignalsAddedThisRun: historicalBootstrap.records.length,
        publicBootstrapSeedsAvailable: historicalBootstrap.seedsAvailable,
        publicBootstrapSeedsRemaining: historicalBootstrap.seedsRemaining,
        doesNotWaitForAllCheckpoints: true,
        earliestEligibleCheckpoint: "1D",
        checkpointsUsedOnlyAfterTheyAreObservable: true,
        numericForecastRequiresIndependentRealEvents: 3,
        historicalComparisonRequiredForSeriousSignal: false,
        findingsAndLaterOutcomesStoredInR2: true,
        actionableBuySellRequiresCalibratedHistory: false,
        historicalEvidenceRole: "optional_learning_and_calibration_context_only",
      },
      _historicalSignalLibraryAdditions: historicalBootstrap.records,
      qualifiedFindings,
      outcomeTrackingCandidates: qualifiedFindings.filter((finding) => finding.outcomeTrackingEligible),
      scheduledEventWatchlist: eventResult.receipts.filter((receipt) => receipt.scheduled).slice(0, 100).map((receipt) => ({ title: receipt.title, scheduledAt: receipt.publishedAt, tickerHints: receipt.symbolHints, companyHints: receipt.companyHints, publisher: receipt.publisher, sourceUrl: receipt.url, predictionStatus: "awaiting_verified_event_content_and_direction" })),
      unmappedOfficialEventWatchlist: eventResult.receipts.filter((receipt) => receipt.official && !receipt.symbolHints.length && !receipt.companyHints.length).slice(0, 100).map((receipt) => ({ title: receipt.title, summary: receipt.summary, observedAt: receipt.publishedAt, publisher: receipt.publisher, channel: receipt.channel, sourceUrl: receipt.url, predictionStatus: "global_event_seen_mapping_or_direction_not_yet_proven" })),
      macroContext: macroResult.context,
      macroProvider: macroResult.provider,
      liveSourcePolicy: { eventFirst: true, priorTwoPercentMoveRequired: false, postEventOnePercentMoveRequired: false, priceUsedForDiscovery: false, priceUsedForExecutionAndOutcomeTrackingOnly: true, primarySourceCanAdvanceWithoutSecondaryNews: true, unofficialClaimRequiresIndependentPublishers: 2, cryptoScanningEnabled: false, providerFailureIsolation: true, connectivityAloneAddsScore: false },
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
      rejectionAuditReview,
      rankedCandidates: ranked.slice(0, 100).map((candidate) => ({ ticker: candidate.ticker, company: candidate.company, cik: candidate.cik, direction: candidate.direction, eventFamily: candidate.eventFamily, relationship: candidate.relationship, eventHeadline: candidate.eventHeadline, eventObservedAt: candidate.eventObservedAt, primarySource: candidate.primarySource, independentPublishers: candidate.independentPublishers, eventTruth: candidate.eventTruth, mappingConfidence: candidate.mappingConfidence, materiality: candidate.materiality, transmissionConfidence: candidate.transmissionConfidence, historicalSupport: candidate.historicalSupport, evidenceIndependence: candidate.evidenceIndependence, contradictionPenalty: candidate.contradictionPenalty, pricedInPenalty: candidate.pricedInPenalty, score: candidate.score, gateChecks: candidate.gateChecks, gatePassed: candidate.gatePassed, quote: candidate.quote, fundamentals: candidate.fundamentals, causalChain: candidate.causalChain, falsifiers: candidate.falsifiers, historicalAnalog: candidate.historicalAnalog, priceForecast: candidate.priceForecast, alertReadiness: seriousActionEligible(candidate) ? "actionable_candidate" : "watch_only" })),
      sourceFailures: providers.filter((provider) => !["connected", "not_due"].includes(provider.status)).map((provider) => ({ provider: provider.provider, status: provider.status, error: provider.error, nextRetryAt: provider.nextRetryAt })),
    };
    if (!best) {
      return { ...common, status: "no_qualified_signal", noSignalReason: noSignalClassification, seriousSignalFound: false, openAiCalled: false, qualityScore: ranked[0]?.score ?? 0, blockers: [`No Committee candidate was produced (${noSignalClassification}). The candidate funnel and failed-gate counts identify the exact stage; price movement was not required.`], technicalFailureFingerprint: null };
    }
    const companyProfile = verifiedCompanyProfile(
      await input.resolveCompanyProfile?.(best) ?? targeted?.storedCompanyAnalysis?.companyProfile, best, now);
    // Stable evidence revisions allow another review when missing facts arrive.
    // Fetch timestamps and small quote ticks cannot manufacture new evidence.
    const evidenceRevision = reviewEvidenceRevision({
      source: best.receipts.filter(r => r.channel !== "nasdaq_trade_halts").map(r => ({ id: r.id, summary: r.summary, rawEventType: r.rawEventType })),
      companyProfile: companyProfile ? { business: companyProfile.business, customers: companyProfile.customers, sourceUrl: companyProfile.sourceUrl, sourceFiledAt: companyProfile.sourceFiledAt } : null,
      industry: industryLabel(targeted?.storedCompanyAnalysis?.industry, companyProfile?.industry),
      outlookRange: (() => {
        const fair = targeted?.storedCompanyAnalysis?.fairValue as UsValueCompanyAnalysis["fairValue"] | undefined;
        return { currency: targeted?.storedCompanyAnalysis?.currency, low: fair?.conservativeValue, base: fair?.baseValue, high: fair?.optimisticValue,
          forecastStatus: best.priceForecast.status, forecastSample: best.priceForecast.sampleSize };
      })(),
      facts: best.fundamentals?.items ?? [], sourceComplete: targeted?.sourceEvidenceIncomplete !== true,
      priceReady: best.quote?.actionableForSeriousSignal === true, haltKnown: tradingHaltStateKnown,
      halted: best.quote?.marketSession === "halted",
      valuation: best.eventFamily === "valuation_gap" ? (() => {
        const value = (targeted?.storedCompanyAnalysis as unknown as UsValueCompanyAnalysis | undefined)?.fairValue;
        return { base: value?.baseValue, low: value?.conservativeValue, high: value?.optimisticValue,
          currentPriceSupportsValuation: best.gateChecks.currentPriceSupportsValuation };
      })() : null,
    });
    const fingerprint = inclusiveReview ? `${fingerprintCandidate(best)}:${evidenceRevision}` : fingerprintCandidate(best);
    const selectedCandidate = {
      companyProfile,
      ticker: best.ticker,
      company: best.company,
      industry: industryLabel(targeted?.storedCompanyAnalysis?.industry, companyProfile?.industry),
      sector: targeted?.storedCompanyAnalysis?.sector ?? null,
      currency: targeted?.storedCompanyAnalysis?.currency ?? null,
      valuationRange: targeted?.storedCompanyAnalysis?.fairValue ?? null,
      timeHorizon: best.timeHorizon,
      whatHappened: best.whatHappened,
      plainLanguageExplanation: null as Record<string, string> | null,
      cik: best.cik,
      price: best.quote?.price ?? null,
      marketObservedAt: best.quote?.observedAt ?? null,
      marketSource: best.quote?.source ?? null,
      benchmarkTicker: quoted.benchmarkTicker,
      benchmarkPrice: quoted.benchmarkQuote?.price ?? null,
      benchmarkObservedAt: quoted.benchmarkQuote?.observedAt ?? null,
      benchmarkSource: quoted.benchmarkQuote?.source ?? null,
      direction: best.direction,
      eventFamily: best.eventFamily,
      relationship: best.relationship,
      eventHeadline: best.eventHeadline,
      eventObservedAt: best.eventObservedAt,
      evidenceFingerprint: fingerprint,
      primarySource: best.primarySource,
      independentPublishers: best.independentPublishers,
      eventTruth: best.eventTruth,
      mappingConfidence: best.mappingConfidence,
      materiality: best.materiality,
      transmissionConfidence: best.transmissionConfidence,
      historicalSupport: best.historicalSupport,
      evidenceIndependence: best.evidenceIndependence,
      contradictionPenalty: best.contradictionPenalty,
      pricedInPenalty: best.pricedInPenalty,
      rumour: best.rumour,
      gatePassed: best.gatePassed,
      score: best.score,
      gateChecks: best.gateChecks,
      causalChain: best.causalChain,
      falsifiers: best.falsifiers,
      receipts: best.receipts,
      quote: best.quote,
      fundamentals: best.fundamentals,
      historicalAnalog: best.historicalAnalog,
      priceForecast: best.priceForecast,
      alertReadiness: seriousActionEligible(best) ? "actionable_candidate" : "watch_only",
    };
    if (!companyProfile) return { ...common, status: "candidate_company_profile_pending", seriousSignalFound: false, actionableSignalFound: false, openAiCalled: false, candidateFingerprint: fingerprint, selectedCandidate, qualityScore: best.score, blockers: ["A source-backed company profile describing its products or services and customers is required before publication."], technicalFailureFingerprint: null };
    const details = alertDetails(selectedCandidate, undefined, now);
    if (!details.complete) return { ...common, status: "candidate_alert_details_pending", seriousSignalFound: false, actionableSignalFound: false, openAiCalled: false, candidateFingerprint: fingerprint, selectedCandidate, qualityScore: best.score, blockers: details.missing, technicalFailureFingerprint: null };
    if (best.eventFamily === "valuation_gap" && best.gateChecks.valueTrapRiskAcceptable === false) return { ...common, status: "candidate_valuation_risk_rejected", seriousSignalFound: false, actionableSignalFound: false, openAiCalled: false, candidateFingerprint: fingerprint, selectedCandidate, qualityScore: best.score, blockers: ["The apparent discount fails the business-quality, balance-sheet or risk checks. Reassess when the financial evidence changes."], technicalFailureFingerprint: null };
    if (!inclusiveReview && !best.quote) return { ...common, status: "qualified_event_market_quote_unavailable", seriousSignalFound: false, openAiCalled: false, candidateFingerprint: fingerprint, selectedCandidate, qualityScore: best.score, blockers: ["The event qualified before the market moved, but no usable price anchor was available for a safe entry or outcome record. The event remains on the watch queue; no OpenAI budget was spent."], technicalFailureFingerprint: null };
    if ((input.skipOpenAiCandidateFingerprints?.includes(fingerprint) || input.skipOpenAiCandidateFingerprints?.includes(fingerprintCandidate(best)))) return { ...common, status: "qualified_candidate_already_reviewed", seriousSignalFound: false, openAiCalled: false, candidateFingerprint: fingerprint, selectedCandidate, qualityScore: best.score, blockers: ["The same event evidence was reviewed recently, so OpenAI was not called again."], technicalFailureFingerprint: null };
    const watchOnlyBlocker = !best.quote
      ? "Current market quote is unavailable."
      : best.quote.actionableForSeriousSignal !== true
      ? quoteFreshnessBlocker(best.quote)
      : best.quote.marketSession === "halted"
      ? "Trading is currently halted, so the event is retained as Watch-only and no committee budget is spent."
      : best.quote.marketSession === "unknown"
        ? "The authoritative U.S. trading-halt state is unavailable or stale, so the event is retained as Watch-only and no committee budget is spent."
        : ["financing_proposal", "regulatory_advisory"].includes(best.eventFamily)
          ? "The event is still a proposal or advisory-stage decision, so it remains Watch-only until the outcome is final."
          : best.pricedInPenalty >= 50
            ? "The event appears materially repriced already, so it remains Watch-only rather than consuming a committee review."
            : null;
    if (!inclusiveReview && watchOnlyBlocker) {
      return {
        ...common,
        status: "qualified_event_watch_only",
        seriousSignalFound: false,
        actionableSignalFound: false,
        alertType: null,
        openAiCalled: false,
        candidateFingerprint: fingerprint,
        selectedCandidate,
        qualityScore: best.score,
        blockers: [watchOnlyBlocker],
        technicalFailureFingerprint: null,
      };
    }
    const pilotGate = evaluateFiveCasePilotGate(best);
    const aiProvider = getAiCommitteeProviderStatus();
    if (input.aiProviderBlockedReason) return { ...common, status: "committee_provider_access_blocked", seriousSignalFound: false, openAiCalled: false, candidateFingerprint: fingerprint, selectedCandidate, qualityScore: best.score, committee: { configured: aiProvider.configured, enabled: aiProvider.enabled, providerBlockedReason: input.aiProviderBlockedReason }, blockers: [`The read-only OpenAI access check blocked paid review: ${input.aiProviderBlockedReason}. Evidence collection continues; no paid request or budget reservation was made.`], technicalFailureFingerprint: `openai_access_${input.aiProviderBlockedReason}`, failureScope: "configuration", repairEligible: false };
    if (!input.allowOpenAi) return { ...common, status: "qualified_signal_openai_not_requested", seriousSignalFound: false, openAiCalled: false, candidateFingerprint: fingerprint, selectedCandidate, qualityScore: best.score, committee: { configured: aiProvider.configured, enabled: aiProvider.enabled }, blockers: ["The rolling OpenAI review budget was not available; the qualified event remains recorded without another paid call."], technicalFailureFingerprint: null };
    if (!aiProvider.configured || !aiProvider.enabled) return { ...common, ok: false, status: "configuration_blocker", seriousSignalFound: false, openAiCalled: false, candidateFingerprint: fingerprint, selectedCandidate, qualityScore: best.score, blockers: [aiProvider.configured ? "AI committee is disabled." : "OPENAI_API_KEY is not available in this deployment."], technicalFailureFingerprint: aiProvider.configured ? "ai_committee_disabled" : "openai_key_missing", failureScope: "configuration", repairEligible: false };
    if (input.beforeOpenAiCall && !await input.beforeOpenAiCall({ candidateFingerprint: fingerprint, checkedAt: now.toISOString(), ticker: best.ticker, direction: best.direction })) return { ...common, status: "qualified_signal_openai_reservation_denied", seriousSignalFound: false, openAiCalled: false, candidateFingerprint: fingerprint, selectedCandidate, qualityScore: best.score, blockers: ["The durable committee budget or same-evidence lock denied this paid review."], technicalFailureFingerprint: null };
    admittedCandidateFingerprint = fingerprint;
    const pack = evidencePack(best, providers, macroResult.context, now, fingerprint, quoted.benchmarkQuote, targeted?.storedCompanyAnalysis);
    // Qualitative business facts cannot satisfy financial completeness, but every
    // role must see the same verified company and customer evidence as the alert.
    pack.fundamentalsEvidence.items.splice(targeted?.storedCompanyAnalysis ? 1 : 0, 0, {
      source: "verified_company_profile", business: companyProfile.business, customers: companyProfile.customers,
      sourceUrl: companyProfile.sourceUrl, sourceFiledAt: companyProfile.sourceFiledAt, verifiedAt: companyProfile.verifiedAt,
    });
    pack.sourceLinks = [...new Set([...pack.sourceLinks, companyProfile.sourceUrl])];
    pack.sourceNames = [...new Set([...pack.sourceNames, "SEC annual business and customer disclosures"])];
    if (details.valuationException) {
      pack.fundamentalsEvidence.items.push({ source: "valuation_availability", ...details.outlook.fairValueUnavailable,
        explanation: NEGATIVE_EARNINGS_NOTICE,
        reviewPolicy: "A documented loss prevents an earnings-based value estimate, not event review. Assess the event's material effect, direction, cash runway, dilution, financing and priced-in risks. Do not invent a target or percentage return." });
    }
    const researchGaps = [...new Set([
      ...(best.failedGateChecks ?? []),
      ...(best.direction === "unknown" ? ["direction_unresolved"] : []),
      ...(watchOnlyBlocker ? [watchOnlyBlocker.replace(" and no committee budget is spent", "")] : []),
      ...(targeted?.sourceEvidenceIncomplete ? ["full_source_evidence_incomplete"] : []),
      ...pack.missingEvidence,
    ])];
    if (inclusiveReview) {
      pack.researchReview = { enabled: true, gaps: researchGaps };
      pack.missingEvidence = [...new Set([...pack.missingEvidence, ...researchGaps])];
    }
    if (rejectionAuditReservation && !await rejectionAuditReservation.commit(executionTime())) {
      return { ...common, status: "qualified_signal_openai_reservation_denied", seriousSignalFound: false, openAiCalled: false,
        candidateFingerprint: fingerprint, selectedCandidate, qualityScore: best.score,
        blockers: ["The daily rejection-audit reservation expired or changed before Committee review."], technicalFailureFingerprint: null };
    }
    // From this point onward the caller must conservatively retain or reconcile
    // its durable cost reservation. A provider exception after one paid request
    // must never be reported as a no-call path that reopens the daily fuse.
    paidCommitteeAdmitted = true;
    committeeStartedAt = executionTime().toISOString();
    const committee = await runAiCommittee({
      [TRUSTED_IN_MEMORY_EVIDENCE]: pack,
      persistResult: false,
      dryRun: false,
      confirmRun: true,
      mode: "preview",
      reviewPolicy: "focused_v1",
      maxCostUsd: PR262_REVIEW_MAX_COST_USD,
      signal: input.signal,
      // The temporary exposure bound uses this model and bounded inputs; only
      // provider-reported usage is recorded as spending.
      allowedModels: ["gpt-4.1-mini", "gpt-4.1-mini-2025-04-14"],
      maximumPromptBytes: PR262_REVIEW_MAX_PROMPT_BYTES,
    });
    const results = Array.isArray(committee.agentResults) ? committee.agentResults : [];
    selectedCandidate.plainLanguageExplanation = committeeExplanation(results.find(result => ["explainer_agent", "analyst_agent"].includes(result.agentId) && result.status === "completed")?.keyFindings ?? []);
    const completed = results.filter((result) => result.status === "completed").length;
    const failed = results.filter((result) => result.status === "failed" || result.status === "blocked").length;
    const technicalFailure = !committee.ok || failed > 0;
    const roleDiagnostics = results.map(result => ({ agentId: result.agentId, status: result.status, error: result.error ?? null, providerFailure: result.providerFailure ?? null, finishReason: result.finishReason ?? null, usageReported: Boolean(result.tokenUsage) }));
    const providerBlockers = results.filter(result => result.status === "failed").map(result => `Committee ${result.agentId}: ${result.providerFailure?.category ?? result.error ?? "role_failed"}${result.providerFailure?.httpStatus ? ` (HTTP ${result.providerFailure.httpStatus})` : ""}${result.providerFailure?.code ? ` / ${result.providerFailure.code}` : ""}`);
    const finalJudge = results.find((result) => result.agentId === "final_judge");
    const recommendation = committee.committeeOutput?.overallRecommendation ?? "needs_more_data";
    const seriousSignalFound = committee.ok === true
      && completeCommitteeReview({ ok: committee.ok, agentsCompleted: completed, agentsFailed: failed, output: committee.committeeOutput })
      && failed === 0
      && recommendation === "approve"
      && finalJudge?.verdict === "positive"
      && (finalJudge.confidence ?? 0) >= 80
      && best.gatePassed
      && best.direction !== "unknown"
      && !targeted?.sourceEvidenceIncomplete
      && !watchOnlyBlocker
      && Boolean(best.quote);
    const actionableSignalFound = seriousSignalFound && seriousActionEligible(best);
    const alertType = !seriousSignalFound ? null : actionableSignalFound ? best.direction === "upside" ? "buy" : "sell" : "watch";
    return { ...common, researchReview: inclusiveReview ? { admitted: true, gaps: researchGaps, publicationHeld: !seriousSignalFound } : null, status: seriousSignalFound ? `serious_${alertType}` : technicalFailure ? "committee_failed" : "candidate_needs_more_data", seriousSignalFound, actionableSignalFound, alertType, openAiCalled: true, candidateFingerprint: fingerprint, selectedCandidate, historicalPilot: pilotGate, qualityScore: Math.round((best.score * 0.45 + (committee.committeeOutput?.evidenceConfidenceScore ?? 0) * 0.25 + (finalJudge?.confidence ?? 0) * 0.3) * 100) / 100, committee: { ok: committee.ok, status: committee.status, startedAt: committeeStartedAt, finishedAt: new Date(now.getTime() + Date.now() - startedAt).toISOString(), agentsPlanned: committee.plannedAgents?.length ?? 0, agentsCompleted: completed, agentsFailed: failed, roleDiagnostics, finalJudge: finalJudge ? { verdict: finalJudge.verdict, confidence: finalJudge.confidence, concerns: finalJudge.concerns, missingData: finalJudge.missingData, followUpChecks: finalJudge.followUpChecks } : null, output: committee.committeeOutput, writesDatabase: committee.compatibility?.writesDatabase ?? false }, blockers: seriousSignalFound ? [] : [...new Set([...providerBlockers, ...researchGaps, ...(committee.committeeOutput?.missingEvidence ?? []), ...(finalJudge?.missingData ?? []), ...(finalJudge?.concerns ?? [])])].slice(0, 12), technicalFailureFingerprint: technicalFailure ? `committee_${committee.status}` : null, failureScope: technicalFailure ? "external_provider" : "none", repairEligible: false };
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 200) : "equity_signal_lab_failed";
    const external = /(?:http_|rate|quota|cadence|temporarily|unavailable|timeout|fetch|official_equity_universe)/i.test(message);
    return { ok: false, mode, assetClass: "public_equity", status: external ? "source_temporarily_unavailable" : "technical_failure", checkedAt: now.toISOString(), durationMs: Date.now() - startedAt, seriousSignalFound: false, openAiCalled: paidCommitteeAdmitted, committee: committeeStartedAt ? { startedAt: committeeStartedAt, finishedAt: null } : null, candidateFingerprint: admittedCandidateFingerprint, rejectionAuditReview, databaseWrites: false, publishing: false, notifications: false, realProviderResponsesOnly: true, qualityScore: 0, blockers: [external ? "A required universe source was temporarily unavailable and no real cached universe existed yet. No substitute or invented data was used." : message], technicalFailureFingerprint: external ? "external_provider_equity_universe" : message.replace(/\d+/g, "#"), failureScope: external ? "external_provider" : "application", repairEligible: !external };
  } finally {
    // Committed reservations cannot be released. Unused selections are reusable
    // immediately; an interrupted process leaves only a bounded pending lease.
    await rejectionAuditReservation?.release(executionTime()).catch(() => undefined);
  }
}

export function syntheticEquityFingerprintForTest(input: string) {
  return crypto.createHash("sha256").update(input).digest("hex").slice(0, 20);
}
