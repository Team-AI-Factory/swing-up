import { Prisma } from "@prisma/client";

const HIGH_IMPACT = ["guidance", "earnings beat", "earnings miss", "partnership", "customer win", "8-k", "approval", "recall", "price target", "estimate", "demand", "margin", "price_volume", "press_release"];
const LOW_IMPACT = ["market recap", "weekly market review", "portfolio", "holdings", "general technology", "broad market", "bank/market"];

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function number(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function catalystImpactScores(input: {
  ticker?: string | null;
  company?: string | null;
  title?: string | null;
  summary?: string | null;
  url?: string | null;
  publishedAt?: string | Date | null;
  sourceReliability?: "low" | "medium" | "high" | number | null;
  catalystType?: string | null;
  proofTypes?: string[];
  providerMetadata?: Record<string, unknown>;
}): Prisma.InputJsonObject {
  const haystack = `${input.title ?? ""} ${input.summary ?? ""}`.toLowerCase();
  const ticker = text(input.ticker).toUpperCase();
  const company = text(input.company).toLowerCase();
  const directTickerMatch = Boolean(ticker && (haystack.includes(ticker.toLowerCase()) || text(input.providerMetadata?.symbol).toUpperCase() === ticker));
  const companyMatch = Boolean(company && haystack.includes(company));
  const directCompanyMatch = companyMatch;
  const hasReceiptUrl = Boolean(text(input.url));
  const published = input.publishedAt ? new Date(input.publishedAt) : new Date();
  const freshWithin72h = !Number.isNaN(published.getTime()) && Date.now() - published.getTime() <= 72 * 60 * 60 * 1000;
  const type = text(input.catalystType) || "stock_news";
  const typeText = `${type} ${haystack}`.toLowerCase();
  const highType = HIGH_IMPACT.some((needle) => typeText.includes(needle));
  const lowType = LOW_IMPACT.some((needle) => typeText.includes(needle));
  const sourceReliabilityScore = typeof input.sourceReliability === "number" ? number(input.sourceReliability) : input.sourceReliability === "high" ? 0.9 : input.sourceReliability === "low" ? 0.35 : 0.65;
  const proofDiversityScore = Math.min(new Set(input.proofTypes ?? []).size / 4, 1);
  const stockSpecificityScore = Math.min((directTickerMatch ? 0.5 : 0) + (companyMatch ? 0.25 : 0) + (hasReceiptUrl ? 0.15 : 0) + (freshWithin72h ? 0.1 : 0), 1);
  const likelyMarketImpact = highType && stockSpecificityScore >= 0.5 ? "high" : lowType || stockSpecificityScore < 0.35 ? "low" : "medium";
  const impactScore = likelyMarketImpact === "high" ? 0.9 : likelyMarketImpact === "medium" ? 0.6 : 0.25;
  const promotionScore = Math.round(100 * (impactScore * 0.35 + stockSpecificityScore * 0.35 + sourceReliabilityScore * 0.2 + proofDiversityScore * 0.1));
  return { directTickerMatch, directCompanyMatch, hasReceiptUrl, freshWithin72h, sourceReliabilityScore, catalystType: type, likelyMarketImpact, proofDiversityScore, stockSpecificityScore, promotionScore };
}

export type SevenLayerEvidenceScore = {
  layerScores: Record<string, number>;
  layersSupportingCandidate: string[];
  layersMissing: string[];
  strongestLayer: string;
  weakestLayer: string;
  earlySignalPossible: boolean;
  marketReactionStatus: "none" | "weak" | "bonus_confirmed" | "unknown";
  promotionScore: number;
  reasonNotPromoted: string | null;
};

function layerStrengthFromText(haystack: string, needles: string[], fallback = 0) {
  return needles.some((needle) => haystack.includes(needle)) ? 75 : fallback;
}

export function scoreSevenLayerEvidence(input: {
  source?: string | null;
  title?: string | null;
  summary?: string | null;
  proofTypes?: string[];
  promotionScore?: number | null;
  priceMovePercent?: number | null;
  riskSignals?: number | null;
}): SevenLayerEvidenceScore {
  const textBlob = `${input.source ?? ""} ${input.title ?? ""} ${input.summary ?? ""}`.toLowerCase();
  const proofTypes = new Set(input.proofTypes ?? []);
  const priceMove = typeof input.priceMovePercent === "number" ? input.priceMovePercent : null;
  const layerScores: Record<string, number> = {
    "Layer 1 — Official truth": Math.max(proofTypes.has("filing") ? 85 : 0, layerStrengthFromText(textBlob, ["sec", "edgar", "8-k", "fda", "clinical", "contract", "award", "recall", "approval"])),
    "Layer 2 — Fast market news": Math.max(proofTypes.has("news") ? 65 : 0, layerStrengthFromText(textBlob, ["marketaux", "alpha vantage", "gdelt", "google news", "press release", "news"], 0)),
    "Layer 3 — Money movement": Math.max(proofTypes.has("price_volume") ? 55 : 0, layerStrengthFromText(textBlob, ["form 4", "insider", "13f", "short", "options", "volume"], 0)),
    "Layer 4 — Business quality": Math.max(proofTypes.has("fundamentals") ? 60 : 0, layerStrengthFromText(textBlob, ["revenue", "margin", "eps", "cash flow", "debt", "valuation", "estimate", "price target"], 0)),
    "Layer 5 — Real-world demand": layerStrengthFromText(textBlob, ["job", "app rank", "review", "traffic", "pricing", "product launch", "customer", "supplier", "patent"], 0),
    "Layer 6 — Risk detector": Math.max((input.riskSignals ?? 0) > 0 ? 70 : 0, layerStrengthFromText(textBlob, ["lawsuit", "investigation", "auditor", "resignation", "default", "dilution", "recall", "enforcement"], 0)),
    "Layer 7 — Historical memory": proofTypes.has("pattern_match") ? 65 : 0,
  };
  const layersSupportingCandidate = Object.entries(layerScores).filter(([, score]) => score >= 50).map(([layer]) => layer);
  const layersMissing = Object.entries(layerScores).filter(([, score]) => score < 50).map(([layer]) => layer);
  const sorted = Object.entries(layerScores).sort((a, b) => b[1] - a[1]);
  const marketReactionStatus = priceMove == null ? "unknown" : Math.abs(priceMove) >= 5 ? "bonus_confirmed" : Math.abs(priceMove) >= 2 ? "weak" : "none";
  const nonMarketScore = sorted.reduce((sum, [, score]) => sum + score, 0) / 7;
  const marketBonus = marketReactionStatus === "bonus_confirmed" ? 8 : marketReactionStatus === "weak" ? 3 : 0;
  const promotionScore = Math.max(0, Math.min(100, Math.round((input.promotionScore ?? nonMarketScore) * 0.65 + nonMarketScore * 0.35 + marketBonus)));
  const earlySignalPossible = marketReactionStatus === "none" || marketReactionStatus === "unknown";
  const reasonNotPromoted = promotionScore < 55 ? "promotion_score_below_threshold_or_missing_clean_proof" : null;
  return { layerScores, layersSupportingCandidate, layersMissing, strongestLayer: sorted[0]?.[0] ?? "Layer 1 — Official truth", weakestLayer: sorted[sorted.length - 1]?.[0] ?? "Layer 7 — Historical memory", earlySignalPossible, marketReactionStatus, promotionScore, reasonNotPromoted };
}
