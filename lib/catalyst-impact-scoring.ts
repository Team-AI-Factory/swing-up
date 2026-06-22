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
