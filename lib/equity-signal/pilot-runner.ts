import { articleEvidenceForCandidate, buildArticleEvidenceReport } from "@/lib/equity-signal/article-evidence";
import type { HistoricalSignalRecord } from "@/lib/equity-signal/historical-analogs";
import { evaluateIndustryPeerPilotGate } from "@/lib/equity-signal/industry-peer-pilot";
import {
  bootstrapPilotHistoricalSignals,
  mergePilotHistoricalSignals,
} from "@/lib/equity-signal/pilot-historical-bootstrap";
import { US_SERIOUS_SIGNAL_PILOT_POLICY } from "@/lib/equity-signal/pilot-serious-signal-policy";
import {
  runEquitySignalLab,
  type EquityProviderCallDecision,
  type EquityProviderCallRequest,
  type EquitySignalLabInput,
} from "@/lib/equity-signal/runner";
import { buildApprovedUsWatchOutReview } from "@/lib/equity-signal/us-watch-out-engine";
import { promoteApprovedWatchOutRules } from "@/lib/equity-signal/us-watch-out-serious-promotion";

export type PilotEquityProviderCallDecision = EquityProviderCallDecision;
export type PilotEquityProviderCallRequest = EquityProviderCallRequest;
export type PilotEquitySignalLabInput = EquitySignalLabInput;

type Json = Record<string, unknown>;

function object(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
}

function strings(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function historicalRecords(value: unknown): HistoricalSignalRecord[] {
  return Array.isArray(value) ? value.filter((item): item is HistoricalSignalRecord => Boolean(item) && typeof item === "object") : [];
}

export async function runPilotEquitySignalLab(input: PilotEquitySignalLabInput = {}) {
  const now = input.now ?? new Date();
  const fetchImpl = input.fetchImpl ?? fetch;
  const suppliedHistory = input.historicalSignals ?? [];
  const pilotBootstrap = await bootstrapPilotHistoricalSignals(suppliedHistory, fetchImpl, now);
  const historicalSignals = mergePilotHistoricalSignals(suppliedHistory, pilotBootstrap.records);
  const baseResult = await runEquitySignalLab({ ...input, now, fetchImpl, historicalSignals });
  const base = baseResult as unknown as Json;
  const selectedCandidate = object(base.selectedCandidate);
  const rankedCandidates = Array.isArray(base.rankedCandidates) ? base.rankedCandidates : [];
  const historicalLearning = object(base.historicalLearning);
  const liveSourcePolicy = object(base.liveSourcePolicy);
  const libraryAdditions = mergePilotHistoricalSignals(
    historicalRecords(base._historicalSignalLibraryAdditions),
    pilotBootstrap.records,
  );

  const [pilotHistoricalGate, rawWatchOutReview, articleEvidence] = await Promise.all([
    evaluateIndustryPeerPilotGate({ candidate: selectedCandidate, historicalSignals, fetchImpl, now }),
    buildApprovedUsWatchOutReview({ rankedCandidates, now, fetchImpl }),
    buildArticleEvidenceReport({ candidates: rankedCandidates, selectedCandidate, fetchImpl, maximumArticles: 12 }),
  ]);
  const watchOutReview = promoteApprovedWatchOutRules({ watchOutReview: rawWatchOutReview, articleEvidence });
  const selectedArticleEvidence = articleEvidenceForCandidate(articleEvidence, selectedCandidate);
  const seriousWatchOutAlerts = Array.isArray(watchOutReview.seriousSignals) ? watchOutReview.seriousSignals : [];

  const common = {
    ...baseResult,
    marketScope: US_SERIOUS_SIGNAL_PILOT_POLICY.marketScope,
    confidenceTier: US_SERIOUS_SIGNAL_PILOT_POLICY.confidenceTier,
    pilotHistoricalGate,
    articleEvidence,
    pilotHistoricalBootstrap: {
      requestedSeeds: pilotBootstrap.requestedSeeds,
      builtSeeds: pilotBootstrap.builtSeeds,
      errors: pilotBootstrap.errors,
      priceSource: pilotBootstrap.priceSource,
      noSyntheticData: pilotBootstrap.noSyntheticData,
    },
    historicalLearning: {
      ...historicalLearning,
      minimumIndependentRealEventsForPilotSeriousBuySell: US_SERIOUS_SIGNAL_PILOT_POLICY.minimumIndependentHistoricalEvents,
      minimumObservedDirectionalHitRatePercent: US_SERIOUS_SIGNAL_PILOT_POLICY.minimumObservedDirectionalHitRatePercent,
      historicalComparisonRequiredForSeriousSignal: true,
      actionableBuySellRequiresCalibratedHistory: true,
      historicalEvidenceRole: "mandatory_same_company_or_same_industry_five_case_pilot_and_r2_learning",
      statisticallyEquivalentToThirtySamples: false,
      forwardOutcomeRequiredBeforeAlert: false,
      swingUpForwardTrackingRole: "transparent_ledger_and_future_self_improvement_only",
      pilotPublicHistoricalSignalsAddedThisRun: pilotBootstrap.records.length,
    },
    liveSourcePolicy: {
      ...liveSourcePolicy,
      marketScope: "US listed common equities and ADRs only",
      nonUsMarketsEnabled: false,
      analystExpectationsCanVetoBuy: false,
      analystExpectationsRole: "optional context only",
      headlineAloneCanPromoteSeriousSignal: false,
      fullArticleOrDetailedOfficialContentRequired: true,
      maximumFullArticlesReadPerScan: articleEvidence.maximumFullArticlesPerScan,
    },
    watchOutReview,
    seriousWatchOutAlerts,
    seriousWatchOutSignalFound: seriousWatchOutAlerts.length > 0,
    _historicalSignalLibraryAdditions: libraryAdditions,
  };

  const committeeApproved = base.seriousSignalFound === true;
  const directionalAction = base.alertType === "buy" || base.alertType === "sell";
  if (!committeeApproved) return common;

  if (!directionalAction) {
    return {
      ...common,
      status: "candidate_not_directional_buy_or_sell",
      seriousSignalFound: false,
      actionableSignalFound: false,
      alertType: null,
      blockers: [...new Set([
        ...strings(base.blockers),
        "Buy and Sell require the same-company or same-industry Pilot 5 gate. P0/P1 Watch Out alerts are emitted separately by the approved Watch Out engine.",
      ])],
    };
  }

  if (!pilotHistoricalGate.passed) {
    return {
      ...common,
      status: "candidate_needs_same_company_or_industry_pilot_history",
      seriousSignalFound: false,
      actionableSignalFound: false,
      alertType: null,
      blockers: [...new Set([...strings(base.blockers), ...pilotHistoricalGate.blockers])],
    };
  }

  if (!selectedArticleEvidence?.decisionGrade) {
    return {
      ...common,
      status: "candidate_needs_full_article_confirmation",
      seriousSignalFound: false,
      actionableSignalFound: false,
      alertType: null,
      blockers: [...new Set([
        ...strings(base.blockers),
        ...(selectedArticleEvidence?.blockers ?? ["The headline and feed summary were not enough to confirm the full event." ]),
      ])],
    };
  }

  return {
    ...common,
    status: `pilot_serious_${String(base.alertType)}`,
    seriousSignalFound: true,
    actionableSignalFound: true,
    alertType: base.alertType,
    pilotWarning: US_SERIOUS_SIGNAL_PILOT_POLICY.warning,
    alertTimingPolicy: "Current evidence, full article confirmation, peer history, and committee approval can trigger immediately. Swing Up does not wait for its own future outcome checkpoints before alerting.",
  };
}
