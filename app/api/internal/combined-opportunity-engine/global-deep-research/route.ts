import { NextRequest, NextResponse } from "next/server";
import { runGlobalDeepResearchV3 } from "@/lib/opportunity-engine/global-deep-research-v3";
import { opportunityCoverageSummary } from "@/lib/opportunity-engine/serious-alert-registry";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function branchAllowed() {
  if (process.env.SWING_UP_COMBINED_ENGINE_ALLOW_LOCAL === "true") return true;
  const branch = process.env.RAILWAY_GIT_BRANCH?.trim();
  const environment = process.env.RAILWAY_ENVIRONMENT_NAME?.trim().toLowerCase();
  return Boolean(
    process.env.RAILWAY_PROJECT_ID
    && branch === "agent/combined-opportunity-engine"
    && environment
    && environment !== "production",
  );
}

function suppliedToken(request: NextRequest) {
  return request.headers.get("x-swing-up-automation-token")?.trim()
    || request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
}

function integer(value: unknown, fallback: number, maximum: number) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? Math.max(1, Math.min(Math.floor(parsed), maximum)) : fallback;
}

export async function GET(request: NextRequest) {
  if (!branchAllowed()) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  const expected = process.env.SWING_UP_AUTOMATION_TOKEN?.trim();
  if (expected && suppliedToken(request) !== expected) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  return NextResponse.json({
    ok: true,
    workflow: "global_live_deep_research",
    currentProviders: {
      worldwideUniverseAndScreening: "TradingView public stock scanner",
      worldwideValuationGrowthMarginsAndAnalystFields: "TradingView current global fundamentals",
      independentAdjustedPriceFallback: "Yahoo Finance public chart API",
      secondPriceAndExpectations: "Financial Modeling Prep when available",
      currentCompanyNews: "Marketaux when available",
      officialUSFundamentals: "SEC and issuer filings in the foundation workflow",
    },
    actionsCovered: ["buy", "sell", "watch_out"],
    opportunityCoverage: opportunityCoverageSummary(),
    seriousDirectionalAlertsEnabled: false,
    reason: "No independent Buy or Sell certificate has passed. Current worldwide fundamentals improve prioritization but cannot turn research into a serious directional alert.",
    safety: { databaseWrites: false, publishing: false, notifications: false },
  });
}

export async function POST(request: NextRequest) {
  if (!branchAllowed()) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  const expected = process.env.SWING_UP_AUTOMATION_TOKEN?.trim();
  if (expected && suppliedToken(request) !== expected) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  try {
    const result = await runGlobalDeepResearchV3({
      perAction: integer(body.perAction, 3, 15),
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: "global_deep_research_failed",
      errorMessageSafe: error instanceof Error ? error.message.replace(/\s+/g, " ").slice(0, 1000) : "unknown_error",
      safety: { databaseWrites: false, publishing: false, notifications: false, seriousSignalsUnlocked: false },
    }, { status: 502 });
  }
}
