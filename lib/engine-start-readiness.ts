import { existsSync } from "node:fs";
import path from "node:path";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { getAiCommitteeProviderStatus } from "@/lib/ai-committee/provider";
import { AI_COMMITTEE_AGENTS } from "@/lib/ai-committee/agents";
import { getSourceHealth } from "@/lib/source-health";

export type SourceTruthStatus = "connected" | "degraded" | "not_configured" | "stubbed" | "failed" | "disabled" | "broken_route" | "not_wired";

type SourceDefinition = {
  name: string;
  required: boolean;
  route?: string;
  adapter?: string;
  apiKey?: string;
  disabledReason?: string;
  notes: string;
};

export const SOURCE_DEFINITIONS: SourceDefinition[] = [
  { name: "SEC EDGAR", required: true, route: "app/api/ears/sec-edgar/run/route.ts", adapter: "lib/ears/sec-edgar.ts", notes: "Required public filings ear; uses SEC public endpoints." },
  { name: "GDELT", required: true, route: "app/api/ears/gdelt/run/route.ts", adapter: "lib/ears/gdelt.ts", notes: "Required public news/events ear; rate limits are degraded, not connected." },
  { name: "Google News RSS", required: true, route: "app/api/ears/google-news/run/route.ts", adapter: "lib/ears/google-news.ts", notes: "Required public RSS ear." },
  { name: "openFDA", required: true, route: "app/api/ears/openfda/run/route.ts", adapter: "lib/ears/openfda.ts", notes: "Required public FDA/regulatory ear." },
  { name: "ClinicalTrials.gov", required: false, disabledReason: "No production adapter is wired yet; optional for first alert.", notes: "Optional clinical-trials source intentionally excluded from first-alert gate until implemented." },
  { name: "FRED", required: false, route: "app/api/ears/fred/run/route.ts", adapter: "lib/ears/fred.ts", disabledReason: "Alias for FRED Macro; non-blocking to avoid duplicate blockers for the same macro dependency.", notes: "Alias for canonical FRED Macro source." },
  { name: "FRED Macro", required: true, route: "app/api/ears/fred/run/route.ts", adapter: "lib/ears/fred.ts", notes: "Required canonical macro ear; uses public FRED fredgraph CSV mode without an API key. FRED_API_KEY may be configured for future API mode but is not required by this adapter." },
  { name: "FMP Catalyst", required: false, route: "app/api/ears/fmp/run/route.ts", adapter: "lib/ears/fmp.ts", apiKey: "FMP_API_KEY", notes: "Optional paid live catalyst ear; missing key should not block first alert." },
  { name: "Marketaux Catalyst", required: false, route: "app/api/ears/marketaux/run/route.ts", adapter: "lib/ears/marketaux.ts", apiKey: "MARKETAUX_API_KEY", notes: "Optional paid live catalyst news ear." },
  { name: "Polygon", required: false, route: "app/api/ears/polygon/run/route.ts", adapter: "lib/ears/polygon.ts", apiKey: "POLYGON_API_KEY", notes: "Optional paid market data ear." },
  { name: "Alpha Vantage Catalyst", required: false, route: "app/api/ears/alpha-vantage/run/route.ts", adapter: "lib/ears/alpha-vantage.ts", apiKey: "ALPHA_VANTAGE_API_KEY", notes: "Optional live catalyst news/sentiment ear." },
  { name: "Company Catalyst Watchlist", required: false, notes: "Default live catalyst watchlist for NVDA, AAPL, MSFT, TSLA, AMZN, META, GOOGL, AMD, SHOP, PLTR." },
  { name: "CoinGecko", required: true, route: "app/api/ears/coingecko/run/route.ts", adapter: "lib/ears/coingecko.ts", notes: "Required public crypto/risk sentiment ear; API key optional." },
  { name: "Frankfurter FX", required: true, route: "app/api/ears/frankfurter/run/route.ts", adapter: "lib/ears/frankfurter.ts", notes: "Required public FX/macro pressure ear." },
  { name: "FINRA Short Sale", required: false, route: "app/api/ears/finra-short-sale/run/route.ts", adapter: "lib/ears/finra-short-sale.ts", notes: "Optional public short-sale context ear." },
  { name: "Wikidata", required: false, route: "app/api/ears/wikidata-ripple/run/route.ts", adapter: "lib/ears/wikidata-ripple.ts", notes: "Optional public ripple-mapping ear." },
  { name: "Wikidata ripple mapping", required: false, route: "app/api/ears/wikidata-ripple/run/route.ts", adapter: "lib/ears/wikidata-ripple.ts", notes: "Optional alias for Wikidata ripple mapping." },
  { name: "AI Committee", required: true, route: "app/api/ai-committee/run/route.ts", adapter: "lib/ai-committee/orchestrator.ts", apiKey: "OPENAI_API_KEY", notes: "Required real brain gate; dry-run must be ready and real run requires confirmRun=true." },
  { name: "Telegram", required: false, disabledReason: "Telegram notifications are optional and not required for first-alert readiness.", notes: "Optional notification path intentionally excluded from first alert." },
  { name: "Stripe Managed Payments", required: false, disabledReason: "Payments are not part of engine-start readiness.", notes: "Optional commercial integration, not a source ear." },
];

const root = process.cwd();
function hasFile(file?: string) { return Boolean(file && existsSync(path.join(root, file))); }
function env(name?: string) { return Boolean(name && process.env[name]?.trim()); }

async function tableAvailable(name: string) {
  if (!process.env.DATABASE_URL) return false;
  try {
    const rows = await prisma.$queryRaw<Array<{ table_name: string }>>(Prisma.sql`select table_name from information_schema.tables where table_schema = 'public' and table_name = ${name}`);
    return rows.length > 0;
  } catch { return false; }
}

function mapStoredStatus(status?: string | null): SourceTruthStatus | null {
  if (!status) return null;
  if (status === "error") return "failed";
  if (["connected", "degraded", "not_configured", "stubbed", "disabled", "failed", "broken_route", "not_wired"].includes(status)) return status as SourceTruthStatus;
  return "failed";
}

export async function getSourceCoverage() {
  const health = await getSourceHealth();
  const byName = new Map(health.sources.map((row) => [row.source, row]));
  return SOURCE_DEFINITIONS.map((source) => {
    const stored = byName.get(source.name);
    const routePresent = hasFile(source.route);
    const adapterPresent = hasFile(source.adapter);
    let status: SourceTruthStatus = "stubbed";
    if (source.disabledReason) status = "disabled";
    else if (source.name === "AI Committee") {
      const ai = getAiCommitteeReadiness();
      status = ai.aiCommitteeDryRunReady ? "connected" : ai.missingAiVariables.length ? "not_configured" : "failed";
    }
    else if (source.apiKey && !env(source.apiKey)) status = "not_configured";
    else if (source.route && !routePresent) status = "broken_route";
    else if (source.adapter && !adapterPresent) status = "not_wired";
    else status = mapStoredStatus(stored?.status) ?? "degraded";
    const real = adapterPresent && routePresent && status !== "stubbed" && status !== "broken_route" && status !== "not_wired";
    const blocker = source.required && !["connected", "degraded"].includes(status);
    const notes = source.name === "AI Committee" && status === "connected"
      ? "OpenAI provider configured and AI_COMMITTEE_ENABLED=true; dry-run ready. Real AI Committee run still requires confirmRun=true and does not expose secrets."
      : source.disabledReason ?? stored?.notes ?? source.notes;
    return { source: source.name, required: source.required, optional: !source.required, status, realOrStubbed: real ? "real" : "stubbed", apiKeyNeeded: source.apiKey ?? null, railwayVariableNeeded: source.apiKey && !env(source.apiKey) ? source.apiKey : null, lastChecked: stored?.lastChecked ?? null, lastSuccess: stored?.lastSuccess ?? null, blocker, notes };
  });
}

export function getAiCommitteeReadiness() {
  const status = getAiCommitteeProviderStatus();
  const missingAiVariables = [
    !status.configured ? "OPENAI_API_KEY" : null,
    !status.enabled ? "AI_COMMITTEE_ENABLED=true" : null,
    status.modelEnvStatus.fast === "missing" ? "AI_COMMITTEE_FAST_MODEL" : null,
    status.modelEnvStatus.deep === "missing" ? "AI_COMMITTEE_DEEP_MODEL" : null,
    status.modelEnvStatus.final === "missing" ? "AI_COMMITTEE_FINAL_MODEL" : null,
  ].filter((v): v is string => Boolean(v));
  const aiCommitteeConfigured = status.configured && status.modelEnvStatus.fast === "configured" && status.modelEnvStatus.deep === "configured" && status.modelEnvStatus.final === "configured";
  const aiCommitteeEnabled = status.enabled;
  const routesReady = hasFile("app/api/ai-committee/agents/route.ts") && hasFile("app/api/ai-committee/run/route.ts") && hasFile("app/api/ai-committee/final-judge/route.ts");
  const aiCommitteeDryRunReady = routesReady && aiCommitteeConfigured && aiCommitteeEnabled && AI_COMMITTEE_AGENTS.length > 0;
  return { aiCommitteeConfigured, aiCommitteeEnabled, aiCommitteeDryRunReady, aiCommitteeRealRunReady: aiCommitteeDryRunReady, missingAiVariables, agents: AI_COMMITTEE_AGENTS.length, provider: "openai" };
}

function routeStatus(files: string[]) {
  const missing = files.filter((file) => !hasFile(file));
  return { ok: missing.length === 0, missing };
}

export async function getEngineStartReadiness() {
  const [databaseConnection, rawSignalsTable, sourceHealthTable, sourceRunHistoryTable, alertTable, ledgerTable, aiRunsTable, sourceCoverage] = await Promise.all([
    tableAvailable("users"), tableAvailable("raw_signals"), tableAvailable("source_health"), tableAvailable("source_runs"), tableAvailable("alerts"), tableAvailable("public_ledger"), tableAvailable("ai_committee_runs"), getSourceCoverage(),
  ]);
  const aiCommitteeStatus = getAiCommitteeReadiness();
  const candidateFactoryStatus = routeStatus(["app/api/internal/candidate-factory-run/route.ts", "lib/raw-signal-quality-gate.ts", "lib/proof/proof-bundle-builder.ts", "lib/scoring-engine.ts"]);
  const evidencePackStatus = routeStatus(["app/api/ai-committee/evidence-pack-preview/route.ts", "lib/ai-committee/evidence-pack.ts"]);
  const approvalGateStatus = routeStatus(["app/api/internal/approval-gate/route.ts", "lib/approval-gate/approval-gate.ts"]);
  const publishLedgerStatus = routeStatus(["app/api/internal/publish-approved-alert/route.ts", "app/api/ledger/from-alert/route.ts", "app/api/ledger/outcome-preview/route.ts", "lib/public-ledger.ts"]);
  const publicWebsiteStatus = routeStatus(["app/alerts/page.tsx", "app/ledger/page.tsx", "app/alerts/[id]/page.tsx", "app/ledger/[id]/page.tsx"]);
  const finalJudgeStatus = routeStatus(["app/api/ai-committee/final-judge/route.ts", "lib/ai-committee/final-judge.ts"]);
  const requiredSourcesFailed = sourceCoverage.filter((source) => source.required && source.blocker).map((source) => source.source);
  const stubbedBlockers = sourceCoverage.filter((source) => source.required && source.status === "stubbed").map((source) => source.source);
  const missingApiKeys = sourceCoverage.filter((source) => source.required && source.railwayVariableNeeded).map((source) => source.railwayVariableNeeded as string);
  const degradedSources = sourceCoverage.filter((source) => source.status === "degraded").map((source) => source.source);
  const blockers = [
    ...(!databaseConnection ? ["database_connection_failed_or_DATABASE_URL_missing"] : []),
    ...(!rawSignalsTable ? ["raw_signals_table_unavailable"] : []),
    ...(!sourceHealthTable ? ["source_health_table_unavailable"] : []),
    ...(!sourceRunHistoryTable ? ["source_run_history_unavailable"] : []),
    ...requiredSourcesFailed.map((source) => `required_source_not_ready:${source}`),
    ...(!aiCommitteeStatus.aiCommitteeDryRunReady ? ["ai_committee_not_ready"] : []),
    ...(!candidateFactoryStatus.ok ? ["candidate_factory_missing"] : []),
    ...(!evidencePackStatus.ok ? ["evidence_pack_missing"] : []),
    ...(!finalJudgeStatus.ok ? ["final_judge_missing"] : []),
    ...(!approvalGateStatus.ok ? ["approval_gate_missing"] : []),
    ...(!publishLedgerStatus.ok ? ["publish_or_ledger_flow_missing"] : []),
    ...(!publicWebsiteStatus.ok ? ["public_alert_or_ledger_pages_missing"] : []),
    ...(!alertTable ? ["alerts_table_unavailable"] : []),
    ...(!ledgerTable ? ["public_ledger_table_unavailable"] : []),
    ...(!aiRunsTable ? ["ai_committee_persistence_unavailable"] : []),
  ];
  const exactNextFixes = [...new Set([...missingApiKeys.map((key) => `Set Railway variable ${key}.`), ...aiCommitteeStatus.missingAiVariables.map((key) => `Set Railway variable ${key}.`), ...blockers.map((blocker) => `Resolve ${blocker}.`)])];
  const coreOk = blockers.length === 0;
  return {
    ok: coreOk,
    readyToStartEngine: coreOk,
    readyForFirstPublicAlert: coreOk,
    readyForContinuousRunning: coreOk && degradedSources.length === 0,
    database: { connected: databaseConnection, rawSignalsTable, sourceHealthTable, sourceRunHistoryTable },
    sourceCoverage,
    requiredSourcesPassed: sourceCoverage.filter((source) => source.required && !source.blocker).map((source) => source.source),
    requiredSourcesFailed,
    optionalSourcesSkipped: sourceCoverage.filter((source) => !source.required && ["disabled", "not_configured"].includes(source.status)).map((source) => ({ source: source.source, reason: source.notes })),
    stubbedBlockers,
    missingApiKeys: [...new Set([...missingApiKeys, ...aiCommitteeStatus.missingAiVariables])],
    degradedSources,
    aiCommitteeStatus,
    candidateFactoryStatus,
    evidencePackStatus,
    approvalGateStatus,
    publishLedgerStatus,
    publicWebsiteStatus,
    warnings: ["Telegram is optional and not required for first public alert.", ...(degradedSources.length ? degradedSources.map((source) => `${source} is degraded/rate-limited/stale; continuous running should wait.`) : [])],
    blockers: [...new Set(blockers)],
    exactNextFixes,
  };
}
