import { existsSync } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";

type CheckStatus = {
  available: boolean;
  required: boolean;
  configured?: boolean;
  built?: boolean;
  detail: string;
};

type ReadinessChecks = Record<string, CheckStatus>;

const root = process.cwd();
const optionalWhenBuilt = true;

function hasFile(relativePath: string) {
  return existsSync(path.join(root, relativePath));
}

function hasAnyFile(relativePaths: string[]) {
  return relativePaths.some(hasFile);
}

function configured(name: string) {
  return Boolean(process.env[name]?.trim());
}

function checkFile(relativePath: string, required = true): CheckStatus {
  const available = hasFile(relativePath);
  return { available, required, detail: available ? `${relativePath} is present.` : `${relativePath} is missing.` };
}

function checkFiles(relativePaths: string[], required = true): CheckStatus {
  const missing = relativePaths.filter((relativePath) => !hasFile(relativePath));
  return {
    available: missing.length === 0,
    required,
    detail: missing.length === 0 ? `Required files are present: ${relativePaths.join(", ")}.` : `Missing files: ${missing.join(", ")}.`,
  };
}

function checkOptionalBuiltFile(relativePath: string): CheckStatus {
  const built = hasFile(relativePath);
  return {
    available: built,
    built,
    required: false,
    detail: built ? `${relativePath} is built and available.` : `${relativePath} is not built in this codebase.`,
  };
}

function checkEnv(name: string, required: boolean): CheckStatus {
  const isConfigured = configured(name);
  return {
    available: isConfigured,
    configured: isConfigured,
    required,
    detail: isConfigured ? `${name} is configured.` : `${name} is not configured.`,
  };
}

async function tablesAvailable(tableNames: string[]): Promise<Record<string, CheckStatus>> {
  const entries = Object.fromEntries(
    tableNames.map((tableName) => [
      tableName,
      { available: false, required: true, detail: "DATABASE_URL is not configured, so table availability could not be verified." },
    ]),
  ) as Record<string, CheckStatus>;

  if (!configured("DATABASE_URL")) return entries;

  try {
    const rows = await prisma.$queryRaw<Array<{ table_name: string }>>(Prisma.sql`
      select table_name
      from information_schema.tables
      where table_schema = 'public'
        and table_name in (${Prisma.join(tableNames)})
    `);
    const found = new Set(rows.map((row) => row.table_name));
    for (const tableName of tableNames) {
      const available = found.has(tableName);
      entries[tableName] = { available, required: true, detail: available ? `${tableName} table is available.` : `${tableName} table was not found.` };
    }
    return entries;
  } catch {
    return Object.fromEntries(
      tableNames.map((tableName) => [tableName, { available: false, required: true, detail: `${tableName} table check failed without exposing database details.` }]),
    ) as Record<string, CheckStatus>;
  }
}

async function databaseConnection(): Promise<CheckStatus> {
  if (!configured("DATABASE_URL")) return { available: false, required: true, configured: false, detail: "DATABASE_URL is not configured." };
  try {
    await prisma.$queryRaw(Prisma.sql`select 1`);
    return { available: true, required: true, configured: true, detail: "Database connection check passed." };
  } catch {
    return { available: false, required: true, configured: true, detail: "Database connection check failed without exposing database details." };
  }
}

function missingFrom(checks: ReadinessChecks, required: boolean) {
  return Object.entries(checks)
    .filter(([, check]) => check.required === required && !check.available)
    .map(([name]) => name);
}

function nextAction(requiredMissing: string[], optionalMissing: string[], warnings: string[]) {
  if (requiredMissing.includes("databaseConnection")) return "Configure DATABASE_URL and verify the database is reachable before running the full alert pipeline.";
  if (requiredMissing.length) return `Resolve required readiness item: ${requiredMissing[0]}.`;
  if (optionalMissing.length) return `Optional integration missing or unconfigured: ${optionalMissing[0]}. Dry-run testing can continue, but real coverage may be incomplete.`;
  if (warnings.length) return "Review warnings, then run the internal dry-run alert test before any real notification test.";
  return "Run the internal dry-run alert test, then promote to a real test only after confirming Telegram test credentials and operator approval.";
}

export async function GET() {
  const tableChecks = await tablesAvailable(["raw_signals", "historical_events", "pattern_matches", "alert_scores", "public_ledger", "ai_committee_runs", "ai_committee_agent_results"]);
  const dbConnection = await databaseConnection();

  const checks: ReadinessChecks = {
    databaseConnection: dbConnection,
    sourceRunnerAvailable: checkFile("lib/ops/source-runner.ts"),
    rawSignalWriterAvailable: checkFile("lib/raw-signal-writer.ts"),
    sourceHealthAvailable: checkFiles(["app/api/source-health/route.ts", "lib/source-health.ts"]),
    sourceRunHistoryAvailable: checkFile("app/api/ops/source-runs/route.ts"),
    atLeastOneEarAvailable: {
      available: hasAnyFile(["app/api/ears/gdelt/run/route.ts", "app/api/ears/coingecko/run/route.ts", "app/api/ears/sec-edgar/run/route.ts", "app/api/ears/fred/run/route.ts"]),
      required: true,
      detail: "Checks that at least one local ear route exists; no external source was called.",
    },
    secEdgarAvailable: checkFiles(["app/api/ears/sec-edgar/run/route.ts", "lib/ears/sec-edgar.ts"]),
    gdeltAvailable: checkFiles(["app/api/ears/gdelt/run/route.ts", "lib/ears/gdelt.ts"]),
    googleNewsRssAvailable: checkOptionalBuiltFile("app/api/ears/google-news/run/route.ts"),
    fmpKeyStatus: { ...checkEnv("FMP_API_KEY", false), built: hasFile("app/api/ears/fmp/run/route.ts") },
    marketauxKeyStatus: { ...checkEnv("MARKETAUX_API_KEY", false), built: hasFile("app/api/ears/marketaux/run/route.ts") },
    polygonKeyStatus: { ...checkEnv("POLYGON_API_KEY", false), built: hasFile("app/api/ears/polygon/run/route.ts") },
    alphaVantageKeyStatus: { ...checkEnv("ALPHA_VANTAGE_API_KEY", false), built: hasFile("app/api/ears/alpha-vantage/run/route.ts") },
    fredKeyStatus: checkEnv("FRED_API_KEY", false),
    fredAvailable: checkFiles(["app/api/ears/fred/run/route.ts", "lib/ears/fred.ts"]),
    openFdaAvailable: checkFiles(["app/api/ears/openfda/run/route.ts", "lib/ears/openfda.ts"]),
    coinGeckoStatus: { ...checkFiles(["app/api/ears/coingecko/run/route.ts", "lib/ears/coingecko.ts"]), configured: configured("COINGECKO_API_KEY") },
    frankfurterAvailable: checkFiles(["app/api/ears/frankfurter/run/route.ts", "lib/ears/frankfurter.ts"]),
    finraShortSaleAvailable: checkOptionalBuiltFile("app/api/ears/finra-short-sale/run/route.ts"),
    wikidataRippleMappingAvailable: checkOptionalBuiltFile("app/api/ears/wikidata-ripple/run/route.ts"),
    rawSignalsTableAvailable: tableChecks.raw_signals,
    historicalEventsTableAvailable: tableChecks.historical_events,
    patternMatchesRouteModelAvailable: {
      available: hasFile("app/api/pattern-matches/route.ts") && hasFile("app/api/pattern-matches/run/route.ts") && tableChecks.pattern_matches.available,
      required: true,
      detail: "Checks pattern match routes and table availability without running matching.",
    },
    scoringPreviewPersistenceAvailable: {
      available: hasFile("app/api/brain/score-preview/route.ts") && hasFile("app/api/candidate-alerts/persist-analysis/route.ts") && tableChecks.alert_scores.available,
      required: true,
      detail: "Checks scoring preview route, persistence route, and alert_scores table without scoring or writing.",
    },
    candidateAlertRouteStateMachineAvailable: checkFiles(["app/api/candidate-alerts/from-raw-signal/route.ts", "app/api/candidate-alerts/state-transition/route.ts"]),
    publicLedgerRouteModelAvailable: {
      available: hasFile("app/api/ledger/from-alert/route.ts") && hasFile("lib/public-ledger.ts") && tableChecks.public_ledger.available,
      required: true,
      detail: "Checks ledger route/model and public_ledger table without creating ledger entries.",
    },
    seoPublicAlertPageAvailable: checkFile("app/public/alerts/[id]/page.tsx"),
    aiCommitteeAgentsAvailable: checkFiles(["app/api/ai-committee/agents/route.ts", "lib/ai-committee/agents.ts"]),
    aiCommitteeEvidencePackAvailable: checkFiles(["app/api/ai-committee/evidence-pack-preview/route.ts", "lib/ai-committee/evidence-pack.ts"]),
    aiCommitteeOrchestratorAvailable: checkFiles(["app/api/ai-committee/run/route.ts", "lib/ai-committee/orchestrator.ts"]),
    aiCommitteeFinalJudgeAvailable: checkFiles(["app/api/ai-committee/final-judge/route.ts", "lib/ai-committee/final-judge.ts"]),
    aiCommitteePersistenceAvailable: {
      available: tableChecks.ai_committee_runs.available && tableChecks.ai_committee_agent_results.available,
      required: true,
      detail: "Checks AI committee persistence tables without creating a run.",
    },
    telegramBotTokenStatus: checkEnv("TELEGRAM_BOT_TOKEN", false),
    telegramTestChatIdStatus: checkEnv("TELEGRAM_TEST_CHAT_ID", false),
  };

  const missingRequiredItems = missingFrom(checks, true);
  const missingOptionalItems = missingFrom(checks, false);
  const readyForDryRunTest = missingRequiredItems.length === 0;
  const readyForAICommitteeRun = readyForDryRunTest && checks.aiCommitteeAgentsAvailable.available && checks.aiCommitteeEvidencePackAvailable.available && checks.aiCommitteeOrchestratorAvailable.available && checks.aiCommitteeFinalJudgeAvailable.available && checks.aiCommitteePersistenceAvailable.available;
  const readyForTelegramTest = readyForDryRunTest && checks.telegramBotTokenStatus.configured === true && checks.telegramTestChatIdStatus.configured === true;
  const readyForRealTest = readyForDryRunTest && readyForAICommitteeRun && readyForTelegramTest && missingOptionalItems.length === 0;
  const warnings = [
    ...missingOptionalItems.map((item) => `${item} is not configured or unavailable; dry-run testing can proceed, but real external-provider coverage may be incomplete.`),
    "This endpoint performs no source calls, AI calls, Telegram sends, or data mutation.",
    "Secret values are never returned; credential checks expose configured true/false only.",
  ];

  return NextResponse.json({
    ok: missingRequiredItems.length === 0,
    readyForDryRunTest,
    readyForRealTest,
    readyForAICommitteeRun,
    readyForTelegramTest,
    missingRequiredItems,
    missingOptionalItems,
    warnings,
    nextRecommendedAction: nextAction(missingRequiredItems, missingOptionalItems, warnings),
    checks,
    optionalWhenBuilt,
  });
}
