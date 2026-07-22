import { NextRequest, NextResponse } from "next/server";
import { evaluateEvent, evaluateFoundation } from "@/lib/opportunity-engine/engine";
import { fetchLiveOpportunityUniverse } from "@/lib/opportunity-engine/live-data";
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
    liveDataSources: ["SEC Company Facts", "SEC filing archives", "Yahoo Finance public chart API"],
    mode: "isolated_preview_only",
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
  const requestedLiveTickers = tickerList(body.liveTickers);
  const live = useLiveData
    ? await fetchLiveOpportunityUniverse(requestedLiveTickers.length ? requestedLiveTickers : ["AAPL", "MSFT", "NVDA", "KO"])
    : { snapshots: [], errors: [] };
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

  return NextResponse.json({
    ok: true,
    dryRun: true,
    dataMode: useLiveData ? "real_live_sec_and_market_data" : "provided_input_only",
    runtime: runtimeDiagnostics(),
    foundationDecisions,
    eventDecisions,
    unmatchedEventTickers,
    liveData: {
      requested: useLiveData,
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
      })),
      errors: live.errors,
      noSyntheticData: live.snapshots.every((snapshot) => snapshot.foundation.raw?.noSyntheticData === true),
    },
    summary: {
      foundationsChecked: foundationDecisions.length,
      eventsChecked: eventDecisions.length,
      alertEligible: [...foundationDecisions, ...eventDecisions].filter((item) => item.userAlertEligible).length,
      researchCandidates: foundationDecisions.filter((item) => item.candidateBucket === "advance_to_deeper_work").length,
      thesisStrengthening: eventDecisions.filter((item) => item.alertType === "thesis_strengthening" || item.alertType === "catalyst_alert").length,
      riskWarnings: eventDecisions.filter((item) => item.alertType === "risk_warning").length,
      brokenTheses: eventDecisions.filter((item) => item.alertType === "thesis_broken").length,
      liveProviderErrors: live.errors.length,
    },
    safety: { databaseWrites: false, publishing: false, notifications: false, payments: false, openAiCalls: false },
    nextStep: "Use the redacted runtime provider diagnostics to connect estimates, targets, second-source market data, and calibrated outcome history before permitting a 90% serious signal.",
  });
}
