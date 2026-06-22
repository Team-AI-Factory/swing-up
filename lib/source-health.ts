import { prisma } from "@/lib/db/client";
import { AI_COMMITTEE_AGENTS } from "@/lib/ai-committee/agents";
import { getAiCommitteeProviderStatus } from "@/lib/ai-committee/provider";
import { SOURCE_ALIAS_MAP, aliasesForSource, isSourceAlias, normalizeSourceName } from "@/lib/source-aliases";

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
  { source: "FMP Catalyst", status: process.env.FMP_API_KEY ? "degraded" : "not_configured", usage: "Live catalyst FMP ear", notes: process.env.FMP_API_KEY ? "FMP_API_KEY is configured; run a tiny source check to mark connected/degraded/failed." : "FMP_API_KEY is not configured; optional for first alert." },
  { source: "FRED Macro", status: "degraded", usage: "Required macro data ear", notes: "Canonical FRED macro source uses public fredgraph CSV mode without an API key; waiting for a successful live CSV check." },
  { source: "CoinGecko", status: "degraded", usage: "Required public crypto/risk sentiment ear", notes: "Real CoinGecko adapter and run route are present; waiting for a successful live source run. Rate limits/cooldowns must remain degraded." },
  { source: "Frankfurter FX", status: "degraded", usage: "Required public FX/macro pressure ear", notes: "Real Frankfurter FX adapter and run route are present; waiting for a successful live FX check." },
  { source: "Marketaux Catalyst", status: process.env.MARKETAUX_API_KEY ? "degraded" : "not_configured", usage: "Live catalyst Marketaux ear", notes: process.env.MARKETAUX_API_KEY ? "MARKETAUX_API_KEY is configured; run a tiny source check to mark connected/degraded/failed." : "MARKETAUX_API_KEY is not configured; optional for first alert." },
  { source: "Polygon", status: "not_configured", usage: "Optional paid market data ear", notes: "POLYGON_API_KEY is not configured; optional for first alert." },
  { source: "Alpha Vantage Catalyst", status: process.env.ALPHA_VANTAGE_API_KEY ? "degraded" : "not_configured", usage: "Live catalyst Alpha Vantage ear", notes: process.env.ALPHA_VANTAGE_API_KEY ? "ALPHA_VANTAGE_API_KEY is configured; run a tiny source check to mark connected/degraded/failed." : "ALPHA_VANTAGE_API_KEY is not configured; optional for first alert." },
  { source: "Company Catalyst Watchlist", status: "connected", usage: "Default catalyst watchlist", notes: "Default tickers: NVDA, AAPL, MSFT, TSLA, AMZN, META, GOOGL, AMD, SHOP, PLTR. Preference order: FMP, Alpha Vantage, Marketaux, SEC, Google News RSS, GDELT." },
  { source: "FINRA Short Sale", status: "connected", usage: "Optional public short-sale context ear", notes: "Real FINRA short sale adapter and run route are present but optional." },
  { source: "Wikidata", status: "connected", usage: "Optional public ripple mapping ear", notes: "Real Wikidata adapter and run route are present but optional." },
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


function sourceDiagnosis(row: SourceHealthRecord) {
  const text = `${row.status} ${row.errorMessage ?? ""} ${row.notes ?? ""}`.toLowerCase();
  if (row.source === "FMP Catalyst") {
    if (/not_configured|missing[_ ]key|api key is not configured/.test(text)) return "missing_key";
    if (/403|forbidden|plan_key_blocked/.test(text)) return "plan_key_blocked";
    if (/invalid[_ ]key|invalid api key|unauthorized|401/.test(text)) return "invalid_key";
    if (/plan|subscription|restricted/.test(text)) return "plan_restricted";
    if (/wrong_endpoint_path|404|not found/.test(text)) return "wrong_endpoint_path";
    if (/rate[_ -]?limited|429/.test(text)) return "rate_limited";
    if (["failed", "error"].includes(row.status)) return "unknown_provider_error";
  }
  if (/rate[_ -]?limited|429/.test(text)) return "rate_limited";
  if (/missing[_ ]key|api key is not configured|not_configured/.test(text)) return "missing_key";
  if (["failed", "error", "broken_route", "not_wired"].includes(row.status)) return "unknown_provider_error";
  return null;
}

function sourceNextAction(row: SourceHealthRecord, diagnosis: string | null) {
  if (row.source === "FMP Catalyst" && diagnosis) return "Check FMP key, account activation, or plan access.";
  if (diagnosis === "missing_key") return "Configure the required Railway/API variable or keep this optional source non-blocking.";
  if (diagnosis === "rate_limited") return "Wait for provider rate-limit cooldown, then rerun a tiny source check.";
  if (diagnosis) return "Review provider response and rerun the source check without changing safety gates.";
  return null;
}

function aiCommitteeRuntimeStatus() {
  const provider = getAiCommitteeProviderStatus();
  const modelsConfigured = provider.modelEnvStatus.fast === "configured"
    && provider.modelEnvStatus.deep === "configured"
    && provider.modelEnvStatus.final === "configured";
  return { ready: provider.configured && provider.enabled && modelsConfigured && AI_COMMITTEE_AGENTS.length > 0, provider, modelsConfigured };
}

function serializeRow(row: SourceHealthRecord, hiddenLegacyRowsCount = 0) {
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
      aliases: aliasesForSource(row.source), realOrStubbed: "real", apiKeyNeeded: "OPENAI_API_KEY", railwayVariableNeeded: null, diagnosis: null, nextAction: null, hiddenLegacyRowsCount,
    };
  }
  const diagnosis = sourceDiagnosis(row);
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
    aliases: aliasesForSource(row.source),
    realOrStubbed: isStaleStubRow(row) ? "stubbed" : "real",
    apiKeyNeeded: row.source === "FMP Catalyst" ? "FMP_API_KEY" : row.source === "Alpha Vantage Catalyst" ? "ALPHA_VANTAGE_API_KEY" : row.source === "Marketaux Catalyst" ? "MARKETAUX_API_KEY" : row.source === "Polygon" ? "POLYGON_API_KEY" : null,
    railwayVariableNeeded: row.status === "not_configured" ? (row.source === "FMP Catalyst" ? "FMP_API_KEY" : row.source === "Alpha Vantage Catalyst" ? "ALPHA_VANTAGE_API_KEY" : row.source === "Marketaux Catalyst" ? "MARKETAUX_API_KEY" : row.source === "Polygon" ? "POLYGON_API_KEY" : null) : null,
    diagnosis,
    nextAction: sourceNextAction(row, diagnosis),
    hiddenLegacyRowsCount,
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


function chooseCanonicalRow(rows: SourceHealthRecord[]) {
  return [...rows].sort((a, b) => {
    const aCanonical = normalizeSourceName(a.source) === a.source ? 1 : 0;
    const bCanonical = normalizeSourceName(b.source) === b.source ? 1 : 0;
    if (aCanonical !== bCanonical) return bCanonical - aCanonical;
    return b.checkedAt.getTime() - a.checkedAt.getTime();
  })[0];
}

function mergeSourceRows(rows: SourceHealthRecord[]) {
  const groups = new Map<string, SourceHealthRecord[]>();
  for (const row of rows) {
    const canonical = normalizeSourceName(row.source);
    groups.set(canonical, [...(groups.get(canonical) ?? []), { ...row, source: canonical }]);
  }
  return [...groups.entries()].map(([canonical, group]) => {
    const originalGroup = rows.filter((row) => normalizeSourceName(row.source) === canonical);
    return { row: chooseCanonicalRow(group), hiddenLegacyRowsCount: originalGroup.filter((row) => isSourceAlias(row.source) || isStaleStubRow(row)).length };
  }).sort((a, b) => a.row.source.localeCompare(b.row.source));
}

export async function getSourceHealthDedupeReport() {
  if (!process.env.DATABASE_URL) {
    const rows = Object.entries(SOURCE_ALIAS_MAP).map(([alias, canonicalSource]) => ({ duplicateSourcesFound: false, stalePlaceholderRows: [alias], source: alias, canonicalSource, aliases: aliasesForSource(canonicalSource), actionTaken: "hidden", currentCanonicalStatus: fallbackSourceHealthRows().find((row) => row.source === canonicalSource)?.status ?? "unknown", notes: "DATABASE_URL is not configured; this is the configured alias cleanup map, not a persisted database audit." }));
    return { ok: true, duplicateSourcesFound: 0, stalePlaceholderRows: rows.map((row) => row.source), rows, message: "DATABASE_URL is not configured; returned configured alias cleanup map." };
  }
  const rows = await prisma.sourceHealth.findMany({ orderBy: { source: "asc" } });
  const grouped = new Map<string, SourceHealthRecord[]>();
  for (const row of rows) grouped.set(normalizeSourceName(row.source), [...(grouped.get(normalizeSourceName(row.source)) ?? []), row]);
  const reportRows = [...grouped.entries()].flatMap(([canonicalSource, group]) => group.filter((row) => group.length > 1 || isSourceAlias(row.source) || isStaleStubRow(row)).map((row) => ({
    duplicateSourcesFound: group.length > 1,
    stalePlaceholderRows: isStaleStubRow(row) || isSourceAlias(row.source) ? [row.source] : [],
    source: row.source,
    canonicalSource,
    aliases: aliasesForSource(canonicalSource),
    actionTaken: row.source === canonicalSource && !isStaleStubRow(row) ? "merged" : "hidden",
    currentCanonicalStatus: chooseCanonicalRow(group.map((item) => ({ ...item, source: normalizeSourceName(item.source) }))).status,
    notes: row.notes ?? row.errorMessage ?? null,
  })));
  return { ok: true, duplicateSourcesFound: reportRows.filter((row) => row.duplicateSourcesFound).length, stalePlaceholderRows: reportRows.flatMap((row) => row.stalePlaceholderRows), rows: reportRows };
}


function fallbackSourceHealthRows() {
  const now = new Date();
  return defaultSourceHealthRows.map((row, index) => ({
    id: `fallback-${index}-${normalizeSourceName(row.source).replace(/\s+/g, "-").toLowerCase()}`,
    source: normalizeSourceName(row.source),
    status: row.status,
    checkedAt: now,
    lastSuccessAt: row.lastSuccessAt ?? null,
    responseTimeMs: row.responseTimeMs ?? null,
    errorMessage: null,
    usage: row.usage,
    notes: row.notes,
  } satisfies SourceHealthRecord));
}

export async function getSourceHealth(): Promise<SourceHealthPayload> {
  if (!process.env.DATABASE_URL) {
    return {
      ok: true,
      message: "DATABASE_URL is not configured; showing canonical source-health defaults without persisted rows.",
      sources: mergeSourceRows(fallbackSourceHealthRows()).map(({ row, hiddenLegacyRowsCount }) => serializeRow(row, hiddenLegacyRowsCount)),
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
      sources: mergeSourceRows(rows).map(({ row, hiddenLegacyRowsCount }) => serializeRow(row, hiddenLegacyRowsCount)),
    };
  } catch (error) {
    return {
      ok: false,
      message: summarizeDatabaseError(error),
      sources: [],
    };
  }
}
