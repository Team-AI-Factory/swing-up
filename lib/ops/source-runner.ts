import { runCoinGeckoIngestion } from "@/lib/ears/coingecko";
import { runFrankfurterIngestion } from "@/lib/ears/frankfurter";
import { runFredIngestion } from "@/lib/ears/fred";
import { runGdeltIngestion } from "@/lib/ears/gdelt";
import { DEFAULT_SEC_TICKERS, runSecEdgarIngestion } from "@/lib/ears/sec-edgar";

const SOURCE_ALIASES = {
  gdelt: "GDELT",
  coingecko: "CoinGecko",
  frankfurter: "Frankfurter FX",
  "frankfurter-fx": "Frankfurter FX",
  fred: "FRED Macro",
  "fred-macro": "FRED Macro",
  sec: "SEC EDGAR",
  "sec-edgar": "SEC EDGAR",
  edgar: "SEC EDGAR",
} as const;

export const DEFAULT_SOURCE_RUN_ORDER = ["GDELT", "CoinGecko", "Frankfurter FX", "FRED Macro", "SEC EDGAR"] as const;
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
  recordsChecked: number;
  signalsCreated: number;
  error: string | null;
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

function baseRow(sourceName: RunnableSourceName, dryRun: boolean): SourceRunSummaryRow {
  return { sourceName, status: "error", recordsChecked: 0, signalsCreated: 0, error: null, sourceHealthUpdated: false, dryRun };
}

async function runOne(sourceName: RunnableSourceName, options: Required<Pick<SourceRunOptions, "dryRun">> & SourceRunOptions): Promise<SourceRunSummaryRow> {
  const row = baseRow(sourceName, options.dryRun);

  try {
    if (sourceName === "GDELT") {
      const result = await runGdeltIngestion({ dryRun: options.dryRun, limit: options.limit ?? 50 });
      return { ...row, status: result.skipped ? "skipped" : result.ok && !result.rateLimited && !result.fallbackUsed ? "ok" : result.ok ? "degraded" : "error", recordsChecked: result.articlesChecked, signalsCreated: result.signalsCreated, error: result.errors[0] ?? result.skipReason ?? null, sourceHealthUpdated: sourceHealthCanPersist() };
    }

    if (sourceName === "CoinGecko") {
      const result = await runCoinGeckoIngestion({ dryRun: options.dryRun, limit: options.limit });
      return { ...row, status: result.ok && !result.rateLimited ? "ok" : result.ok ? "degraded" : "error", recordsChecked: result.assetsChecked, signalsCreated: result.signalsCreated, error: result.errors[0] ?? null, sourceHealthUpdated: sourceHealthCanPersist() };
    }

    if (sourceName === "Frankfurter FX") {
      const result = await runFrankfurterIngestion({ dryRun: options.dryRun, force: options.force });
      return { ...row, status: result.skipped ? "skipped" : result.ok && !result.rateLimited ? "ok" : result.ok ? "degraded" : "error", recordsChecked: result.pairsChecked, signalsCreated: result.signalsCreated, error: result.errors[0] ?? result.skipReason ?? null, sourceHealthUpdated: sourceHealthCanPersist() && !result.skipped };
    }

    if (sourceName === "FRED Macro") {
      const result = await runFredIngestion({ dryRun: options.dryRun });
      return { ...row, status: result.ok && result.status === "complete" ? "ok" : result.ok ? "degraded" : "error", recordsChecked: result.observations.length, signalsCreated: result.persisted ? 1 : 0, error: result.warnings[0] ?? null, sourceHealthUpdated: sourceHealthCanPersist() };
    }

    const result = await runSecEdgarIngestion({ dryRun: options.dryRun, tickers: (options.tickers?.length ? options.tickers : DEFAULT_SEC_TICKERS).slice(0, 2), limit: Math.min(options.limit ?? 3, 3) });
    return { ...row, status: result.ok && !result.errors.length ? "ok" : result.ok ? "degraded" : "error", recordsChecked: result.tickersChecked, signalsCreated: result.signalsCreated, error: result.errors[0] ?? null, sourceHealthUpdated: sourceHealthCanPersist() };
  } catch (error) {
    return { ...row, status: "error", error: safeError(error), sourceHealthUpdated: false };
  }
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
