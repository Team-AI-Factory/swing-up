import { prisma } from "@/lib/db/client";

type DefaultSourceHealthRow = {
  source: string;
  status: string;
  lastSuccessAt?: Date;
  responseTimeMs?: number | null;
  usage: string;
  notes: string;
};

type SourceHealthRecord = {
  id: string;
  source: string;
  status: string;
  checkedAt: Date;
  lastSuccessAt: Date | null;
  responseTimeMs: number | null;
  errorMessage: string | null;
  usage: string | null;
  notes: string | null;
};

const safeStatuses = new Set(["connected", "not_configured", "stubbed", "degraded", "error"]);

const defaultSourceHealthRows = [
  {
    source: "Database",
    status: "connected",
    lastSuccessAt: new Date(),
    responseTimeMs: null,
    usage: "Railway PostgreSQL connection check",
    notes: "Railway PostgreSQL connection is available.",
  },
  {
    source: "SEC EDGAR",
    status: "stubbed",
    usage: "Public filings source placeholder",
    notes: "SEC EDGAR integration is stubbed until filing ingestion is added.",
  },
  { source: "FMP", status: "not_configured", usage: "Paid market API placeholder", notes: "API key not configured yet." },
  { source: "GDELT", status: "stubbed", usage: "Public events/news placeholder", notes: "GDELT ingestion is stubbed until background jobs are added." },
  { source: "FRED", status: "not_configured", usage: "Macro data key placeholder", notes: "API key not configured yet." },
  { source: "openFDA", status: "stubbed", usage: "Public health API placeholder", notes: "openFDA integration is stubbed for future regulatory and medical event signals." },
  { source: "ClinicalTrials.gov", status: "stubbed", usage: "Public trials API placeholder", notes: "ClinicalTrials.gov integration is stubbed for future trial status changes." },
  { source: "Google News RSS", status: "stubbed", usage: "RSS polling placeholder", notes: "Google News RSS polling is stubbed until ingestion jobs are added." },
  { source: "CoinGecko", status: "stubbed", usage: "Public crypto API placeholder", notes: "CoinGecko integration is stubbed for crypto market context." },
  { source: "Frankfurter FX", status: "stubbed", usage: "Public FX API placeholder", notes: "Frankfurter FX integration is stubbed for foreign exchange context." },
  { source: "AI Committee", status: "stubbed", usage: "No real AI calls", notes: "AI Committee is stubbed and does not call AI providers." },
  { source: "Telegram", status: "not_configured", usage: "Notification integration placeholder", notes: "Notification integration not connected yet." },
  { source: "Stripe Managed Payments", status: "not_configured", usage: "Payments provider placeholder", notes: "Payment integration will be added last." },
] satisfies DefaultSourceHealthRow[];

function isUniqueConstraintError(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

function summarizeDatabaseError(error: unknown) {
  if (error instanceof Error) {
    return error.message.split("\n")[0]?.slice(0, 160) || "Database connection failed";
  }

  return "Database connection failed";
}

function serializeRow(row: SourceHealthRecord) {
  return {
    id: row.id,
    source: row.source,
    status: safeStatuses.has(row.status) ? row.status : "error",
    lastChecked: row.checkedAt.toISOString(),
    lastSuccess: row.lastSuccessAt?.toISOString() ?? null,
    responseTimeMs: row.responseTimeMs,
    errorMessage: row.errorMessage ? row.errorMessage.slice(0, 240) : null,
    usage: row.usage,
    notes: row.notes,
  };
}

export type SerializedSourceHealth = ReturnType<typeof serializeRow>;

export type SourceHealthPayload = {
  ok: boolean;
  message: string;
  sources: SerializedSourceHealth[];
};

export async function ensureDefaultSourceHealthRows() {
  const existingRows = await prisma.sourceHealth.count();

  if (existingRows > 0) {
    return false;
  }

  const now = new Date();

  try {
    await prisma.sourceHealth.createMany({
      data: defaultSourceHealthRows.map((row) => ({
        ...row,
        checkedAt: now,
        lastSuccessAt: row.source === "Database" ? now : row.lastSuccessAt,
        errorMessage: null,
      })),
      skipDuplicates: true,
    });
  } catch (error) {
    if (!isUniqueConstraintError(error)) {
      throw error;
    }
  }

  return true;
}

export async function getSourceHealth(): Promise<SourceHealthPayload> {
  if (!process.env.DATABASE_URL) {
    return {
      ok: false,
      message: "DATABASE_URL is not configured, so source health cannot be loaded yet.",
      sources: [],
    };
  }

  try {
    const seededDefaults = await ensureDefaultSourceHealthRows();
    const rows = await prisma.sourceHealth.findMany({ orderBy: { source: "asc" } });

    return {
      ok: true,
      message: seededDefaults ? "Default source health rows created." : "Source health loaded from the database.",
      sources: rows.map(serializeRow),
    };
  } catch (error) {
    return {
      ok: false,
      message: summarizeDatabaseError(error),
      sources: [],
    };
  }
}
