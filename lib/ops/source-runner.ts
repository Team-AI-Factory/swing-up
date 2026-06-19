import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { runCoinGeckoIngestion } from "@/lib/ears/coingecko";
import { runFrankfurterIngestion } from "@/lib/ears/frankfurter";
import { runFmpIngestion } from "@/lib/ears/fmp";
import { runFredIngestion } from "@/lib/ears/fred";
import { runGdeltIngestion } from "@/lib/ears/gdelt";
import { runMarketauxIngestion } from "@/lib/ears/marketaux";
import { runOpenFdaIngestion } from "@/lib/ears/openfda";
import { runPolygonIngestion } from "@/lib/ears/polygon";
import { DEFAULT_SEC_TICKERS, runSecEdgarIngestion } from "@/lib/ears/sec-edgar";

const SOURCE_ALIASES = {
  gdelt: "GDELT",
  coingecko: "CoinGecko",
  frankfurter: "Frankfurter FX",
  "frankfurter-fx": "Frankfurter FX",
  fmp: "FMP",
  fred: "FRED Macro",
  "fred-macro": "FRED Macro",
  marketaux: "Marketaux",
  polygon: "Polygon",
  openfda: "openFDA",
  "open-fda": "openFDA",
  fda: "openFDA",
  sec: "SEC EDGAR",
  "sec-edgar": "SEC EDGAR",
  edgar: "SEC EDGAR",
} as const;

export const DEFAULT_SOURCE_RUN_ORDER = ["GDELT", "CoinGecko", "Frankfurter FX", "FMP", "FRED Macro", "Marketaux", "Polygon", "openFDA", "SEC EDGAR"] as const;
export type RunnableSourceName = (typeof DEFAULT_SOURCE_RUN_ORDER)[number];

type SourceRunOptions = {
  dryRun?: boolean;
  sources?: string[];
  limit?: number;
  tickers?: string[];
  force?: boolean;
};

export type SourceRunSummaryRow = {
  sourceName: RunnableSourceName;
  status: "ok" | "degraded" | "error" | "skipped";
  startedAt: string;
  finishedAt: string;
  recordsChecked: number;
  signalsCreated: number;
  duplicatesSkipped: number;
  errors: string[];
  error: string | null;
  sourceHealthStatus: string | null;
  sourceHealthUpdated: boolean;
  dryRun: boolean;
};

export type SourceRunSummary = {
  ok: boolean;
  dryRun: boolean;
  sourcesRequested: RunnableSourceName[];
  table: SourceRunSummaryRow[];
};

function normalizeSourceName(source: string): RunnableSourceName | null {
  const key = source.trim().toLowerCase();
  const aliased = SOURCE_ALIASES[key as keyof typeof SOURCE_ALIASES];
  if (aliased) return aliased;
  return DEFAULT_SOURCE_RUN_ORDER.find((name) => name.toLowerCase() === key) ?? null;
}

function selectedSources(sources?: string[]) {
  if (!sources?.length) return [...DEFAULT_SOURCE_RUN_ORDER];
  const selected = sources.map(normalizeSourceName).filter((source): source is RunnableSourceName => Boolean(source));
  return selected.length ? [...new Set(selected)] : [...DEFAULT_SOURCE_RUN_ORDER];
}

function safeError(error: unknown) {
  if (error instanceof Error) return error.message.split("\n")[0]?.slice(0, 220) || "Source run failed";
  return "Source run failed";
}

function sourceHealthCanPersist() {
  return Boolean(process.env.DATABASE_URL);
}

function baseRow(sourceName: RunnableSourceName, dryRun: boolean, startedAt = new Date()): SourceRunSummaryRow {
  const timestamp = startedAt.toISOString();
  return { sourceName, status: "error", startedAt: timestamp, finishedAt: timestamp, recordsChecked: 0, signalsCreated: 0, duplicatesSkipped: 0, errors: [], error: null, sourceHealthStatus: null, sourceHealthUpdated: false, dryRun };
}

function finishRow(row: SourceRunSummaryRow, patch: Partial<SourceRunSummaryRow>): SourceRunSummaryRow {
  const errors = patch.errors ?? (patch.error ? [patch.error] : row.errors);
  const error = patch.error ?? errors[0] ?? null;
  return { ...row, ...patch, errors, error, finishedAt: new Date().toISOString() };
}

async function sourceHealthStatus(sourceName: RunnableSourceName) {
  if (!process.env.DATABASE_URL) return null;
  const row = await prisma.sourceHealth.findUnique({ where: { source: sourceName }, select: { status: true } });
  return row?.status ?? null;
}

async function recordSourceRun(row: SourceRunSummaryRow) {
  if (!process.env.DATABASE_URL) return;
  try {
    await prisma.sourceRun.create({
      data: {
        source: row.sourceName,
        startedAt: new Date(row.startedAt),
        finishedAt: new Date(row.finishedAt),
        status: row.status,
        dryRun: row.dryRun,
        recordsChecked: row.recordsChecked,
        signalsCreated: row.signalsCreated,
        duplicatesSkipped: row.duplicatesSkipped,
        errors: row.errors as Prisma.InputJsonValue,
        sourceHealthStatus: row.sourceHealthStatus,
      },
    });
  } catch {
    // Source run history is audit-only and should never make ingestion fail.
  }
}

async function runOne(sourceName: RunnableSourceName, options: Required<Pick<SourceRunOptions, "dryRun">> & SourceRunOptions): Promise<SourceRunSummaryRow> {
  const row = baseRow(sourceName, options.dryRun);
  let finished = row;

  try {
    if (sourceName === "GDELT") {
      const result = await runGdeltIngestion({ dryRun: options.dryRun, limit: options.limit ?? 50 });
      finished = finishRow(row, { status: result.skipped ? "skipped" : result.ok && !result.rateLimited && !result.fallbackUsed ? "ok" : result.ok ? "degraded" : "error", recordsChecked: result.articlesChecked, signalsCreated: result.signalsCreated, duplicatesSkipped: 0, errors: [...result.errors, ...(result.skipReason ? [result.skipReason] : [])], sourceHealthUpdated: sourceHealthCanPersist() });
    } else if (sourceName === "CoinGecko") {
      const result = await runCoinGeckoIngestion({ dryRun: options.dryRun, limit: options.limit });
      finished = finishRow(row, { status: result.ok && !result.rateLimited ? "ok" : result.ok ? "degraded" : "error", recordsChecked: result.assetsChecked, signalsCreated: result.signalsCreated, duplicatesSkipped: result.duplicatesSkipped, errors: result.errors, sourceHealthUpdated: sourceHealthCanPersist() });
    } else if (sourceName === "Frankfurter FX") {
      const result = await runFrankfurterIngestion({ dryRun: options.dryRun, force: options.force });
      finished = finishRow(row, { status: result.skipped ? "skipped" : result.ok && !result.rateLimited ? "ok" : result.ok ? "degraded" : "error", recordsChecked: result.pairsChecked, signalsCreated: result.signalsCreated, duplicatesSkipped: 0, errors: [...result.errors, ...(result.skipReason ? [result.skipReason] : [])], sourceHealthUpdated: sourceHealthCanPersist() && !result.skipped });
    } else if (sourceName === "FMP") {
      const result = await runFmpIngestion({ dryRun: options.dryRun, limit: options.limit, tickers: options.tickers });
      finished = finishRow(row, { status: result.status === "missing_key" ? "skipped" : result.ok && !result.errors.length ? "ok" : result.ok ? "degraded" : "error", recordsChecked: result.recordsChecked, signalsCreated: result.rawSignalsCreated, duplicatesSkipped: result.duplicatesSkipped, errors: result.status === "missing_key" ? ["missing_key"] : result.errors, sourceHealthUpdated: sourceHealthCanPersist() });
    } else if (sourceName === "FRED Macro") {
      const result = await runFredIngestion({ dryRun: options.dryRun });
      finished = finishRow(row, { status: result.ok && result.status === "complete" ? "ok" : result.ok ? "degraded" : "error", recordsChecked: result.observations.length, signalsCreated: result.persisted ? 1 : 0, duplicatesSkipped: 0, errors: result.warnings, sourceHealthUpdated: sourceHealthCanPersist() });
    } else if (sourceName === "Marketaux") {
      const result = await runMarketauxIngestion({ dryRun: options.dryRun });
      finished = finishRow(row, { status: result.status === "missing_key" ? "skipped" : result.ok && !result.errors.length ? "ok" : result.ok ? "degraded" : "error", recordsChecked: result.articlesChecked, signalsCreated: result.rawSignalsCreated, duplicatesSkipped: result.duplicatesSkipped, errors: result.status === "missing_key" ? ["missing_key"] : result.errors, sourceHealthUpdated: sourceHealthCanPersist() });
    } else if (sourceName === "Polygon") {
      const result = await runPolygonIngestion({ dryRun: options.dryRun, limit: options.limit, tickers: options.tickers });
      finished = finishRow(row, { status: result.status === "missing_key" ? "skipped" : result.ok && !result.errors.length ? "ok" : result.ok ? "degraded" : "error", recordsChecked: result.recordsChecked, signalsCreated: result.rawSignalsCreated, duplicatesSkipped: result.duplicatesSkipped, errors: result.status === "missing_key" ? ["missing_key"] : result.errors, sourceHealthUpdated: sourceHealthCanPersist() });
    } else if (sourceName === "openFDA") {
      const result = await runOpenFdaIngestion({ dryRun: options.dryRun, limit: options.limit });
      finished = finishRow(row, { status: result.ok ? "ok" : "error", recordsChecked: result.recordsChecked, signalsCreated: result.rawSignalsCreated, duplicatesSkipped: result.duplicatesSkipped, errors: result.errors, sourceHealthUpdated: sourceHealthCanPersist() });
    } else {
      const result = await runSecEdgarIngestion({ dryRun: options.dryRun, tickers: (options.tickers?.length ? options.tickers : DEFAULT_SEC_TICKERS).slice(0, 2), limit: Math.min(options.limit ?? 3, 3) });
      finished = finishRow(row, { status: result.ok && !result.errors.length ? "ok" : result.ok ? "degraded" : "error", recordsChecked: result.tickersChecked, signalsCreated: result.signalsCreated, duplicatesSkipped: result.duplicatesSkipped, errors: result.errors, sourceHealthUpdated: sourceHealthCanPersist() });
    }
  } catch (error) {
    finished = finishRow(row, { status: "error", errors: [safeError(error)], sourceHealthUpdated: false });
  }

  finished.sourceHealthStatus = await sourceHealthStatus(sourceName).catch(() => null);
  await recordSourceRun(finished);
  return finished;
}

export async function runSources(options: SourceRunOptions = {}): Promise<SourceRunSummary> {
  const dryRun = options.dryRun !== false;
  const sourcesRequested = selectedSources(options.sources);
  const table: SourceRunSummaryRow[] = [];

  for (const sourceName of sourcesRequested) {
    table.push(await runOne(sourceName, { ...options, dryRun }));
  }

  return { ok: table.every((row) => row.status !== "error"), dryRun, sourcesRequested, table };
}
