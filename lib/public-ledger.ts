import { mockAlerts } from "@/lib/mock-alerts";
import { prisma } from "@/lib/db/client";

type LedgerOutcome = "tracking" | "win" | "neutral" | "loss";

export type PublicLedgerRecord = {
  id: string;
  href: string;
  sourceLabel: "Database record" | "Mock preview data";
  action: string;
  ticker: string;
  company: string;
  alertDate: string;
  priceAtAlert: string;
  latestTrackedPrice: string;
  profitPotentialScore: string;
  evidenceConfidenceScore: string;
  riskLevel: string;
  historicalPatternMatch: string;
  result1d: string;
  result3d: string;
  result7d: string;
  result30d: string;
  result90d: string;
  maxGain: string;
  maxDrawdown: string;
  outcome: LedgerOutcome;
  receiptsCount: number;
  notes: string;
};

type PublicLedgerEntry = Partial<Record<keyof Omit<PublicLedgerRecord, "id" | "href" | "sourceLabel">, unknown>> & {
  currentPrice?: unknown;
  currentTrackedPrice?: unknown;
  latestPrice?: unknown;
  status?: unknown;
};

function formatDate(value: Date | string | null | undefined) {
  if (!value) return "Pending";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "Pending";
  return date.toISOString().slice(0, 10);
}

function asText(value: unknown, fallback = "Pending") {
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}

function asOutcome(value: unknown): LedgerOutcome {
  return value === "win" || value === "neutral" || value === "loss" || value === "tracking" ? value : "tracking";
}

function asCount(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export const requiredLedgerDisclaimer =
  "Swing Up provides market research and decision-support information. It does not guarantee returns. Investing involves risk, including possible loss of capital. Users are responsible for their own decisions.";

export const mockLedgerRecords: PublicLedgerRecord[] = mockAlerts.map((alert, index) => ({
  id: alert.id,
  href: `/ledger/${alert.id}`,
  sourceLabel: "Mock preview data",
  action: alert.action,
  ticker: alert.ticker,
  company: alert.company,
  alertDate: `2026-06-${String(18 - index).padStart(2, "0")}`,
  priceAtAlert: alert.currentPrice,
  latestTrackedPrice: index === 1 ? "$68.25" : "Pending live tracking",
  profitPotentialScore: String(alert.profitScore),
  evidenceConfidenceScore: String(alert.confidenceScore),
  riskLevel: alert.riskLevel,
  historicalPatternMatch: alert.patternMatch.split(" with ")[0] ?? alert.patternMatch,
  result1d: index === 1 ? "+1.2% preview" : "Pending",
  result3d: "Pending",
  result7d: "Pending",
  result30d: "Pending",
  result90d: "Pending",
  maxGain: index === 1 ? "+4.1% preview" : "Pending",
  maxDrawdown: index === 2 ? "-1.6% preview" : "Pending",
  outcome: index === 1 ? "tracking" : "tracking",
  receiptsCount: alert.receipts.length,
  notes: "Preview row only. Not a published real alert.",
}));

export async function getPublicLedgerRecords(): Promise<{ records: PublicLedgerRecord[]; usingMock: boolean; databaseUnavailable: boolean }> {
  if (!process.env.DATABASE_URL) {
    return { records: [], usingMock: false, databaseUnavailable: false };
  }

  try {
    const rows = await prisma.publicLedger.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { alert: { include: { scores: { orderBy: { createdAt: "desc" }, take: 1 }, sources: true, patternMatches: { orderBy: { createdAt: "desc" }, take: 1 } } } },
    });

    return {
      usingMock: false,
      databaseUnavailable: false,
      records: rows.map((row) => {
        const entry = (row.entry && typeof row.entry === "object" ? row.entry : {}) as PublicLedgerEntry;
        const score = row.alert?.scores[0];
        const pattern = row.alert?.patternMatches[0];
        return {
          id: row.publicSlug,
          href: `/ledger/${row.publicSlug}`,
          sourceLabel: "Database record",
          action: asText(entry.action, row.alert?.action ?? "Pending"),
          ticker: asText(entry.ticker, row.alert?.ticker ?? "Pending"),
          company: asText(entry.company, row.alert?.company ?? "Pending"),
          alertDate: asText(entry.alertDate, formatDate(row.alert?.publishedAt ?? row.createdAt)),
          priceAtAlert: asText(entry.priceAtAlert),
          latestTrackedPrice: asText(entry.latestTrackedPrice ?? entry.currentTrackedPrice ?? entry.currentPrice ?? entry.latestPrice),
          profitPotentialScore: asText(entry.profitPotentialScore, score ? String(score.profitPotential) : "Pending"),
          evidenceConfidenceScore: asText(entry.evidenceConfidenceScore, score ? String(score.evidenceConfidence) : "Pending"),
          riskLevel: asText(entry.riskLevel, score?.riskLevel ?? "Pending"),
          historicalPatternMatch: asText(entry.historicalPatternMatch, pattern ? `${pattern.similarity}% similarity` : "Pending"),
          result1d: asText(entry.result1d),
          result3d: asText(entry.result3d),
          result7d: asText(entry.result7d),
          result30d: asText(entry.result30d),
          result90d: asText(entry.result90d),
          maxGain: asText(entry.maxGain),
          maxDrawdown: asText(entry.maxDrawdown),
          outcome: asOutcome(entry.outcome ?? entry.status),
          receiptsCount: asCount(entry.receiptsCount) || row.alert?.sources.length || 0,
          notes: asText(entry.notes, "Public tracking record. Delayed fields may remain pending until enough time has elapsed."),
        };
      }),
    };
  } catch {
    return { records: [], usingMock: false, databaseUnavailable: true };
  }
}

export async function getPublicLedgerRecord(id: string) {
  const { records } = await getPublicLedgerRecords();
  return records.find((record) => record.id === id) ?? mockLedgerRecords.find((record) => record.id === id);
}
