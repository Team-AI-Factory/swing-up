import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { mockAlerts, type Alert } from "@/lib/mock-alerts";

export type LedgerOutcome = "tracking" | "win" | "neutral" | "loss" | "needs_more_data";
export type LedgerSourceMode = "live" | "empty" | "mock_fallback";

export type LedgerRow = {
  id: string;
  alertId: string;
  action: string;
  ticker: string;
  company: string;
  event: string;
  alertDate: string;
  priceAtAlert: string;
  latestPrice: string;
  profitPotentialScore: string;
  evidenceConfidenceScore: string;
  riskLevel: string;
  historicalPatternMatch: string;
  oneDayResult: string;
  threeDayResult: string;
  sevenDayResult: string;
  thirtyDayResult: string;
  ninetyDayResult: string;
  maxGain: string;
  maxDrawdown: string;
  outcome: LedgerOutcome;
  receiptsCount: number;
  sourceMode: LedgerSourceMode;
  result: string;
  alert?: Alert;
};

export type LedgerData = {
  rows: LedgerRow[];
  sourceMode: LedgerSourceMode;
  sourceLabel: string;
  summary: string;
};

type LiveLedgerRecord = Prisma.PublicLedgerGetPayload<{
  include: {
    alert: {
      include: {
        scores: { orderBy: { createdAt: "desc" }; take: 1 };
        sources: true;
        patternMatches: { orderBy: { createdAt: "desc" }; take: 1 };
      };
    };
  };
}>;

const statusByAction: Record<Alert["action"], LedgerOutcome> = { BUY: "tracking", WATCH: "neutral", AVOID: "tracking" };

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown, fallback = "Not available yet") {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (value instanceof Prisma.Decimal) return value.toString();
  return fallback;
}

function money(value: unknown, fallback = "Not available yet") {
  const raw = text(value, "");
  return raw ? (raw.startsWith("$") ? raw : `$${raw}`) : fallback;
}

function numberText(value: unknown, fallback = "Not available yet") {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (value instanceof Prisma.Decimal) return value.toString();
  if (typeof value === "string" && value.trim()) return value.trim();
  return fallback;
}

function dateText(value: unknown, fallback = "Not available yet") {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return text(value, fallback);
}

function outcome(value: unknown): LedgerOutcome {
  const normalized = typeof value === "string" ? value.toLowerCase() : "";
  if (["win", "neutral", "loss", "tracking", "needs_more_data"].includes(normalized)) return normalized as LedgerOutcome;
  if (normalized === "missing_data") return "needs_more_data";
  if (normalized === "open") return "tracking";
  return "tracking";
}

function first(entry: Record<string, unknown>, keys: string[], fallback = "Not available yet") {
  for (const key of keys) {
    const value = entry[key];
    if (value !== undefined && value !== null && text(value, "")) return text(value, fallback);
  }
  return fallback;
}

function liveRow(record: LiveLedgerRecord, latestPriceByTicker: Map<string, string> = new Map()): LedgerRow {
  const entry = asRecord(record.entry);
  const alert = record.alert;
  const score = alert?.scores[0];
  const match = alert?.patternMatches[0];
  const alertId = text(entry.alertId ?? record.alertId ?? alert?.id, record.id);
  const priceAtAlert = money(entry.priceAtAlert ?? entry.alertPrice);
  const latestPrice = money(entry.latestPrice ?? entry.currentPrice ?? latestPriceByTicker.get(text(entry.ticker ?? alert?.ticker, "")));
  const oneDayResult = first(entry, ["oneDayResult", "oneDay", "1D", "result1D"]);
  const threeDayResult = first(entry, ["threeDayResult", "threeDay", "3D", "result3D"]);
  const sevenDayResult = first(entry, ["sevenDayResult", "sevenDay", "7D", "result7D"]);
  const thirtyDayResult = first(entry, ["thirtyDayResult", "thirtyDay", "30D", "result30D"]);
  const ninetyDayResult = first(entry, ["ninetyDayResult", "ninetyDay", "90D", "result90D"]);

  return {
    id: record.publicSlug || record.id,
    alertId,
    action: text(entry.action ?? alert?.action),
    ticker: text(entry.ticker ?? alert?.ticker),
    company: text(entry.company ?? alert?.company),
    event: text(entry.event ?? alert?.event, "Ledger outcome record"),
    alertDate: dateText(entry.alertDate ?? entry.publishedAt ?? alert?.publishedAt ?? record.createdAt),
    priceAtAlert,
    latestPrice,
    profitPotentialScore: numberText(entry.profitPotentialScore ?? entry.profitPotential ?? score?.profitPotential),
    evidenceConfidenceScore: numberText(entry.evidenceConfidenceScore ?? entry.evidenceConfidence ?? score?.evidenceConfidence),
    riskLevel: text(entry.riskLevel ?? score?.riskLevel),
    historicalPatternMatch: text(entry.historicalPatternMatch ?? entry.patternMatch ?? match?.confidenceLabel ?? match?.similarity),
    oneDayResult,
    threeDayResult,
    sevenDayResult,
    thirtyDayResult,
    ninetyDayResult,
    maxGain: numberText(entry.maxGain),
    maxDrawdown: numberText(entry.maxDrawdown),
    outcome: outcome(entry.outcome ?? entry.status),
    receiptsCount: Number(entry.receiptsCount ?? alert?.sources.length ?? 0),
    sourceMode: "live",
    result: text(entry.result ?? entry.currentTrackedResult ?? `${outcome(entry.outcome ?? entry.status)}; outcome checkpoints shown when available.`),
  };
}

function formatAction(action: Alert["action"]) {
  if (action === "BUY") return "Buy candidate";
  if (action === "AVOID") return "Avoid";
  return "Watch";
}

function mockRow(alert: Alert): LedgerRow {
  return {
    id: alert.id,
    alertId: alert.id,
    action: formatAction(alert.action),
    ticker: alert.ticker,
    company: alert.company,
    event: alert.event,
    alertDate: alert.eventDate ?? "Preview date pending",
    priceAtAlert: alert.currentPrice,
    latestPrice: "Mock preview only",
    profitPotentialScore: String(alert.profitScore),
    evidenceConfidenceScore: String(alert.confidenceScore),
    riskLevel: alert.riskLevel,
    historicalPatternMatch: alert.patternMatch,
    oneDayResult: "Mock preview pending",
    threeDayResult: "Mock preview pending",
    sevenDayResult: "Mock preview pending",
    thirtyDayResult: "Mock preview pending",
    ninetyDayResult: "Mock preview pending",
    maxGain: "Mock preview pending",
    maxDrawdown: "Mock preview pending",
    outcome: statusByAction[alert.action],
    receiptsCount: alert.receipts.length,
    sourceMode: "mock_fallback",
    result: alert.publicTrackingResult,
    alert,
  };
}

export async function getLedgerData(): Promise<LedgerData> {
  if (!process.env.DATABASE_URL) {
    return { rows: mockAlerts.map(mockRow), sourceMode: "mock_fallback", sourceLabel: "Mock fallback data", summary: "DATABASE_URL is not configured, so this page is showing clearly labelled mock preview rows." };
  }

  try {
    const records = await prisma.publicLedger.findMany({
      include: { alert: { include: { scores: { orderBy: { createdAt: "desc" }, take: 1 }, sources: true, patternMatches: { orderBy: { createdAt: "desc" }, take: 1 } } } },
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    if (records.length > 0) {
      const tickers = Array.from(new Set(records.map((record) => text(asRecord(record.entry).ticker ?? record.alert?.ticker, "")).filter(Boolean)));
      const snapshots = tickers.length
        ? await prisma.priceSnapshot.findMany({ where: { ticker: { in: tickers } }, orderBy: { capturedAt: "desc" }, distinct: ["ticker"] })
        : [];
      const latestPriceByTicker = new Map(snapshots.map((snapshot) => [snapshot.ticker, snapshot.price.toString()]));
      return { rows: records.map((record) => liveRow(record, latestPriceByTicker)), sourceMode: "live", sourceLabel: "Live ledger records", summary: "Showing stored public ledger records and alert outcomes when available." };
    }
  } catch {
    return { rows: mockAlerts.map(mockRow), sourceMode: "mock_fallback", sourceLabel: "Mock fallback data", summary: "Live ledger records could not be loaded in this environment, so this page is showing clearly labelled mock preview rows." };
  }

  return { rows: [], sourceMode: "empty", sourceLabel: "No tracked alerts yet", summary: "No live public ledger records are available yet. Preview examples are not shown when the live ledger is simply empty." };
}

export async function getLedgerEntry(id: string) {
  const data = await getLedgerData();
  return data.rows.find((entry) => entry.id === id || entry.alertId === id);
}
