import { NextRequest, NextResponse } from "next/server";
import { scanAllGlobalStocks } from "@/lib/opportunity-engine/global-market-scanner-v2";
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
    scanner: "global_two_stage_stock_scanner_v2",
    providerConfigured: Boolean(process.env.FMP_API_KEY?.trim()),
    directoryFailover: ["stock-list", "actively-trading-list", "profile-bulk", "financial-statement-symbol-list", "key-metrics-ttm-bulk-symbols"],
    method: "Every available active stock is screened with current batch quotes. Buy, Sell and Watch Out research queues are separated. Independently certified rules receive fresh adjusted-price verification before seriousSignal can be true.",
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
  if (!process.env.FMP_API_KEY?.trim()) return NextResponse.json({ ok: false, error: "fmp_not_configured" }, { status: 503 });
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  try {
    const result = await scanAllGlobalStocks({
      maximumStocks: integer(body.maximumStocks, 100_000, 150_000),
      batchSize: integer(body.batchSize, 250, 500),
      deepQueueSize: integer(body.deepQueueSize, 250, 2_000),
      minimumPrice: numeric(body.minimumPrice, 0.25),
      minimumMarketCap: numeric(body.minimumMarketCap, 25_000_000),
      maximumCertifiedChecks: integer(body.maximumCertifiedChecks, 2_000, 10_000),
      certifiedCheckConcurrency: integer(body.certifiedCheckConcurrency, 8, 16),
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
