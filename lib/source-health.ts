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

const safeStatuses = new Set(["connected", "not_configured", "stubbed", "degraded", "failed", "disabled", "broken_route", "not_wired"]);

const defaultSourceHealthRows = [
  { source: "Database", status: "connected", lastSuccessAt: new Date(), responseTimeMs: null, usage: "Railway PostgreSQL connection check", notes: "Railway PostgreSQL connection is available." },
  { source: "SEC EDGAR", status: "connected", usage: "Required public filings ear", notes: "Real SEC EDGAR adapter and run route are present; source runs update this row with live results." },
  { source: "GDELT", status: "connected", usage: "Required public news/events ear", notes: "Real GDELT adapter and run route are present; rate limits/cooldowns must be reported as degraded." },
  { source: "Google News RSS", status: "connected", usage: "Required public RSS ear", notes: "Real Google News RSS adapter and run route are present." },
  { source: "openFDA", status: "connected", usage: "Required public FDA/regulatory ear", notes: "Real openFDA adapter and run route are present." },
  { source: "ClinicalTrials.gov", status: "disabled", usage: "Optional clinical trials source", notes: "No production adapter is wired yet; intentionally excluded from first-alert readiness." },
  { source: "FMP", status: "not_configured", usage: "Optional paid market API ear", notes: "FMP_API_KEY is not configured; optional for first alert." },
  { source: "FRED", status: "not_configured", usage: "Required macro data ear", notes: "FRED_API_KEY is the Railway variable for production macro checks." },
  { source: "FRED Macro", status: "not_configured", usage: "Required macro data ear", notes: "Canonical source runner name for FRED; set FRED_API_KEY for production macro checks." },
  { source: "CoinGecko", status: "connected", usage: "Required public crypto/risk sentiment ear", notes: "Real CoinGecko adapter and run route are present; rate limits/cooldowns must be reported as degraded." },
  { source: "Frankfurter FX", status: "connected", usage: "Required public FX/macro pressure ear", notes: "Real Frankfurter FX adapter and run route are present." },
  { source: "Marketaux", status: "not_configured", usage: "Optional paid news ear", notes: "MARKETAUX_API_KEY is not configured; optional for first alert." },
  { source: "Polygon", status: "not_configured", usage: "Optional paid market data ear", notes: "POLYGON_API_KEY is not configured; optional for first alert." },
  { source: "Alpha Vantage", status: "not_configured", usage: "Optional backup market/fundamentals ear", notes: "ALPHA_VANTAGE_API_KEY is not configured; optional for first alert." },
  { source: "FINRA Short Sale", status: "connected", usage: "Optional public short-sale context ear", notes: "Real FINRA short sale adapter and run route are present but optional." },
  { source: "Wikidata", status: "connected", usage: "Optional public ripple mapping ear", notes: "Real Wikidata adapter and run route are present but optional." },
  { source: "Wikidata ripple mapping", status: "connected", usage: "Optional public ripple mapping alias", notes: "Alias for Wikidata ripple mapping; optional for first alert." },
  { source: "AI Committee", status: "not_configured", usage: "Required OpenAI review brain", notes: "Requires OPENAI_API_KEY, AI_COMMITTEE_ENABLED=true, AI_COMMITTEE_FAST_MODEL, AI_COMMITTEE_DEEP_MODEL, and AI_COMMITTEE_FINAL_MODEL." },
  { source: "Telegram", status: "disabled", usage: "Optional notification integration", notes: "Telegram is intentionally excluded from first-alert readiness." },
  { source: "Stripe Managed Payments", status: "disabled", usage: "Payments provider", notes: "Payments are not part of engine-start readiness." },
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
    status: safeStatuses.has(row.status) ? row.status : "failed",
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
