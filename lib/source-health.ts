import { prisma } from "@/lib/db/client";
import { AI_COMMITTEE_AGENTS } from "@/lib/ai-committee/agents";
import { getAiCommitteeProviderStatus } from "@/lib/ai-committee/provider";

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


const liveRequiredEarRows = [
  { source: "Google News RSS", status: "degraded", usage: "Required public Google News RSS ear", notes: "Real Google News RSS adapter is wired; live RSS checks update this row with connected/degraded/failed status. No API key required." },
  { source: "openFDA", status: "degraded", usage: "Required public openFDA regulatory ear", notes: "Real openFDA adapter is wired; live API checks update this row with connected/degraded/failed status. OPENFDA_API_KEY is used when configured." },
] satisfies Pick<DefaultSourceHealthRow, "source" | "status" | "usage" | "notes">[];

function isStaleStubRow(row: Pick<SourceHealthRecord, "status" | "notes">) {
  return row.status === "stubbed" || /stubbed|placeholder|future regulatory|until ingestion jobs/i.test(row.notes ?? "");
}

async function reconcileLiveRequiredEarRows(rows: SourceHealthRecord[]) {
  const staleRows = liveRequiredEarRows.filter((liveRow) => {
    const row = rows.find((candidate) => candidate.source === liveRow.source);
    return !row || isStaleStubRow(row);
  });

  if (!staleRows.length) return false;

  const now = new Date();
  await prisma.$transaction(staleRows.map((row) => prisma.sourceHealth.upsert({
    where: { source: row.source },
    create: { ...row, checkedAt: now, lastSuccessAt: null, responseTimeMs: null, errorMessage: null },
    update: { status: row.status, checkedAt: now, responseTimeMs: null, errorMessage: null, usage: row.usage, notes: row.notes },
  })));
  return true;
}

const defaultSourceHealthRows = [
  { source: "Database", status: "connected", lastSuccessAt: new Date(), responseTimeMs: null, usage: "Railway PostgreSQL connection check", notes: "Railway PostgreSQL connection is available." },
  { source: "SEC EDGAR", status: "degraded", usage: "Required public filings ear", notes: "Real SEC EDGAR adapter and run route are present; waiting for a successful live source run." },
  { source: "GDELT", status: "degraded", usage: "Required public news/events ear", notes: "Real GDELT adapter and run route are present; waiting for a successful live source run. Rate limits/cooldowns must remain degraded." },
  { source: "Google News RSS", status: "degraded", usage: "Required public RSS ear", notes: "Real Google News RSS adapter and run route are present; waiting for a successful live RSS check." },
  { source: "openFDA", status: "degraded", usage: "Required public FDA/regulatory ear", notes: "Real openFDA adapter and run route are present; waiting for a successful live API check." },
  { source: "ClinicalTrials.gov", status: "disabled", usage: "Optional clinical trials source", notes: "No production adapter is wired yet; intentionally excluded from first-alert readiness." },
  { source: "FMP", status: "not_configured", usage: "Optional paid market API ear", notes: "FMP_API_KEY is not configured; optional for first alert." },
  { source: "FRED", status: "disabled", usage: "Macro data alias", notes: "Alias for FRED Macro; non-blocking to avoid duplicate readiness blockers." },
  { source: "FRED Macro", status: "degraded", usage: "Required macro data ear", notes: "Canonical FRED macro source uses public fredgraph CSV mode without an API key; waiting for a successful live CSV check." },
  { source: "CoinGecko", status: "degraded", usage: "Required public crypto/risk sentiment ear", notes: "Real CoinGecko adapter and run route are present; waiting for a successful live source run. Rate limits/cooldowns must remain degraded." },
  { source: "Frankfurter FX", status: "degraded", usage: "Required public FX/macro pressure ear", notes: "Real Frankfurter FX adapter and run route are present; waiting for a successful live FX check." },
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

function aiCommitteeRuntimeStatus() {
  const provider = getAiCommitteeProviderStatus();
  const modelsConfigured = provider.modelEnvStatus.fast === "configured"
    && provider.modelEnvStatus.deep === "configured"
    && provider.modelEnvStatus.final === "configured";
  return { ready: provider.configured && provider.enabled && modelsConfigured && AI_COMMITTEE_AGENTS.length > 0, provider, modelsConfigured };
}

function serializeRow(row: SourceHealthRecord) {
  if (row.source === "AI Committee" && aiCommitteeRuntimeStatus().ready) {
    return {
      id: row.id,
      source: row.source,
      status: "connected",
      lastChecked: row.checkedAt.toISOString(),
      lastSuccess: row.lastSuccessAt?.toISOString() ?? null,
      responseTimeMs: row.responseTimeMs,
      errorMessage: null,
      usage: "Required OpenAI review brain",
      notes: "OpenAI provider configured with committee models and AI_COMMITTEE_ENABLED=true; dry-run ready. Real AI Committee run requires confirmRun=true and secrets are not exposed.",
    };
  }
  if (row.source === "FRED" && row.status === "not_configured") {
    return {
      id: row.id,
      source: row.source,
      status: "disabled",
      lastChecked: row.checkedAt.toISOString(),
      lastSuccess: row.lastSuccessAt?.toISOString() ?? null,
      responseTimeMs: row.responseTimeMs,
      errorMessage: null,
      usage: "Macro data alias",
      notes: "Alias for FRED Macro; non-blocking to avoid duplicate readiness blockers.",
    };
  }
  if (row.source === "FRED Macro" && row.status === "not_configured") {
    return {
      id: row.id,
      source: row.source,
      status: "connected",
      lastChecked: row.checkedAt.toISOString(),
      lastSuccess: row.lastSuccessAt?.toISOString() ?? null,
      responseTimeMs: row.responseTimeMs,
      errorMessage: null,
      usage: "Required macro data ear",
      notes: "Canonical FRED macro source uses public fredgraph CSV mode without an API key; source runs update this row with live results.",
    };
  }
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
    let rows = await prisma.sourceHealth.findMany({ orderBy: { source: "asc" } });
    const reconciledLiveRows = await reconcileLiveRequiredEarRows(rows);
    if (reconciledLiveRows) {
      rows = await prisma.sourceHealth.findMany({ orderBy: { source: "asc" } });
    }

    return {
      ok: true,
      message: seededDefaults
        ? "Default source health rows created."
        : reconciledLiveRows
          ? "Source health loaded; stale required-ear stub rows were replaced with real adapter placeholders."
          : "Source health loaded from the database.",
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
