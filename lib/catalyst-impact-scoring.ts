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
  const scoringBreakdown = {
    directTickerCompanyMatch: directTickerMatch || directCompanyMatch ? 15 : 0,
    catalystImportance: Math.round(impactScore * 18),
    specificRealReceiptUrl: hasReceiptUrl ? 10 : 0,
    freshness: freshWithin72h ? 8 : 0,
    independentProofCount: Math.round(proofDiversityScore * 12),
    proofMatchQuality: Math.round(stockSpecificityScore * 12),
    historicalPatternMatch: (input.proofTypes ?? []).includes("pattern_match") ? 10 : 0,
    fundamentalsSupport: (input.proofTypes ?? []).includes("fundamentals") ? 8 : 0,
    marketReactionBonus: (input.proofTypes ?? []).includes("price_volume") ? 4 : 0,
    sourceReliability: Math.round(sourceReliabilityScore * 2),
    riskClarity: lowType ? 0 : 1,
  };
  const promotionScore = Math.min(100, Object.values(scoringBreakdown).reduce((sum, value) => sum + value, 0));
  const promotionBand = promotionScore >= 85 ? "strong_candidate" : promotionScore >= 75 ? "eligible_for_ai_committee" : promotionScore >= 60 ? "watch_needs_proof" : "noise_weak";
  return { directTickerMatch, directCompanyMatch, hasReceiptUrl, freshWithin72h, sourceReliabilityScore, catalystType: type, likelyMarketImpact, proofDiversityScore, stockSpecificityScore, promotionScore, promotionBand, marketReactionIsRequired: false, marketReactionBonusScore: scoringBreakdown.marketReactionBonus, scoringBreakdown };
}
