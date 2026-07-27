import { NextRequest, NextResponse } from "next/server";
import { scanTradingViewGlobalStocks } from "@/lib/opportunity-engine/global-market-scanner-v3";
import { CERTIFIED_EXTREME_VOLATILITY_RULE, opportunityCoverageSummary } from "@/lib/opportunity-engine/serious-alert-registry";
import { persistWorldwideLearningRun, WORLDWIDE_LEARNING_LEDGER_POLICY } from "@/lib/opportunity-engine/worldwide-learning-ledger";

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
    scanner: "tradingview_entire_world_primary_listing_scanner",
    universeProvider: "TradingView public stock scanner",
    historyProvider: "Yahoo Finance public chart API",
    optionalDeepResearchProviders: ["Financial Modeling Prep", "Alpha Vantage", "Marketaux", "SEC and official filings"],
    method: "Scan current primary equity listings worldwide, separate Buy, Sell and Watch Out research queues, and verify any certified serious alert against fresh adjusted history from an independent provider.",
    certifiedRule: {
      ...CERTIFIED_EXTREME_VOLATILITY_RULE,
      certifiedListingScope: "Primary listings on NASDAQ, NYSE and AMEX only. Other global listings remain research-only until independent cross-market certification passes.",
    },
    opportunityCoverage: opportunityCoverageSummary(),
    learningLedger: WORLDWIDE_LEARNING_LEDGER_POLICY,
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
    const globallyQualified = result.seriousAlerts.watchOut;
    const certifiedScopeAlerts = globallyQualified.filter((alert) => CERTIFIED_US_LISTING_EXCHANGES.has(alert.exchange.toUpperCase()));
    const suppressedOutsideCertifiedScope = globallyQualified.length - certifiedScopeAlerts.length;
    const response = {
      ...result,
      seriousAlerts: {
        ...result.seriousAlerts,
        watchOut: certifiedScopeAlerts,
        certificationScope: {
          exchanges: [...CERTIFIED_US_LISTING_EXCHANGES],
          evidence: "The independent external certificate used U.S.-listed securities. Cross-market portability has not yet been proven.",
          globallyQualifiedCases: globallyQualified.length,
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
    const candidateObservations = [
      ...result.candidates.opportunity,
      ...result.candidates.buyResearch,
      ...result.candidates.sellResearch,
      ...result.candidates.watchOutResearch,
    ].map((candidate) => ({
      tradingViewSymbol: candidate.tradingViewSymbol,
      price: candidate.price,
      observedAt: result.checkedAt,
      source: "TradingView public stock scanner",
    })).concat(globallyQualified.map((alert) => ({
      tradingViewSymbol: alert.tradingViewSymbol,
      price: alert.currentPrice,
      observedAt: alert.observedAt,
      source: alert.evidence.adjustedHistorySource,
    })));
    const certifiedFindings = globallyQualified.map((alert) => {
      const insideCertifiedScope = CERTIFIED_US_LISTING_EXCHANGES.has(alert.exchange.toUpperCase());
      return {
        kind: "certified_finding" as const,
        tradingViewSymbol: alert.tradingViewSymbol,
        symbol: alert.symbol,
        company: alert.company,
        exchange: alert.exchange,
        country: alert.country,
        action: "watch_out" as const,
        disposition: insideCertifiedScope ? "qualified_certified_review_only" : "research_only_outside_certified_listing_scope",
        currentPrice: alert.currentPrice,
        observedAt: alert.observedAt,
        qualifiedCertified: insideCertifiedScope,
        rejectionReasons: insideCertifiedScope ? [] : ["The listing exchange is outside the independently certified NASDAQ, NYSE, and AMEX scope."],
        evidence: {
          ruleId: alert.ruleId,
          alertKey: alert.alertKey,
          trailing120SessionDrawdownPercent: alert.trailing120SessionDrawdownPercent,
          independentPriceAgreementPercent: alert.independentPriceAgreementPercent,
          historySource: alert.evidence.adjustedHistorySource,
          primaryListing: alert.evidence.primaryListing,
          noSyntheticData: alert.evidence.noSyntheticData,
        },
      };
    });
    const verification = result.seriousAlerts.verification;
    const verificationRejections = [
      `${verification.unsupportedYahooMappings} candidates lacked a supported independent Yahoo mapping.`,
      `${verification.priceConflictsBlocked} candidates were blocked by conflicting current prices.`,
      `${verification.insufficientHistoryBlocked} candidates were blocked by insufficient adjusted history.`,
      `${verification.staleHistoryBlocked} candidates were blocked by stale history.`,
      `${verification.corporateActionBlocked} candidates were blocked by split or corporate-action evidence.`,
      `${verification.historyDiscontinuityBlocked} candidates were blocked by extreme adjusted-price discontinuities.`,
      `${verification.liquidityBlocked} candidates were blocked by missing or insufficient liquidity evidence.`,
      `${verification.providerFailures} candidates were blocked by provider failures.`,
      `${verification.skippedCandidates} candidates were not attempted within the configured processing limit.`,
      ...verification.errors,
    ].filter((reason) => !reason.startsWith("0 candidates"));
    const learningLedger = await persistWorldwideLearningRun({
      workflow: "global_serious_scan",
      checkedAt: result.checkedAt,
      runtimeCommit: process.env.RAILWAY_GIT_COMMIT_SHA?.trim() || null,
      summary: {
        ok: response.ok,
        universe: response.universe,
        verification: response.seriousAlerts.verification,
        certificationScope: response.seriousAlerts.certificationScope,
        seriousAlertCount: certifiedScopeAlerts.length,
        researchOnlyQualifiedCount: suppressedOutsideCertifiedScope,
        safety: response.safety,
      },
      findings: [
        ...certifiedFindings,
        {
          kind: "verification_rejection_summary",
          tradingViewSymbol: "WORLDWIDE:VERIFICATION",
          symbol: "WORLDWIDE",
          company: "Worldwide certified-rule verification funnel",
          exchange: "WORLDWIDE",
          country: null,
          action: "watch_out",
          disposition: verificationRejections.length ? "blocked_or_rejected_verification_summary" : "no_verification_rejections",
          currentPrice: null,
          observedAt: result.checkedAt,
          qualifiedCertified: false,
          rejectionReasons: verificationRejections,
          evidence: {
            prefilterCandidates: verification.prefilterCandidates,
            mappedCandidates: verification.mappedCandidates,
            checkedCandidates: verification.checkedCandidates,
            verifiedHistoryCandidates: verification.verifiedHistoryCandidates,
            processingCoveragePercent: verification.processingCoveragePercent,
          },
        },
      ],
      observations: candidateObservations,
    });
    return NextResponse.json({ ...response, learningLedger }, { status: response.ok ? 200 : 206 });
  } catch (error) {
    const checkedAt = new Date().toISOString();
    const errorMessageSafe = error instanceof Error ? error.message.slice(0, 1000) : "unknown_error";
    const learningLedger = await persistWorldwideLearningRun({
      workflow: "global_serious_scan",
      checkedAt,
      runtimeCommit: process.env.RAILWAY_GIT_COMMIT_SHA?.trim() || null,
      summary: {
        ok: false,
        status: "global_scan_failed",
        errorMessageSafe,
        safety: { databaseWrites: false, publishing: false, notifications: false, trading: false, seriousSignalsUnlocked: false },
      },
      findings: [],
      observations: [],
    }).catch(() => null);
    return NextResponse.json({
      ok: false,
      error: "global_scan_failed",
      errorMessageSafe,
      learningLedger,
      safety: { databaseWrites: false, publishing: false, notifications: false, seriousSignalsUnlocked: false },
    }, { status: 502 });
  }
}
