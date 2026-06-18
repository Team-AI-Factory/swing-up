import type { RuleFilterDecision } from "@/lib/rule-filter";

export type MiniAiScanDecision = "pass" | "reject" | "needs_more_data";
export type SentimentDataStatus = "available" | "missing";
export type MiniAiNextStage = "full_ai_committee" | "manual_review" | "receipt_collection" | "stop";

export type MiniAiSourceReceipt = {
  label?: unknown;
  url?: unknown;
  source?: unknown;
  capturedAt?: unknown;
};

export type MiniAiScanInput = {
  rawSignalId?: unknown;
  ticker?: unknown;
  company?: unknown;
  eventSummary?: unknown;
  sourceReceipts?: unknown;
  sourceReliability?: unknown;
  ruleFilterDecision?: unknown;
  ruleFilterReasons?: unknown;
  priceContext?: unknown;
  marketSentimentSnapshot?: unknown;
  historicalPatternSummary?: unknown;
};

export type MiniAiScanOutput = {
  ok: true;
  rawSignalId: string | null;
  ticker: string;
  company: string;
  scanDecision: MiniAiScanDecision;
  seriousnessScore: number;
  noveltyScore: number;
  evidenceStrength: number;
  marketRelevanceScore: number;
  sentimentDataStatus: SentimentDataStatus;
  likelyEventType: string;
  whyItMatters: string;
  whatCouldGoWrong: string;
  recommendedNextStage: MiniAiNextStage;
  warnings: string[];
  compatibility: {
    previewOnly: true;
    callsPaidAiModel: false;
    publishesRealAlert: false;
    finalInvestmentRecommendation: false;
  };
};

const UNSAFE_PHRASES = [
  "guaranteed",
  "risk-free",
  "strong buy",
  "buy now",
  "will definitely go up",
];

function safeString(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function safeArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function lower(value: unknown) {
  return safeString(value).toLowerCase();
}

function sanitizeText(value: string) {
  return UNSAFE_PHRASES.reduce((text, phrase) => new RegExp(phrase, "gi").test(text) ? text.replace(new RegExp(phrase, "gi"), "review-worthy") : text, value);
}

function receiptCount(input: MiniAiScanInput) {
  const receipts = safeArray(input.sourceReceipts);
  return receipts.length;
}

function hasMeaningfulData(value: unknown) {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

function normalizedRuleDecision(input: MiniAiScanInput): RuleFilterDecision {
  const decision = lower(input.ruleFilterDecision);
  if (["pass", "reject", "needs_more_data"].includes(decision)) return decision as RuleFilterDecision;
  return "needs_more_data";
}

function likelyEventType(input: MiniAiScanInput) {
  const summary = lower(input.eventSummary);
  const pattern = lower(input.historicalPatternSummary);
  const combined = `${summary} ${pattern}`;
  if (combined.includes("earnings") || combined.includes("revenue") || combined.includes("guidance")) return "earnings_or_guidance";
  if (combined.includes("fda") || combined.includes("approval") || combined.includes("regulatory")) return "regulatory_update";
  if (combined.includes("contract") || combined.includes("partnership")) return "commercial_deal";
  if (combined.includes("merger") || combined.includes("acquisition")) return "m_and_a";
  if (combined.includes("filing") || combined.includes("sec")) return "filing_update";
  return "unknown_event_type";
}

function sourceReliabilityScore(input: MiniAiScanInput) {
  const reliability = lower(input.sourceReliability);
  if (["strong", "high", "verified"].includes(reliability)) return 82;
  if (["medium", "moderate"].includes(reliability)) return 58;
  if (["weak", "low"].includes(reliability)) return 28;
  return 42;
}

function recommendedStage(scanDecision: MiniAiScanDecision, evidenceStrength: number): MiniAiNextStage {
  if (scanDecision === "pass") return "full_ai_committee";
  if (scanDecision === "needs_more_data") return evidenceStrength < 45 ? "receipt_collection" : "manual_review";
  return "stop";
}

export const mockMiniAiScanInput: MiniAiScanInput = {
  rawSignalId: "raw_mock_shop_001",
  ticker: "SHOP",
  company: "Shopify Inc.",
  eventSummary: "Rule-filtered preview signal: partner checks and company receipts suggest enterprise commerce demand is improving.",
  sourceReceipts: [
    { label: "Company release", url: "https://example.com/shopify-release", source: "BusinessWire" },
    { label: "Partner channel check", url: "https://example.com/shopify-partner-check", source: "Verified partner note" },
  ],
  sourceReliability: "strong",
  ruleFilterDecision: "pass",
  ruleFilterReasons: [],
  priceContext: { recentMovePercent: 2.4, volumeContext: "above_average" },
  marketSentimentSnapshot: { status: "neutral", sectorTone: "constructive" },
  historicalPatternSummary: "Similar verified demand updates have often mattered most when paired with earnings or guidance context.",
};

export function previewMiniAiScan(input: MiniAiScanInput = {}): MiniAiScanOutput {
  const ruleDecision = normalizedRuleDecision(input);
  const receipts = receiptCount(input);
  const sentimentDataStatus: SentimentDataStatus = hasMeaningfulData(input.marketSentimentSnapshot) ? "available" : "missing";
  const reasons = safeArray(input.ruleFilterReasons).map((reason) => safeString(reason)).filter(Boolean);
  const ticker = safeString(input.ticker, "UNKNOWN").toUpperCase();
  const company = safeString(input.company, "Unknown company");
  const eventType = likelyEventType(input);

  const evidenceStrength = clampScore(sourceReliabilityScore(input) + receipts * 8 + (ruleDecision === "pass" ? 8 : -12));
  const seriousnessScore = clampScore((eventType === "unknown_event_type" ? 42 : 68) + (hasMeaningfulData(input.priceContext) ? 8 : 0) + (ruleDecision === "pass" ? 8 : -18));
  const noveltyScore = clampScore(hasMeaningfulData(input.historicalPatternSummary) ? 58 : 44);
  const marketRelevanceScore = clampScore(seriousnessScore + (sentimentDataStatus === "available" ? 6 : -8));

  let scanDecision: MiniAiScanDecision = "needs_more_data";
  if (ruleDecision === "reject") scanDecision = evidenceStrength >= 60 ? "needs_more_data" : "reject";
  else if (ruleDecision === "pass" && evidenceStrength >= 65 && seriousnessScore >= 60) scanDecision = "pass";
  else if (evidenceStrength < 35 || seriousnessScore < 35) scanDecision = "reject";

  const warnings = [
    "Preview only: this scan is not a final investment recommendation and cannot publish an alert.",
    "No OpenAI or paid AI model call is made by this route.",
    sentimentDataStatus === "missing" ? "Market sentiment snapshot is missing; sentimentDataStatus is missing." : "Market sentiment snapshot is present for preview context.",
    ruleDecision !== "pass" ? `Rule filter did not pass (${ruleDecision}); Mini AI preview should not advance without review.` : "Rule filter passed before this preview stage.",
    ...reasons.map((reason) => `Rule filter reason: ${reason}.`),
  ].map(sanitizeText);

  return {
    ok: true,
    rawSignalId: safeString(input.rawSignalId) || null,
    ticker,
    company,
    scanDecision,
    seriousnessScore,
    noveltyScore,
    evidenceStrength,
    marketRelevanceScore,
    sentimentDataStatus,
    likelyEventType: eventType,
    whyItMatters: sanitizeText(`${company} (${ticker}) may warrant deeper review because the event type, receipts, and rule-filter status suggest possible market relevance.`),
    whatCouldGoWrong: sanitizeText("The signal may be stale, already reflected in prices, unsupported by independent receipts, or less important than early context implies."),
    recommendedNextStage: recommendedStage(scanDecision, evidenceStrength),
    warnings,
    compatibility: { previewOnly: true, callsPaidAiModel: false, publishesRealAlert: false, finalInvestmentRecommendation: false },
  };
}
