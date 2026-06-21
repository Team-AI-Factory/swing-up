import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { getAlert, type Alert, type AlertAction, type MarketSentimentImpact } from "@/lib/mock-alerts";
import { absoluteUrl, alertSeoSlug, canonicalAlertPath, jsonRecord, safeText } from "@/lib/seo-alerts";

export type PublicAlertSourceMode = "live" | "mock_fallback" | "missing";

export type PublicTracking = {
  exists: boolean;
  alertDate: string;
  action: string;
  priceAtAlert: string;
  latestTrackedPrice: string;
  oneDay: string;
  threeDay: string;
  sevenDay: string;
  thirtyDay: string;
  ninetyDay: string;
  maxGain: string;
  maxDrawdown: string;
  finalOutcome: string;
  status: string;
};

export type PublicAlertDetail = {
  alert: Alert | null;
  sourceMode: PublicAlertSourceMode;
  label: string;
  summary: string;
  trackingStatus?: string;
  canonicalPath?: string;
  canonicalUrl?: string;
  publishedAt?: Date | null;
  updatedAt?: Date | null;
  tracking?: PublicTracking;
  sourceHealthLabel?: string;
  shareText?: string;
  noindex: boolean;
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

function formatDate(value: Date | null | undefined, withTime = false) {
  if (!value) return "Not available yet";
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: withTime ? "short" : undefined, timeZone: "UTC" }).format(value);
}

function allowedActionLabel(action: string) {
  return displayAction(action);
}

function normalizeAction(action: string): AlertAction {
  if (/avoid/i.test(action)) return "AVOID";
  if (/watch|no action|sell review|speculative/i.test(action)) return "WATCH";
  return "BUY";
}

export function displayAction(action: string) {
  if (/speculative/i.test(action)) return "Speculative Buy Candidate";
  if (/avoid/i.test(action)) return "Avoid";
  if (/sell review/i.test(action)) return "Sell Review";
  if (/no action/i.test(action)) return "No Action";
  if (/watch/i.test(action)) return "Watch";
  return "Buy Candidate";
}

function normalizeRisk(risk: string | undefined): Alert["riskLevel"] {
  if (/high/i.test(risk ?? "")) return "High";
  if (/low/i.test(risk ?? "")) return "Low";
  return "Medium";
}

function marketSentimentFromLedger(entry: Record<string, unknown>): Partial<MarketSentimentImpact> | undefined {
  const sentiment = jsonRecord(entry.marketSentimentImpact ?? entry.marketSentiment);
  if (!Object.keys(sentiment).length) return undefined;
  return {
    overallMarketMood: safeText(sentiment.overallMarketMood ?? sentiment.mood, ""),
    macroRiskLevel: safeText(sentiment.macroRiskLevel ?? sentiment.riskLevel, ""),
    sentimentSupportScore: Number(sentiment.sentimentSupportScore),
    macroSupportScore: Number(sentiment.macroSupportScore),
    profitPotentialAdjustment: Number(sentiment.profitPotentialAdjustment),
    confidenceAdjustment: Number(sentiment.confidenceAdjustment),
    explanation: safeText(sentiment.explanation, ""),
  };
}

function sourceLabel(source: LiveAlertRecord["sources"][number]) {
  const summary = source.summary?.trim();
  const url = source.receiptUrl?.trim();
  if (summary && url) return `${summary} (${url})`;
  return summary || url || source.sourceType;
}

function trackingFromRecord(record: LiveAlertRecord): PublicTracking {
  const ledger = record.publicLedger[0];
  const entry = jsonRecord(ledger?.entry);
  if (!ledger) {
    return {
      exists: false,
      alertDate: formatDate(record.publishedAt, true),
      action: displayAction(record.action),
      priceAtAlert: "Not available yet",
      latestTrackedPrice: "Not available yet",
      oneDay: "Pending",
      threeDay: "Pending",
      sevenDay: "Pending",
      thirtyDay: "Pending",
      ninetyDay: "Pending",
      maxGain: "Pending",
      maxDrawdown: "Pending",
      finalOutcome: "Pending",
      status: "Still tracking",
    };
  }
  return {
    exists: true,
    alertDate: safeText(entry.alertDate, formatDate(record.publishedAt, true)),
    action: displayAction(safeText(entry.action, record.action)),
    priceAtAlert: safeText(entry.priceAtAlert ?? entry.alertPrice, "Not available yet"),
    latestTrackedPrice: safeText(entry.latestPrice ?? entry.currentPrice, "Not available yet"),
    oneDay: safeText(entry.oneDay ?? entry.oneDayResult ?? entry["1D"], "Pending"),
    threeDay: safeText(entry.threeDay ?? entry.threeDayResult ?? entry["3D"], "Pending"),
    sevenDay: safeText(entry.sevenDay ?? entry.sevenDayResult ?? entry["7D"], "Pending"),
    thirtyDay: safeText(entry.thirtyDay ?? entry.thirtyDayResult ?? entry["30D"], "Pending"),
    ninetyDay: safeText(entry.ninetyDay ?? entry.ninetyDayResult ?? entry["90D"], "Pending"),
    maxGain: safeText(entry.maxGain, "Pending"),
    maxDrawdown: safeText(entry.maxDrawdown, "Pending"),
    finalOutcome: safeText(entry.finalOutcome ?? entry.outcome, "Pending"),
    status: safeText(entry.status ?? entry.outcome, "Open"),
  };
}

function liveAlertToCard(record: LiveAlertRecord): Alert {
  const score = record.scores[0];
  const target = record.targetPrices[0];
  const match = record.patternMatches[0];
  const ledger = record.publicLedger[0];
  const entry = jsonRecord(ledger?.entry);
  const matchEvent = match?.historicalEvent;
  const patternText = match
    ? `${safeText(match.confidenceLabel, "Pattern match")} similarity ${safeText(match.matchScore ?? match.similarity)}${matchEvent?.title ? ` — ${matchEvent.title}` : ""}${match.matchReason ? `: ${match.matchReason}` : ""}`
    : safeText(entry.historicalPatternMatch ?? entry.patternMatch, "Historical pattern match not available yet");
  const trackingStatus = safeText(entry.status ?? entry.outcome ?? entry.currentTrackedResult ?? entry.result, ledger ? "Public tracking record is available; checkpoints may still be pending." : "Tracking pending. This alert will be updated publicly.");

  return {
    id: alertSeoSlug(record),
    action: normalizeAction(record.action),
    actionLabel: allowedActionLabel(record.action),
    ticker: record.ticker,
    company: record.company,
    event: record.event,
    eventDate: formatDate(record.publishedAt),
    whatHappened: safeText(entry.whatHappened ?? entry.whatChanged ?? entry.summary, record.event),
    whyItMatters: safeText(entry.whyItMatters ?? entry.explanation, "This event may affect revenue, margins, demand, valuation, sentiment, regulation, or market timing; detailed logic was not stored yet."),
    howChecked: [
      { label: "Filing checked", status: safeText(entry.filingChecked, "No filing check stored for this alert."), available: Boolean(entry.filingChecked) },
      { label: "News checked", status: record.sources.length ? "Stored source receipts were reviewed." : "No news receipt stored yet.", available: record.sources.length > 0 },
      { label: "Price/volume checked", status: safeText(entry.priceVolumeChecked ?? entry.priceVolume, "No price/volume detail stored yet."), available: Boolean(entry.priceVolumeChecked ?? entry.priceVolume) },
      { label: "Fundamentals checked", status: safeText(entry.fundamentalsChecked, "No fundamentals detail stored yet."), available: Boolean(entry.fundamentalsChecked) },
      { label: "Valuation checked", status: score?.pricedInCheck ?? safeText(entry.valuationChecked ?? entry.pricedInCheck, "No valuation detail stored yet."), available: Boolean(score?.pricedInCheck ?? entry.valuationChecked ?? entry.pricedInCheck) },
      { label: "Historical pattern checked", status: patternText, available: Boolean(match || entry.historicalPatternMatch || entry.patternMatch) },
      { label: "Source health checked", status: record.sources.length ? "Source proof available; review receipt dates." : "Source proof pending or unavailable.", available: record.sources.length > 0 },
    ],
    proofFound: record.sources.map((source) => ({ sourceType: source.sourceType, explanation: source.summary || "Source receipt attached.", freshness: formatDate(source.collectedAt, true), link: source.receiptUrl ?? undefined })),
    historicalPatternDetail: patternText || "No strong historical pattern match found yet.",
    pricedInDetail: score?.pricedInCheck ?? safeText(entry.pricedInCheck, "Priced-in check not available yet"),
    rippleEffects: [{ group: "Watchlist only", explanation: safeText(entry.rippleEffect ?? entry.whatChanged, "No proven ripple effect available yet."), proofStrength: "weak" }],
    swingUpView: safeText(entry.swingUpView ?? entry.finalView ?? entry.explanation, "Balanced view pending; review proof, pricing, and risks."),
    whatWouldChangeView: [safeText(entry.whatWouldChangeView, "Stronger proof, cleaner price confirmation, improved source health, or a stronger historical pattern would change the view.")],
    sourceHealth: record.sources.length ? "Source proof available; review collection dates on receipts." : "Source proof pending or unavailable.",
    patternMatchStrength: match?.confidenceLabel ?? safeText(entry.patternMatchStrength, "Not available yet"),
    currentPrice: safeText(entry.currentPrice ?? entry.latestPrice, "Price not available yet"),
    targetRange: target?.lowPrice && target.highPrice ? `$${target.lowPrice.toString()}–$${target.highPrice.toString()}` : safeText(entry.targetRange, "Target not available yet"),
    potentialMove: safeText(entry.potentialMove, "Tracked after publication; market outcomes remain uncertain."),
    profitScore: score?.profitPotential ?? Number(entry.profitPotentialScore ?? 0),
    confidenceScore: score?.evidenceConfidence ?? Number(entry.evidenceConfidenceScore ?? 0),
    riskLevel: normalizeRisk(score?.riskLevel ?? safeText(entry.riskLevel, "")),
    pricedInCheck: score?.pricedInCheck ?? safeText(entry.pricedInCheck, "Priced-in check not available yet"),
    patternMatch: patternText,
    explanation: safeText(entry.whyItMatters ?? entry.explanation, "Published after final review. Review the evidence, risks, and tracking status before making any independent decision."),
    rippleEffect: safeText(entry.whatChanged ?? entry.rippleEffect, record.event),
    risks: [safeText(entry.risk ?? entry.risks ?? score?.riskLevel, "Risk review not available yet")],
    receipts: record.sources.map(sourceLabel).filter(Boolean),
    publicTrackingResult: trackingStatus,
    publicAlertUrl: `/alerts/${alertSeoSlug(record)}`,
    ledgerStatus: trackingStatus,
    latestTrackedResult: safeText(entry.latestTrackedResult ?? entry.currentTrackedResult ?? entry.result, trackingStatus),
    priceAtAlert: safeText(entry.priceAtAlert ?? entry.alertPrice, safeText(entry.currentPrice ?? entry.latestPrice, "Not available yet")),
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
      const path = canonicalAlertPath(live, live.publicLedger[0]?.publicSlug);
      const shareText = `Swing Up research alert: ${live.ticker}/${live.company} — ${live.event}. Includes proof, risk checks, scores, and public tracking.`;
      return {
        alert,
        sourceMode: "live",
        label: "Live published alert",
        summary: "This published research page includes proof, risk checks, scores, and public tracking.",
        trackingStatus: alert.publicTrackingResult,
        canonicalPath: path,
        canonicalUrl: absoluteUrl(path),
        publishedAt: live.publishedAt,
        updatedAt: live.publicLedger[0]?.createdAt ?? live.publishedAt,
        tracking: trackingFromRecord(live),
        sourceHealthLabel: live.sources.length ? "Source proof available; review collection dates on receipts." : "Source proof pending or unavailable.",
        shareText,
        noindex: false,
      };
    }
  } catch {
    // Public pages must not crash on data outages.
  }

  const preview = getAlert(id);
  if (preview?.id === id) {
    return { alert: preview, sourceMode: "mock_fallback", label: "Preview example — mock data", summary: "No matching published alert was found. This clearly labelled mock example is not indexable.", noindex: true };
  }

  return { alert: null, sourceMode: "missing", label: "Alert not found", summary: "No published public alert matches this slug. Unpublished candidate alerts are not exposed publicly.", noindex: true };
}
