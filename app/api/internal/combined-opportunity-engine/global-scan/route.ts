import { NextRequest, NextResponse } from "next/server";
import { scanTradingViewGlobalStocks } from "@/lib/opportunity-engine/global-market-scanner-v3";
import { CERTIFIED_EXTREME_VOLATILITY_RULE, opportunityCoverageSummary } from "@/lib/opportunity-engine/serious-alert-registry";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const CERTIFIED_US_LISTING_EXCHANGES = new Set(["NASDAQ", "NYSE", "AMEX"]);

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
    scanner: "tradingview_us_primary_listing_scanner",
    universeProvider: "TradingView public stock scanner",
    historyProvider: "Yahoo Finance public chart API",
    optionalDeepResearchProviders: ["Financial Modeling Prep", "Alpha Vantage", "Marketaux", "SEC and official filings"],
    method: "Scan current NASDAQ, NYSE and AMEX primary common-stock and ADR listings, separate Buy, Sell and Watch Out research queues, and verify certified alerts against fresh adjusted history.",
    certifiedRule: {
      ...CERTIFIED_EXTREME_VOLATILITY_RULE,
      certifiedListingScope: "Primary listings on NASDAQ, NYSE and AMEX only. Non-U.S. scanning is disabled.",
    },
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
    const usQualified = result.seriousAlerts.watchOut;
    const certifiedScopeAlerts = usQualified.filter((alert) => CERTIFIED_US_LISTING_EXCHANGES.has(alert.exchange.toUpperCase()));
    const suppressedOutsideCertifiedScope = usQualified.length - certifiedScopeAlerts.length;
    const response = {
      ...result,
      seriousAlerts: {
        ...result.seriousAlerts,
        watchOut: certifiedScopeAlerts,
        certificationScope: {
          exchanges: [...CERTIFIED_US_LISTING_EXCHANGES],
          evidence: "The active pilot and independent certificate are restricted to U.S.-listed securities. Non-U.S. scanning is disabled.",
          globallyQualifiedCases: 0,
          usQualifiedCases: usQualified.length,
          seriousAlertsInsideCertifiedScope: certifiedScopeAlerts.length,
          researchOnlyOutsideCertifiedScope: suppressedOutsideCertifiedScope,
        },
        verification: {
          ...result.seriousAlerts.verification,
          qualifyingAlerts: certifiedScopeAlerts.length,
          allMappedCandidatesAttempted: result.seriousAlerts.verification.checkedCandidates === result.seriousAlerts.verification.mappedCandidates,
          unresolvedCandidatesAreBlockedNotPromoted: true,
        },
      },
      safety: {
        ...result.safety,
        seriousSignalsUnlocked: certifiedScopeAlerts.length > 0,
      },
    };
    return NextResponse.json(response, { status: response.ok ? 200 : 206 });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: "global_scan_failed",
      errorMessageSafe: error instanceof Error ? error.message.slice(0, 1000) : "unknown_error",
      safety: { databaseWrites: false, publishing: false, notifications: false, seriousSignalsUnlocked: false },
    }, { status: 502 });
  }
}
