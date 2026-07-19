import type {
  CandidateBucket,
  CompanyFoundationInput,
  EventDecision,
  EventSignalInput,
  FoundationDecision,
  FoundationScoreBreakdown,
  OpportunityAlertType,
  PillarStatus,
  SecurityReadiness,
  StoredThesisSnapshot,
  ThesisPillar,
  ThesisStatus,
} from "./types";

const clamp = (value: number) => Math.max(0, Math.min(100, Math.round(value)));
const known = (value: number | null): value is number => typeof value === "number" && Number.isFinite(value);
const score = (value: number | null, low: number, high: number) => !known(value) ? 45 : clamp(((value - low) / (high - low)) * 100);

function quality(input: CompanyFoundationInput) {
  const m = input.metrics;
  return clamp([
    known(m.netMargin) ? score(m.netMargin, -0.1, 0.25) : 45,
    known(m.freeCashFlowMargin) ? score(m.freeCashFlowMargin, -0.05, 0.25) : 45,
    known(m.returnOnAssets) ? score(m.returnOnAssets, -0.05, 0.2) : 45,
    known(m.debtToAssets) ? 100 - score(m.debtToAssets, 0.1, 0.8) : 45,
  ].reduce((a, b) => a + b, 0) / 4);
}

function momentum(input: CompanyFoundationInput) {
  const m = input.metrics;
  const growth = known(m.revenueGrowthYoY) ? score(m.revenueGrowthYoY, -0.15, 0.35) : 45;
  const growthChange = known(m.revenueGrowthYoY) && known(m.priorRevenueGrowthYoY)
    ? score(m.revenueGrowthYoY - m.priorRevenueGrowthYoY, -0.15, 0.15) : 45;
  const marginChange = known(m.operatingMargin) && known(m.priorOperatingMargin)
    ? score(m.operatingMargin - m.priorOperatingMargin, -0.1, 0.1) : 45;
  return clamp(growth * 0.45 + growthChange * 0.3 + marginChange * 0.25);
}

function valuation(input: CompanyFoundationInput) {
  const v = input.valuation;
  const pe = known(v.forwardPriceToEarnings) ? 100 - score(v.forwardPriceToEarnings, 8, 55) : 45;
  const fcf = known(v.freeCashFlowYield) ? score(v.freeCashFlowYield, 0, 0.1) : 45;
  const ps = known(v.priceToSales) ? 100 - score(v.priceToSales, 1, 20) : 45;
  return clamp(pe * 0.4 + fcf * 0.4 + ps * 0.2);
}

function expectations(input: CompanyFoundationInput) {
  const e = input.expectations;
  const revisions = known(e.analystRevisionScore) ? clamp(e.analystRevisionScore) : 45;
  const surprise = known(e.earningsSurprisePercent) ? score(e.earningsSurprisePercent, -15, 20) : 45;
  const gap = known(input.metrics.revenueGrowthYoY) && known(e.consensusRevenueGrowthPercent)
    ? score(input.metrics.revenueGrowthYoY * 100 - e.consensusRevenueGrowthPercent, -15, 15) : 45;
  return clamp(revisions * 0.4 + surprise * 0.25 + gap * 0.35);
}

function timing(input: CompanyFoundationInput) {
  let result = 45;
  if (known(input.market.priceChange20d)) result += input.market.priceChange20d < -10 ? 12 : input.market.priceChange20d > 20 ? -12 : 3;
  if (known(input.market.volumeRatio)) result += input.market.volumeRatio > 1.5 ? 8 : 0;
  if (input.catalyst.expectedAt) result += 12;
  if (known(input.catalyst.confidence)) result += (input.catalyst.confidence - 50) * 0.2;
  return clamp(result);
}

function evidenceConfidence(input: CompanyFoundationInput) {
  const official = input.receipts.filter((item) => item.reliability === "official").length;
  const high = input.receipts.filter((item) => item.reliability === "high").length;
  const missingPenalty = Math.min(45, input.missingFields.length * 5);
  return clamp(35 + official * 18 + high * 10 + Math.min(15, input.receipts.length * 3) - missingPenalty);
}

function risk(input: CompanyFoundationInput) {
  const m = input.metrics;
  let result = 45;
  if (known(m.debtToAssets)) result += m.debtToAssets > 0.7 ? 25 : m.debtToAssets < 0.35 ? -12 : 0;
  if (known(m.sharesGrowthYoY)) result += m.sharesGrowthYoY > 0.08 ? 18 : 0;
  if (known(m.freeCashFlowMargin)) result += m.freeCashFlowMargin < 0 ? 15 : -8;
  if (known(input.market.priceChange90d)) result += input.market.priceChange90d > 60 ? 15 : 0;
  return clamp(result);
}

function pillar(id: ThesisPillar["id"], label: string, status: PillarStatus, baseline: string, nextTest: string): ThesisPillar {
  return {
    id, label, status, baseline, nextTest,
    confirmCondition: `A fresh official source confirms improvement in ${label.toLowerCase()}.`,
    warningCondition: `${label} stops improving or misses the expected path.`,
    breakCondition: `Two consecutive official updates materially weaken ${label.toLowerCase()}.`,
  };
}

export function evaluateFoundation(input: CompanyFoundationInput): FoundationDecision {
  const businessQuality = quality(input);
  const financialMomentum = momentum(input);
  const valuationSupport = valuation(input);
  const expectationsGap = expectations(input);
  const timingQuality = timing(input);
  const evidence = evidenceConfidence(input);
  const riskScore = risk(input);
  const opportunityScore = clamp(businessQuality * 0.22 + financialMomentum * 0.25 + valuationSupport * 0.2 + expectationsGap * 0.18 + timingQuality * 0.15 - riskScore * 0.16 + 12);
  const scores: FoundationScoreBreakdown = { businessQuality, financialMomentum, valuationSupport, expectationsGap, timingQuality, evidenceConfidence: evidence, riskScore, opportunityScore };

  let candidateBucket: CandidateBucket = "deprioritized_or_reject";
  if (opportunityScore >= 70 && evidence >= 65 && riskScore < 65) candidateBucket = "advance_to_deeper_work";
  else if (opportunityScore >= 58 && evidence >= 50) candidateBucket = valuationSupport < 45 ? "valuation_or_expectations_gated" : "exposure_not_yet_proven";
  else if (evidence < 50) candidateBucket = "exposure_not_yet_proven";

  const securityReadiness: SecurityReadiness = candidateBucket === "advance_to_deeper_work"
    ? "conditional" : candidateBucket === "valuation_or_expectations_gated" ? "wait_for_price" : evidence < 55 ? "wait_for_proof" : "not_decision_grade";
  const thesisStatus: ThesisStatus = candidateBucket === "advance_to_deeper_work" ? "strengthening" : candidateBucket === "deprioritized_or_reject" ? "watch" : "untested";
  const alertType: OpportunityAlertType = candidateBucket === "advance_to_deeper_work" ? "new_opportunity" : "wait_for_proof";
  const blockedReasons = [
    ...(evidence < 65 ? ["evidence_confidence_below_alert_threshold"] : []),
    ...(riskScore >= 65 ? ["risk_too_high_for_opportunity_alert"] : []),
    ...(opportunityScore < 70 ? ["opportunity_score_below_alert_threshold"] : []),
    ...(input.market.currentPrice === null ? ["current_price_missing"] : []),
  ];
  const pillars = [
    pillar("growth", "Growth", financialMomentum >= 60 ? "confirming" : financialMomentum < 40 ? "warning" : "neutral", `Revenue growth: ${input.metrics.revenueGrowthYoY ?? "missing"}`, "Next reported revenue and guidance"),
    pillar("margins", "Margins", known(input.metrics.operatingMargin) && known(input.metrics.priorOperatingMargin) && input.metrics.operatingMargin > input.metrics.priorOperatingMargin ? "confirming" : "neutral", `Operating margin: ${input.metrics.operatingMargin ?? "missing"}`, "Next operating margin"),
    pillar("cash_conversion", "Cash conversion", known(input.metrics.freeCashFlowMargin) && input.metrics.freeCashFlowMargin > 0 ? "confirming" : "warning", `FCF margin: ${input.metrics.freeCashFlowMargin ?? "missing"}`, "Next free-cash-flow update"),
    pillar("balance_sheet", "Balance sheet", riskScore < 50 ? "confirming" : riskScore >= 70 ? "impaired" : "warning", `Debt/assets: ${input.metrics.debtToAssets ?? "missing"}`, "Debt, cash and dilution update"),
    pillar("valuation", "Valuation", valuationSupport >= 60 ? "confirming" : valuationSupport < 40 ? "warning" : "neutral", `Forward P/E: ${input.valuation.forwardPriceToEarnings ?? "missing"}`, "Price and estimate refresh"),
    pillar("expectations", "Expectations", expectationsGap >= 60 ? "confirming" : "neutral", `Expectations score: ${expectationsGap}`, "Estimate revisions and surprise"),
    pillar("catalyst", "Catalyst", input.catalyst.description ? "confirming" : "untested", input.catalyst.description ?? "No dated catalyst", input.catalyst.expectedAt ?? "Find a dated proof point"),
  ];

  return {
    path: "foundation", ticker: input.ticker.toUpperCase(), company: input.company, evaluatedAt: new Date().toISOString(),
    candidateBucket, thesisStatus, securityReadiness, alertType,
    userAlertEligible: blockedReasons.length === 0, scores,
    actionability: candidateBucket === "advance_to_deeper_work" ? "Research candidate: complete valuation and red-team review before any user-facing alert." : "Keep in the research funnel until missing proof or valuation improves.",
    variantWedge: expectationsGap >= 60 ? "Reported fundamentals may be improving faster than current expectations." : "No strong expectations gap has been proven yet.",
    whyNow: input.catalyst.description ?? (financialMomentum >= 60 ? "Fundamental momentum is improving without requiring a fresh-news trigger." : "The company was screened for persistent monitoring."),
    firstRejection: riskScore >= 65 ? "Risk is too high." : evidence < 65 ? "The evidence pack is incomplete." : valuationSupport < 40 ? "The stock may already price in too much success." : "The opportunity score is not high enough.",
    whatWouldMakeInvestable: ["Fresh official financial evidence", "Current price and valuation", "A defined catalyst or proof point", "Bull/base/bear downside review"],
    killCriteria: ["Two consecutive periods of worsening growth", "Material margin or cash-flow deterioration", "Balance-sheet stress or heavy dilution", "Valuation removes the reward-to-risk advantage"],
    blockedReasons, pillars,
    evidence: input.receipts.map((item) => ({ path: "foundation", direction: "neutral", pillar: "other", sourceName: item.source, sourceUrl: item.url, rawSignalId: null, observedAt: item.observedAt ?? input.observedAt, summary: `Foundation receipt from ${item.source}`, reliability: item.reliability, payload: { fields: item.fields ?? [] } })),
    nextWorkflow: candidateBucket === "advance_to_deeper_work" ? "scenario_sensitivity_and_valuation" : "collect_missing_foundation_evidence",
    input,
  };
}

const POSITIVE = ["raises guidance", "beats", "contract win", "approval", "record revenue", "margin expansion", "buyback", "debt reduction"];
const NEGATIVE = ["cuts guidance", "misses", "investigation", "fraud", "recall", "offering", "dilution", "default", "bankruptcy", "customer loss", "margin pressure"];

export function evaluateEvent(event: EventSignalInput, thesis: StoredThesisSnapshot): EventDecision {
  const text = `${event.title} ${event.summary}`.toLowerCase();
  const positives = POSITIVE.filter((term) => text.includes(term));
  const negatives = NEGATIVE.filter((term) => text.includes(term));
  const official = /sec|edgar|investor relations|company|exchange|government/i.test(event.source);
  const scoreValue = clamp(45 + positives.length * 18 - negatives.length * 22 + (event.importanceHint === "high" ? 12 : 0));
  const direction = negatives.length > positives.length ? "disconfirming" : positives.length > negatives.length ? "confirming" : "neutral";
  const severity = negatives.some((term) => ["fraud", "default", "bankruptcy"].includes(term)) ? "critical" : Math.max(positives.length, negatives.length) >= 2 ? "high" : "medium";
  let thesisStatusAfter: ThesisStatus = thesis.companyStatus;
  if (direction === "confirming" && thesis.companyStatus !== "broken") thesisStatusAfter = "strengthening";
  if (direction === "disconfirming") thesisStatusAfter = severity === "critical" ? "broken" : "impaired";
  let alertType: OpportunityAlertType = "no_action";
  if (thesisStatusAfter === "broken") alertType = "thesis_broken";
  else if (direction === "disconfirming") alertType = "risk_warning";
  else if (direction === "confirming") alertType = thesis.companyStatus === "strengthening" ? "catalyst_alert" : "thesis_strengthening";
  const evidenceConfidence = clamp(official ? 80 : event.sourceUrl ? 58 : 35);
  const blockedReasons = [
    ...(direction === "neutral" ? ["event_does_not_change_the_thesis"] : []),
    ...(evidenceConfidence < 65 ? ["event_needs_official_or_independent_confirmation"] : []),
  ];
  const securityReadinessAfter: SecurityReadiness = thesisStatusAfter === "broken" ? "not_decision_grade" : blockedReasons.length ? "wait_for_proof" : thesis.securityReadiness;
  return {
    path: "event", ticker: event.ticker.toUpperCase(), company: thesis.company, evaluatedAt: new Date().toISOString(), alertType,
    userAlertEligible: blockedReasons.length === 0,
    candidateBucket: thesisStatusAfter === "broken" ? "deprioritized_or_reject" : thesis.candidateBucket,
    thesisStatusBefore: thesis.companyStatus, thesisStatusAfter,
    securityReadinessBefore: thesis.securityReadiness, securityReadinessAfter,
    impact: { direction, severity, score: scoreValue, evidenceConfidence, linkedPillars: ["growth", "margins", "catalyst"], matchedPositiveSignals: positives, matchedNegativeSignals: negatives, pricedInRisk: "unknown" },
    thesisDelta: direction === "confirming" ? "New evidence strengthens the existing foundation thesis." : direction === "disconfirming" ? "New evidence weakens or breaks an existing thesis." : "The event does not materially change the thesis yet.",
    firstRejection: official ? "Check whether the market already priced in the event." : "The source is not yet strong enough.",
    requiredFollowUp: ["Verify with an official receipt", "Measure price and volume reaction", "Update valuation and scenario ranges"],
    blockedReasons,
    evidence: [{ path: "event", direction, pillar: "catalyst", sourceName: event.source, sourceUrl: event.sourceUrl, rawSignalId: event.rawSignalId, observedAt: event.receivedAt, summary: event.summary || event.title, reliability: official ? "official" : event.sourceUrl ? "medium" : "low", payload: event.payload }],
    nextWorkflow: direction === "disconfirming" ? "thesis_red_team_and_risk_review" : direction === "confirming" ? "valuation_and_priced_in_check" : "wait_for_more_evidence",
    event,
  };
}
