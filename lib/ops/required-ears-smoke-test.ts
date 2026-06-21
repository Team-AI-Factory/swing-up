import { runCoinGeckoIngestion } from "@/lib/ears/coingecko";
import { runFrankfurterIngestion } from "@/lib/ears/frankfurter";
import { runFredIngestion } from "@/lib/ears/fred";
import { runGdeltIngestion } from "@/lib/ears/gdelt";
import { runGoogleNewsRssIngestion } from "@/lib/ears/google-news";
import { runOpenFdaIngestion } from "@/lib/ears/openfda";
import { DEFAULT_SEC_TICKERS, runSecEdgarIngestion } from "@/lib/ears/sec-edgar";

const REQUIRED_EARS = ["sec-edgar", "gdelt", "google-news", "openfda", "fred", "coingecko", "frankfurter"] as const;
type RequiredEar = (typeof REQUIRED_EARS)[number];
type EarStatus = "connected" | "degraded" | "failed" | "stubbed" | "not_configured";

type Options = { dryRun?: boolean; limitPerSource?: number; sources?: string[] };

type SourceResult = {
  source: string;
  required: true;
  status: EarStatus;
  realOrStubbed: "real" | "stubbed";
  liveCheckAttempted: boolean;
  apiKeyNeeded: string | null;
  railwayVariableNeeded: string | null;
  blocker: boolean;
  recordsChecked: number;
  rawSignalsCreated: number;
  warnings: string[];
  errors: string[];
  notes: string;
};

const DISPLAY: Record<RequiredEar, string> = {
  "sec-edgar": "SEC EDGAR",
  gdelt: "GDELT",
  "google-news": "Google News RSS",
  openfda: "openFDA",
  fred: "FRED Macro",
  coingecko: "CoinGecko",
  frankfurter: "Frankfurter FX",
};

const ALIASES: Record<string, RequiredEar> = {
  sec: "sec-edgar", edgar: "sec-edgar", "sec-edgar": "sec-edgar", "sec edgar": "sec-edgar",
  gdelt: "gdelt",
  google: "google-news", googlenews: "google-news", "google-news": "google-news", "google news rss": "google-news",
  openfda: "openfda", "open-fda": "openfda",
  fred: "fred", "fred-macro": "fred", "fred macro": "fred",
  coingecko: "coingecko",
  frankfurter: "frankfurter", "frankfurter-fx": "frankfurter", fx: "frankfurter",
};

function limit(value?: number) { return !Number.isFinite(value) || !value || value < 1 ? 1 : Math.min(Math.floor(value), 2); }
function normalizeSources(sources?: string[]) {
  if (!sources?.length) return [...REQUIRED_EARS];
  return [...new Set(sources.map((source) => ALIASES[source.trim().toLowerCase()]).filter((source): source is RequiredEar => Boolean(source)))];
}
function safeError(error: unknown) { return error instanceof Error ? error.message.split("\n")[0]?.slice(0, 240) || "required ear check failed" : "required ear check failed"; }
function classify(records: number, errors: string[], warnings: string[] = []): EarStatus {
  if (errors.length && records === 0) return "failed";
  if (errors.length || warnings.length || records === 0) return "degraded";
  return "connected";
}
function result(source: RequiredEar, status: EarStatus, recordsChecked: number, rawSignalsCreated: number, errors: string[] = [], warnings: string[] = [], notes = "Real adapter check completed."): SourceResult {
  const blocker = status === "failed" || status === "stubbed" || status === "not_configured";
  return { source: DISPLAY[source], required: true, status, realOrStubbed: status === "stubbed" ? "stubbed" : "real", liveCheckAttempted: true, apiKeyNeeded: null, railwayVariableNeeded: null, blocker, recordsChecked, rawSignalsCreated, errors, warnings, notes };
}

async function runOne(source: RequiredEar, dryRun: boolean, perSourceLimit: number): Promise<SourceResult> {
  try {
    if (source === "sec-edgar") { const r = await runSecEdgarIngestion({ dryRun, limit: perSourceLimit, tickers: DEFAULT_SEC_TICKERS.slice(0, 1) }); return result(source, classify(r.tickersChecked, r.errors), r.tickersChecked, r.signalsCreated, r.errors); }
    if (source === "gdelt") { const r = await runGdeltIngestion({ dryRun, limit: perSourceLimit }); return result(source, r.rateLimited ? "degraded" : classify(r.articlesChecked, r.errors, r.skipReason ? [r.skipReason] : []), r.articlesChecked, r.signalsCreated, r.rateLimited ? [] : r.errors, [...(r.skipReason ? [r.skipReason] : []), ...(r.rateLimited ? r.errors : [])], r.rateLimited ? "Rate limited; treated as degraded." : "Real GDELT check completed."); }
    if (source === "google-news") { const r = await runGoogleNewsRssIngestion({ dryRun }); return result(source, classify(r.articlesChecked, r.errors), r.articlesChecked, r.rawSignalsCreated, r.errors, [], "Public RSS feed checked; no API key required."); }
    if (source === "openfda") { const r = await runOpenFdaIngestion({ dryRun, limit: perSourceLimit }); return result(source, r.sourceHealthStatus === "error" ? "failed" : r.sourceHealthStatus, r.recordsChecked, r.rawSignalsCreated, r.errors, [], r.apiKeyConfigured ? "Public openFDA checked with configured optional API key." : "Public openFDA checked without API key."); }
    if (source === "fred") { const r = await runFredIngestion({ dryRun }); return result(source, r.ok ? (r.status === "complete" ? "connected" : "degraded") : "failed", r.observations.length, r.persisted ? 1 : 0, [], r.warnings, `Public FRED CSV checked; FRED_API_KEY configured=${Boolean(process.env.FRED_API_KEY?.trim())}.`); }
    if (source === "coingecko") { const r = await runCoinGeckoIngestion({ dryRun, limit: perSourceLimit }); return result(source, classify(r.assetsChecked, r.errors, r.rateLimited ? ["rate_limited"] : []), r.assetsChecked, r.signalsCreated, r.errors, r.rateLimited ? ["rate_limited"] : []); }
    const r = await runFrankfurterIngestion({ dryRun, force: true }); return result(source, classify(r.pairsChecked, r.errors, r.skipReason ? [r.skipReason] : []), r.pairsChecked, r.signalsCreated, r.errors, r.skipReason ? [r.skipReason] : []);
  } catch (error) {
    return result(source, "failed", 0, 0, [safeError(error)], [], "Real adapter check failed.");
  }
}

export async function runRequiredEarsSmokeTest(options: Options = {}) {
  const dryRun = options.dryRun !== false;
  const selected = normalizeSources(options.sources);
  const sourceResults = await Promise.all(selected.map((source) => runOne(source, dryRun, limit(options.limitPerSource))));
  const connected = sourceResults.filter((r) => r.status === "connected").map((r) => r.source);
  const degraded = sourceResults.filter((r) => r.status === "degraded").map((r) => r.source);
  const failed = sourceResults.filter((r) => r.status === "failed").map((r) => r.source);
  const stubbed = sourceResults.filter((r) => r.status === "stubbed").map((r) => r.source);
  const notConfigured = sourceResults.filter((r) => r.status === "not_configured").map((r) => r.source);
  const missingApiKeys = sourceResults.map((r) => r.railwayVariableNeeded).filter((v): v is string => Boolean(v));
  const blockers = sourceResults.filter((r) => r.blocker).map((r) => `required_source_not_ready:${r.source}`);
  const warnings = sourceResults.flatMap((r) => r.warnings.map((message) => ({ source: r.source, message })));
  return { ok: blockers.length === 0, dryRun, readyRequiredEars: blockers.length === 0, sourceResults, connected, degraded, failed, stubbed, notConfigured, missingApiKeys: [...new Set(missingApiKeys)], blockers, warnings, exactNextFixes: blockers.map((b) => `Resolve ${b} with the real adapter check; do not publish alerts until clear.`) };
}
