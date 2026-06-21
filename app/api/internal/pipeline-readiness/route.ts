import { existsSync } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";

type CheckStatus = {
  available: boolean;
  required: boolean;
  configured?: boolean;
  detail: string;
};

type ReadinessChecks = Record<string, CheckStatus>;

const root = process.cwd();

function hasFile(relativePath: string) {
  return existsSync(path.join(root, relativePath));
}

function configured(name: string) {
  return Boolean(process.env[name]?.trim());
}

function checkFile(relativePath: string, required = true): CheckStatus {
  const available = hasFile(relativePath);
  return { available, required, detail: available ? `${relativePath} is present.` : `${relativePath} is missing.` };
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

async function tableAvailable(tableName: string): Promise<CheckStatus> {
  if (!configured("DATABASE_URL")) {
    return { available: false, required: true, detail: "DATABASE_URL is not configured, so table availability could not be verified." };
  }

  try {
    const rows = await prisma.$queryRaw<Array<{ exists: boolean }>>(Prisma.sql`
      select exists (
        select 1
        from information_schema.tables
        where table_schema = 'public'
          and table_name = ${tableName}
      ) as exists
    `);
    const available = rows[0]?.exists === true;
    return { available, required: true, detail: available ? `${tableName} table is available.` : `${tableName} table was not found.` };
  } catch {
    return { available: false, required: true, detail: `${tableName} table check failed without exposing database details.` };
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
  if (optionalMissing.length) return `Optional production integration missing: ${optionalMissing[0]}. Dry-run testing can continue, but real testing should configure it if needed.`;
  if (warnings.length) return "Review warnings, then run the internal dry-run alert test before any real notification test.";
  return "Run the internal dry-run alert test, then promote to a real test only after confirming Telegram test credentials and operator approval.";
}

export async function GET() {
  const checks: ReadinessChecks = {
    databaseConnection: await databaseConnection(),
    sourceRunnerAvailable: checkFile("lib/ops/source-runner.ts"),
    rawSignalWriterAvailable: checkFile("lib/raw-signal-writer.ts"),
    atLeastOneEarAvailable: {
      available: ["app/api/ears/gdelt/run/route.ts", "app/api/ears/coingecko/run/route.ts", "app/api/ears/sec-edgar/run/route.ts"].some(hasFile),
      required: true,
      detail: "Checks that at least one local ear route exists; no external source was called.",
    },
    fmpKeyStatus: checkEnv("FMP_API_KEY", false),
    marketauxKeyStatus: checkEnv("MARKETAUX_API_KEY", false),
    polygonKeyStatus: checkEnv("POLYGON_API_KEY", false),
    googleNewsRssAvailable: checkFile("app/api/ears/google-news/run/route.ts"),
    secEdgarAvailable: checkFile("app/api/ears/sec-edgar/run/route.ts"),
    gdeltAvailable: checkFile("app/api/ears/gdelt/run/route.ts"),
    fredAvailable: checkFile("app/api/ears/fred/run/route.ts"),
    openFdaAvailable: checkFile("app/api/ears/openfda/run/route.ts"),
    coinGeckoAvailable: checkFile("app/api/ears/coingecko/run/route.ts"),
    frankfurterAvailable: checkFile("app/api/ears/frankfurter/run/route.ts"),
    rawSignalsTableAvailable: await tableAvailable("raw_signals"),
    historicalEventsTableAvailable: await tableAvailable("historical_events"),
    patternMatchesRouteModelAvailable: {
      available: hasFile("app/api/pattern-matches/route.ts") && hasFile("app/api/pattern-matches/run/route.ts") && (await tableAvailable("pattern_matches")).available,
      required: true,
      detail: "Checks pattern match routes and table availability without running matching.",
    },
    scoringPreviewPersistenceAvailable: {
      available: hasFile("app/api/brain/score-preview/route.ts") && hasFile("app/api/candidate-alerts/persist-analysis/route.ts") && (await tableAvailable("alert_scores")).available,
      required: true,
      detail: "Checks scoring preview route, persistence route, and alert_scores table without scoring or writing.",
    },
    candidateAlertRouteStateMachineAvailable: {
      available: hasFile("app/api/candidate-alerts/from-raw-signal/route.ts") && hasFile("app/api/candidate-alerts/state-transition/route.ts"),
      required: true,
      detail: "Checks candidate alert creation route and state transition route existence only.",
    },
    publicLedgerRouteModelAvailable: {
      available: hasFile("app/api/ledger/from-alert/route.ts") && hasFile("app/public-ledger/page.tsx") && (await tableAvailable("public_ledger")).available,
      required: true,
      detail: "Checks ledger route/page and public_ledger table without creating ledger entries.",
    },
    seoPublicAlertPageAvailable: checkFile("app/public/alerts/[id]/page.tsx"),
    telegramBotTokenStatus: checkEnv("TELEGRAM_BOT_TOKEN", false),
    telegramTestChatIdStatus: checkEnv("TELEGRAM_TEST_CHAT_ID", false),
  };

  const missingRequiredItems = missingFrom(checks, true);
  const missingOptionalItems = missingFrom(checks, false);
  const warnings = [
    ...missingOptionalItems.map((item) => `${item} is not configured or unavailable; dry-run testing can proceed, but real external-provider coverage may be incomplete.`),
    "This endpoint performs no source calls, AI calls, Telegram sends, or data mutation.",
  ];
  const readyForDryRunTest = missingRequiredItems.length === 0;
  const readyForRealTest = readyForDryRunTest && missingOptionalItems.length === 0;

  return NextResponse.json({
    ok: true,
    readyForDryRunTest,
    readyForRealTest,
    missingRequiredItems,
    missingOptionalItems,
    warnings,
    nextRecommendedAction: nextAction(missingRequiredItems, missingOptionalItems, warnings),
    checks,
  });
}
