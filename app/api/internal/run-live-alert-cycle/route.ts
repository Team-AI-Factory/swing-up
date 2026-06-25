import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { Prisma, type RawSignal } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { getEngineStartReadiness } from "@/lib/engine-start-readiness";
import { buildAiCommitteeEvidencePack } from "@/lib/ai-committee/evidence-pack";
import { getAiCommitteeProviderStatus } from "@/lib/ai-committee/provider";
import { runAiCommittee } from "@/lib/ai-committee/orchestrator";
import { runFinalJudge } from "@/lib/ai-committee/final-judge";
import { runApprovalGate } from "@/lib/approval-gate/approval-gate";
import { POST as candidateFactoryPOST } from "@/app/api/internal/candidate-factory-run/route";
import { POST as publishApprovedAlertPOST } from "@/app/api/internal/publish-approved-alert/route";
import { runSources } from "@/lib/ops/source-runner";
import { enrichProofForRawSignal } from "@/lib/proof-enrichment";
import { getR2OperationalStatus, saveJsonToR2 } from "@/lib/r2-warehouse";
import { earRegistrySummary } from "@/lib/ear-registry";
import { scoreSevenLayerEvidence } from "@/lib/catalyst-impact-scoring";
import { withRedactionMetadata } from "@/lib/redact-secrets";
import {
  buildGlobalSchedulerPlan,
  MEANINGFUL_METRIC_REGISTRY,
} from "@/lib/global-ear-scheduler";
import { runGenericNewsTriage } from "@/lib/generic-news-triage";
import { runFmpProof, runPriceVolume } from "@/lib/proof-ears";
import type { ProofItem } from "@/lib/proof/proof-bundle-builder";

export const dynamic = "force-dynamic";

function redactedJson(payload: Record<string, unknown>, init?: ResponseInit) {
  return NextResponse.json(withRedactionMetadata(payload), init);
}

type JsonRecord = Record<string, unknown>;
type SignalGrade = "A" | "B" | "C" | "D" | "F";
type PipelineStage =
  | "radar_item"
  | "watch_candidate"
  | "proof_needed"
  | "ai_review_ready"
  | "approval_ready"
  | "publish_ready"
  | "rejected_noise";
type SignalType =
  | "direct_company_news"
  | "official_filing_event"
  | "insider_or_institutional_activity"
  | "price_volume_anomaly"
  | "fundamentals_change"
  | "regulatory_or_legal_event"
  | "contract_or_customer_event"
  | "broad_macro_or_sector_ripple"
  | "product_or_demand_signal"
  | "calendar_only_event"
  | "opinion_or_noise";

type GreatSignalScorecard = {
  catalystStrengthScore: number;
  directAssetMatchScore: number;
  proofQualityScore: number;
  proofDiversityScore: number;
  businessImpactScore: number;
  timingScore: number;
  priceVolumeContextScore: number;
  fundamentalsSupportScore: number;
  officialProofScore: number;
  historicalMemoryScore: number;
  riskClarityScore: number;
  noisePenalty: number;
  hypePenalty: number;
  unsafeProofPenalty: number;
  missingProofPenalty: number;
  finalGreatSignalScore: number;
  signalGrade: SignalGrade;
  stageRecommendation: PipelineStage;
  signalType: SignalType;
  signalPlaybook: SignalPlaybook;
  whyItCouldBeGreat: string[];
  whyItIsBlocked: string[];
  nextBestProofToFetch: string;
  relevantProofTypes: string[];
  irrelevantProofTypes: string[];
  requiredProofTypesForThisCandidate: string[];
  optionalProofTypesForThisCandidate: string[];
  missingRequiredProof: string[];
  missingOptionalProof: string[];
  uniqueProofTypesClean: string[];
  uniqueIndependentSourcesClean: string[];
  duplicateProofRejected: string[];
  weakContextOnlyProof: string[];
  proofDiversityClean: number;
  proofRouterAttempted: boolean;
  proofRouterCalls: string[];
  proofAttachedByType: Record<string, number>;
  proofUnavailableByType: Record<string, string>;
  proofStillMissingAfterRouter: string[];
  nextBestProofToFetchAfterRouter: string;
  priceVolumeProofExamples?: JsonRecord[];
  fundamentalsProofExamples?: JsonRecord[];
  fmpProofUnavailableReason?: string | null;
  priceVolumeUnavailableReason?: string | null;
  routerFailureReasons?: string[];
};

type DiscoveryRow = {
  rawSignalId: string;
  ticker: string | null;
  source: string;
  title: string;
  receivedAt: string;
  passed: boolean;
  blockedReasons: string[];
  qualityScore: number;
  evidenceConfidenceScore: number;
  suggestedAction: string | null;
  beforeProofCount: number;
  afterProofCount: number;
  beforeConfidenceScore: number;
  afterConfidenceScore: number;
  passedAfterEnrichment: boolean;
  proofAddedTypes: string[];
  stillMissingProof: string[];
  catalystImpactScore: number | null;
  stockSpecificityScore: number | null;
  directTickerMatch: boolean | null;
  directCompanyMatch: boolean | null;
  hasReceiptUrl: boolean | null;
  freshWithin72h: boolean | null;
  promotionScore: number | null;
  bestFailureReason: string | null;
  unsafeProofMismatchWarning: boolean;
  proofMatchQuality: number;
  proofDiversity: number;
  eligibleForBest: boolean;
  reasonNotPromoted: string | null;
  sevenLayerEvidence: ReturnType<typeof scoreSevenLayerEvidence>;
  greatSignalScorecard: GreatSignalScorecard;
  finalGreatSignalScore: number;
  signalGrade: SignalGrade;
  stageRecommendation: PipelineStage;
  signalType: SignalType;
  signalPlaybook: SignalPlaybook;
  whyItCouldBeGreat: string[];
  whyItIsBlocked: string[];
  nextBestProofToFetch: string;
  relevantProofTypes: string[];
  irrelevantProofTypes: string[];
  requiredProofTypesForThisCandidate: string[];
  optionalProofTypesForThisCandidate: string[];
  missingRequiredProof: string[];
  missingOptionalProof: string[];
  uniqueProofTypesClean: string[];
  uniqueIndependentSourcesClean: string[];
  duplicateProofRejected: string[];
  weakContextOnlyProof: string[];
  proofDiversityClean: number;
  proofRouterAttempted: boolean;
  proofRouterCalls: string[];
  proofAttachedByType: Record<string, number>;
  proofUnavailableByType: Record<string, string>;
  proofStillMissingAfterRouter: string[];
  nextBestProofToFetchAfterRouter: string;
  priceVolumeProofExamples?: JsonRecord[];
  fundamentalsProofExamples?: JsonRecord[];
  fmpProofUnavailableReason?: string | null;
  priceVolumeUnavailableReason?: string | null;
  routerFailureReasons?: string[];
  cleanNewsReceiptAttached: boolean;
  cleanNewsReceiptReason: string | null;
  rejectedNewsReceiptReason: string | null;
  aiReviewEligible: boolean;
  aiCommitteeCalled: boolean;
  pipelineStage: PipelineStage;
  stageReason: string;
  nextPipelineAction: string;
  canMoveToNextStage: boolean;
  blockedFromNextStageBecause: string[];
  broadNewsClass: string | null;
  seriousnessScore: number | null;
  affectedSectors: string[];
  affectedTickers: string[];
  affectedETFs: string[];
  impactMechanism: string | null;
  mappedBy: string | null;
  promotedToRippleCandidate: boolean;
  watchQueueEligible: boolean;
  watchQueueReason: string | null;
  watchUntil: string | null;
  recheckAfter: string | null;
  missingProofToRecheck: string[];
  watchPriority: "high" | "medium" | "low" | null;
};

type SignalPlaybook = {
  signalType: SignalType;
  requiredProofTypes: string[];
  optionalProofTypes: string[];
  proofThatDoesNotApply: string[];
  minimumCleanProofTypes: number;
  stage2EligibilityRule: string;
};

const SIGNAL_PLAYBOOKS: Record<SignalType, SignalPlaybook> = {
  direct_company_news: {
    signalType: "direct_company_news",
    requiredProofTypes: ["news", "price_volume_or_fundamentals"],
    optionalProofTypes: ["filing", "pattern_match", "regulatory", "contract"],
    proofThatDoesNotApply: [],
    minimumCleanProofTypes: 2,
    stage2EligibilityRule:
      "Requires company/topic match plus news and price-volume or fundamentals proof.",
  },
  official_filing_event: {
    signalType: "official_filing_event",
    requiredProofTypes: ["filing", "price_volume_or_fundamentals"],
    optionalProofTypes: ["insider", "pattern_match"],
    proofThatDoesNotApply: ["generic_sec_homepage"],
    minimumCleanProofTypes: 2,
    stage2EligibilityRule:
      "Requires a specific SEC filing URL plus price-volume or fundamentals proof.",
  },
  insider_or_institutional_activity: {
    signalType: "insider_or_institutional_activity",
    requiredProofTypes: ["filing_or_insider", "price_volume"],
    optionalProofTypes: ["fundamentals", "pattern_match"],
    proofThatDoesNotApply: ["non_open_market_insider_context"],
    minimumCleanProofTypes: 2,
    stage2EligibilityRule:
      "Requires clean insider/filing proof and real price-volume context.",
  },
  price_volume_anomaly: {
    signalType: "price_volume_anomaly",
    requiredProofTypes: ["price_volume", "news_or_filing_or_fundamentals"],
    optionalProofTypes: ["pattern_match"],
    proofThatDoesNotApply: ["market_reaction_required"],
    minimumCleanProofTypes: 2,
    stage2EligibilityRule:
      "Price/volume can support a signal but needs a separate real catalyst proof type.",
  },
  fundamentals_change: {
    signalType: "fundamentals_change",
    requiredProofTypes: ["fundamentals", "news_or_filing"],
    optionalProofTypes: ["price_volume", "pattern_match"],
    proofThatDoesNotApply: ["profile_page_only"],
    minimumCleanProofTypes: 2,
    stage2EligibilityRule:
      "Requires real FMP values and a separate matched catalyst receipt.",
  },
  regulatory_or_legal_event: {
    signalType: "regulatory_or_legal_event",
    requiredProofTypes: ["regulatory_or_legal_risk_or_filing", "news"],
    optionalProofTypes: ["price_volume", "fundamentals", "pattern_match"],
    proofThatDoesNotApply: [],
    minimumCleanProofTypes: 2,
    stage2EligibilityRule:
      "Requires regulatory/legal/filing proof plus matched news.",
  },
  contract_or_customer_event: {
    signalType: "contract_or_customer_event",
    requiredProofTypes: [
      "contract_or_filing_or_official_receipt",
      "price_volume_or_fundamentals",
    ],
    optionalProofTypes: ["pattern_match"],
    proofThatDoesNotApply: [],
    minimumCleanProofTypes: 2,
    stage2EligibilityRule:
      "Requires specific contract/customer receipt and business or market context.",
  },
  broad_macro_or_sector_ripple: {
    signalType: "broad_macro_or_sector_ripple",
    requiredProofTypes: [
      "affected_ticker_or_sector_mapping",
      "news_or_official_source",
      "price_volume_or_fundamentals",
    ],
    optionalProofTypes: ["pattern_match"],
    proofThatDoesNotApply: ["generic_unmapped_broad_news"],
    minimumCleanProofTypes: 2,
    stage2EligibilityRule:
      "May reach AI review only when mapped to a sector/ticker and supported by clean proof.",
  },
  product_or_demand_signal: {
    signalType: "product_or_demand_signal",
    requiredProofTypes: [
      "news_or_official_source",
      "price_volume_or_fundamentals",
    ],
    optionalProofTypes: ["contract", "pattern_match"],
    proofThatDoesNotApply: [],
    minimumCleanProofTypes: 2,
    stage2EligibilityRule:
      "Requires product/demand proof plus market or business context.",
  },
  calendar_only_event: {
    signalType: "calendar_only_event",
    requiredProofTypes: ["calendar_event"],
    optionalProofTypes: [],
    proofThatDoesNotApply: ["earnings_calendar_only"],
    minimumCleanProofTypes: 99,
    stage2EligibilityRule:
      "Calendar-only events cannot become public alerts by themselves and stop at watch_candidate.",
  },
  opinion_or_noise: {
    signalType: "opinion_or_noise",
    requiredProofTypes: [],
    optionalProofTypes: ["another_clean_proof_source"],
    proofThatDoesNotApply: ["opinion_only"],
    minimumCleanProofTypes: 99,
    stage2EligibilityRule:
      "Opinion/noise cannot become a public alert unless another clean proof source changes classification.",
  },
};

const MIN_STOCK_SPECIFICITY_SCORE = 55;
const MIN_CATALYST_IMPACT_SCORE = 55;
const MIN_PROMOTION_SCORE = 55;
const CORE_PROOF_TYPES = new Set([
  "price_volume",
  "fundamentals",
  "pattern_match",
]);

const VALID_CANDIDATE_PROOF_TYPES = new Set([
  "filing",
  "news",
  "price_volume",
  "fundamentals",
  "pattern_match",
  "insider",
  "regulatory",
  "contract",
  "legal_risk",
]);

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function nextBestProof(missingProof: string[]) {
  const missing = new Set(missingProof.filter(Boolean));
  if (!missing.size) return "none";
  if (missing.has("price_volume")) return "price_volume";
  if (missing.has("fundamentals")) return "fundamentals";
  if (
    missing.has("filing") ||
    missing.has("regulatory") ||
    missing.has("legal_risk")
  )
    return "filing";
  if (missing.has("news")) return "news";
  if (missing.has("pattern_match")) return "pattern_match";
  return missingProof.find(Boolean) ?? "none";
}

function gradeFromScore(
  score: number,
  blocked: string[],
  proofTypes: string[],
) {
  const cleanProofTypes = proofTypes.filter((type) =>
    VALID_CANDIDATE_PROOF_TYPES.has(type),
  );
  const newsOnly =
    cleanProofTypes.length === 1 && cleanProofTypes[0] === "news";
  const opinionOnly = blocked.some((reason) => /opinion/i.test(reason));
  const missingRequired = blocked.some((reason) =>
    /Missing proof/i.test(reason),
  );
  if (blocked.includes("source_health_is_diagnostic_not_proof") || score < 20)
    return "F" as const;
  if (
    score >= 82 &&
    cleanProofTypes.length >= 2 &&
    !missingRequired &&
    !newsOnly &&
    !opinionOnly
  )
    return "A" as const;
  if (
    score >= 62 &&
    cleanProofTypes.length >= 2 &&
    !missingRequired &&
    !opinionOnly &&
    !newsOnly
  )
    return "B" as const;
  if (score >= 42 && cleanProofTypes.length >= 1) return "C" as const;
  if (score >= 20) return "D" as const;
  return "F" as const;
}

function classifySignalType(
  signal: RawSignal,
  impact: ReturnType<typeof payloadImpact>,
): SignalType {
  const haystack =
    `${signal.source} ${signal.title} ${signal.summary} ${impact.catalystType ?? ""}`.toLowerCase();
  if (/opinion|commentary|rumou?r|why i think/.test(haystack))
    return "opinion_or_noise";
  if (/earnings calendar|calendar|ex-dividend|conference date/.test(haystack))
    return "calendar_only_event";
  if (
    /8-k|10-q|10-k|sec filing|filed with sec|annual report|quarterly report/.test(
      haystack,
    )
  )
    return "official_filing_event";
  if (
    /insider|form 4|13f|institutional|open-market buy|open market buy/.test(
      haystack,
    )
  )
    return "insider_or_institutional_activity";
  if (
    /fda|regulatory|lawsuit|litigation|sanction|doj|ftc|government policy|legal/.test(
      haystack,
    )
  )
    return "regulatory_or_legal_event";
  if (
    /contract|customer|award|purchase order|supplier|partnership/.test(haystack)
  )
    return "contract_or_customer_event";
  if (/volume|breakout|price move|unusual trading|rally|selloff/.test(haystack))
    return "price_volume_anomaly";
  if (/revenue|margin|eps|guidance|estimate|fundamental/.test(haystack))
    return "fundamentals_change";
  if (/product|demand|launch|orders|platform/.test(haystack))
    return "product_or_demand_signal";
  if (
    !impact.directTickerMatch &&
    !impact.directCompanyMatch &&
    /chip stocks|ai rout|tech rout|commodity supercycle|sanctions|cyber defense|government policy|fda|regulatory action|sector selloff|supply chain shock|oil|rates|fx|spacex|ai infrastructure|ripple events|sector|macro|geopolitical|commodity|currency/.test(
      haystack,
    )
  )
    return "broad_macro_or_sector_ripple";
  return "direct_company_news";
}

function broadRippleMetadata(signal: RawSignal, signalType: SignalType) {
  const payload = obj(signal.payload);
  const triage = obj(
    payload.genericNewsTriage ?? payload.genericTriage ?? payload.broadNews,
  );
  const haystack = `${signal.title} ${signal.summary}`.toLowerCase();
  const isBroad = signalType === "broad_macro_or_sector_ripple";
  const chip = /chip|semiconductor|ai/.test(haystack);
  const oil = /oil|energy|sanction/.test(haystack);
  const fda = /fda|health|drug|device/.test(haystack);
  const cyber = /cyber|defense|defence/.test(haystack);
  const tech = /tech rout|ai rout|ai infrastructure|spacex/.test(haystack);
  const supply = /supply chain shock|shipping disruption/.test(haystack);
  const rates = /rates|fx|dollar|currency|inflation/.test(haystack);
  const affectedSectors = arrayText(triage.affectedSectors).length
    ? arrayText(triage.affectedSectors)
    : chip
      ? ["Semiconductors", "AI infrastructure"]
      : tech
        ? ["Technology", "AI infrastructure"]
        : oil
          ? ["Energy", "Airlines", "Shipping"]
          : fda
            ? ["Healthcare", "Biotech"]
            : cyber
              ? ["Cybersecurity", "Defense"]
              : supply
                ? ["Retail", "Autos", "Logistics"]
                : rates
                  ? ["Banks", "Real Estate", "Exporters"]
                  : [];
  const affectedTickers = arrayText(triage.affectedTickers).length
    ? arrayText(triage.affectedTickers)
    : chip
      ? ["NVDA", "AMD", "TSM", "ASML", "MU"]
      : tech
        ? ["MSFT", "GOOGL", "META", "NVDA"]
        : oil
          ? ["XOM", "CVX", "OXY"]
          : supply
            ? ["WMT", "AMZN", "FDX", "UPS"]
            : [];
  const affectedETFs = arrayText(triage.affectedETFs).length
    ? arrayText(triage.affectedETFs)
    : chip
      ? ["SMH", "SOXX"]
      : tech
        ? ["XLK", "QQQ"]
        : oil
          ? ["XLE"]
          : fda
            ? ["XLV", "XBI"]
            : rates
              ? ["TLT", "UUP", "XLF"]
              : [];
  return {
    broadNewsClass:
      text(triage.broadNewsClass) ||
      (isBroad
        ? chip
          ? "sectorShock"
          : oil
            ? "commodityShock"
            : fda
              ? "healthRegulatoryShock"
              : cyber
                ? "defenceSecurityShock"
                : "macroShock"
        : null),
    seriousnessScore:
      typeof triage.seriousnessScore === "number"
        ? triage.seriousnessScore
        : isBroad
          ? 65
          : null,
    affectedSectors,
    affectedTickers,
    affectedETFs,
    impactMechanism:
      text(triage.impactMechanism) ||
      (isBroad
        ? "Broad item may affect revenue, margins, risk, sentiment, or cost of capital for mapped sectors/tickers."
        : null),
    mappedBy: isBroad
      ? "serious_signal_pipeline_v1_keyword_and_payload_mapping"
      : null,
    promotedToRippleCandidate:
      isBroad && (affectedSectors.length > 0 || affectedTickers.length > 0),
  };
}

function pipelineDecision(input: {
  scorecard: GreatSignalScorecard;
  signalType: SignalType;
  passed: boolean;
  unsafeProofMismatchWarning: boolean;
  broad: ReturnType<typeof broadRippleMetadata>;
  confirmRun: boolean;
}) {
  const { scorecard, signalType, passed, unsafeProofMismatchWarning, broad } =
    input;
  const blocked = [...scorecard.whyItIsBlocked];
  let pipelineStage: PipelineStage = "radar_item";
  if (scorecard.signalGrade === "F" || signalType === "opinion_or_noise")
    pipelineStage =
      signalType === "opinion_or_noise" && scorecard.proofDiversityClean > 0
        ? "watch_candidate"
        : "rejected_noise";
  else if (signalType === "calendar_only_event")
    pipelineStage = "watch_candidate";
  else if (
    scorecard.missingRequiredProof.length > 0 ||
    scorecard.proofDiversityClean < 2
  )
    pipelineStage =
      scorecard.finalGreatSignalScore >= 45 || broad.promotedToRippleCandidate
        ? "proof_needed"
        : "watch_candidate";
  else if (
    passed &&
    !unsafeProofMismatchWarning &&
    scorecard.proofDiversityClean >= 2 &&
    scorecard.missingRequiredProof.length === 0 &&
    !scorecard.whyItIsBlocked.some((reason) => /opinion|calendar/i.test(reason))
  )
    pipelineStage = "ai_review_ready";
  else pipelineStage = "watch_candidate";
  if (
    signalType === "broad_macro_or_sector_ripple" &&
    !broad.promotedToRippleCandidate
  )
    pipelineStage = "watch_candidate";
  if (signalType === "calendar_only_event")
    blocked.push("calendar_only_event_cannot_be_public_alert_by_itself");
  if (signalType === "opinion_or_noise")
    blocked.push("opinion_or_noise_cannot_be_public_alert_by_itself");
  if (
    signalType === "broad_macro_or_sector_ripple" &&
    (!broad.promotedToRippleCandidate || scorecard.proofDiversityClean < 2)
  )
    blocked.push(
      "broad_news_requires_mapping_and_clean_proof_before_ai_review",
    );
  const canMoveToNextStage =
    pipelineStage === "ai_review_ready"
      ? input.confirmRun
      : (
          ["proof_needed", "watch_candidate", "radar_item"] as PipelineStage[]
        ).includes(pipelineStage);
  const nextPipelineAction =
    pipelineStage === "proof_needed"
      ? `fetch_${scorecard.nextBestProofToFetchAfterRouter}`
      : pipelineStage === "watch_candidate"
        ? "store_in_watch_queue_for_recheck"
        : pipelineStage === "ai_review_ready"
          ? "run_ai_committee_only_if_confirmRun_true"
          : pipelineStage === "rejected_noise"
            ? "do_not_publish"
            : "continue_triage";
  return {
    pipelineStage,
    stageReason:
      blocked[0] ??
      (pipelineStage === "ai_review_ready"
        ? "clean_proof_ready_for_ai_gate"
        : "candidate_needs_more_triage"),
    nextPipelineAction,
    canMoveToNextStage,
    blockedFromNextStageBecause:
      pipelineStage === "ai_review_ready" && !input.confirmRun
        ? ["confirmRun=false"]
        : blocked,
  };
}

function watchQueueFields(
  stage: PipelineStage,
  score: number,
  missing: string[],
) {
  const eligible = stage === "watch_candidate" || stage === "proof_needed";
  const now = Date.now();
  const priority =
    score >= 65 ? "high" : score >= 45 ? "medium" : eligible ? "low" : null;
  return {
    watchQueueEligible: eligible,
    watchQueueReason: eligible
      ? "Candidate may become useful after missing proof is rechecked; watch candidates never publish or send Telegram."
      : null,
    watchUntil: eligible
      ? new Date(now + 72 * 60 * 60 * 1000).toISOString()
      : null,
    recheckAfter: eligible
      ? new Date(
          now + (priority === "high" ? 6 : 24) * 60 * 60 * 1000,
        ).toISOString()
      : null,
    missingProofToRecheck: missing,
    watchPriority: priority as "high" | "medium" | "low" | null,
  };
}

function buildGreatSignalScorecard(input: {
  signal: RawSignal;
  blockedReasons: string[];
  enrichment: Awaited<ReturnType<typeof enrichProofForRawSignal>>;
  impact: ReturnType<typeof payloadImpact>;
}): GreatSignalScorecard {
  const { signal, blockedReasons, enrichment, impact } = input;
  const signalType = classifySignalType(signal, impact);
  const signalPlaybook = SIGNAL_PLAYBOOKS[signalType];
  const profile = proofNeedProfile(signal, impact);
  const diversity = cleanProofDiversity({ enrichment });
  const proofTypes = diversity.uniqueProofTypesClean;
  const proofSet = new Set(proofTypes);
  const missingProof = missingNeedGroups(
    profile.requiredProofTypesForThisCandidate,
    proofTypes,
    signal,
    impact,
  );
  const title = `${signal.title} ${signal.summary}`.toLowerCase();
  const genericNoise = isBroadMarketNoise({
    directTickerMatch: impact.directTickerMatch,
    directCompanyMatch: impact.directCompanyMatch,
    stockSpecificityScore: impact.stockSpecificityScore,
    title: signal.title,
  });
  const opinionOnly =
    /opinion|commentary|why i think|could be|might be|rumor/.test(title);
  const hype =
    /moon|rocket|explosive|massive upside|guaranteed|can't miss|game.?changer/i.test(
      title,
    );
  const sourceHealthRejected = enrichment.rejectedProofReasons.includes(
    "source_health_is_diagnostic_not_proof",
  );
  const catalystStrengthScore = clampScore(impact.catalystImpactScore ?? 0);
  const directAssetMatchScore = impact.directTickerMatch
    ? 100
    : impact.directCompanyMatch
      ? 75
      : 15;
  const proofQualityScore = enrichment.acceptedProofItems.length
    ? Math.max(
        ...enrichment.acceptedProofItems.map((item) => item.proofMatchScore),
      )
    : 0;
  const proofDiversityScore = clampScore(
    (diversity.proofDiversityClean / 4) * 100,
  );
  const businessImpactScore = clampScore(
    impact.promotionScore ?? catalystStrengthScore,
  );
  const timingScore = impact.freshWithin72h ? 100 : 35;
  const priceVolumeContextScore = proofSet.has("price_volume") ? 100 : 0;
  const fundamentalsSupportScore = proofSet.has("fundamentals") ? 100 : 0;
  const officialProofScore =
    proofSet.has("filing") || proofSet.has("regulatory")
      ? 100
      : proofSet.has("contract") ||
          proofSet.has("legal_risk") ||
          proofSet.has("insider")
        ? 75
        : 0;
  const historicalMemoryScore = proofSet.has("pattern_match") ? 100 : 0;
  const riskClarityScore = enrichment.rejectedProofItems.length ? 35 : 80;
  const noisePenalty = genericNoise ? 25 : 0;
  const hypePenalty = hype || opinionOnly ? 20 : 0;
  const unsafeProofPenalty =
    input.enrichment.rejectedProofItems.length &&
    !input.enrichment.acceptedProofItems.length
      ? 30
      : 0;
  const missingProofPenalty = Math.min(35, missingProof.length * 7);
  const positive =
    catalystStrengthScore * 0.16 +
    directAssetMatchScore * 0.14 +
    proofQualityScore * 0.18 +
    proofDiversityScore * 0.12 +
    businessImpactScore * 0.12 +
    timingScore * 0.08 +
    priceVolumeContextScore * 0.06 +
    fundamentalsSupportScore * 0.06 +
    officialProofScore * 0.04 +
    historicalMemoryScore * 0.02 +
    riskClarityScore * 0.02;
  const finalGreatSignalScore = clampScore(
    positive -
      noisePenalty -
      hypePenalty -
      unsafeProofPenalty -
      missingProofPenalty -
      (sourceHealthRejected ? 20 : 0),
  );
  const whyItCouldBeGreat = [
    ...(catalystStrengthScore >= 55 ? ["Real catalyst detected."] : []),
    ...(impact.directTickerMatch
      ? ["Direct ticker match found."]
      : impact.directCompanyMatch
        ? ["Direct company match found."]
        : []),
    ...(impact.hasReceiptUrl ? ["Specific receipt URL exists."] : []),
    ...(proofSet.has("filing") ? ["Official filing proof is present."] : []),
    ...(proofSet.has("price_volume")
      ? ["Price/volume context is present."]
      : []),
    ...(proofSet.has("fundamentals")
      ? ["Fundamentals support is present."]
      : []),
    ...(proofSet.has("pattern_match")
      ? ["Historical pattern support is present."]
      : []),
  ];
  const whyItIsBlocked = [
    ...blockedReasons,
    ...(diversity.proofDiversityClean < 2
      ? ["Needs at least two clean proof types beyond the raw source."]
      : []),
    ...(opinionOnly
      ? ["Opinion-only content cannot receive an A or B grade."]
      : []),
    ...(genericNoise
      ? ["Generic market/news noise is not specific enough yet."]
      : []),
    ...(sourceHealthRejected ? ["source_health_is_diagnostic_not_proof"] : []),
    ...(missingProof.length
      ? [`Missing proof: ${missingProof.join(", ")}.`]
      : []),
  ];
  const signalGrade = gradeFromScore(
    finalGreatSignalScore,
    whyItIsBlocked,
    proofTypes,
  );
  const stageRecommendation: PipelineStage =
    signalGrade === "A" &&
    missingProof.length === 0 &&
    diversity.proofDiversityClean >= signalPlaybook.minimumCleanProofTypes
      ? "ai_review_ready"
      : signalGrade === "F"
        ? "rejected_noise"
        : missingProof.length
          ? "proof_needed"
          : "watch_candidate";
  return {
    catalystStrengthScore,
    directAssetMatchScore,
    proofQualityScore,
    proofDiversityScore,
    businessImpactScore,
    timingScore,
    priceVolumeContextScore,
    fundamentalsSupportScore,
    officialProofScore,
    historicalMemoryScore,
    riskClarityScore,
    noisePenalty,
    hypePenalty,
    unsafeProofPenalty,
    missingProofPenalty,
    finalGreatSignalScore,
    signalGrade,
    stageRecommendation,
    signalType,
    signalPlaybook,
    whyItCouldBeGreat,
    whyItIsBlocked,
    nextBestProofToFetch: nextBestProof(missingProof),
    relevantProofTypes: profile.relevantProofTypes,
    irrelevantProofTypes: profile.irrelevantProofTypes,
    requiredProofTypesForThisCandidate:
      profile.requiredProofTypesForThisCandidate,
    optionalProofTypesForThisCandidate:
      profile.optionalProofTypesForThisCandidate,
    missingRequiredProof: missingProof,
    missingOptionalProof: missingNeedGroups(
      profile.optionalProofTypesForThisCandidate,
      proofTypes,
      signal,
      impact,
    ),
    ...diversity,
    ...proofRouterSummary(missingProof, enrichment),
  };
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

type ProofNeedProfile = {
  relevantProofTypes: string[];
  irrelevantProofTypes: string[];
  requiredProofTypesForThisCandidate: string[];
  optionalProofTypesForThisCandidate: string[];
};

const ALL_PROOF_TYPE_NAMES = Array.from(VALID_CANDIDATE_PROOF_TYPES);

function proofNeedProfile(
  signal: RawSignal,
  impact: ReturnType<typeof payloadImpact>,
): ProofNeedProfile {
  const haystack =
    `${signal.source} ${signal.title} ${signal.summary} ${impact.catalystType ?? ""}`.toLowerCase();
  let required: string[] = ["news", "price_volume", "fundamentals"];
  let optional: string[] = [
    "filing",
    "pattern_match",
    "contract",
    "regulatory",
  ];
  if (
    /8-k|10-q|10-k|filing|sec|earnings release|official company event/.test(
      haystack,
    )
  ) {
    required = ["filing", "price_volume_or_fundamentals"];
    optional = ["insider", "pattern_match"];
  } else if (
    /insider|form 4|institutional buying|13f|open-market buy|open market buy/.test(
      haystack,
    )
  ) {
    required = ["insider_or_filing", "price_volume"];
    optional = ["fundamentals", "pattern_match"];
  } else if (
    /regulatory|lawsuit|litigation|fda|government action|doj|ftc|sec probe|legal/.test(
      haystack,
    )
  ) {
    required = ["regulatory_or_legal_risk_or_filing", "news"];
    optional = ["price_volume", "fundamentals", "pattern_match"];
  } else if (
    /contract|award|customer win|government award|purchase order|customer/.test(
      haystack,
    )
  ) {
    required = [
      "contract_or_filing_or_official_receipt",
      "fundamentals_or_price_volume",
    ];
    optional = ["pattern_match"];
  } else if (
    !impact.directTickerMatch &&
    !impact.directCompanyMatch &&
    /sector|stocks|index|rout|plunge|supercycle|supply chain|commodity|cyber|quantum|chip stocks|ai rout/.test(
      haystack,
    )
  ) {
    required = [
      "mapped_affected_ticker_or_sector",
      "news_or_official_source",
      "price_volume_or_fundamentals",
    ];
    optional = ["pattern_match", "ripple_proof"];
  }
  const relevant = uniqueStrings(
    [...required, ...optional].flatMap((item) => item.split("_or_")),
  );
  return {
    relevantProofTypes: relevant,
    irrelevantProofTypes: ALL_PROOF_TYPE_NAMES.filter(
      (type) => !relevant.includes(type),
    ),
    requiredProofTypesForThisCandidate: required,
    optionalProofTypesForThisCandidate: optional,
  };
}

function missingNeedGroups(
  groups: string[],
  proofTypes: string[],
  signal: RawSignal,
  impact: ReturnType<typeof payloadImpact>,
) {
  const set = new Set(proofTypes);
  return groups.filter((group) => {
    if (group === "mapped_affected_ticker_or_sector")
      return !(
        signal.ticker ||
        impact.directTickerMatch ||
        impact.directCompanyMatch ||
        classifySignalType(signal, impact) === "broad_macro_or_sector_ripple"
      );
    if (group === "official_receipt") return !impact.hasReceiptUrl;
    return !group
      .split("_or_")
      .some(
        (type) =>
          set.has(type) ||
          (type === "official_receipt" && impact.hasReceiptUrl),
      );
  });
}

function cleanProofDiversity(input: {
  enrichment: Awaited<ReturnType<typeof enrichProofForRawSignal>>;
}) {
  const seenUrl = new Set<string>();
  const seenTopic = new Set<string>();
  const duplicateProofRejected: string[] = [];
  const weakContextOnlyProof: string[] = [];
  const clean = input.enrichment.acceptedProofItems.filter((item) => {
    if (item.proofType === "unknown" || item.proofType === "source_health")
      return false;
    const urlKey = item.url ?? "";
    const topicKey = `${item.source}:${item.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .slice(0, 90)}`;
    if (urlKey && seenUrl.has(urlKey)) {
      duplicateProofRejected.push(`duplicate_url:${urlKey}`);
      return false;
    }
    if (seenTopic.has(topicKey)) {
      duplicateProofRejected.push(
        `duplicate_topic:${item.source}:${item.title}`,
      );
      return false;
    }
    if (
      /financial summary|quote summary|source health/i.test(
        `${item.source} ${item.title}`,
      )
    ) {
      weakContextOnlyProof.push(`${item.source}:${item.title}`);
      return false;
    }
    if (urlKey) seenUrl.add(urlKey);
    seenTopic.add(topicKey);
    return true;
  });
  const uniqueProofTypesClean = uniqueStrings(
    clean.map((item) => String(item.proofType)),
  );
  const uniqueIndependentSourcesClean = uniqueStrings(
    clean.map((item) => item.source),
  );
  return {
    uniqueProofTypesClean,
    uniqueIndependentSourcesClean,
    duplicateProofRejected,
    weakContextOnlyProof,
    proofDiversityClean: uniqueProofTypesClean.length,
  };
}

function numberOrNull(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function hasRealNumber(record: JsonRecord, keys: string[]) {
  return keys.some((key) => numberOrNull(record[key]) !== null);
}

function proofReceiptUrl(
  type: "price_volume" | "fundamentals",
  ticker: string,
) {
  return `internal://proof-router/${type}/${ticker}/${stage1DateKey()}`;
}

const FUNDAMENTALS_VALUE_KEYS = [
  "revenueGrowthPct",
  "marginTrendPct",
  "epsOrIncomeGrowthPct",
  "earningsSurpriseAverage",
  "cashFlowToNetIncome",
  "debtToEquity",
  "currentRatio",
  "peRatio",
  "evToSales",
  "estimateRevisionPct",
  "priceTargetRevisionPct",
];
const FUNDAMENTALS_SCORE_KEYS = [
  "revenueGrowthScore",
  "marginTrendScore",
  "earningsQualityScore",
  "cashFlowQualityScore",
  "debtRiskScore",
  "valuationSupportScore",
  "estimateRevisionScore",
  "priceTargetRevisionScore",
];

function realFundamentalsValueCount(values: JsonRecord) {
  return FUNDAMENTALS_VALUE_KEYS.filter(
    (key) => numberOrNull(values[key]) !== null,
  ).length;
}

function realFundamentalsScoreCount(row: JsonRecord) {
  return FUNDAMENTALS_SCORE_KEYS.filter(
    (key) => numberOrNull(row[key]) !== null && numberOrNull(row[key])! > 0,
  ).length;
}

async function attachRoutedProofForSignal(
  signal: RawSignal,
  enrichment: Awaited<ReturnType<typeof enrichProofForRawSignal>>,
) {
  const ticker = text(signal.ticker).toUpperCase();
  const routerFailureReasons: string[] = [];
  if (!ticker) {
    routerFailureReasons.push(
      "missing_ticker_for_price_volume_or_fundamentals_router",
    );
    return { enrichment, routerFailureReasons };
  }

  const missing = new Set(enrichment.missingProof);
  const extraProofs: ProofItem[] = [];
  const acceptedProofItems = [...enrichment.acceptedProofItems];
  const attempts = [...enrichment.enrichmentAttempts];

  if (missing.has("price_volume")) {
    try {
      const result = await runPriceVolume({ tickers: [ticker], maxTickers: 1 });
      const row = (
        Array.isArray(result.priceVolumeProof) ? result.priceVolumeProof : []
      )
        .map(obj)
        .find((item) => text(item.ticker).toUpperCase() === ticker);
      const hasRealPrice = row && hasRealNumber(row, ["price", "latestPrice"]);
      const hasRealVolume = row && hasRealNumber(row, ["volume"]);
      if (row && hasRealPrice && hasRealVolume) {
        const latestPrice =
          numberOrNull(row.latestPrice) ?? numberOrNull(row.price);
        const priceChange =
          numberOrNull(row.priceChange) ?? numberOrNull(row.priceMove1d);
        const volume = numberOrNull(row.volume);
        const averageVolume =
          numberOrNull(row.averageVolume) ?? numberOrNull(row.avgVolume);
        const volumeRatio = numberOrNull(row.volumeRatio);
        const marketReactionStatus =
          text(row.marketReactionStatus) || "early_signal_possible";
        const earlySignalPossible =
          row.earlySignalPossible === true ||
          marketReactionStatus === "early_signal_possible" ||
          marketReactionStatus === "no_reaction_yet";
        const metadata = {
          ticker,
          latestPrice,
          priceChange1d: priceChange,
          priceChange5d: numberOrNull(row.priceMove5d),
          volume,
          averageVolume,
          volumeRatio,
          marketReactionStatus,
          earlySignalPossible,
          pricedInRiskScore: numberOrNull(row.pricedInRiskScore),
          source: "FMP",
          receiptUrl: proofReceiptUrl("price_volume", ticker),
        };
        extraProofs.push({
          type: "price_volume",
          strength: "medium",
          label: "Real FMP price and volume context",
          source: "FMP Price Volume Proof",
          summary: `${ticker} real price/volume values returned: price ${latestPrice}, volume ${volume}.`,
          url: proofReceiptUrl("price_volume", ticker),
          observedAt: new Date().toISOString(),
          metadata,
        });
        acceptedProofItems.push({
          proofType: "price_volume",
          source: "FMP Price Volume Proof",
          title: `${ticker} price/volume proof`,
          url: proofReceiptUrl("price_volume", ticker),
          proofMatchScore: 90,
          matchedTicker: true,
          matchedCompany: false,
          matchedTopic: true,
          freshWithin72h: true,
          urlIsSpecific: true,
          reasons: [
            "same_ticker",
            "real_latest_price",
            "real_volume",
            "market_reaction_bonus_only",
          ],
        });
        attempts.push({
          source: "FMP Price Volume Proof",
          status: "added",
          detail:
            "Attached price_volume proof from real returned latest price and volume values.",
          proofType: "price_volume",
        });
      } else {
        routerFailureReasons.push(
          "price_volume_real_price_or_volume_unavailable",
        );
        attempts.push({
          source: "FMP Price Volume Proof",
          status: "missing",
          detail:
            "Price-volume route returned no real latest price and volume values.",
        });
      }
    } catch {
      routerFailureReasons.push("price_volume_route_error_safe");
      attempts.push({
        source: "FMP Price Volume Proof",
        status: "error",
        detail: "Price-volume proof route failed safely.",
      });
    }
  }

  if (missing.has("fundamentals")) {
    try {
      const result = await runFmpProof({
        tickers: [ticker],
        maxTickers: 1,
        dryRun: true,
        confirmRun: false,
      });
      const row = (Array.isArray(result.proof) ? result.proof : [])
        .map(obj)
        .find((item) => text(item.ticker).toUpperCase() === ticker);
      const values = obj(row?.valuesUsed);
      const realValueCount = realFundamentalsValueCount(values);
      const realScoreCount = row ? realFundamentalsScoreCount(row) : 0;
      const hasCleanFundamentalsProof =
        row &&
        row.fundamentalsProofClean === true &&
        realValueCount >= 3 &&
        realScoreCount >= 3;
      if (row && hasCleanFundamentalsProof) {
        const metadata = {
          ticker,
          source: "FMP",
          receiptUrl: proofReceiptUrl("fundamentals", ticker),
          providerReference: `FMP fundamentals proof ${ticker} ${stage1DateKey()}`,
          revenueGrowthScore: numberOrNull(row.revenueGrowthScore),
          marginTrendScore: numberOrNull(row.marginTrendScore),
          earningsQualityScore: numberOrNull(row.earningsQualityScore),
          cashFlowQualityScore: numberOrNull(row.cashFlowQualityScore),
          debtRiskScore: numberOrNull(row.debtRiskScore),
          valuationSupportScore: numberOrNull(row.valuationSupportScore),
          estimateRevisionScore: numberOrNull(row.estimateRevisionScore),
          priceTargetRevisionScore: numberOrNull(row.priceTargetRevisionScore),
          valuesUsed: values,
          unavailableEndpoints: Array.isArray(row.unavailableEndpoints)
            ? row.unavailableEndpoints
            : [],
          fundamentalsProofScore: numberOrNull(row.fundamentalsProofScore),
          realValueCount,
          fundamentalsProofClean: row.fundamentalsProofClean === true,
          fundamentalsUnavailableReason:
            text(row.fmpProofUnavailableReason) || null,
        };
        extraProofs.push({
          type: "fundamentals",
          strength: "medium",
          label: "Real FMP fundamentals support",
          source: "FMP Fundamentals Proof",
          summary: `${ticker} real FMP fundamentals returned ${realValueCount} usable values.`,
          url: proofReceiptUrl("fundamentals", ticker),
          observedAt: new Date().toISOString(),
          metadata,
        });
        acceptedProofItems.push({
          proofType: "fundamentals",
          source: "FMP Fundamentals Proof",
          title: `${ticker} fundamentals proof`,
          url: proofReceiptUrl("fundamentals", ticker),
          proofMatchScore: 90,
          matchedTicker: true,
          matchedCompany: false,
          matchedTopic: true,
          freshWithin72h: true,
          urlIsSpecific: true,
          reasons: [
            "same_ticker",
            "real_fmp_values",
            "profile_or_endpoint_availability_not_counted",
          ],
        });
        attempts.push({
          source: "FMP Fundamentals Proof",
          status: "added",
          detail: "Attached fundamentals proof from real FMP values only.",
          proofType: "fundamentals",
        });
      } else {
        routerFailureReasons.push("fundamentals_clean_real_values_unavailable");
        const unavailable = Array.isArray(row?.unavailableEndpoints)
          ? row.unavailableEndpoints.slice(0, 6).join(",")
          : "none_returned";
        attempts.push({
          source: "FMP Fundamentals Proof",
          status: "missing",
          detail: `FMP proof unavailable: clean=${String(hasCleanFundamentalsProof)}, realValues=${realValueCount}, realScores=${realScoreCount}, unavailable=${unavailable}`,
        });
      }
    } catch {
      routerFailureReasons.push("fundamentals_route_error_safe");
      attempts.push({
        source: "FMP Fundamentals Proof",
        status: "error",
        detail: "FMP fundamentals proof route failed safely.",
      });
    }
  }

  if (!extraProofs.length)
    return {
      enrichment: { ...enrichment, enrichmentAttempts: attempts },
      routerFailureReasons,
    };
  const proofTypes = uniqueStrings([
    ...enrichment.proofTypes,
    ...extraProofs.map((proof) => proof.type),
  ] as string[]) as typeof enrichment.proofTypes;
  const proofs = [...enrichment.enrichmentProofs, ...extraProofs];
  return {
    enrichment: {
      ...enrichment,
      enrichmentProofs: proofs,
      acceptedProofItems,
      enrichmentAttempts: attempts,
      proofTypes,
      proofCount: proofTypes.filter((type) =>
        VALID_CANDIDATE_PROOF_TYPES.has(type),
      ).length,
      missingProof: enrichment.missingProof.filter(
        (type) => !proofTypes.includes(type),
      ),
      confidenceScore: Math.min(
        100,
        enrichment.confidenceScore + extraProofs.length * 15,
      ),
      safeToPromote: proofTypes.length >= 2,
      strongestProof: extraProofs[0] ?? enrichment.strongestProof,
    },
    routerFailureReasons,
  };
}

function proofRouterSummary(
  missingRequiredProof: string[],
  enrichment: Awaited<ReturnType<typeof enrichProofForRawSignal>>,
) {
  const proofAttachedByType = enrichment.enrichmentProofs.reduce<
    Record<string, number>
  >((acc, proof) => {
    acc[proof.type] = (acc[proof.type] ?? 0) + 1;
    return acc;
  }, {});
  const calls = missingRequiredProof.map((need) => {
    if (/price_volume/.test(need))
      return "price_volume:FMP_quote_historical_or_polygon_when_configured";
    if (/fundamentals/.test(need)) return "fundamentals:FMP_real_values_only";
    if (/filing/.test(need)) return "filing:SEC_specific_filing_url_required";
    if (/insider/.test(need)) return "insider:SEC_Form_4_open_market_buys_only";
    if (/regulatory|legal/.test(need))
      return "regulatory_legal:mapped_source_only";
    if (/contract/.test(need)) return "contract:mapped_source_only";
    if (/pattern_match/.test(need)) return "pattern_match:stored_samples_only";
    return `${need}:mapped_source_only`;
  });
  const proofUnavailableByType = Object.fromEntries(
    missingRequiredProof.map((need) => [
      need,
      "real_values_or_specific_receipt_not_available_in_this_run",
    ]),
  );
  const proofExamples = (type: string) =>
    enrichment.enrichmentProofs
      .filter((proof) => proof.type === type)
      .slice(0, 3)
      .map((proof) => ({
        ticker: proof.metadata?.ticker,
        source: proof.source,
        receiptUrl: proof.url,
        ...obj(proof.metadata),
      }));
  return {
    proofRouterAttempted: missingRequiredProof.length > 0,
    proofRouterCalls: calls,
    proofAttachedByType,
    proofUnavailableByType,
    proofStillMissingAfterRouter: missingRequiredProof,
    nextBestProofToFetchAfterRouter: nextBestProof(missingRequiredProof),
    priceVolumeProofExamples: proofExamples("price_volume"),
    fundamentalsProofExamples: proofExamples("fundamentals"),
    fmpProofUnavailableReason: missingRequiredProof.includes("fundamentals")
      ? proofUnavailableByType.fundamentals
      : null,
    priceVolumeUnavailableReason: missingRequiredProof.includes("price_volume")
      ? proofUnavailableByType.price_volume
      : null,
  };
}

function truthyRank(value: boolean | null | undefined) {
  return value === true ? 1 : 0;
}
function numericRank(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : -1;
}
function arrayIncludes(values: string[], item: string) {
  return values.includes(item);
}

function isBroadMarketNoise(
  row: Pick<
    DiscoveryRow,
    | "directTickerMatch"
    | "directCompanyMatch"
    | "stockSpecificityScore"
    | "title"
  >,
) {
  const title = row.title.toLowerCase();
  return (
    row.directTickerMatch !== true &&
    row.directCompanyMatch !== true &&
    (row.stockSpecificityScore === null ||
      row.stockSpecificityScore < MIN_STOCK_SPECIFICITY_SCORE ||
      /market cap|markets?|index|sector|economy|stocks?\b|overtakes/i.test(
        title,
      ))
  );
}

function bestEligibilityFailure(row: DiscoveryRow) {
  const failures = [
    ...(row.unsafeProofMismatchWarning
      ? ["unsafe_proof_mismatch_warning"]
      : []),
    ...(row.directTickerMatch !== true ? ["direct_ticker_match_required"] : []),
    ...(numericRank(row.stockSpecificityScore) < MIN_STOCK_SPECIFICITY_SCORE
      ? ["stock_specificity_below_threshold"]
      : []),
    ...(numericRank(row.catalystImpactScore) < MIN_CATALYST_IMPACT_SCORE
      ? ["catalyst_impact_below_threshold"]
      : []),
    ...(numericRank(row.promotionScore) < MIN_PROMOTION_SCORE
      ? ["promotion_score_below_threshold"]
      : []),
    ...(row.hasReceiptUrl !== true ? ["specific_receipt_url_required"] : []),
    ...(isBroadMarketNoise(row) ? ["broad_market_or_news_noise"] : []),
    ...(row.blockedReasons.includes("low_impact") &&
    !row.proofAddedTypes.some((type) => CORE_PROOF_TYPES.has(type))
      ? ["low_impact_without_price_fundamental_or_pattern_support"]
      : []),
    ...(row.passed !== true ? ["candidate_factory_gates_not_passed"] : []),
  ];
  return failures;
}

function sortDiscoveryRows(rows: DiscoveryRow[]) {
  return rows.sort(
    (a, b) =>
      truthyRank(b.directTickerMatch) - truthyRank(a.directTickerMatch) ||
      truthyRank(!b.unsafeProofMismatchWarning) -
        truthyRank(!a.unsafeProofMismatchWarning) ||
      numericRank(b.promotionScore) - numericRank(a.promotionScore) ||
      numericRank(b.catalystImpactScore) - numericRank(a.catalystImpactScore) ||
      numericRank(b.stockSpecificityScore) -
        numericRank(a.stockSpecificityScore) ||
      b.proofMatchQuality - a.proofMatchQuality ||
      truthyRank(b.freshWithin72h) - truthyRank(a.freshWithin72h) ||
      b.proofDiversity - a.proofDiversity ||
      Number(b.qualityScore ?? 0) - Number(a.qualityScore ?? 0),
  );
}

const DEFAULT_PAYLOAD = {
  dryRun: true,
  confirmRun: false,
  confirmPublish: false,
  confirmSend: false,
  maxAlertsToPublish: 1,
  allowTelegram: false,
  maxRawSignalsToInspect: 50,
  maxFreshPullPerSource: 3,
  freshnessWindowHours: 72,
  excludeLowImpactReferenceUpdates: true,
};

const PUBLIC_DRY_RUN_EXAMPLE_BODY = {
  dryRun: true,
  confirmRun: false,
  confirmPublish: false,
  confirmSend: false,
  maxAlertsToPublish: 1,
  allowTelegram: false,
  maxRawSignalsToInspect: 50,
  maxFreshPullPerSource: 3,
  freshnessWindowHours: 72,
};

export async function GET() {
  return redactedJson({
    ok: false,
    route: "/api/internal/run-live-alert-cycle",
    methodRequired: "POST",
    message:
      "Use POST with a dry-run payload, or use the Stage 1 Dry Run button on /ops/engine-control.",
    engineControlUrl:
      "https://swing-up-production.up.railway.app/ops/engine-control",
    exampleBody: PUBLIC_DRY_RUN_EXAMPLE_BODY,
  });
}

function bool(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function int(value: unknown, fallback: number) {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseInt(value, 10)
        : Number.NaN;
  return Number.isFinite(parsed) ? Math.floor(parsed) : fallback;
}

function arrayText(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => String(item)).filter(Boolean)
    : [];
}

function payloadImpact(signal: Pick<RawSignal, "payload">) {
  const payload = obj(signal.payload);
  const impact = obj(payload.catalystImpact);
  return {
    catalystImpactScore:
      typeof impact.promotionScore === "number" ? impact.promotionScore : null,
    stockSpecificityScore:
      typeof impact.stockSpecificityScore === "number"
        ? impact.stockSpecificityScore
        : null,
    directTickerMatch:
      typeof impact.directTickerMatch === "boolean"
        ? impact.directTickerMatch
        : null,
    directCompanyMatch:
      typeof impact.directCompanyMatch === "boolean"
        ? impact.directCompanyMatch
        : null,
    hasReceiptUrl:
      typeof impact.hasReceiptUrl === "boolean" ? impact.hasReceiptUrl : null,
    freshWithin72h:
      typeof impact.freshWithin72h === "boolean" ? impact.freshWithin72h : null,
    promotionScore:
      typeof impact.promotionScore === "number" ? impact.promotionScore : null,
    likelyMarketImpact: text(impact.likelyMarketImpact) || null,
    catalystType: text(impact.catalystType) || null,
  };
}

function obj(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function isApproved(value: unknown) {
  const record = obj(value);
  return (
    record.approvalRecommendation === "approve" &&
    arrayText(record.failedChecks).length === 0
  );
}

const DISCOVERY_SOURCE_PRIORITY = [
  "FMP Catalyst",
  "Marketaux Catalyst",
  "Alpha Vantage Catalyst",
  "SEC EDGAR",
  "GDELT",
  "Google News RSS",
  "openFDA",
  "CoinGecko",
  "FRED Macro",
  "Frankfurter FX",
] as const;
type DiscoverySource = (typeof DISCOVERY_SOURCE_PRIORITY)[number];

function discoverySources(preferredSources: string[]) {
  const known = new Set<string>(DISCOVERY_SOURCE_PRIORITY);
  const preferred = preferredSources.filter((source) => known.has(source));
  return (
    preferred.length ? preferred : [...DISCOVERY_SOURCE_PRIORITY]
  ) as DiscoverySource[];
}

function sourceRank(
  source: string,
  sources = DISCOVERY_SOURCE_PRIORITY as readonly string[],
) {
  const index = sources.indexOf(source);
  return index === -1 ? sources.length + 1 : index;
}

function isLowImpactReferenceUpdate(
  signal: Pick<
    RawSignal,
    "source" | "importanceHint" | "title" | "summary" | "payload"
  >,
) {
  if (signal.source !== "Frankfurter FX") return false;
  const textBlob = `${signal.title} ${signal.summary}`.toLowerCase();
  const payload = obj(signal.payload);
  return (
    signal.importanceHint === "low" ||
    textBlob.includes("reference update") ||
    payload.usefulContext === "reference_update"
  );
}

async function latestUsefulRawSignals(
  limit: number,
  sources: string[],
  excludeLowImpactReferenceUpdates: boolean,
  freshnessWindowHours?: number,
) {
  const candidates = await prisma.rawSignal.findMany({
    where: {
      source: { in: sources },
      ...(freshnessWindowHours
        ? {
            receivedAt: {
              gte: new Date(Date.now() - freshnessWindowHours * 60 * 60 * 1000),
            },
          }
        : {}),
      OR: [
        { ticker: { not: null } },
        { sourceUrl: { not: null } },
        { importanceHint: { in: ["high", "urgent"] } },
        { processedStatus: { in: ["new", "queued", "promoted"] } },
      ],
    },
    orderBy: [{ receivedAt: "desc" }, { createdAt: "desc" }],
    take: Math.max(limit * 3, limit),
  });
  return candidates
    .filter(
      (signal) =>
        !excludeLowImpactReferenceUpdates ||
        !isLowImpactReferenceUpdate(signal),
    )
    .sort(
      (a, b) =>
        sourceRank(a.source, sources) - sourceRank(b.source, sources) ||
        b.receivedAt.getTime() - a.receivedAt.getTime() ||
        b.createdAt.getTime() - a.createdAt.getTime(),
    )
    .slice(0, limit);
}

async function jsonFromRoute(response: Response) {
  return (await response.json().catch(() => ({}))) as JsonRecord;
}

function baseResponse(input: {
  dryRun: boolean;
  readiness: unknown;
  warnings?: string[];
}) {
  return {
    ok: true,
    dryRun: input.dryRun,
    stage: "initialized",
    readiness: input.readiness,
    rawWarehouseAvailable: false,
    rawWarehouseWriteUnavailable: true,
    rawDataStored: false,
    storageMode: "postgresql_summary_only",
    reasonStorageFallback: "R2 write/delete health has not been checked yet.",
    rawWarehouseStatus: {},
    earRegistrySummary: earRegistrySummary(),
    sourceSummary: {},
    selectedRawSignalId: null as string | null,
    rawSignalSummary: {},
    candidateDiscoverySummary: {},
    pipelineStageCounts: {
      radar_item: 0,
      watch_candidate: 0,
      proof_needed: 0,
      ai_review_ready: 0,
      approval_ready: 0,
      publish_ready: 0,
      rejected_noise: 0,
    },
    watchQueueSummary: { eligibleCount: 0, candidates: [] },
    proofNeededCount: 0,
    aiReviewReadyCount: 0,
    rejectedNoiseCount: 0,
    broadRippleCandidates: [] as unknown[],
    proofRouterSummary: {},
    bestWatchCandidate: null as unknown,
    bestProofNeededCandidate: null as unknown,
    bestAIReviewReadyCandidate: null as unknown,
    nextBestSystemFix: null as string | null,
    greatSignalSummary: {},
    catalystSummary: {},
    proofEnrichmentSummary: {},
    candidateSummary: {},
    evidencePackSummary: {},
    aiCommitteeSummary: {},
    finalJudgeSummary: {},
    approvalGateSummary: {},
    publishLedgerSummary: {},
    genericNewsScanned: 0,
    seriousGenericSignalsFound: 0,
    rippleCandidatesCreated: 0,
    genericSignalsRejectedAsNoise: 0,
    topGenericSignal: null as unknown,
    affectedTickersFromGenericNews: [] as string[],
    deepChecksTriggeredByGenericNews: [] as unknown[],
    callsSavedByGenericTriage: 0,
    genericNewsDidNotBypassProofGate: true,
    seriousSignalsFound: 0,
    genericRippleCandidates: [] as unknown[],
    directCompanyCatalysts: [] as unknown[],
    opinionOnlyRejected: [] as unknown[],
    proofFillingAttempts: [] as unknown[],
    proofFilledBySource: {} as Record<string, unknown>,
    remainingProofGaps: [] as string[],
    bestSeriousCandidate: null as unknown,
    topRejectedButInterestingSignals: [] as unknown[],
    nextBestEarToImprove: null as string | null,
    recommendedDeepProofCalls: [] as unknown[],
    signalFound: false,
    aiCommitteeRan: false,
    approved: false,
    publishable: false,
    published: false,
    publicAlertUrl: null as string | null,
    publicLedgerUrl: null as string | null,
    sentToTelegram: false,
    blockers: [] as string[],
    warnings: input.warnings ?? [],
    nextRecommendedAction:
      "Run the live alert cycle only with explicit confirmations.",
  };
}

function stage1DateKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

async function saveStage1RawObject(
  output: JsonRecord,
  r2WriteAvailable: boolean,
  key: string,
  payload: unknown,
  metadata: Record<string, unknown>,
) {
  if (!r2WriteAvailable) return null;
  try {
    const row = await saveJsonToR2(key, payload, {
      ...metadata,
      source: String(metadata.source ?? "stage1"),
      assetType: String(metadata.assetType ?? "stage1"),
      dataType: String(metadata.dataType ?? "run-payload"),
    });
    output.rawDataStored = true;
    const existing = Array.isArray(output.r2ObjectKeys)
      ? output.r2ObjectKeys
      : Array.isArray(output.rawDataObjectKeys)
        ? output.rawDataObjectKeys
        : [];
    output.r2ObjectKeys = [...existing, row?.r2Key ?? key];
    output.rawDataObjectKeys = output.r2ObjectKeys;
    output.r2ObjectsWritten = (output.r2ObjectKeys as unknown[]).length;
    return row?.r2Key ?? key;
  } catch (error) {
    output.rawDataStored = false;
    output.storageMode = "postgresql_summary_only";
    output.rawWarehouseWriteUnavailable = true;
    output.reasonStorageFallback =
      "R2 raw object save failed; Stage 1 continued with PostgreSQL summary-only fallback.";
    output.rawStorageErrorCategory =
      error instanceof Error && /status (\d+)/i.test(error.message)
        ? `r2_save_http_${error.message.match(/status (\d+)/i)?.[1]}`
        : "r2_save_failed";
    return null;
  }
}

export async function POST(request: NextRequest) {
  const body: JsonRecord = {
    ...DEFAULT_PAYLOAD,
    ...((await request.json().catch(() => ({}))) as JsonRecord),
  };
  const dryRun = bool(body.dryRun, true);
  const confirmRun = bool(body.confirmRun, false);
  const confirmPublish = bool(body.confirmPublish, false);
  const confirmSend = bool(body.confirmSend, false);
  const allowTelegram = bool(body.allowTelegram, false);
  const maxAlertsToPublish = Math.min(
    Math.max(int(body.maxAlertsToPublish, 1), 0),
    1,
  );
  const rawSignalId = text(body.rawSignalId);
  let candidateAlertId = text(body.candidateAlertId);
  const source = text(body.source);
  const preferredSources = discoverySources(
    arrayText(body.preferredSources).length
      ? arrayText(body.preferredSources)
      : source
        ? [source]
        : [],
  );
  const maxRawSignalsToInspect = Math.min(
    Math.max(int(body.maxRawSignalsToInspect, 50), 1),
    100,
  );
  const maxFreshPullPerSource = Math.min(
    Math.max(int(body.maxFreshPullPerSource, 3), 1),
    3,
  );
  const freshnessWindowHours = Math.min(
    Math.max(int(body.freshnessWindowHours, 72), 1),
    24 * 14,
  );
  const excludeLowImpactReferenceUpdates = bool(
    body.excludeLowImpactReferenceUpdates,
    true,
  );
  const universeMode = text(body.universeMode) || "watchlist";
  const maxAssetsToPlan = Math.min(
    Math.max(int(body.maxAssetsToPlan, 1000), 1),
    10000,
  );
  const maxAssetsToScanNow = Math.min(
    Math.max(int(body.maxAssetsToScanNow, 50), 1),
    maxAssetsToPlan,
  );
  const maxDeepScans = Math.min(
    Math.max(int(body.maxDeepScans, 5), 0),
    maxAssetsToScanNow,
  );
  const warnings = [
    "Telegram is disabled for this founder website test; this route never sends Telegram.",
    ...(confirmSend || allowTelegram
      ? ["confirmSend/allowTelegram were ignored by this route."]
      : []),
  ];

  try {
    const [readiness, r2Health] = await Promise.all([
      getEngineStartReadiness(),
      getR2OperationalStatus({
        allowRuntimeWriteCheck: bool(body.allowRuntimeR2WriteCheck, false),
      }),
    ]);
    const r2WriteAvailable = r2Health.writeAvailable;
    const storageMode = r2Health.storageMode;
    const reasonStorageFallback = r2WriteAvailable
      ? null
      : r2Health.configured
        ? `R2 read health is ${r2Health.canRead ? "available" : "unavailable"}, but write/delete is unavailable; Stage 1 is continuing with PostgreSQL summaries and rawDataStored=false.`
        : `R2 is not fully configured (${r2Health.rawHealth.missingEnvVars.join(", ") || "missing configuration"}); Stage 1 is continuing with PostgreSQL summaries and rawDataStored=false.`;
    const globalSchedulerPlan = buildGlobalSchedulerPlan({
      dryRun,
      universeMode,
      maxAssetsToPlan,
      maxAssetsToScanNow,
      maxDeepScans,
      respectProviderLimits: true,
      confirmRun,
      r2RawStorageReady: r2WriteAvailable,
    });
    const genericTriage = await runGenericNewsTriage({
      maxGenericItemsToScan: Math.min(maxRawSignalsToInspect, 50),
      maxRippleCandidates: Math.min(maxDeepScans || 10, 10),
      maxDeepChecks: confirmRun ? maxDeepScans : 0,
      confirmRun,
      freshnessWindowHours,
    });
    const output = {
      ...baseResponse({ dryRun, readiness, warnings }),
      universeMode,
      assetsConsidered: globalSchedulerPlan.assetsConsidered,
      globalCoveragePercent: universeMode === "global" ? 100 : 0,
      sourcesConsideredPerAsset: globalSchedulerPlan.sourcesConsideredPerAsset,
      sourcesConsidered: globalSchedulerPlan.sourcesConsidered,
      wideScanCount: globalSchedulerPlan.wideScansPlanned,
      deepScanCount: globalSchedulerPlan.deepScansPlanned,
      meaningfulMetricsCalculated: MEANINGFUL_METRIC_REGISTRY.map(
        (metric) => metric.name,
      ),
      highestValueCallsUsed: confirmRun
        ? globalSchedulerPlan.highestValueNextCalls
        : [],
      genericNewsScanned: genericTriage.genericItemsScannedToday,
      seriousGenericSignalsFound: genericTriage.seriousGenericSignalsFound,
      rippleCandidatesCreated: genericTriage.rippleCandidatesCreated,
      genericSignalsRejectedAsNoise:
        genericTriage.genericSignalsRejectedAsNoise,
      broadGenericSignalsMapped: genericTriage.rippleCandidatesCreated,
      broadGenericSignalsRejectedAsNoise:
        genericTriage.genericSignalsRejectedAsNoise,
      topGenericSignal: genericTriage.topGenericSignal,
      affectedTickersFromGenericNews:
        genericTriage.affectedTickersFromGenericNews,
      deepChecksTriggeredByGenericNews:
        genericTriage.deepChecksTriggeredByGenericNews,
      callsSavedByGenericTriage: genericTriage.callsSavedByGenericTriage,
      genericNewsDidNotBypassProofGate: true,
      seriousSignalsFound: genericTriage.seriousGenericSignalsFound,
      genericRippleCandidates: Array.isArray(genericTriage.classifications)
        ? (genericTriage.classifications
            .filter((item) => obj(item).rippleCandidate === true)
            .slice(0, 10) as unknown[])
        : ([] as unknown[]),
      directCompanyCatalysts: [] as unknown[],
      opinionOnlyRejected: Array.isArray(genericTriage.classifications)
        ? (genericTriage.classifications
            .filter((item) =>
              text(obj(item).rejectedReason).includes("opinion"),
            )
            .slice(0, 10) as unknown[])
        : ([] as unknown[]),
      proofFillingAttempts: [] as unknown[],
      proofFilledBySource: {} as Record<string, unknown>,
      remainingProofGaps: [
        "at least 2 clean proof types beyond raw source",
        "clean direct ticker/company/topic match",
      ],
      bestSeriousCandidate: (genericTriage.topGenericSignal ?? null) as unknown,
      topRejectedButInterestingSignals: Array.isArray(
        genericTriage.classifications,
      )
        ? (genericTriage.classifications
            .filter(
              (item) =>
                obj(item).rippleCandidate !== true &&
                numericRank(obj(item).seriousnessScore as number | null) >= 55,
            )
            .slice(0, 5) as unknown[])
        : ([] as unknown[]),
      nextBestEarToImprove: null as string | null,
      recommendedDeepProofCalls:
        genericTriage.deepChecksTriggeredByGenericNews as unknown[],
      genericNewsTriageSummary: {
        enabled: genericTriage.enabled,
        broadSourcesUsed: genericTriage.broadSourcesUsed,
        topGenericSignalTypes: genericTriage.topGenericSignalTypes,
        topAffectedSectors: genericTriage.topAffectedSectors,
        topAffectedTickers: genericTriage.topAffectedTickers,
        exampleRejectedAsNoise: genericTriage.exampleRejectedAsNoise,
        examplePromotedIntoRippleCandidate:
          genericTriage.examplePromotedIntoRippleCandidate,
        noOpenAIWhenConfirmRunFalse: confirmRun !== true,
        noPublish: true,
        noTelegram: true,
      },
      callsSkippedToAvoidWaste: [
        `${genericTriage.callsSavedByGenericTriage} generic-news deep checks saved by triage`,
        "generic broad market articles",
        "ticker-only comparisons",
        "stale proof",
        "unrelated topics",
        "Alpha Vantage backup call skipped unless a proof gap remains",
      ],
      proofGapsRemaining: [
        "at least 2 clean proof types beyond raw source",
        "clean direct ticker/company/topic match",
      ],
      rawWarehouseAvailable: r2Health.connected || r2Health.canRead,
      rawWarehouseWriteUnavailable: !r2WriteAvailable,
      rawDataStored: false,
      storageMode,
      reasonStorageFallback,
      runId: crypto.randomUUID(),
      rawDataObjectKeys: [] as string[],
      r2ObjectsWritten: 0,
      r2ObjectKeys: [] as string[],
      rawWarehouseStatus: {
        configured: r2Health.configured,
        connected: r2Health.connected,
        bucket: r2Health.rawHealth.bucket,
        canRead: r2Health.canRead,
        canWrite: r2Health.canWrite,
        canDelete: r2Health.canDelete,
        writeAvailable: r2WriteAvailable,
        mode: storageMode,
        storageMode,
        lastConfirmedWriteAt: r2Health.lastConfirmedWriteAt,
        lastConfirmedDeleteAt: r2Health.lastConfirmedDeleteAt,
        sourceOfTruth: r2Health.sourceOfTruth,
        missingEnvVars: r2Health.rawHealth.missingEnvVars,
        errorCategory: r2Health.rawHealth.errorCategory,
        errorMessageSafe: r2Health.rawHealth.errorMessageSafe,
        suspectedCause: r2Health.rawHealth.suspectedCause,
        nextAction: r2Health.rawHealth.nextAction,
      },
    };
    if (!confirmRun && !dryRun) {
      return redactedJson({
        ...output,
        stage: "dry_run_confirm_required",
        blockers: dryRun ? [] : ["confirmRun_required"],
        nextRecommendedAction:
          "Set confirmRun=true only when you intend to inspect real source data. No OpenAI, publish, or Telegram actions ran.",
      });
    }
    if (!readiness.readyForFirstPublicAlert) {
      return redactedJson(
        {
          ...output,
          ok: false,
          stage: "readiness_blocked",
          blockers: readiness.blockers,
          nextRecommendedAction:
            readiness.exactNextFixes?.[0] ??
            "Resolve engine-start readiness blockers before running a live alert cycle.",
        },
        { status: 503 },
      );
    }
    if (!process.env.DATABASE_URL) {
      return redactedJson(
        {
          ...output,
          ok: false,
          stage: "database_blocked",
          blockers: ["database_not_configured"],
          nextRecommendedAction:
            "Configure DATABASE_URL before selecting a real raw signal.",
        },
        { status: 503 },
      );
    }

    const catalystSources = [
      "FMP Catalyst",
      "Marketaux Catalyst",
      "Alpha Vantage Catalyst",
    ];
    let sourceSummary: unknown = null;
    if (!rawSignalId) {
      const catalystToAttempt = catalystSources.filter((provider) =>
        provider === "FMP Catalyst"
          ? Boolean(process.env.FMP_API_KEY)
          : provider === "Marketaux Catalyst"
            ? Boolean(process.env.MARKETAUX_API_KEY)
            : Boolean(process.env.ALPHA_VANTAGE_API_KEY),
      );
      sourceSummary = catalystToAttempt.length
        ? await runSources({
            dryRun: false,
            sources: catalystToAttempt,
            limit: maxFreshPullPerSource,
            tickers: [
              "NVDA",
              "AAPL",
              "MSFT",
              "TSLA",
              "AMZN",
              "META",
              "GOOGL",
              "AMD",
              "SHOP",
              "PLTR",
            ],
            force: true,
          }).catch((error: unknown) => ({
            ok: false,
            error:
              error instanceof Error
                ? error.message
                : "catalyst_source_run_unavailable",
            table: [],
          }))
        : { ok: true, dryRun: false, sourcesRequested: [], table: [] };
    }
    let rawSignals: RawSignal[] = rawSignalId
      ? await prisma.rawSignal.findMany({ where: { id: rawSignalId }, take: 1 })
      : await latestUsefulRawSignals(
          maxRawSignalsToInspect,
          preferredSources,
          excludeLowImpactReferenceUpdates,
          freshnessWindowHours,
        );
    if (
      rawSignals.length < Math.min(3, maxRawSignalsToInspect) &&
      !rawSignalId
    ) {
      const fallbackSummary = await runSources({
        dryRun: false,
        sources: preferredSources
          .filter((source) => !catalystSources.includes(source))
          .slice(0, 4),
        limit: maxFreshPullPerSource,
        force: false,
      }).catch((error: unknown) => ({
        ok: false,
        error:
          error instanceof Error ? error.message : "source_run_unavailable",
        table: [],
      }));
      sourceSummary = {
        ...obj(sourceSummary),
        fallbackSummary,
        table: [
          ...(Array.isArray(obj(sourceSummary).table)
            ? (obj(sourceSummary).table as unknown[])
            : []),
          ...(Array.isArray(obj(fallbackSummary).table)
            ? (obj(fallbackSummary).table as unknown[])
            : []),
        ],
      };
      rawSignals = await latestUsefulRawSignals(
        maxRawSignalsToInspect,
        preferredSources,
        excludeLowImpactReferenceUpdates,
        freshnessWindowHours,
      );
    }
    const catalystRawSignals = rawSignals.filter((signal) =>
      catalystSources.includes(signal.source),
    );
    const catalystSummaryBase = {
      configuredProviders: catalystSources.filter((provider) =>
        provider === "FMP Catalyst"
          ? Boolean(process.env.FMP_API_KEY)
          : provider === "Marketaux Catalyst"
            ? Boolean(process.env.MARKETAUX_API_KEY)
            : Boolean(process.env.ALPHA_VANTAGE_API_KEY),
      ),
      attemptedProviders: Array.isArray(obj(sourceSummary).table)
        ? (obj(sourceSummary).table as unknown[])
            .map((row) => text(obj(row).sourceName))
            .filter((name) => catalystSources.includes(name))
        : [],
      catalystSignalsFound: catalystRawSignals.length,
      catalystSignalsSaved:
        typeof obj(sourceSummary).table === "object" &&
        Array.isArray(obj(sourceSummary).table)
          ? (obj(sourceSummary).table as unknown[])
              .filter((row) =>
                catalystSources.includes(text(obj(row).sourceName)),
              )
              .reduce(
                (sum: number, row) =>
                  sum +
                  (typeof obj(row).signalsCreated === "number"
                    ? (obj(row).signalsCreated as number)
                    : 0),
                0,
              )
          : 0,
      catalystSignalsInspected: 0,
      topCatalystCandidates: catalystRawSignals.slice(0, 5).map((signal) => ({
        id: signal.id,
        source: signal.source,
        ticker: signal.ticker,
        title: signal.title,
        receivedAt: signal.receivedAt.toISOString(),
        catalystImpact: payloadImpact(signal),
      })),
      missingCatalystKeys: [
        ["FMP_API_KEY", process.env.FMP_API_KEY],
        ["MARKETAUX_API_KEY", process.env.MARKETAUX_API_KEY],
        ["ALPHA_VANTAGE_API_KEY", process.env.ALPHA_VANTAGE_API_KEY],
      ]
        .filter(([, value]) => !value)
        .map(([key]) => key),
      degradedCatalystProviders: Array.isArray(obj(sourceSummary).table)
        ? (obj(sourceSummary).table as unknown[])
            .filter(
              (row) =>
                catalystSources.includes(text(obj(row).sourceName)) &&
                text(obj(row).status) === "degraded",
            )
            .map((row) => text(obj(row).sourceName))
        : [],
      failedCatalystProviders: Array.isArray(obj(sourceSummary).table)
        ? (obj(sourceSummary).table as unknown[])
            .filter(
              (row) =>
                catalystSources.includes(text(obj(row).sourceName)) &&
                text(obj(row).status) === "error",
            )
            .map((row) => text(obj(row).sourceName))
        : [],
      providerDiagnostics: Array.isArray(obj(sourceSummary).table)
        ? (obj(sourceSummary).table as unknown[])
            .filter((row) =>
              catalystSources.includes(text(obj(row).sourceName)),
            )
            .map((row) => ({
              source: text(obj(row).sourceName),
              status: text(obj(row).status),
              sourceHealthStatus: text(obj(row).sourceHealthStatus),
              errors: Array.isArray(obj(row).errors) ? obj(row).errors : [],
              diagnosis: text(obj(row).diagnosis) || null,
            }))
        : [],
    };
    const fmpBlocked = catalystSummaryBase.providerDiagnostics.some(
      (diagnostic) =>
        diagnostic.source === "FMP Catalyst" &&
        /403|plan_key_blocked|plan restricted|check fmp key/i.test(
          JSON.stringify(diagnostic),
        ),
    );
    const providerSkippedReasons = fmpBlocked
      ? {
          "FMP Catalyst":
            "plan_key_blocked; Check FMP key, account activation, or plan access.",
        }
      : {};
    output.catalystSummary = {
      ...catalystSummaryBase,
      fmpProvider403: fmpBlocked,
      providerSkippedReasons,
      nextAction: fmpBlocked
        ? "Check FMP key, account activation, or plan access."
        : null,
    };
    if (!rawSignals.length && !candidateAlertId) {
      const summary = {
        rawSignalsInspected: 0,
        sourcesInspected: preferredSources,
        passCount: 0,
        blockedCount: 0,
        bestCandidateRawSignalId: null,
        rankedCandidates: [],
        blockedReasonsBySignal: {},
        recommendedNextSource: preferredSources[0] ?? "SEC EDGAR",
        recommendedNextAction: catalystSummaryBase.attemptedProviders.length
          ? "No useful real raw signal was available after attempting configured catalyst providers. Check degraded/failed catalyst provider reasons, then try SEC EDGAR, GDELT, or Google News RSS; do not create a fake alert."
          : "No useful real raw signal was available because no catalyst providers were attempted. Check missing API keys/source runner configuration before trying SEC EDGAR; do not create a fake alert.",
      };
      return redactedJson({
        ...output,
        ok: true,
        stage: "no_signal",
        sourceSummary: sourceSummary ?? {},
        candidateDiscoverySummary: summary,
        signalFound: false,
        approved: false,
        published: false,
        blockers: [],
        stage2Unlocked: false,
        reasonStage2Locked: "No raw signal passed Stage 1 proof inspection.",
        proofGapsRemaining: ["No raw signal passed Stage 1 proof inspection."],
        finalRecommendation: "Continue testing",
        nextRecommendedAction: summary.recommendedNextAction,
      });
    }

    output.stage = "source_selected";
    output.sourceSummary = sourceSummary
      ? obj(sourceSummary)
      : { selectedSources: preferredSources };
    output.signalFound = Boolean(rawSignals.length || candidateAlertId);
    const runId = String(output.runId);
    const dateKey = stage1DateKey();
    if (sourceSummary) {
      const rows = Array.isArray(obj(sourceSummary).table)
        ? (obj(sourceSummary).table as unknown[])
        : [];
      await saveStage1RawObject(
        output,
        r2WriteAvailable,
        `raw/stage1/source-runs/${dateKey}/${runId}.json`,
        { sourceSummary },
        {
          source: "stage1",
          assetType: "stage1",
          dataType: "source-run",
          recordCount: rows.length,
        },
      );
    }
    await saveStage1RawObject(
      output,
      r2WriteAvailable,
      `raw/stage1/candidates/${dateKey}/${runId}.json`,
      {
        rawSignals: rawSignals.map((signal) => ({
          id: signal.id,
          source: signal.source,
          ticker: signal.ticker,
          title: signal.title,
          summary: signal.summary,
          sourceUrl: signal.sourceUrl,
          receivedAt: signal.receivedAt,
          payload: signal.payload,
        })),
      },
      {
        source: "stage1",
        assetType: "candidates",
        dataType: "candidate-raw-signals",
        recordCount: rawSignals.length,
      },
    );

    await saveStage1RawObject(
      output,
      r2WriteAvailable,
      `raw/stage1/generic-ripple/${dateKey}/${runId}.json`,
      {
        genericTriage,
        genericRippleCandidates: output.genericRippleCandidates,
      },
      {
        source: "stage1",
        assetType: "generic-ripple",
        dataType: "generic-ripple",
        recordCount: Array.isArray(output.genericRippleCandidates)
          ? output.genericRippleCandidates.length
          : 0,
      },
    );
    await saveStage1RawObject(
      output,
      r2WriteAvailable,
      `raw/stage1/great-signal-scorecards/${dateKey}/${runId}.json`,
      { greatSignalSummary: output.greatSignalSummary ?? null, scorecards: [] },
      {
        source: "stage1",
        assetType: "scorecards",
        dataType: "great-signal-scorecards",
        recordCount: 0,
      },
    );

    if (!candidateAlertId && rawSignals.length) {
      const discoveryRows: DiscoveryRow[] = [];
      const blockedReasonsBySignal: Record<string, string[]> = {};
      const enrichedProofsBySignal: Record<string, unknown[]> = {};
      const enrichmentSummaries = [] as JsonRecord[];
      for (const signal of rawSignals) {
        const beforeResponse = await candidateFactoryPOST(
          new NextRequest(
            "http://internal/api/internal/candidate-factory-run",
            {
              method: "POST",
              body: JSON.stringify({
                dryRun: true,
                rawSignalId: signal.id,
                limit: 1,
                requireProof: true,
              }),
            },
          ),
        );
        const beforeJson = await jsonFromRoute(beforeResponse);
        const beforeProof = obj(
          (Array.isArray(beforeJson.proofSummary)
            ? beforeJson.proofSummary
            : [])[0],
        );
        let enrichment = await enrichProofForRawSignal(signal);
        const routed = await attachRoutedProofForSignal(signal, enrichment);
        enrichment = routed.enrichment;
        enrichedProofsBySignal[signal.id] = enrichment.enrichmentProofs;
        enrichmentSummaries.push({
          rawSignalId: signal.id,
          proofAddedCount: enrichment.enrichmentProofs.length,
          proofAddedTypes: enrichment.enrichmentProofs.map(
            (proof) => proof.type,
          ),
          receiptsAdded: enrichment.enrichmentProofs.map(
            (proof) => proof.source,
          ),
          urlsAdded: enrichment.enrichmentProofs
            .map((proof) => proof.url)
            .filter(Boolean),
          stillMissingProof: enrichment.missingProof,
          safeToPromote: enrichment.safeToPromote,
          acceptedProofItems: enrichment.acceptedProofItems,
          rejectedProofItems: enrichment.rejectedProofItems,
          rejectedProofReasons: enrichment.rejectedProofReasons,
          proofMatchScore: enrichment.acceptedProofItems.length
            ? Math.max(
                ...enrichment.acceptedProofItems.map(
                  (item) => item.proofMatchScore,
                ),
              )
            : 0,
          strongestProof: enrichment.strongestProof,
          warnings: enrichment.enrichmentWarnings,
          errors: enrichment.enrichmentErrors,
          attempts: enrichment.enrichmentAttempts,
          routerFailureReasons: routed.routerFailureReasons,
        });
        const candidateResponse = await candidateFactoryPOST(
          new NextRequest(
            "http://internal/api/internal/candidate-factory-run",
            {
              method: "POST",
              body: JSON.stringify({
                dryRun: true,
                rawSignalId: signal.id,
                limit: 1,
                requireProof: true,
                extraProofsBySignal: {
                  [signal.id]: enrichment.enrichmentProofs,
                },
              }),
            },
          ),
        );
        const candidateJson = await jsonFromRoute(candidateResponse);
        const blocked = obj(candidateJson.blockedReasons)[signal.id];
        const reasons = arrayText(blocked);
        if (reasons.length) blockedReasonsBySignal[signal.id] = reasons;
        const scores = Array.isArray(candidateJson.scoreSummary)
          ? candidateJson.scoreSummary
          : [];
        const score = obj(scores[0]);
        const impact = payloadImpact(signal);
        const greatSignalScorecard = buildGreatSignalScorecard({
          signal,
          blockedReasons: reasons,
          enrichment,
          impact,
        });
        const broad = broadRippleMetadata(
          signal,
          greatSignalScorecard.signalType,
        );
        const pipeline = pipelineDecision({
          scorecard: greatSignalScorecard,
          signalType: greatSignalScorecard.signalType,
          passed: reasons.length === 0,
          unsafeProofMismatchWarning:
            enrichment.rejectedProofItems.length > 0 &&
            enrichment.acceptedProofItems.length === 0,
          broad,
          confirmRun,
        });
        const watchQueue = watchQueueFields(
          pipeline.pipelineStage,
          greatSignalScorecard.finalGreatSignalScore,
          greatSignalScorecard.proofStillMissingAfterRouter,
        );
        discoveryRows.push({
          rawSignalId: signal.id,
          ticker: signal.ticker,
          source: signal.source,
          title: signal.title,
          receivedAt: signal.receivedAt.toISOString(),
          passed: reasons.length === 0,
          blockedReasons: reasons,
          qualityScore:
            typeof score.qualityScore === "number" ? score.qualityScore : 0,
          evidenceConfidenceScore:
            typeof score.evidenceConfidenceScore === "number"
              ? score.evidenceConfidenceScore
              : 0,
          suggestedAction: text(score.suggestedAction) || null,
          beforeProofCount:
            typeof beforeProof.proofCount === "number"
              ? beforeProof.proofCount
              : 0,
          afterProofCount: enrichment.proofCount,
          beforeConfidenceScore:
            typeof beforeProof.confidenceScore === "number"
              ? beforeProof.confidenceScore
              : 0,
          afterConfidenceScore: enrichment.confidenceScore,
          passedAfterEnrichment: reasons.length === 0,
          proofAddedTypes: enrichment.enrichmentProofs.map(
            (proof) => proof.type,
          ),
          stillMissingProof: enrichment.missingProof,
          catalystImpactScore: impact.catalystImpactScore,
          stockSpecificityScore: impact.stockSpecificityScore,
          directTickerMatch: impact.directTickerMatch,
          directCompanyMatch: impact.directCompanyMatch,
          hasReceiptUrl: impact.hasReceiptUrl,
          freshWithin72h: impact.freshWithin72h,
          promotionScore: impact.promotionScore,
          bestFailureReason: reasons[0] ?? null,
          unsafeProofMismatchWarning:
            enrichment.rejectedProofItems.length > 0 &&
            enrichment.acceptedProofItems.length === 0,
          proofMatchQuality: enrichment.acceptedProofItems.length
            ? Math.max(
                ...enrichment.acceptedProofItems.map(
                  (item) => item.proofMatchScore,
                ),
              )
            : 0,
          proofDiversity: new Set(
            enrichment.proofTypes.filter(
              (type) =>
                type !== "raw_signal_source" && type !== "source_health",
            ),
          ).size,
          eligibleForBest: false,
          reasonNotPromoted: null,
          sevenLayerEvidence: scoreSevenLayerEvidence({
            source: signal.source,
            title: signal.title,
            summary: signal.summary,
            proofTypes: enrichment.proofTypes,
            promotionScore: impact.promotionScore,
          }),
          greatSignalScorecard,
          finalGreatSignalScore: greatSignalScorecard.finalGreatSignalScore,
          signalGrade: greatSignalScorecard.signalGrade,
          stageRecommendation: greatSignalScorecard.stageRecommendation,
          signalType: greatSignalScorecard.signalType,
          signalPlaybook: greatSignalScorecard.signalPlaybook,
          ...pipeline,
          ...broad,
          ...watchQueue,
          whyItCouldBeGreat: greatSignalScorecard.whyItCouldBeGreat,
          whyItIsBlocked: greatSignalScorecard.whyItIsBlocked,
          nextBestProofToFetch: greatSignalScorecard.nextBestProofToFetch,
          relevantProofTypes: greatSignalScorecard.relevantProofTypes,
          irrelevantProofTypes: greatSignalScorecard.irrelevantProofTypes,
          requiredProofTypesForThisCandidate:
            greatSignalScorecard.requiredProofTypesForThisCandidate,
          optionalProofTypesForThisCandidate:
            greatSignalScorecard.optionalProofTypesForThisCandidate,
          missingRequiredProof: greatSignalScorecard.missingRequiredProof,
          missingOptionalProof: greatSignalScorecard.missingOptionalProof,
          uniqueProofTypesClean: greatSignalScorecard.uniqueProofTypesClean,
          uniqueIndependentSourcesClean:
            greatSignalScorecard.uniqueIndependentSourcesClean,
          duplicateProofRejected: greatSignalScorecard.duplicateProofRejected,
          weakContextOnlyProof: greatSignalScorecard.weakContextOnlyProof,
          proofDiversityClean: greatSignalScorecard.proofDiversityClean,
          proofRouterAttempted: greatSignalScorecard.proofRouterAttempted,
          proofRouterCalls: greatSignalScorecard.proofRouterCalls,
          proofAttachedByType: greatSignalScorecard.proofAttachedByType,
          proofUnavailableByType: greatSignalScorecard.proofUnavailableByType,
          proofStillMissingAfterRouter:
            greatSignalScorecard.proofStillMissingAfterRouter,
          nextBestProofToFetchAfterRouter:
            greatSignalScorecard.nextBestProofToFetchAfterRouter,
          routerFailureReasons: routed.routerFailureReasons,
          cleanNewsReceiptAttached: enrichment.cleanNewsReceiptAttached,
          cleanNewsReceiptReason: enrichment.cleanNewsReceiptReason,
          rejectedNewsReceiptReason: enrichment.rejectedNewsReceiptReason,
          aiReviewEligible:
            pipeline.pipelineStage === "ai_review_ready" &&
            greatSignalScorecard.missingRequiredProof.length === 0 &&
            greatSignalScorecard.proofDiversityClean >= 2 &&
            !pipeline.blockedFromNextStageBecause.some((reason) =>
              /opinion|calendar|unsafe/i.test(reason),
            ),
          aiCommitteeCalled: false,
        });
      }
      for (const row of discoveryRows) {
        const failures = bestEligibilityFailure(row);
        row.eligibleForBest =
          (row.signalType === "broad_macro_or_sector_ripple"
            ? failures.filter(
                (failure) =>
                  failure !== "direct_ticker_match_required" &&
                  failure !== "broad_market_or_news_noise",
              ).length === 0
            : failures.length === 0) &&
          row.pipelineStage === "ai_review_ready" &&
          row.missingRequiredProof.length === 0 &&
          row.proofDiversityClean >= 2 &&
          row.signalType !== "opinion_or_noise" &&
          row.signalType !== "calendar_only_event" &&
          !(
            row.signalType === "broad_macro_or_sector_ripple" &&
            !row.promotedToRippleCandidate
          );
        const layerFailures = row.sevenLayerEvidence.reasonNotPromoted
          ? [row.sevenLayerEvidence.reasonNotPromoted]
          : [];
        row.reasonNotPromoted =
          failures.length || layerFailures.length
            ? [...failures, ...layerFailures].join("; ")
            : null;
      }
      const rankedCandidates = sortDiscoveryRows(discoveryRows);
      const topDirectCandidates = rankedCandidates
        .filter((row) => row.directTickerMatch === true)
        .slice(0, 5);
      const best = rankedCandidates.find((row) => row.eligibleForBest === true);
      const bestDirectTickerCandidate = topDirectCandidates[0] ?? null;
      const bestFailed =
        bestDirectTickerCandidate ?? rankedCandidates[0] ?? null;
      const recommendedNextSource = String(
        rankedCandidates.find((row) => row.passed !== true)?.source ??
          preferredSources[0] ??
          "SEC EDGAR",
      );
      const gradeCounts = rankedCandidates.reduce<Record<SignalGrade, number>>(
        (acc, row) => {
          acc[row.signalGrade] += 1;
          return acc;
        },
        { A: 0, B: 0, C: 0, D: 0, F: 0 },
      );
      const pipelineStageCounts = rankedCandidates.reduce<
        Record<PipelineStage, number>
      >(
        (acc, row) => {
          acc[row.pipelineStage] = (acc[row.pipelineStage] ?? 0) + 1;
          return acc;
        },
        {
          radar_item: 0,
          watch_candidate: 0,
          proof_needed: 0,
          ai_review_ready: 0,
          approval_ready: 0,
          publish_ready: 0,
          rejected_noise: 0,
        },
      );
      const watchQueueCandidates = rankedCandidates.filter(
        (row) => row.watchQueueEligible,
      );
      const aiReviewReadyCandidates = rankedCandidates.filter(
        (row) =>
          row.pipelineStage === "ai_review_ready" &&
          row.missingRequiredProof.length === 0 &&
          row.proofDiversityClean >= 2 &&
          row.unsafeProofMismatchWarning !== true &&
          row.signalType !== "opinion_or_noise" &&
          row.signalType !== "calendar_only_event" &&
          !(
            row.signalType === "broad_macro_or_sector_ripple" &&
            !row.promotedToRippleCandidate
          ),
      );
      const proofNeededCandidates = rankedCandidates.filter(
        (row) => row.pipelineStage === "proof_needed",
      );
      const broadRippleCandidates = rankedCandidates.filter(
        (row) =>
          row.signalType === "broad_macro_or_sector_ripple" &&
          row.promotedToRippleCandidate,
      );
      const missingProofCounts = rankedCandidates
        .flatMap((row) => row.missingRequiredProof)
        .filter((type) => VALID_CANDIDATE_PROOF_TYPES.has(type))
        .reduce<Record<string, number>>((acc, type) => {
          acc[type] = (acc[type] ?? 0) + 1;
          return acc;
        }, {});
      const mostCommonMissingProof =
        Object.entries(missingProofCounts).sort(
          (a, b) => b[1] - a[1],
        )[0]?.[0] ?? null;
      const bestGreatSignalCandidate =
        rankedCandidates.find((row) => row.signalGrade === "A") ??
        rankedCandidates.find((row) => row.signalGrade === "B") ??
        null;
      const bestWatchOnlyCandidate =
        rankedCandidates.find((row) => row.signalGrade === "C") ??
        rankedCandidates.find((row) => row.signalGrade === "D") ??
        null;
      const greatSignalSummary = {
        candidatesScored: rankedCandidates.length,
        pipelineStageCounts,
        proofNeededCount: proofNeededCandidates.length,
        aiReviewReadyCount: aiReviewReadyCandidates.length,
        aiReviewEligibleCount: rankedCandidates.filter(
          (row) => row.aiReviewEligible,
        ).length,
        proofNeededToAIReviewEligibleCount: rankedCandidates.filter(
          (row) =>
            row.aiReviewEligible && row.stageRecommendation === "proof_needed",
        ).length,
        rejectedNoiseCount: pipelineStageCounts.rejected_noise,
        broadRippleCandidates: broadRippleCandidates.slice(0, 10),
        broadRippleCandidatesCreated: broadRippleCandidates.length,
        broadRippleRejectedAsNoise: rankedCandidates.filter(
          (row) =>
            row.signalType === "broad_macro_or_sector_ripple" &&
            !row.promotedToRippleCandidate,
        ).length,
        watchQueueSummary: {
          eligibleCount: watchQueueCandidates.length,
          highPriorityCount: watchQueueCandidates.filter(
            (row) => row.watchPriority === "high",
          ).length,
          nextRecheck:
            watchQueueCandidates
              .map((row) => row.recheckAfter)
              .filter(Boolean)
              .sort()[0] ?? null,
          candidates: watchQueueCandidates.slice(0, 10),
        },
        gradeCounts,
        bestGreatSignalCandidate,
        bestWatchOnlyCandidate,
        rejectedAsNoiseCount: rankedCandidates.filter((row) =>
          row.whyItIsBlocked.some((reason) => /noise|generic/i.test(reason)),
        ).length,
        blockedByMissingProofCount: rankedCandidates.filter((row) =>
          row.whyItIsBlocked.some((reason) =>
            /Missing proof|two clean proof/i.test(reason),
          ),
        ).length,
        blockedByUnsafeProofCount: rankedCandidates.filter(
          (row) => row.unsafeProofMismatchWarning,
        ).length,
        mostCommonMissingRequiredProof: mostCommonMissingProof,
        mostCommonMissingProof,
        proofDiversityClean: rankedCandidates.map((row) => ({
          rawSignalId: row.rawSignalId,
          proofDiversityClean: row.proofDiversityClean,
          uniqueProofTypesClean: row.uniqueProofTypesClean,
        })),
        duplicateProofRejected: rankedCandidates.flatMap(
          (row) => row.duplicateProofRejected,
        ),
        nextBestSystemFix: mostCommonMissingProof
          ? `Improve ${mostCommonMissingProof} proof fetching for top direct ticker candidates.`
          : "Keep proof gates strict and expand clean proof coverage only when specific URLs exist.",
        bestWatchCandidate: watchQueueCandidates[0] ?? null,
        bestProofNeededCandidate: proofNeededCandidates[0] ?? null,
        bestAIReviewReadyCandidate: aiReviewReadyCandidates[0] ?? null,
        bestAIReviewEligibleCandidate:
          rankedCandidates.find((row) => row.aiReviewEligible) ?? null,
      };
      const proofCompletionSummary = {
        attemptedCandidates: topDirectCandidates.map((row) => row.rawSignalId),
        priceVolumeAttempted: topDirectCandidates
          .filter((row) =>
            arrayIncludes(row.missingRequiredProof, "price_volume"),
          )
          .map((row) => row.rawSignalId),
        fundamentalsAttempted: topDirectCandidates
          .filter((row) =>
            arrayIncludes(row.missingRequiredProof, "fundamentals"),
          )
          .map((row) => row.rawSignalId),
        patternMatchAttempted: topDirectCandidates
          .filter((row) =>
            arrayIncludes(row.missingRequiredProof, "pattern_match"),
          )
          .map((row) => row.rawSignalId),
        proofAdded: topDirectCandidates.flatMap((row) =>
          row.proofAddedTypes.map((type) => ({
            rawSignalId: row.rawSignalId,
            type,
          })),
        ),
        proofStillMissing: Object.fromEntries(
          topDirectCandidates.map((row) => [
            row.rawSignalId,
            row.missingRequiredProof,
          ]),
        ),
        proofRouterAttempted: topDirectCandidates.some(
          (row) => row.proofRouterAttempted,
        ),
        proofRouterCalls: topDirectCandidates.flatMap(
          (row) => row.proofRouterCalls,
        ),
        priceVolumeProofAttachedCount: topDirectCandidates.reduce(
          (total, row) =>
            total + Number(row.proofAttachedByType.price_volume ?? 0),
          0,
        ),
        fundamentalsProofAttachedCount: rankedCandidates.reduce(
          (total, row) =>
            total + Number(row.proofAttachedByType.fundamentals ?? 0),
          0,
        ),
        cleanNewsReceiptAttachedCount: rankedCandidates.filter(
          (row) => row.cleanNewsReceiptAttached,
        ).length,
        priceVolumeProofExamples: topDirectCandidates
          .flatMap((row) => row.priceVolumeProofExamples ?? [])
          .slice(0, 5),
        fundamentalsProofExamples: topDirectCandidates
          .flatMap((row) => row.fundamentalsProofExamples ?? [])
          .slice(0, 5),
        fmpProofUnavailableReason:
          topDirectCandidates.find((row) => row.fmpProofUnavailableReason)
            ?.fmpProofUnavailableReason ?? null,
        priceVolumeUnavailableReason:
          topDirectCandidates.find((row) => row.priceVolumeUnavailableReason)
            ?.priceVolumeUnavailableReason ?? null,
        proofRouterSuccessCount: topDirectCandidates.reduce(
          (total, row) =>
            total +
            Object.values(row.proofAttachedByType).reduce(
              (sum, count) => sum + Number(count),
              0,
            ),
          0,
        ),
        proofRouterFailureReasons: Array.from(
          new Set(
            topDirectCandidates.flatMap(
              (row) => row.routerFailureReasons ?? [],
            ),
          ),
        ),
        proofAttachedByType: topDirectCandidates.reduce<Record<string, number>>(
          (acc, row) => {
            for (const [type, count] of Object.entries(row.proofAttachedByType))
              acc[type] = (acc[type] ?? 0) + Number(count);
            return acc;
          },
          {},
        ),
        proofUnavailableByType: Object.assign(
          {},
          ...topDirectCandidates.map((row) => row.proofUnavailableByType),
        ),
        proofStillMissingAfterRouter: Object.fromEntries(
          topDirectCandidates.map((row) => [
            row.rawSignalId,
            row.proofStillMissingAfterRouter,
          ]),
        ),
        nextBestProofToFetchAfterRouter:
          topDirectCandidates[0]?.nextBestProofToFetchAfterRouter ??
          (mostCommonMissingProof
            ? nextBestProof([mostCommonMissingProof])
            : "none"),
        nextBestProofToFetchAfterRouterAll: Array.from(
          new Set(
            topDirectCandidates
              .map((row) => row.nextBestProofToFetchAfterRouter)
              .filter((value) => value !== "none"),
          ),
        ),
        providerSkippedReasons,
      };
      const proofEnrichmentSummary = {
        attempted: true,
        signalsEnriched: enrichmentSummaries.filter(
          (item) => Number(item.proofAddedCount ?? 0) > 0,
        ).length,
        proofAddedCount: enrichmentSummaries.reduce(
          (total, item) => total + Number(item.proofAddedCount ?? 0),
          0,
        ),
        receiptsAdded: enrichmentSummaries.flatMap((item) =>
          Array.isArray(item.receiptsAdded) ? item.receiptsAdded : [],
        ),
        urlsAdded: enrichmentSummaries.flatMap((item) =>
          Array.isArray(item.urlsAdded) ? item.urlsAdded : [],
        ),
        stillMissingProof: Array.from(
          new Set(
            enrichmentSummaries.flatMap((item) =>
              Array.isArray(item.stillMissingProof)
                ? item.stillMissingProof.map(String)
                : [],
            ),
          ),
        ),
        bestProofBundle:
          enrichmentSummaries.find(
            (item) => item.rawSignalId === best?.rawSignalId,
          ) ??
          enrichmentSummaries[0] ??
          null,
        acceptedProofItems: enrichmentSummaries.flatMap((item) =>
          Array.isArray(item.acceptedProofItems) ? item.acceptedProofItems : [],
        ),
        rejectedProofItems: enrichmentSummaries.flatMap((item) =>
          Array.isArray(item.rejectedProofItems) ? item.rejectedProofItems : [],
        ),
        rejectedProofReasons: Array.from(
          new Set(
            enrichmentSummaries.flatMap((item) =>
              Array.isArray(item.rejectedProofReasons)
                ? item.rejectedProofReasons.map(String)
                : [],
            ),
          ),
        ),
        proofMatchScore: enrichmentSummaries.reduce(
          (max, item) =>
            Math.max(
              max,
              typeof item.proofMatchScore === "number"
                ? item.proofMatchScore
                : 0,
            ),
          0,
        ),
        proofMatchingClean: !enrichmentSummaries.some(
          (item) =>
            Array.isArray(item.rejectedProofItems) &&
            item.rejectedProofItems.length > 0 &&
            (!Array.isArray(item.acceptedProofItems) ||
              item.acceptedProofItems.length === 0),
        ),
        enrichmentBlockedReasons: blockedReasonsBySignal,
        proofCompletionSummary,
      };
      output.proofEnrichmentSummary = proofEnrichmentSummary;
      output.proofFillingAttempts = enrichmentSummaries.map((item) => ({
        rawSignalId: item.rawSignalId,
        attempts: item.attempts,
        proofAddedTypes: item.proofAddedTypes,
        stillMissingProof: item.stillMissingProof,
      }));
      output.proofFilledBySource = enrichmentSummaries.reduce<
        Record<string, unknown>
      >((acc, item) => {
        const key = String(item.rawSignalId ?? "unknown");
        acc[key] = {
          receiptsAdded: item.receiptsAdded,
          urlsAdded: item.urlsAdded,
          proofAddedCount: item.proofAddedCount,
        };
        return acc;
      }, {});
      output.remainingProofGaps = proofEnrichmentSummary.stillMissingProof;
      await saveStage1RawObject(
        output,
        r2WriteAvailable,
        `raw/stage1/proof-enrichment/${stage1DateKey()}/${String(output.runId)}.json`,
        { proofEnrichmentSummary, enrichmentSummaries },
        {
          source: "stage1",
          assetType: "proof",
          dataType: "proof-enrichment",
          recordCount: enrichmentSummaries.length,
        },
      );
      const summary = {
        rawSignalsInspected: discoveryRows.length,
        sourcesInspected: Array.from(
          new Set([
            ...(catalystSummaryBase.attemptedProviders as string[]),
            ...discoveryRows.map((row) => row.source),
          ]),
        ),
        catalystSignalsFound: catalystSummaryBase.catalystSignalsFound,
        catalystSignalsInspected: discoveryRows.filter((row) =>
          catalystSources.includes(row.source),
        ).length,
        topCatalystCandidates: discoveryRows
          .filter((row) => catalystSources.includes(row.source))
          .slice(0, 5),
        passCount: rankedCandidates.filter((row) => row.passed).length,
        blockedCount: rankedCandidates.filter((row) => !row.passed).length,
        bestCandidateRawSignalId: best?.rawSignalId ?? null,
        bestDirectTickerCandidate: bestDirectTickerCandidate
          ? {
              rawSignalId: bestDirectTickerCandidate.rawSignalId,
              ticker: bestDirectTickerCandidate.ticker,
              title: bestDirectTickerCandidate.title,
              source: bestDirectTickerCandidate.source,
              promotionScore: bestDirectTickerCandidate.promotionScore,
              catalystImpactScore:
                bestDirectTickerCandidate.catalystImpactScore,
              stockSpecificityScore:
                bestDirectTickerCandidate.stockSpecificityScore,
              proofTypesFound: bestDirectTickerCandidate.proofAddedTypes,
              proofTypesMissing: bestDirectTickerCandidate.missingRequiredProof,
              reasonNotPromoted: bestDirectTickerCandidate.reasonNotPromoted,
              layersSupportingCandidate:
                bestDirectTickerCandidate.sevenLayerEvidence
                  .layersSupportingCandidate,
              layersMissing:
                bestDirectTickerCandidate.sevenLayerEvidence.layersMissing,
              strongestLayer:
                bestDirectTickerCandidate.sevenLayerEvidence.strongestLayer,
              weakestLayer:
                bestDirectTickerCandidate.sevenLayerEvidence.weakestLayer,
              earlySignalPossible:
                bestDirectTickerCandidate.sevenLayerEvidence
                  .earlySignalPossible,
              marketReactionStatus:
                bestDirectTickerCandidate.sevenLayerEvidence
                  .marketReactionStatus,
            }
          : null,
        proofCompletionSummary,
        greatSignalSummary,
        rankedCandidates,
        blockedReasonsBySignal,
        recommendedNextSource,
        bestCandidateFailureReason: bestFailed
          ? `${bestFailed.title}: ${(bestFailed.blockedReasons.length ? bestFailed.blockedReasons : [bestFailed.bestFailureReason ?? "missing_matching_independent_proof"]).join("; ")}`
          : null,
        sevenLayerEvidenceModel: {
          marketReactionRule: "bonus_only_never_required",
          bestEarlySignalCandidate:
            (best ?? bestDirectTickerCandidate ?? rankedCandidates[0] ?? null)
              ?.sevenLayerEvidence ?? null,
        },
        recommendedNextAction: best
          ? "Stage 1 found a candidate strong enough for Stage 2 AI review. Re-run with dryRun=false and confirmRun=true to create/review exactly one candidate."
          : bestFailed
            ? `No inspected signal passed safety gates. Best candidate "${bestFailed.title}" failed because ${(bestFailed.blockedReasons.length ? bestFailed.blockedReasons : ["matching proof is still required"]).join("; ")}. Missing: ${(bestFailed.missingRequiredProof.length ? bestFailed.missingRequiredProof : ["at least 2 independent matching proof types, a specific receipt URL, price/volume or fundamentals/pattern confirmation"]).join(", ")}. Use ${recommendedNextSource} next; FMP plan/key block ${catalystSummaryBase.failedCatalystProviders.includes("FMP Catalyst") ? "may be blocking useful FMP proof but must not be retried in this run" : "is not the active blocker"}. Marketaux/Alpha data is useful only when ticker/company/topic-specific proof matches.`
            : `No inspected signal passed safety gates and catalyst providers were not attempted. Fix catalyst provider execution before trying ${recommendedNextSource}.`,
      };
      output.catalystSummary = {
        ...catalystSummaryBase,
        fmpProvider403: fmpBlocked,
        providerSkippedReasons,
        nextAction: fmpBlocked
          ? "Check FMP key, account activation, or plan access."
          : null,
        catalystSignalsInspected: discoveryRows.filter((row) =>
          catalystSources.includes(row.source),
        ).length,
        topCatalystCandidates: discoveryRows
          .filter((row) => catalystSources.includes(row.source))
          .slice(0, 5),
      };
      output.greatSignalSummary = greatSignalSummary;
      Object.assign(output, {
        pipelineStageCounts,
        watchQueueSummary: greatSignalSummary.watchQueueSummary,
        proofNeededCount: proofNeededCandidates.length,
        aiReviewReadyCount: aiReviewReadyCandidates.length,
        aiReviewEligibleCount: rankedCandidates.filter(
          (row) => row.aiReviewEligible,
        ).length,
        proofNeededToAIReviewEligibleCount: rankedCandidates.filter(
          (row) =>
            row.aiReviewEligible && row.stageRecommendation === "proof_needed",
        ).length,
        rejectedNoiseCount: pipelineStageCounts.rejected_noise,
        broadRippleCandidates: broadRippleCandidates.slice(0, 10),
        broadRippleCandidatesCreated: broadRippleCandidates.length,
        broadRippleRejectedAsNoise: rankedCandidates.filter(
          (row) =>
            row.signalType === "broad_macro_or_sector_ripple" &&
            !row.promotedToRippleCandidate,
        ).length,
        proofRouterSummary: proofCompletionSummary,
        bestWatchCandidate: greatSignalSummary.bestWatchCandidate,
        bestProofNeededCandidate: greatSignalSummary.bestProofNeededCandidate,
        bestAIReviewReadyCandidate:
          greatSignalSummary.bestAIReviewReadyCandidate,
        bestAIReviewEligibleCandidate:
          greatSignalSummary.bestAIReviewEligibleCandidate,
        cleanNewsReceiptAttachedCount:
          proofCompletionSummary.cleanNewsReceiptAttachedCount,
        nextBestSystemFix: greatSignalSummary.nextBestSystemFix,
      });
      output.candidateDiscoverySummary = summary;
      output.directCompanyCatalysts = rankedCandidates
        .filter(
          (row) =>
            row.directTickerMatch === true || row.directCompanyMatch === true,
        )
        .slice(0, 10) as unknown[];
      output.bestSeriousCandidate = (best ??
        bestDirectTickerCandidate ??
        obj(output.bestSeriousCandidate)) as unknown;
      output.topRejectedButInterestingSignals = rankedCandidates
        .filter((row) => row.eligibleForBest !== true)
        .slice(0, 5) as unknown[];
      output.nextBestEarToImprove = recommendedNextSource;
      output.recommendedDeepProofCalls = [
        ...((Array.isArray(output.recommendedDeepProofCalls)
          ? output.recommendedDeepProofCalls
          : []) as unknown[]),
        ...topDirectCandidates.flatMap((row) =>
          row.missingRequiredProof.map((proofType) => ({
            rawSignalId: row.rawSignalId,
            proofType,
            source: recommendedNextSource,
          })),
        ),
      ] as unknown[];
      const rawSignal = best
        ? (rawSignals.find((signal) => signal.id === best.rawSignalId) ?? null)
        : bestFailed
          ? (rawSignals.find(
              (signal) => signal.id === bestFailed.rawSignalId,
            ) ?? null)
          : (rawSignals[0] ?? null);
      output.selectedRawSignalId = rawSignal?.id ?? null;
      output.rawSignalSummary = rawSignal
        ? {
            id: rawSignal.id,
            source: rawSignal.source,
            ticker: rawSignal.ticker,
            title: rawSignal.title,
            receivedAt: rawSignal.receivedAt,
          }
        : {};
      if (!best)
        return redactedJson({
          ...output,
          stage: "no_publish",
          approved: false,
          publishable: false,
          published: false,
          blockers: [],
          stage2Unlocked: false,
          reasonStage2Locked:
            summary.bestCandidateFailureReason ??
            "No candidate passed strict proof gates.",
          proofGapsRemaining: bestFailed?.missingRequiredProof ?? [
            "No candidate passed strict proof gates.",
          ],
          finalRecommendation: r2WriteAvailable
            ? "Do not run Stage 2"
            : "Fix R2 before large history backfill; do not run Stage 2",
          nextRecommendedAction: summary.recommendedNextAction,
        });
      if (dryRun)
        return redactedJson({
          ...output,
          stage: "dry_run_planned",
          approved: false,
          publishable: false,
          published: false,
          stage2Allowed:
            confirmRun === true &&
            best.eligibleForBest === true &&
            best.proofDiversityClean >= 2 &&
            proofEnrichmentSummary.proofMatchingClean === true &&
            !best.unsafeProofMismatchWarning,
          stage2Unlocked:
            confirmRun === true &&
            best.eligibleForBest === true &&
            best.proofDiversityClean >= 2 &&
            proofEnrichmentSummary.proofMatchingClean === true &&
            !best.unsafeProofMismatchWarning,
          reasonStage2Locked:
            confirmRun !== true
              ? "confirmRun=false; Stage 2 AI Committee stayed locked and OpenAI was not called."
              : best.eligibleForBest === true &&
                  best.proofDiversityClean >= 2 &&
                  proofEnrichmentSummary.proofMatchingClean === true &&
                  !best.unsafeProofMismatchWarning
                ? null
                : (best.reasonNotPromoted ??
                  "Strict proof gates did not pass cleanly."),
          finalRecommendation:
            confirmRun === true &&
            best.eligibleForBest === true &&
            best.proofDiversityClean >= 2 &&
            proofEnrichmentSummary.proofMatchingClean === true &&
            !best.unsafeProofMismatchWarning
              ? "Stage 2 allowed"
              : r2WriteAvailable
                ? "Do not run Stage 2"
                : "Fix R2 before large history backfill; do not run Stage 2",
          approvedForAiReview:
            confirmRun === true &&
            best.eligibleForBest === true &&
            best.proofDiversityClean >= 2 &&
            proofEnrichmentSummary.proofMatchingClean === true &&
            !best.unsafeProofMismatchWarning,
          nextRecommendedAction: summary.recommendedNextAction,
        });
      const createResponse = await candidateFactoryPOST(
        new NextRequest("http://internal/api/internal/candidate-factory-run", {
          method: "POST",
          body: JSON.stringify({
            dryRun: false,
            rawSignalId: String(best.rawSignalId),
            limit: 1,
            requireProof: true,
            extraProofsBySignal: {
              [String(best.rawSignalId)]:
                enrichedProofsBySignal[String(best.rawSignalId)] ?? [],
            },
          }),
        }),
      );
      const candidateJson = await jsonFromRoute(createResponse);
      const created = Array.isArray(candidateJson.createdCandidateIds)
        ? candidateJson.createdCandidateIds.map(String)
        : [];
      candidateAlertId = created[0] ?? "";
      output.candidateSummary = {
        ...candidateJson,
        createdCandidateIds: created.slice(0, 1),
      };
      if (!candidateAlertId)
        return redactedJson({
          ...output,
          stage: "candidate_blocked",
          approved: false,
          publishable: false,
          blockers: [],
          nextRecommendedAction:
            candidateJson.nextRecommendedAction ??
            "Candidate factory did not create a candidate; inspect blocked reasons.",
        });
    }

    output.stage = "candidate_ready";
    output.candidateSummary = {
      ...obj(output.candidateSummary),
      candidateAlertId,
    };
    const evidence = await buildAiCommitteeEvidencePack(candidateAlertId);
    output.evidencePackSummary = {
      ok: evidence.ok,
      readyForCommittee: evidence.readyForCommittee,
      missingRequiredEvidence: evidence.missingRequiredEvidence,
    };

    const provider = getAiCommitteeProviderStatus();
    if (!confirmRun || !provider.enabled || !provider.configured) {
      return redactedJson({
        ...output,
        stage: "ai_committee_planned",
        aiCommitteeSummary: {
          ok: true,
          status: "planned",
          provider: {
            enabled: provider.enabled,
            configured: provider.configured,
          },
          reason: !confirmRun
            ? "confirmRun=false"
            : "AI Committee provider not enabled/configured",
        },
        nextRecommendedAction:
          "Run Stage 2 with confirmRun=true and configured AI Committee to get a real approval review. Nothing was published.",
      });
    }

    const committee = await runAiCommittee({
      candidateAlertId,
      dryRun: false,
      confirmRun: true,
      mode: "preview",
    });
    const committeeRunId = text((committee as JsonRecord).persistedRunId);
    output.aiCommitteeRan = true;
    output.aiCommitteeSummary = {
      ok: committee.ok,
      status: committee.status,
      committeeRunId,
      providerStatus: committee.providerStatus,
    };

    const finalJudge = await runFinalJudge({
      candidateAlertId,
      committeeRunId,
      dryRun: true,
    });
    output.finalJudgeSummary = {
      ok: finalJudge.ok,
      finalDecision: finalJudge.finalDecision,
      publishAllowed: finalJudge.publishAllowed,
      requiredFixes: finalJudge.requiredFixes,
    };
    if (
      finalJudge.finalDecision === "reject" ||
      finalJudge.publishAllowed === false
    )
      warnings.push(
        "Final judge did not allow publish; approval gate must block publication.",
      );

    const gate = await runApprovalGate({
      candidateAlertId,
      committeeRunId,
      dryRun: !confirmPublish,
      reviewerNote: confirmPublish
        ? "Founder confirmed Stage 3 website publish from live alert cycle route."
        : "Stage 2 review only; no publish.",
    });
    const approved =
      isApproved(gate) &&
      finalJudge.finalDecision === "approve" &&
      finalJudge.publishAllowed === true;
    output.approvalGateSummary = {
      ok: gate.ok,
      approvalRecommendation: gate.approvalRecommendation,
      failedChecks: gate.failedChecks,
      warnings: gate.warnings,
    };
    output.approved = approved;
    output.publishable = approved;

    if (!approved || dryRun || !confirmPublish || maxAlertsToPublish < 1) {
      return redactedJson({
        ...output,
        stage: approved ? "approved_not_published" : "approval_blocked",
        blockers: approved ? [] : ["approval_gate_or_final_judge_not_approved"],
        nextRecommendedAction: approved
          ? "Stage 2 produced one real approved/publishable signal. Stage 3 may publish at most one alert after confirmation."
          : "Resolve final judge/approval gate failed checks before publishing. Nothing was published.",
      });
    }

    const publishResponse = await publishApprovedAlertPOST(
      new NextRequest("http://internal/api/internal/publish-approved-alert", {
        method: "POST",
        body: JSON.stringify({
          candidateAlertId,
          dryRun: false,
          confirmPublish: true,
        }),
      }),
    );
    const publishJson = await jsonFromRoute(publishResponse);
    return redactedJson(
      {
        ...output,
        stage: publishJson.published ? "published" : "publish_blocked",
        publishLedgerSummary: publishJson,
        published: publishJson.published === true,
        publicAlertUrl: text(publishJson.publicAlertUrl) || null,
        publicLedgerUrl: text(publishJson.publicLedgerUrl) || null,
        blockers: arrayText(publishJson.blockedReasons),
        warnings: [...warnings, ...arrayText(publishJson.warnings)],
        nextRecommendedAction:
          text(publishJson.nextRecommendedAction) ||
          "Publish attempted; inspect publishLedgerSummary.",
      },
      { status: publishResponse.status },
    );
  } catch (error) {
    const status =
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2023"
        ? 400
        : 500;
    return redactedJson(
      {
        ...baseResponse({ dryRun, readiness: {}, warnings }),
        ok: false,
        stage: "live_alert_cycle_failed",
        blockers: [error instanceof Error ? error.message : "unknown_error"],
        nextRecommendedAction:
          "Check server logs and rerun safely; no Telegram send was attempted.",
      },
      { status },
    );
  }
}
