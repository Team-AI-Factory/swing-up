/* eslint-disable */
import { NextRequest, NextResponse } from "next/server";
import { evaluateEvent, evaluateFoundation } from "@/lib/opportunity-engine/engine";
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
    process.env.RAILWAY_PROJECT_ID &&
    branch === "agent/combined-opportunity-engine" &&
    environment && environment !== "production"
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

export async function GET() {
  if (!branchAllowed()) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  return NextResponse.json({
    ok: true,
    engine: "combined_opportunity_engine",
    branch: "agent/combined-opportunity-engine",
    paths: ["foundation", "event"],
    mode: "isolated_preview_only",
    safety: { databaseWrites: false, publishing: false, notifications: false, payments: false, openAiCalls: false },
  });
}

export async function POST(request: NextRequest) {
  if (!branchAllowed()) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  const expected = process.env.SWING_UP_AUTOMATION_TOKEN?.trim();
  if (expected && token(request) !== expected) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const body = object(await request.json().catch(() => ({})));
  const foundations = Array.isArray(body.foundations) ? body.foundations.filter(validFoundation).slice(0, 25) : [];
  const eventRows = Array.isArray(body.events) ? body.events : [];
  const theses = Array.isArray(body.theses) ? body.theses.filter(validThesis).slice(0, 50) : [];
  const thesisByTicker = new Map(theses.map((item) => [item.ticker.toUpperCase(), item]));

  const foundationDecisions = foundations.map(evaluateFoundation);
  for (const decision of foundationDecisions) {
    thesisByTicker.set(decision.ticker, {
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
    });
  }

  const eventDecisions = eventRows.filter(validEvent).slice(0, 50).flatMap((event) => {
    const thesis = thesisByTicker.get(event.ticker.toUpperCase());
    return thesis ? [evaluateEvent(event, thesis)] : [];
  });

  return NextResponse.json({
    ok: true,
    dryRun: true,
    branch: "agent/combined-opportunity-engine",
    foundationDecisions,
    eventDecisions,
    unmatchedEventTickers: eventRows.filter(validEvent).map((event) => event.ticker.toUpperCase()).filter((ticker) => !thesisByTicker.has(ticker)),
    summary: {
      foundationsChecked: foundationDecisions.length,
      eventsChecked: eventDecisions.length,
      alertEligible: [...foundationDecisions, ...eventDecisions].filter((item) => item.userAlertEligible).length,
      researchCandidates: foundationDecisions.filter((item) => item.candidateBucket === "advance_to_deeper_work").length,
      thesisStrengthening: eventDecisions.filter((item) => item.alertType === "thesis_strengthening" || item.alertType === "catalyst_alert").length,
      riskWarnings: eventDecisions.filter((item) => item.alertType === "risk_warning").length,
      brokenTheses: eventDecisions.filter((item) => item.alertType === "thesis_broken").length,
    },
    safety: { databaseWrites: false, publishing: false, notifications: false, payments: false, openAiCalls: false },
    nextStep: "Connect verified SEC fundamentals and stored raw signals after preview validation. No user alerts are published by this branch.",
  });
}
