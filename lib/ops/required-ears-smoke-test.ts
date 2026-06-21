import { getSourceCoverage } from "@/lib/engine-start-readiness";
import { runTestEarBatch } from "@/lib/ops/test-ear-batch";

const REQUIRED_SMOKE_SOURCES = ["sec-edgar", "gdelt", "google-news", "openfda", "fred", "coingecko", "frankfurter"] as const;
const DISPLAY: Record<string, string> = { "sec-edgar": "SEC EDGAR", gdelt: "GDELT", "google-news": "Google News RSS", openfda: "openFDA", fred: "FRED Macro", coingecko: "CoinGecko", frankfurter: "Frankfurter FX" };
const KEY_NEEDED: Record<string, string | null> = { "sec-edgar": null, gdelt: null, "google-news": null, openfda: "OPENFDA_API_KEY", fred: "FRED_API_KEY", coingecko: null, frankfurter: null };

type Options = { dryRun?: boolean; limitPerSource?: number; sources?: string[] };

function normalize(source: string) {
  const s = source.trim().toLowerCase();
  if (["sec", "sec-edgar", "edgar"].includes(s)) return "sec-edgar";
  if (["google-news", "googlenews", "google news rss"].includes(s)) return "google-news";
  if (["openfda", "open-fda"].includes(s)) return "openfda";
  if (["fred", "fred-macro", "fred macro"].includes(s)) return "fred";
  if (["frankfurter", "frankfurter-fx"].includes(s)) return "frankfurter";
  if (["gdelt", "coingecko"].includes(s)) return s;
  return null;
}

export async function runRequiredEarsSmokeTest(options: Options = {}) {
  const dryRun = options.dryRun !== false;
  const requested = options.sources?.length ? [...new Set(options.sources.map(normalize).filter((s): s is (typeof REQUIRED_SMOKE_SOURCES)[number] => Boolean(s)))] : [...REQUIRED_SMOKE_SOURCES];
  const batch = await runTestEarBatch({ dryRun, limitPerSource: options.limitPerSource ?? 1, sources: requested, saveRawSignals: !dryRun });
  const coverage = await getSourceCoverage();
  const coverageBySource = new Map(coverage.map((row) => [row.source, row]));

  const sourceResults = batch.perSource.map((row) => {
    const name = DISPLAY[row.source];
    const coverageRow = coverageBySource.get(name);
    const missingKey = KEY_NEEDED[row.source] && !process.env[KEY_NEEDED[row.source]!]?.trim();
    const status = row.warnings.includes("rate_limited") ? "degraded" : row.status === "error" ? "failed" : row.status === "warning" ? "degraded" : row.status === "skipped" ? "not_configured" : row.recordsChecked === 0 ? "degraded" : "connected";
    const stubbed = coverageRow?.realOrStubbed === "stubbed";
    const blocker = Boolean(stubbed || missingKey || status === "failed" || status === "not_configured");
    return { source: name, required: true, status: stubbed ? "stubbed" : status, realOrStubbed: stubbed ? "stubbed" : "real", liveCheckAttempted: row.status !== "skipped", apiKeyNeeded: KEY_NEEDED[row.source], railwayVariableNeeded: missingKey ? KEY_NEEDED[row.source] : null, blocker, recordsChecked: row.recordsChecked, rawSignalsCreated: row.rawSignalsCreated, errors: row.errors, warnings: row.warnings, notes: row.reason ?? coverageRow?.notes ?? null };
  });
  const connected = sourceResults.filter((r) => r.status === "connected").map((r) => r.source);
  const degraded = sourceResults.filter((r) => r.status === "degraded").map((r) => r.source);
  const failed = sourceResults.filter((r) => r.status === "failed").map((r) => r.source);
  const stubbed = sourceResults.filter((r) => r.status === "stubbed").map((r) => r.source);
  const notConfigured = sourceResults.filter((r) => r.status === "not_configured").map((r) => r.source);
  const missingApiKeys = [...new Set(sourceResults.map((r) => r.railwayVariableNeeded).filter((v): v is string => Boolean(v)))];
  const blockers = sourceResults.filter((r) => r.blocker).map((r) => `${r.source}:${r.status}`);
  return { ok: blockers.length === 0, dryRun, readyRequiredEars: blockers.length === 0, sourceResults, connected, degraded, failed, stubbed, notConfigured, missingApiKeys, blockers, warnings: batch.warnings, exactNextFixes: [...missingApiKeys.map((k) => `Set Railway variable ${k}.`), ...blockers.map((b) => `Resolve required ear ${b}.`)] };
}
