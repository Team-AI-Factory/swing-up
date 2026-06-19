import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { getAlert, type Alert, type AlertAction, type MarketSentimentImpact } from "@/lib/mock-alerts";

export type PublicAlertSourceMode = "live" | "mock_fallback" | "missing";

export type PublicAlertDetail = {
  alert: Alert | null;
  sourceMode: PublicAlertSourceMode;
  label: string;
  summary: string;
  trackingStatus?: string;
};

type LiveAlertRecord = Prisma.AlertGetPayload<{
  include: {
    scores: { orderBy: { createdAt: "desc" }; take: 1 };
    sources: { orderBy: { collectedAt: "desc" }; take: 10 };
    targetPrices: { take: 1 };
    patternMatches: { orderBy: { createdAt: "desc" }; take: 1; include: { historicalEvent: true } };
    publicLedger: { orderBy: { createdAt: "desc" }; take: 1 };
  };
}>;

function text(value: unknown, fallback = "Not available yet") {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (value instanceof Prisma.Decimal) return value.toString();
  return fallback;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function formatDate(value: Date | null | undefined) {
  if (!value) return undefined;
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" }).format(value);
}

function normalizeAction(action: string): AlertAction {
  if (/avoid/i.test(action)) return "AVOID";
  if (/watch|no action|sell review|speculative/i.test(action)) return "WATCH";
  return "BUY";
}

function normalizeRisk(risk: string | undefined): Alert["riskLevel"] {
  if (/high/i.test(risk ?? "")) return "High";
  if (/low/i.test(risk ?? "")) return "Low";
  return "Medium";
}

function marketSentimentFromLedger(entry: Record<string, unknown>): Partial<MarketSentimentImpact> | undefined {
  const sentiment = asRecord(entry.marketSentimentImpact ?? entry.marketSentiment);
  if (!Object.keys(sentiment).length) return undefined;
  return {
    overallMarketMood: text(sentiment.overallMarketMood ?? sentiment.mood, ""),
    macroRiskLevel: text(sentiment.macroRiskLevel ?? sentiment.riskLevel, ""),
    sentimentSupportScore: Number(sentiment.sentimentSupportScore),
    macroSupportScore: Number(sentiment.macroSupportScore),
    profitPotentialAdjustment: Number(sentiment.profitPotentialAdjustment),
    confidenceAdjustment: Number(sentiment.confidenceAdjustment),
    explanation: text(sentiment.explanation, ""),
  };
}

function sourceLabel(source: LiveAlertRecord["sources"][number]) {
  const summary = source.summary?.trim();
  const url = source.receiptUrl?.trim();
  if (summary && url) return `${summary} (${url})`;
  return summary || url || source.sourceType;
}

function liveAlertToCard(record: LiveAlertRecord): Alert {
  const score = record.scores[0];
  const target = record.targetPrices[0];
  const match = record.patternMatches[0];
  const ledger = record.publicLedger[0];
  const entry = asRecord(ledger?.entry);
  const matchEvent = match?.historicalEvent;
  const patternText = match
    ? `${text(match.confidenceLabel, "Pattern match")} similarity ${text(match.matchScore ?? match.similarity)}${matchEvent?.title ? ` — ${matchEvent.title}` : ""}${match.matchReason ? `: ${match.matchReason}` : ""}`
    : text(entry.historicalPatternMatch ?? entry.patternMatch, "Historical pattern match not available yet");
  const trackingStatus = text(entry.status ?? entry.outcome ?? entry.currentTrackedResult ?? entry.result, ledger ? "Public tracking record is available; checkpoints may still be pending." : "Public tracking is not available yet.");

  return {
    id: record.id,
    action: normalizeAction(record.action),
    ticker: record.ticker,
    company: record.company,
    event: record.event,
    eventDate: formatDate(record.publishedAt),
    currentPrice: text(entry.currentPrice ?? entry.latestPrice, "Price not available yet"),
    targetRange: target?.lowPrice && target.highPrice ? `$${target.lowPrice.toString()}–$${target.highPrice.toString()}` : text(entry.targetRange, "Target not available yet"),
    potentialMove: text(entry.potentialMove, "Tracked after publication; market outcomes remain uncertain."),
    profitScore: score?.profitPotential ?? Number(entry.profitPotentialScore ?? 0),
    confidenceScore: score?.evidenceConfidence ?? Number(entry.evidenceConfidenceScore ?? 0),
    riskLevel: normalizeRisk(score?.riskLevel ?? text(entry.riskLevel, "")),
    pricedInCheck: score?.pricedInCheck ?? text(entry.pricedInCheck, "Priced-in check not available yet"),
    patternMatch: patternText,
    explanation: text(entry.whyItMatters ?? entry.explanation, "Published after final review. Review the evidence, risks, and tracking status before making any independent decision."),
    rippleEffect: text(entry.whatChanged ?? entry.rippleEffect, record.event),
    risks: [text(entry.risk ?? entry.risks ?? score?.riskLevel, "Risk review not available yet")],
    receipts: record.sources.map(sourceLabel).filter(Boolean),
    publicTrackingResult: trackingStatus,
    marketSentimentImpact: marketSentimentFromLedger(entry),
  };
}

async function getLivePublishedAlert(id: string): Promise<LiveAlertRecord | null> {
  if (!process.env.DATABASE_URL) return null;
  return prisma.alert.findFirst({
    where: {
      status: { equals: "published", mode: "insensitive" },
      publishedAt: { not: null },
      OR: [{ id }, { publicLedger: { some: { publicSlug: id } } }],
    },
    include: {
      scores: { orderBy: { createdAt: "desc" }, take: 1 },
      sources: { orderBy: { collectedAt: "desc" }, take: 10 },
      targetPrices: { take: 1 },
      patternMatches: { orderBy: { createdAt: "desc" }, take: 1, include: { historicalEvent: true } },
      publicLedger: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
}

export async function getPublicAlertDetail(id: string): Promise<PublicAlertDetail> {
  try {
    const live = await getLivePublishedAlert(id);
    if (live) {
      const alert = liveAlertToCard(live);
      return { alert, sourceMode: "live", label: "Live published alert", summary: "This page is loaded from a published alert record and related proof, score, pattern, and public tracking tables.", trackingStatus: alert.publicTrackingResult };
    }
  } catch {
    // Fall through to labelled preview or missing state. Public pages must not crash on data outages.
  }

  const preview = getAlert(id);
  if (preview?.id === id) {
    return { alert: preview, sourceMode: "mock_fallback", label: "Preview example — mock data", summary: "No matching published alert was found. This clearly labelled mock example is shown only for product preview." };
  }

  return { alert: null, sourceMode: "missing", label: "Alert not found", summary: "No published public alert matches this id. Unpublished candidate alerts are not exposed publicly." };
}
