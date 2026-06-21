import { runAlphaVantageIngestion } from "@/lib/ears/alpha-vantage";
import { runCoinGeckoIngestion } from "@/lib/ears/coingecko";
import { runFinraShortSaleIngestion } from "@/lib/ears/finra-short-sale";
import { runFmpIngestion } from "@/lib/ears/fmp";
import { runFrankfurterIngestion } from "@/lib/ears/frankfurter";
import { runFredIngestion } from "@/lib/ears/fred";
import { runGdeltIngestion } from "@/lib/ears/gdelt";
import { runGoogleNewsRssIngestion } from "@/lib/ears/google-news";
import { runMarketauxIngestion } from "@/lib/ears/marketaux";
import { runOpenFdaIngestion } from "@/lib/ears/openfda";
import { runPolygonIngestion } from "@/lib/ears/polygon";
import { DEFAULT_SEC_TICKERS, runSecEdgarIngestion } from "@/lib/ears/sec-edgar";
import { runWikidataRippleIngestion } from "@/lib/ears/wikidata-ripple";

export const TEST_EAR_BATCH_SOURCES = [
  "sec-edgar",
  "gdelt",
  "google-news",
  "fmp",
  "marketaux",
  "polygon",
  "alpha-vantage",
  "fred",
  "openfda",
  "coingecko",
  "frankfurter",
  "finra-short-sale",
  "wikidata-ripple",
] as const;

type TestEarBatchSource = (typeof TEST_EAR_BATCH_SOURCES)[number];
type SourceStatus = "ran" | "skipped" | "warning" | "error";

type TestEarBatchOptions = {
  dryRun?: boolean;
  sources?: string[];
  limitPerSource?: number;
  saveRawSignals?: boolean;
};

type PerSourceSummary = {
  source: TestEarBatchSource;
  status: SourceStatus;
  reason: string | null;
  recordsChecked: number;
  rawSignalsCreated: number;
  duplicatesSkipped: number;
  rejected: number;
  errors: string[];
  warnings: string[];
};

export type TestEarBatchSummary = {
  ok: boolean;
  dryRun: boolean;
  saveRawSignals: boolean;
  sourcesRequested: TestEarBatchSource[];
  sourcesRan: TestEarBatchSource[];
  sourcesSkipped: Array<{ source: string; reason: string }>;
  recordsChecked: number;
  rawSignalsCreated: number;
  duplicatesSkipped: number;
  rejected: number;
  errors: Array<{ source: string; message: string }>;
  warnings: Array<{ source: string; message: string }>;
  perSource: PerSourceSummary[];
  nextRecommendedAction: string;
};

const SOURCE_ALIASES: Record<string, TestEarBatchSource> = {
  sec: "sec-edgar",
  edgar: "sec-edgar",
  "sec-edgar": "sec-edgar",
  gdelt: "gdelt",
  "google-news": "google-news",
  googlenews: "google-news",
  fmp: "fmp",
  marketaux: "marketaux",
  polygon: "polygon",
  "alpha-vantage": "alpha-vantage",
  alphavantage: "alpha-vantage",
  fred: "fred",
  openfda: "openfda",
  "open-fda": "openfda",
  coingecko: "coingecko",
  frankfurter: "frankfurter",
  "frankfurter-fx": "frankfurter",
  "finra-short-sale": "finra-short-sale",
  finra: "finra-short-sale",
  wikidata: "wikidata-ripple",
  "wikidata-ripple": "wikidata-ripple",
};

function normalizeSource(source: string): TestEarBatchSource | null {
  return SOURCE_ALIASES[source.trim().toLowerCase()] ?? null;
}

function selectedSources(sources?: string[]) {
  if (!sources?.length) return [...TEST_EAR_BATCH_SOURCES];
  return [...new Set(sources.map(normalizeSource).filter((source): source is TestEarBatchSource => Boolean(source)))];
}

function limitPerSource(value?: number) {
  if (!Number.isFinite(value) || !value || value < 1) return 3;
  return Math.min(Math.floor(value), 3);
}

function messages(values: unknown) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.filter((value): value is string => typeof value === "string").map((value) => value.slice(0, 240)))];
}


function row(input: Omit<PerSourceSummary, "status" | "reason" | "errors" | "warnings"> & { errors?: string[]; warnings?: string[]; missingKey?: boolean; rateLimited?: boolean }): PerSourceSummary {
  const errors = messages(input.errors);
  const warnings = messages(input.warnings);
  if (input.missingKey) warnings.unshift("missing_key");
  if (input.rateLimited) warnings.unshift("rate_limited");
  const status: SourceStatus = input.missingKey ? "skipped" : errors.length ? "error" : warnings.length ? "warning" : "ran";
  return { ...input, status, reason: input.missingKey ? "missing_key" : null, errors, warnings };
}

function safeError(error: unknown) {
  if (error instanceof Error) return error.message.split("\n")[0]?.slice(0, 240) || "ear test failed";
  return "ear test failed";
}

async function runOne(source: TestEarBatchSource, dryRun: boolean, limit: number): Promise<PerSourceSummary> {
  try {
    if (source === "sec-edgar") {
      const result = await runSecEdgarIngestion({ dryRun, limit, tickers: DEFAULT_SEC_TICKERS.slice(0, 1) });
      return row({ source, recordsChecked: result.tickersChecked, rawSignalsCreated: result.signalsCreated, duplicatesSkipped: result.duplicatesSkipped, rejected: 0, errors: result.errors });
    }
    if (source === "gdelt") {
      const result = await runGdeltIngestion({ dryRun, limit });
      return row({ source, recordsChecked: result.articlesChecked, rawSignalsCreated: result.signalsCreated, duplicatesSkipped: 0, rejected: 0, errors: result.errors, warnings: result.skipReason ? [result.skipReason] : [], rateLimited: result.rateLimited });
    }
    if (source === "google-news") {
      const result = await runGoogleNewsRssIngestion({ dryRun });
      return row({ source, recordsChecked: result.articlesChecked, rawSignalsCreated: result.rawSignalsCreated, duplicatesSkipped: result.duplicatesSkipped, rejected: result.rejected, errors: result.errors });
    }
    if (source === "fmp") {
      const result = await runFmpIngestion({ dryRun, limit });
      return row({ source, recordsChecked: result.recordsChecked, rawSignalsCreated: result.rawSignalsCreated, duplicatesSkipped: result.duplicatesSkipped, rejected: result.rejected, errors: result.errors, missingKey: result.status === "missing_key" });
    }
    if (source === "marketaux") {
      const result = await runMarketauxIngestion({ dryRun });
      return row({ source, recordsChecked: result.articlesChecked, rawSignalsCreated: result.rawSignalsCreated, duplicatesSkipped: result.duplicatesSkipped, rejected: result.rejected, errors: result.errors, missingKey: result.status === "missing_key" });
    }
    if (source === "polygon") {
      const result = await runPolygonIngestion({ dryRun, limit });
      return row({ source, recordsChecked: result.recordsChecked, rawSignalsCreated: result.rawSignalsCreated, duplicatesSkipped: result.duplicatesSkipped, rejected: result.rejected, errors: result.errors, missingKey: result.status === "missing_key" });
    }
    if (source === "alpha-vantage") {
      const result = await runAlphaVantageIngestion({ dryRun, limit });
      return row({ source, recordsChecked: result.recordsChecked, rawSignalsCreated: result.rawSignalsCreated, duplicatesSkipped: result.duplicatesSkipped, rejected: result.rejected, errors: result.errors, missingKey: result.status === "missing_key" });
    }
    if (source === "fred") {
      const result = await runFredIngestion({ dryRun });
      return row({ source, recordsChecked: result.observations.length, rawSignalsCreated: result.persisted ? 1 : 0, duplicatesSkipped: 0, rejected: 0, warnings: result.warnings });
    }
    if (source === "openfda") {
      const result = await runOpenFdaIngestion({ dryRun, limit });
      return row({ source, recordsChecked: result.recordsChecked, rawSignalsCreated: result.rawSignalsCreated, duplicatesSkipped: result.duplicatesSkipped, rejected: result.rejected, errors: result.errors });
    }
    if (source === "coingecko") {
      const result = await runCoinGeckoIngestion({ dryRun, limit });
      return row({ source, recordsChecked: result.assetsChecked, rawSignalsCreated: result.signalsCreated, duplicatesSkipped: result.duplicatesSkipped, rejected: 0, errors: result.errors, rateLimited: result.rateLimited });
    }
    if (source === "frankfurter") {
      const result = await runFrankfurterIngestion({ dryRun, force: true });
      return row({ source, recordsChecked: result.pairsChecked, rawSignalsCreated: result.signalsCreated, duplicatesSkipped: 0, rejected: 0, errors: result.errors, warnings: result.skipReason ? [result.skipReason] : [], rateLimited: result.rateLimited });
    }
    if (source === "finra-short-sale") {
      const result = await runFinraShortSaleIngestion({ dryRun });
      return row({ source, recordsChecked: result.recordsChecked, rawSignalsCreated: result.rawSignalsCreated, duplicatesSkipped: result.duplicatesSkipped, rejected: result.rejected, errors: result.errors });
    }
    const result = await runWikidataRippleIngestion({ dryRun });
    return row({ source, recordsChecked: result.entitiesChecked, rawSignalsCreated: result.rawSignalsCreated, duplicatesSkipped: result.duplicatesSkipped, rejected: result.rejected, warnings: result.warnings });
  } catch (error) {
    const message = safeError(error);
    if (dryRun && !process.env.DATABASE_URL) {
      return { source, status: "warning", reason: null, recordsChecked: 0, rawSignalsCreated: 0, duplicatesSkipped: 0, rejected: 0, errors: [], warnings: ["database_unavailable", message] };
    }
    return { source, status: "error", reason: null, recordsChecked: 0, rawSignalsCreated: 0, duplicatesSkipped: 0, rejected: 0, errors: [message], warnings: [] };
  }
}

export async function runTestEarBatch(options: TestEarBatchOptions = {}): Promise<TestEarBatchSummary> {
  const dryRun = options.dryRun !== false;
  const saveRawSignals = options.saveRawSignals ?? !dryRun;
  const adapterDryRun = dryRun || !saveRawSignals;
  const limit = limitPerSource(options.limitPerSource);
  const requested = selectedSources(options.sources);
  const invalidSources = (options.sources ?? []).filter((source) => !normalizeSource(source));
  const perSource: PerSourceSummary[] = [];


  for (const source of requested) perSource.push(await runOne(source, adapterDryRun, limit));

  const sourcesSkipped = [
    ...invalidSources.map((source) => ({ source, reason: "unsupported_source" })),
    ...perSource.filter((source) => source.status === "skipped").map((source) => ({ source: source.source, reason: source.reason ?? source.warnings[0] ?? "skipped" })),
  ];
  const errors: Array<{ source: string; message: string }> = perSource.flatMap((source) => source.errors.map((message) => ({ source: source.source, message })));
  const warnings: Array<{ source: string; message: string }> = perSource.flatMap((source) => source.warnings.map((message) => ({ source: source.source, message })));
  if (!process.env.DATABASE_URL && !adapterDryRun) warnings.push({ source: "batch", message: "DATABASE_URL is not configured; raw signals and run history cannot be persisted." });
  if (!dryRun && !saveRawSignals) warnings.push({ source: "batch", message: "dryRun=false but saveRawSignals=false, so ears were checked without raw signal writes." });

  const rawSignalsCreated = perSource.reduce((sum, source) => sum + source.rawSignalsCreated, 0);
  const nextRecommendedAction = dryRun
    ? "Review per-source dry-run results, then rerun one or two trusted sources with dryRun=false if the summaries look clean."
    : rawSignalsCreated > 0
      ? "Review /admin/raw-signals for the saved batch and avoid rerunning until duplicates and quality look correct."
      : "No raw signals were created; check skipped sources, missing keys, warnings, and duplicate counts before another write run.";

  return {
    ok: errors.length === 0,
    dryRun,
    saveRawSignals,
    sourcesRequested: requested,
    sourcesRan: perSource.filter((source) => source.status !== "skipped").map((source) => source.source),
    sourcesSkipped,
    recordsChecked: perSource.reduce((sum, source) => sum + source.recordsChecked, 0),
    rawSignalsCreated,
    duplicatesSkipped: perSource.reduce((sum, source) => sum + source.duplicatesSkipped, 0),
    rejected: perSource.reduce((sum, source) => sum + source.rejected, 0),
    errors,
    warnings,
    perSource,
    nextRecommendedAction,
  };
}
