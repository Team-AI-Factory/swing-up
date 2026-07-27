import { NextRequest, NextResponse } from "next/server";
import { scanTradingViewGlobalStocks } from "@/lib/opportunity-engine/global-market-scanner-v3";
import { CERTIFIED_EXTREME_VOLATILITY_RULE, opportunityCoverageSummary } from "@/lib/opportunity-engine/serious-alert-registry";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function branchAllowed() {
  if (process.env.SWING_UP_COMBINED_ENGINE_ALLOW_LOCAL === "true") return true;
  const branch = process.env.RAILWAY_GIT_BRANCH?.trim();
  const environment = process.env.RAILWAY_ENVIRONMENT_NAME?.trim().toLowerCase();
  return Boolean(process.env.RAILWAY_PROJECT_ID && branch === "agent/combined-opportunity-engine" && environment && environment !== "production");
}

function suppliedToken(request: NextRequest) {
  return request.headers.get("x-swing-up-automation-token")?.trim()
    || request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
}

function integer(value: unknown, fallback: number, maximum: number) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? Math.max(1, Math.min(Math.floor(parsed), maximum)) : fallback;
}

function numeric(value: unknown, fallback: number) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? Math.max(0, parsed) : fallback;
}

export async function GET(request: NextRequest) {
  if (!branchAllowed()) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  const expected = process.env.SWING_UP_AUTOMATION_TOKEN?.trim();
  if (expected && suppliedToken(request) !== expected) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  return NextResponse.json({
    ok: true,
    scanner: "tradingview_entire_world_primary_listing_scanner",
    universeProvider: "TradingView public stock scanner",
    historyProvider: "Yahoo Finance public chart API",
    optionalDeepResearchProviders: ["Financial Modeling Prep", "Alpha Vantage", "Marketaux", "SEC and official filings"],
    method: "Scan current primary equity listings worldwide, separate Buy, Sell and Watch Out research queues, and verify any certified serious alert against fresh adjusted history from an independent provider.",
    certifiedRule: CERTIFIED_EXTREME_VOLATILITY_RULE,
    opportunityCoverage: opportunityCoverageSummary(),
    publishingEnabled: false,
    notificationsEnabled: false,
  });
}

export async function POST(request: NextRequest) {
  if (!branchAllowed()) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  const expected = process.env.SWING_UP_AUTOMATION_TOKEN?.trim();
  if (expected && suppliedToken(request) !== expected) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  try {
    const result = await scanTradingViewGlobalStocks({
      maximumListings: integer(body.maximumStocks ?? body.maximumListings, 150_000, 200_000),
      pageSize: integer(body.pageSize ?? body.batchSize, 1_000, 2_000),
      pageConcurrency: integer(body.pageConcurrency, 8, 16),
      deepQueueSize: integer(body.deepQueueSize, 300, 2_000),
      minimumPrice: numeric(body.minimumPrice, 0.25),
      minimumMarketCap: numeric(body.minimumMarketCap, 25_000_000),
      maximumCertifiedChecks: integer(body.maximumCertifiedChecks, 5_000, 15_000),
      historyConcurrency: integer(body.certifiedCheckConcurrency ?? body.historyConcurrency, 10, 20),
    });
    return NextResponse.json(result, { status: result.ok ? 200 : 206 });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: "global_scan_failed",
      errorMessageSafe: error instanceof Error ? error.message.slice(0, 1000) : "unknown_error",
      safety: { databaseWrites: false, publishing: false, notifications: false, seriousSignalsUnlocked: false },
    }, { status: 502 });
  }
}
