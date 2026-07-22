import { NextRequest, NextResponse } from "next/server";
import { evaluateEvent, evaluateFoundation } from "@/lib/opportunity-engine/engine";
import { fetchLiveOpportunityUniverse } from "@/lib/opportunity-engine/live-data";
import { enrichLiveOpportunityUniverse } from "@/lib/opportunity-engine/provider-enrichment";
import type { CompanyFoundationInput, EventSignalInput, StoredThesisSnapshot } from "@/lib/opportunity-engine/types";

export const dynamic = "force-dynamic";

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function branchAllowed() {
  if (process.env.SWING_UP_COMBINED_ENGINE_ALLOW_LOCAL === "true") return true;
  const branch = process.env.RAILWAY_GIT_BRANCH?.trim();
  const environment = process.env.RAILWAY_ENVIRONMENT_NAME?.trim().toLowerCase();
  return Boolean(
    process.env.RAILWAY_PROJECT_ID
    && branch === "agent/combined-opportunity-engine"
    && environment
    && environment !== "production"
  );
}

function token(request: NextRequest) {
  return request.headers.get("x-swing-up-automation-token")?.trim()
    || request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
}

function validFoundation(value: unknown): value is CompanyFoundationInput {
  const row = object(value);
  return typeof row.ticker === "string" && typeof row.company === "string"
    && Boolean(row.metrics) && Boolean(row.valuation) && Boolean(row.market)
    && Boolean(row.expectations) && Boolean(row.catalyst) && Array.isArray(row.receipts);
}

function validEvent(value: unknown): value is EventSignalInput {
  const row = object(value);
  return typeof row.ticker === "string" && typeof row.title === "string"
    && typeof row.summary === "string" && typeof row.source === "string"
    && typeof row.receivedAt === "string";
}

function validThesis(value: unknown): value is StoredThesisSnapshot {
  const row = object(value);
  return typeof row.ticker === "string" && typeof row.company === "string"
    && typeof row.companyStatus === "string" && typeof row.securityReadiness === "string"
    && typeof row.candidateBucket === "string";
}

function tickerList(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(String).map((ticker) => ticker.trim().toUpperCase()).filter((ticker) => /^[A-Z.]{1,8}$/.test(ticker)))].slice(0, 5);
}

function latestByTicker(foundations: CompanyFoundationInput[]) {
  const rows = new Map<string, CompanyFoundationInput>();
  for (const foundation of foundations) rows.set(foundation.ticker.toUpperCase(), foundation);
  return [...rows.values()];
}

function runtimeDiagnostics() {
  const configured = (name: string) => Boolean(process.env[name]?.trim());
  return {
    branch: process.env.RAILWAY_GIT_BRANCH?.trim() || "agent/combined-opportunity-engine",
    environmentName: process.env.RAILWAY_ENVIRONMENT_NAME?.trim() || (process.env.SWING_UP_COMBINED_ENGINE_ALLOW_LOCAL === "true" ? "local_test" : null),
    deploymentId: process.env.RAILWAY_DEPLOYMENT_ID?.trim() || null,
    commitSha: process.env.RAILWAY_GIT_COMMIT_SHA?.trim() || process.env.GITHUB_SHA?.trim() || null,
    providerConfiguration: {
      database: configured("DATABASE_URL"),
      r2: configured("R2_ACCOUNT_ID") && configured("R2_ACCESS_KEY_ID") && configured("R2_SECRET_ACCESS_KEY") && configured("R2_BUCKET_NAME"),
      fmp: configured("FMP_API_KEY"),
      marketaux: configured("MARKETAUX_API_KEY"),
      alphaVantage: configured("ALPHA_VANTAGE_API_KEY"),
      polygon: configured("POLYGON_API_KEY"),
      fred: configured("FRED_API_KEY"),
      openFda: configured("OPENFDA_API_KEY"),
      openAi: configured("OPENAI_API_KEY"),
    },
    secretsRedacted: true,
  };
}

function thesisFromDecision(decision: ReturnType<typeof evaluateFoundation>): StoredThesisSnapshot {
  return {
    id: null,
    ticker: decision.ticker,
    company: decision.company,
    companyStatus: decision.thesisStatus,
    securityReadiness: decision.securityReadiness,
    candidateBucket: decision.candidateBucket,
    opportunityScore: decision.scores.opportunityScore,
    evidenceConfidence: decision.scores.evidenceConfidence,
    riskScore: decision.scores.riskScore,
    signalAction: decision.signalAction,
    confidence: decision.confidence,
    originalUnderwriting: decision,
    currentAssessment: decision,
    updatedAt: decision.evaluatedAt,
  };
}

export async function GET() {
  if (!branchAllowed()) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  return NextResponse.json({
    ok: true,
    engine: "combined_opportunity_engine",
    paths: ["foundation", "event"],
    liveDataAvailable: true,
    liveDataSources: ["SEC Company Facts", "SEC filing archives", "Yahoo Finance public chart API", "configured Railway estimates, price, and news providers"],
    mode: "isolated_preview_only",
    confidencePolicy: {
      seriousSignalThreshold: 90,
      minimumHistoricalSamples: 30,
      requiresLowerConfidenceBound: 0.9,
      abstainsWhenUncalibrated: true,
    },
    runtime: runtimeDiagnostics(),
    safety: { databaseWrites: false, publishing: false, notifications: false, payments: false, openAiCalls: false },
  });
}

export async function POST(request: NextRequest) {
  if (!branchAllowed()) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  const expected = process.env.SWING_UP_AUTOMATION_TOKEN?.trim();
  if (expected && token(request) !== expected) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const body = object(await request.json().catch(() => ({})));
  const useLiveData = body.useLiveData === true;
  const useProviderEnrichment = body.useProviderEnrichment !== false;
  const requestedLiveTickers = tickerList(body.liveTickers);
  const baseLive = useLiveData
    ? await fetchLiveOpportunityUniverse(requestedLiveTickers.length ? requestedLiveTickers : ["AAPL", "MSFT", "NVDA", "KO"])
    : { snapshots: [], errors: [] };
  const enrichment = useLiveData && useProviderEnrichment
    ? await enrichLiveOpportunityUniverse(baseLive.snapshots)
    : { snapshots: baseLive.snapshots, providerSummary: [] };
  const live = { snapshots: enrichment.snapshots, errors: baseLive.errors };
  const providedFoundations = Array.isArray(body.foundations) ? body.foundations.filter(validFoundation).slice(0, 25) : [];
  const foundations = latestByTicker([...providedFoundations, ...live.snapshots.map((snapshot) => snapshot.foundation)]);
  const providedEvents = Array.isArray(body.events) ? body.events.filter(validEvent).slice(0, 50) : [];
  const eventRows = [...providedEvents, ...live.snapshots.map((snapshot) => snapshot.event)].slice(0, 50);
  const theses = Array.isArray(body.theses) ? body.theses.filter(validThesis).slice(0, 50) : [];
  const thesisByTicker = new Map(theses.map((item) => [item.ticker.toUpperCase(), item]));

  const foundationDecisions = foundations.map(evaluateFoundation);
  for (const decision of foundationDecisions) thesisByTicker.set(decision.ticker, thesisFromDecision(decision));

  const eventDecisions = eventRows.flatMap((event) => {
    const thesis = thesisByTicker.get(event.ticker.toUpperCase());
    return thesis ? [evaluateEvent(event, thesis)] : [];
  });
  const unmatchedEventTickers = eventRows.map((event) => event.ticker.toUpperCase()).filter((ticker) => !thesisByTicker.has(ticker));
  const decisions = [...foundationDecisions, ...eventDecisions];

  return NextResponse.json({
    ok: true,
    dryRun: true,
    dataMode: useLiveData ? "real_live_sec_market_and_configured_provider_data" : "provided_input_only",
    runtime: runtimeDiagnostics(),
    confidencePolicy: {
      seriousSignalThreshold: 90,
      minimumHistoricalSamples: 30,
      requiresLowerConfidenceBound: 0.9,
      noUncalibratedDirectionalAlerts: true,
    },
    foundationDecisions,
    eventDecisions,
    unmatchedEventTickers,
    liveData: {
      requested: useLiveData,
      providerEnrichmentRequested: useProviderEnrichment,
      tickersRequested: requestedLiveTickers,
      snapshots: live.snapshots.map((snapshot) => ({
        ticker: snapshot.foundation.ticker,
        sourceMode: snapshot.metadata.sourceMode,
        fiscalPeriod: snapshot.metadata.fiscalPeriod,
        latestFilingForm: snapshot.metadata.latestFilingForm,
        latestFilingDate: snapshot.metadata.latestFilingDate,
        latestFilingAccession: snapshot.metadata.latestFilingAccession,
        marketSource: snapshot.metadata.marketSource,
        marketDate: snapshot.metadata.marketDate,
        realDataReceipts: snapshot.metadata.realDataReceipts,
        optionalProvidersUsed: object(snapshot.foundation.raw?.providerEnrichment).providersUsed ?? [],
        expectationSources: snapshot.foundation.expectations.sources ?? [],
        priceSourceCount: snapshot.foundation.market.priceSourceCount ?? 1,
        contradictions: snapshot.foundation.contradictions ?? [],
      })),
      providerSummary: enrichment.providerSummary,
      errors: live.errors,
      noSyntheticData: live.snapshots.every((snapshot) => snapshot.foundation.raw?.noSyntheticData === true),
    },
    summary: {
      foundationsChecked: foundationDecisions.length,
      eventsChecked: eventDecisions.length,
      alertEligible: decisions.filter((item) => item.userAlertEligible).length,
      seriousSignals: decisions.filter((item) => item.seriousSignal).length,
      buySignals: decisions.filter((item) => item.signalAction === "buy" && item.seriousSignal).length,
      sellSignals: decisions.filter((item) => item.signalAction === "sell" && item.seriousSignal).length,
      watchOutSignals: decisions.filter((item) => item.signalAction === "watch_out" && item.seriousSignal).length,
      abstentions: decisions.filter((item) => item.abstained).length,
      researchCandidates: foundationDecisions.filter((item) => item.candidateBucket === "advance_to_deeper_work").length,
      thesisStrengthening: eventDecisions.filter((item) => item.alertType === "thesis_strengthening" || item.alertType === "catalyst_alert").length,
      riskWarnings: eventDecisions.filter((item) => item.alertType === "risk_warning").length,
      brokenTheses: eventDecisions.filter((item) => item.alertType === "thesis_broken").length,
      liveProviderErrors: live.errors.length,
      optionalProviderErrors: enrichment.providerSummary.reduce((sum, row) => sum + row.providerErrors.length, 0),
    },
    safety: { databaseWrites: false, publishing: false, notifications: false, payments: false, openAiCalls: false },
    nextStep: "Build and validate chronological outcome calibration. Until the 90% lower confidence bound is proven on at least 30 real outcomes, all directional results remain research/watch only.",
  });
}
