import { buildMarketSentimentImpact, mockScoreInput, scoreSwingUpAlert, type MarketSentimentImpact, type RiskLevel, type ScorePreviewInput, type SuggestedAction } from "@/lib/scoring-engine";

export type AiCommitteeReviewStage =
  | "raw_signal_received"
  | "rule_filter_passed"
  | "mini_ai_scan_passed"
  | "committee_ready"
  | "committee_reviewing"
  | "final_judge_pending"
  | "approved"
  | "rejected"
  | "blocked";

export type AiCommitteeAgentName =
  | "Filing Agent"
  | "Accountant Agent"
  | "DCF Agent"
  | "Market Agent"
  | "News Agent"
  | "Macro Agent"
  | "Industry Agent"
  | "Knock-On Agent"
  | "Risk Agent"
  | "Skeptic Agent"
  | "Compliance Agent"
  | "Explainer Agent"
  | "Final Judge";

export type AiCommitteeCandidateInput = ScorePreviewInput & {
  candidateId?: string;
  eventSummary?: string;
  currentStage?: AiCommitteeReviewStage;
  receiptsCount?: number;
  warnings?: string[];
  simpleExplanation?: string;
};

export type AiCommitteeQueueItem = {
  candidateId: string;
  ticker: string;
  company: string;
  eventSummary: string;
  currentStage: AiCommitteeReviewStage;
  nextStage: AiCommitteeReviewStage | null;
  suggestedAction: SuggestedAction;
  profitPotentialScore: number;
  evidenceConfidenceScore: number;
  riskLevel: RiskLevel;
  marketSentimentImpact?: MarketSentimentImpact;
  receiptsCount: number;
  warnings: string[];
  simpleExplanation: string;
  reviewAgents: AiCommitteeAgentName[];
  compatibility: {
    adminReviewReady: true;
    alertPublishingReady: true;
    publishesRealAlert: false;
    callsPaidAiModel: false;
  };
};

export type AiCommitteeQueueSourceMode = "live" | "empty" | "mock_fallback";

export type AiCommitteeQueueResponse = {
  ok: true;
  sourceMode: AiCommitteeQueueSourceMode;
  queueItems: AiCommitteeQueueItem[];
  reviewStages: AiCommitteeReviewStage[];
  safeActionLabels: SuggestedAction[];
  warnings: string[];
};

export const AI_COMMITTEE_REVIEW_STAGES: AiCommitteeReviewStage[] = [
  "raw_signal_received",
  "rule_filter_passed",
  "mini_ai_scan_passed",
  "committee_ready",
  "committee_reviewing",
  "final_judge_pending",
  "approved",
  "rejected",
  "blocked",
];

export const AI_COMMITTEE_AGENTS: AiCommitteeAgentName[] = [
  "Filing Agent",
  "Accountant Agent",
  "DCF Agent",
  "Market Agent",
  "News Agent",
  "Macro Agent",
  "Industry Agent",
  "Knock-On Agent",
  "Risk Agent",
  "Skeptic Agent",
  "Compliance Agent",
  "Explainer Agent",
  "Final Judge",
];

export const SAFE_ACTION_LABELS: SuggestedAction[] = ["Buy Candidate", "Speculative Buy Candidate", "Watch", "Sell Review", "Avoid", "No Action"];

const TERMINAL_STAGES = new Set<AiCommitteeReviewStage>(["approved", "rejected", "blocked"]);

function isReviewStage(value: unknown): value is AiCommitteeReviewStage {
  return typeof value === "string" && AI_COMMITTEE_REVIEW_STAGES.includes(value as AiCommitteeReviewStage);
}

function nextStage(stage: AiCommitteeReviewStage): AiCommitteeReviewStage | null {
  if (TERMINAL_STAGES.has(stage)) return null;
  const index = AI_COMMITTEE_REVIEW_STAGES.indexOf(stage);
  return AI_COMMITTEE_REVIEW_STAGES[index + 1] ?? null;
}

function safeString(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function sanitizeWarning(value: string) {
  return value.replace(/guaranteed/gi, "promised").replace(/risk-free/gi, "low-risk").replace(/strong buy/gi, "Buy Candidate").replace(/buy now/gi, "review candidate").replace(/will definitely go up/gi, "may move higher or lower");
}

function safeReceiptsCount(input: AiCommitteeCandidateInput) {
  const explicit = input.receiptsCount;
  if (typeof explicit === "number" && Number.isFinite(explicit) && explicit >= 0) return Math.round(explicit);
  if (typeof input.independentReceipts === "number" && Number.isFinite(input.independentReceipts) && input.independentReceipts >= 0) return Math.round(input.independentReceipts);
  return 0;
}

export function mockCommitteeCandidate(): AiCommitteeCandidateInput {
  return {
    ...mockScoreInput(),
    candidateId: "candidate_mock_shop_001",
    eventSummary: "Preview-only candidate: better commerce software demand, verified receipts, and constructive sector context prepared for committee review.",
    currentStage: "committee_ready",
    simpleExplanation: "This candidate is queued for future committee review because scoring, evidence, and receipt counts are sufficient for a safe internal preview.",
  };
}

export function buildCommitteeQueueItem(input: AiCommitteeCandidateInput, sentiment = buildMarketSentimentImpact(null)): AiCommitteeQueueItem {
  const score = scoreSwingUpAlert(input, sentiment);
  const currentStage = isReviewStage(input.currentStage) ? input.currentStage : "raw_signal_received";
  const warnings = [
    "Internal review candidate only; no paid or user-facing alert is published.",
    "No OpenAI or paid AI model call is made in this queue layer.",
    ...score.warnings,
    ...(Array.isArray(input.warnings) ? input.warnings.filter((warning): warning is string => typeof warning === "string" && warning.trim().length > 0) : []),
  ].map(sanitizeWarning);

  return {
    candidateId: safeString(input.candidateId, `candidate_${score.ticker.toLowerCase()}_preview`),
    ticker: safeString(score.ticker, "MOCK"),
    company: safeString(score.company, "Mock Company"),
    eventSummary: safeString(input.eventSummary, "Candidate alert prepared for internal review preview."),
    currentStage,
    nextStage: nextStage(currentStage),
    suggestedAction: SAFE_ACTION_LABELS.includes(score.suggestedAction) ? score.suggestedAction : "No Action",
    profitPotentialScore: score.profitPotentialScore,
    evidenceConfidenceScore: score.evidenceConfidenceScore,
    riskLevel: score.riskLevel,
    marketSentimentImpact: score.marketSentimentImpact,
    receiptsCount: safeReceiptsCount(input),
    warnings,
    simpleExplanation: safeString(input.simpleExplanation, "This item is staged for internal review and cannot become a real alert until final approval is added in a future build."),
    reviewAgents: AI_COMMITTEE_AGENTS,
    compatibility: { adminReviewReady: true, alertPublishingReady: true, publishesRealAlert: false, callsPaidAiModel: false },
  };
}

export function buildCommitteeQueue(
  inputs: AiCommitteeCandidateInput[],
  limit = 20,
  options: { sourceMode?: AiCommitteeQueueSourceMode; sentiment?: MarketSentimentImpact } = {},
): AiCommitteeQueueResponse {
  const safeLimit = Math.max(0, Math.min(100, Number.isFinite(limit) ? Math.floor(limit) : 20));
  return {
    ok: true,
    sourceMode: options.sourceMode ?? "mock_fallback",
    queueItems: inputs.slice(0, safeLimit).map((input) => buildCommitteeQueueItem(input, options.sentiment)),
    reviewStages: AI_COMMITTEE_REVIEW_STAGES,
    safeActionLabels: SAFE_ACTION_LABELS,
    warnings: ["Queue preview only. Publishing remains disabled until a future final-review build."],
  };
}
