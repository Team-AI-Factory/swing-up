import { buildEventConfidence, buildFoundationConfidence, buildPriceTargetScenario } from "./confidence";
import type {
  CandidateBucket,
  CompanyFoundationInput,
  EventDecision,
  EventImpact,
  EventSignalInput,
  FoundationDecision,
  FoundationScoreBreakdown,
  OpportunityAlertType,
  PillarStatus,
  SecurityReadiness,
  SeriousSignalAction,
  StoredThesisSnapshot,
  ThesisPillar,
  ThesisStatus,
} from "./types";

const clamp = (value: number) => Math.max(0, Math.min(100, Math.round(value)));
const known = (value: number | null | undefined): value is number => typeof value === "number" && Number.isFinite(value);
const score = (value: number | null, low: number, high: number) => !known(value) ? 45 : clamp(((value - low) / (high - low)) * 100);

function quality(input: CompanyFoundationInput) {
  const metrics = input.metrics;
  return clamp([
    known(metrics.netMargin) ? score(metrics.netMargin, -0.1, 0.25) : 45,
    known(metrics.freeCashFlowMargin) ? score(metrics.freeCashFlowMargin, -0.05, 0.25) : 45,
    known(metrics.returnOnAssets) ? score(metrics.returnOnAssets, -0.05, 0.2) : 45,
    known(metrics.debtToAssets) ? 100 - score(metrics.debtToAssets, 0.1, 0.8) : 45,
  ].reduce((sum, value) => sum + value, 0) / 4);
}

function momentum(input: CompanyFoundationInput) {
  const metrics = input.metrics;
  const growth = known(metrics.revenueGrowthYoY) ? score(metrics.revenueGrowthYoY, -0.15, 0.35) : 45;
  const growthChange = known(metrics.revenueGrowthYoY) && known(metrics.priorRevenueGrowthYoY)
    ? score(metrics.revenueGrowthYoY - metrics.priorRevenueGrowthYoY, -0.15, 0.15)
    : 45;
  const marginChange = known(metrics.operatingMargin) && known(metrics.priorOperatingMargin)
    ? score(metrics.operatingMargin - metrics.priorOperatingMargin, -0.1, 0.1)
    : 45;
  return clamp(growth * 0.45 + growthChange * 0.3 + marginChange * 0.25);
}

function valuation(input: CompanyFoundationInput) {
  const metrics = input.valuation;
  const peInput = known(metrics.forwardPriceToEarnings) ? metrics.forwardPriceToEarnings : metrics.priceToEarnings;
  const pe = known(peInput) ? 100 - score(peInput, 8, 55) : 45;
  const freeCashFlow = known(metrics.freeCashFlowYield) ? score(metrics.freeCashFlowYield, 0, 0.1) : 45;
  const sales = known(metrics.priceToSales) ? 100 - score(metrics.priceToSales, 1, 20) : 45;
  return clamp(pe * 0.4 + freeCashFlow * 0.4 + sales * 0.2);
}

function expectations(input: CompanyFoundationInput) {
  const values = input.expectations;
  const revisions = known(values.analystRevisionScore) ? clamp(values.analystRevisionScore) : 45;
  const surprise = known(values.earningsSurprisePercent) ? score(values.earningsSurprisePercent, -15, 20) : 45;
  const gap = known(input.metrics.revenueGrowthYoY) && known(values.consensusRevenueGrowthPercent)
    ? score(input.metrics.revenueGrowthYoY * 100 - values.consensusRevenueGrowthPercent, -15, 15)
    : 45;
  return clamp(revisions * 0.4 + surprise * 0.25 + gap * 0.35);
}

function timing(input: CompanyFoundationInput) {
  let result = 45;
  if (known(input.market.priceChange20d)) result += input.market.priceChange20d < -10 ? 12 : input.market.priceChange20d > 20 ? -12 : 3;
  if (known(input.market.volumeRatio)) result += input.market.volumeRatio > 1.5 ? 8 : 0;
  if (input.catalyst.expectedAt) result += 12;
  if (known(input.catalyst.confidence)) result += (input.catalyst.confidence - 50) * 0.2;
  if (known(input.market.relativeStrength20d)) result += input.market.relativeStrength20d > 5 ? 5 : input.market.relativeStrength20d < -8 ? -5 : 0;
  return clamp(result);
}

function evidenceConfidence(input: CompanyFoundationInput) {
  const official = input.receipts.filter((item) => item.reliability === "official").length;
  const high = input.receipts.filter((item) => item.reliability === "high").length;
  const missingPenalty = Math.min(45, input.missingFields.length * 5);
  const contradictionPenalty = Math.min(25, (input.contradictions?.length ?? input.dataQuality?.contradictionCount ?? 0) * 10);
  return clamp(35 + official * 18 + high * 10 + Math.min(15, input.receipts.length * 3) - missingPenalty - contradictionPenalty);
}

function risk(input: CompanyFoundationInput) {
  const metrics = input.metrics;
  let result = 45;
  if (known(metrics.debtToAssets)) result += metrics.debtToAssets > 0.7 ? 25 : metrics.debtToAssets < 0.35 ? -12 : 0;
  if (known(metrics.sharesGrowthYoY)) result += metrics.sharesGrowthYoY > 0.08 ? 18 : 0;
  if (known(metrics.freeCashFlowMargin)) result += metrics.freeCashFlowMargin < 0 ? 15 : -8;
  if (known(input.market.priceChange90d)) result += input.market.priceChange90d > 60 ? 15 : 0;
  if (known(input.market.drawdown90d)) result += input.market.drawdown90d < -25 ? 12 : 0;
  result += Math.min(30, (input.contradictions?.length ?? input.dataQuality?.contradictionCount ?? 0) * 10);
  return clamp(result);
}

function pillar(id: ThesisPillar["id"], label: string, status: PillarStatus, baseline: string, nextTest: string): ThesisPillar {
  return {
    id,
    label,
    status,
    baseline,
    nextTest,
    confirmCondition: `A fresh official source confirms improvement in ${label.toLowerCase()}.`,
    warningCondition: `${label} stops improving or misses the expected path.`,
    breakCondition: `Two consecutive official updates materially weaken ${label.toLowerCase()}.`,
  };
}

function foundationSignal(params: {
  confidenceEligible: boolean;
  opportunityScore: number;
  riskScore: number;
  upsidePercent: number | null;
  downsidePercent: number | null;
  rewardRiskRatio: number | null;
  candidateBucket: CandidateBucket;
}): SeriousSignalAction {
  if (params.confidenceEligible) {
    if (known(params.upsidePercent) && params.upsidePercent >= 12 && known(params.rewardRiskRatio) && params.rewardRiskRatio >= 2 && params.opportunityScore >= 70 && params.riskScore < 65) return "buy";
    if (known(params.upsidePercent) && params.upsidePercent <= -12) return "sell";
    if (params.riskScore >= 70 || (known(params.downsidePercent) && params.downsidePercent <= -18)) return "watch_out";
  }
  if (params.riskScore >= 70) return "watch_out";
  if (["advance_to_deeper_work", "valuation_or_expectations_gated", "exposure_not_yet_proven"].includes(params.candidateBucket)) return "watch";
  return "no_action";
}

export function evaluateFoundation(input: CompanyFoundationInput): FoundationDecision {
  const businessQuality = quality(input);
  const financialMomentum = momentum(input);
  const valuationSupport = valuation(input);
  const expectationsGap = expectations(input);
  const timingQuality = timing(input);
  const evidence = evidenceConfidence(input);
  const riskScore = risk(input);
  const opportunityScore = clamp(
    businessQuality * 0.22
    + financialMomentum * 0.25
    + valuationSupport * 0.2
    + expectationsGap * 0.18
    + timingQuality * 0.15
    - riskScore * 0.16
    + 12,
  );
  const scores: FoundationScoreBreakdown = {
    businessQuality,
    financialMomentum,
    valuationSupport,
    expectationsGap,
    timingQuality,
    evidenceConfidence: evidence,
    riskScore,
    opportunityScore,
  };

  let candidateBucket: CandidateBucket = "deprioritized_or_reject";
  if (opportunityScore >= 70 && evidence >= 65 && riskScore < 65) candidateBucket = "advance_to_deeper_work";
  else if (opportunityScore >= 58 && evidence >= 50) candidateBucket = valuationSupport < 45 ? "valuation_or_expectations_gated" : "exposure_not_yet_proven";
  else if (evidence < 50) candidateBucket = "exposure_not_yet_proven";

  const priceTarget = buildPriceTargetScenario(input);
  const confidence = buildFoundationConfidence(input, priceTarget);
  const signalAction = foundationSignal({
    confidenceEligible: confidence.seriousSignalEligible,
    opportunityScore,
    riskScore,
    upsidePercent: priceTarget.upsidePercent,
    downsidePercent: priceTarget.downsidePercent,
    rewardRiskRatio: priceTarget.rewardRiskRatio,
    candidateBucket,
  });
  const seriousSignal = confidence.seriousSignalEligible && ["buy", "sell", "watch_out"].includes(signalAction);
  const expectationsMissing = !known(input.expectations.analystRevisionScore)
    && !known(input.expectations.earningsSurprisePercent)
    && !known(input.expectations.consensusRevenueGrowthPercent)
    && !known(input.expectations.targetPriceConsensus)
    && !known(input.expectations.targetPriceMedian);
  const blockedReasons = [
    ...(evidence < 65 ? ["evidence_confidence_below_alert_threshold"] : []),
    ...(riskScore >= 65 && signalAction === "buy" ? ["risk_too_high_for_buy_signal"] : []),
    ...(opportunityScore < 70 && signalAction === "buy" ? ["opportunity_score_below_buy_threshold"] : []),
    ...(input.market.currentPrice === null ? ["current_price_missing"] : []),
    ...(expectationsMissing ? ["market_expectations_not_available"] : []),
    ...(priceTarget.sourcePosture === "unavailable" ? ["price_target_scenario_unavailable"] : []),
    ...(!known(priceTarget.rewardRiskRatio) || priceTarget.rewardRiskRatio < 2 ? ["reward_risk_below_two_to_one"] : []),
    ...(!confidence.seriousSignalEligible ? ["calibrated_confidence_below_90"] : []),
    ...((input.calibration?.sampleSize ?? 0) < 30 ? ["historical_calibration_sample_below_30"] : []),
    ...((input.calibration?.lowerConfidenceBound ?? 0) < 0.9 ? ["historical_lower_confidence_bound_below_90"] : []),
  ];
  const securityReadiness: SecurityReadiness = seriousSignal
    ? "ready"
    : candidateBucket === "advance_to_deeper_work"
      ? "conditional"
      : candidateBucket === "valuation_or_expectations_gated"
        ? "wait_for_price"
        : evidence < 55 ? "wait_for_proof" : "not_decision_grade";
  const thesisStatus: ThesisStatus = candidateBucket === "advance_to_deeper_work" ? "strengthening" : candidateBucket === "deprioritized_or_reject" ? "watch" : "untested";
  let alertType: OpportunityAlertType = candidateBucket === "advance_to_deeper_work" ? "new_opportunity" : "wait_for_proof";
  if (seriousSignal && signalAction === "buy") alertType = "price_opportunity";
  else if (seriousSignal && (signalAction === "sell" || signalAction === "watch_out")) alertType = "risk_warning";
  const valuationPe = input.valuation.forwardPriceToEarnings ?? input.valuation.priceToEarnings;
  const pillars = [
    pillar("growth", "Growth", financialMomentum >= 60 ? "confirming" : financialMomentum < 40 ? "warning" : "neutral", `Revenue growth: ${input.metrics.revenueGrowthYoY ?? "missing"}`, "Next reported revenue and guidance"),
    pillar("margins", "Margins", known(input.metrics.operatingMargin) && known(input.metrics.priorOperatingMargin) && input.metrics.operatingMargin > input.metrics.priorOperatingMargin ? "confirming" : "neutral", `Operating margin: ${input.metrics.operatingMargin ?? "missing"}`, "Next operating margin"),
    pillar("cash_conversion", "Cash conversion", known(input.metrics.freeCashFlowMargin) && input.metrics.freeCashFlowMargin > 0 ? "confirming" : "warning", `FCF margin: ${input.metrics.freeCashFlowMargin ?? "missing"}`, "Next free-cash-flow update"),
    pillar("balance_sheet", "Balance sheet", riskScore < 50 ? "confirming" : riskScore >= 70 ? "impaired" : "warning", `Debt/assets: ${input.metrics.debtToAssets ?? "missing"}`, "Debt, cash and dilution update"),
    pillar("valuation", "Valuation", valuationSupport >= 60 ? "confirming" : valuationSupport < 40 ? "warning" : "neutral", `P/E: ${valuationPe ?? "missing"}; target: ${priceTarget.basePrice ?? "unavailable"}`, "Price, estimates, and scenario refresh"),
    pillar("expectations", "Expectations", expectationsMissing ? "untested" : expectationsGap >= 60 ? "confirming" : "neutral", expectationsMissing ? "Verified market expectations unavailable" : `Expectations score: ${expectationsGap}`, "Estimate revisions, target changes, and surprise"),
    pillar("catalyst", "Catalyst", input.catalyst.description ? "confirming" : "untested", input.catalyst.description ?? "No dated catalyst", input.catalyst.expectedAt ?? "Find a dated proof point"),
  ];
  const confidenceExplanation = [
    `Overall confidence is ${confidence.overall}/100 and is ${confidence.kind.replaceAll("_", " ")}.`,
    `Data quality ${confidence.dataQuality}, freshness ${confidence.freshness}, source agreement ${confidence.sourceAgreement}, completeness ${confidence.completeness}.`,
    `Historical calibration ${confidence.calibration} from ${confidence.calibrationSampleSize} outcome(s); scenario confidence ${confidence.scenario}.`,
    ...confidence.confidenceCaps,
  ];

  return {
    path: "foundation",
    ticker: input.ticker.toUpperCase(),
    company: input.company,
    evaluatedAt: new Date().toISOString(),
    candidateBucket,
    thesisStatus,
    securityReadiness,
    alertType,
    signalAction,
    seriousSignal,
    userAlertEligible: seriousSignal,
    abstained: !seriousSignal,
    horizonDays: priceTarget.horizonDays,
    scores,
    confidence,
    priceTarget,
    confidenceExplanation,
    actionability: seriousSignal
      ? `${signalAction.toUpperCase()} serious signal cleared the 90% calibrated-confidence gate.`
      : "Research/watch only. The engine abstained from a directional user alert until data, scenario, and historical calibration all clear the 90% gate.",
    variantWedge: expectationsMissing
      ? "Reported fundamentals are measurable, but no verified market-expectations edge has been proven."
      : expectationsGap >= 60 ? "Reported fundamentals may be improving faster than current expectations." : "No strong expectations gap has been proven yet.",
    whyNow: input.catalyst.description ?? (financialMomentum >= 60 ? "Fundamental momentum is improving without requiring a fresh-news trigger." : "The company was screened for persistent monitoring."),
    firstRejection: seriousSignal
      ? "No immediate rejection; monitor the stated kill criteria and calibration drift."
      : confidence.confidenceCaps[0]
        ?? (riskScore >= 65 ? "Risk is too high." : evidence < 65 ? "The evidence pack is incomplete." : expectationsMissing ? "Verified market expectations are missing." : valuationSupport < 40 ? "The stock may already price in too much success." : "The opportunity score is not high enough."),
    whatWouldMakeInvestable: ["Fresh official financial evidence", "Two independent price sources", "Verified consensus and target range", "A source-backed bull/base/bear scenario", "At least 30 comparable real outcomes with a 90% lower confidence bound"],
    killCriteria: ["Two consecutive periods of worsening growth", "Material margin or cash-flow deterioration", "Balance-sheet stress or heavy dilution", "Valuation removes the reward-to-risk advantage", "Observed signal precision falls below its published calibration band"],
    blockedReasons: [...new Set(blockedReasons)],
    pillars,
    evidence: input.receipts.map((item) => ({ path: "foundation", direction: "neutral", pillar: "other", sourceName: item.source, sourceUrl: item.url, rawSignalId: null, observedAt: item.observedAt ?? input.observedAt, summary: `Foundation receipt from ${item.source}`, reliability: item.reliability, payload: { fields: item.fields ?? [] } })),
    nextWorkflow: seriousSignal ? "publish_to_guarded_serious_signal_review" : candidateBucket === "advance_to_deeper_work" ? "scenario_sensitivity_and_calibration" : "collect_missing_foundation_evidence",
    input,
  };
}

const POSITIVE = ["raises guidance", "beats", "contract win", "approval", "record revenue", "revenue growth", "margin expansion", "margin improvement", "cash flow improvement", "buyback", "debt reduction"];
const NEGATIVE = ["cuts guidance", "misses", "investigation", "fraud", "recall", "offering", "dilution", "default", "bankruptcy", "customer loss", "revenue decline", "margin pressure", "margin contraction", "cash flow deterioration"];

export function evaluateEvent(event: EventSignalInput, thesis: StoredThesisSnapshot): EventDecision {
  const text = `${event.title} ${event.summary}`.toLowerCase();
  const positives = POSITIVE.filter((term) => text.includes(term));
  const negatives = NEGATIVE.filter((term) => text.includes(term));
  const official = /sec|edgar|investor relations|company|exchange|government|fda|federal reserve/i.test(event.source);
  const independentReceipts = known(event.payload.independentReceipts) ? Math.max(0, Math.floor(event.payload.independentReceipts)) : event.sourceUrl ? 1 : 0;
  const scoreValue = clamp(45 + positives.length * 18 - negatives.length * 22 + (event.importanceHint === "high" ? 12 : 0));
  const direction = negatives.length > positives.length ? "disconfirming" : positives.length > negatives.length ? "confirming" : "neutral";
  const severity = negatives.some((term) => ["fraud", "default", "bankruptcy"].includes(term)) ? "critical" : Math.max(positives.length, negatives.length) >= 2 ? "high" : positives.length || negatives.length ? "medium" : "low";
  let thesisStatusAfter: ThesisStatus = thesis.companyStatus;
  if (direction === "confirming" && thesis.companyStatus !== "broken") thesisStatusAfter = "strengthening";
  if (direction === "disconfirming") thesisStatusAfter = severity === "critical" ? "broken" : "impaired";
  let alertType: OpportunityAlertType = "no_action";
  if (thesisStatusAfter === "broken") alertType = "thesis_broken";
  else if (direction === "disconfirming") alertType = "risk_warning";
  else if (direction === "confirming") alertType = thesis.companyStatus === "strengthening" ? "catalyst_alert" : "thesis_strengthening";
  const evidenceConfidence = clamp((official ? 82 : event.sourceUrl ? 58 : 35) + Math.min(15, independentReceipts * 5));
  const impact: EventImpact = {
    direction,
    severity,
    score: scoreValue,
    evidenceConfidence,
    linkedPillars: ["growth", "margins", "catalyst"],
    matchedPositiveSignals: positives,
    matchedNegativeSignals: negatives,
    pricedInRisk: "unknown",
  };
  const confidence = buildEventConfidence(event, thesis, impact);
  let signalAction: SeriousSignalAction = "no_action";
  if (direction === "disconfirming") signalAction = thesisStatusAfter === "broken" || severity === "critical" ? "sell" : "watch_out";
  else if (direction === "confirming") signalAction = confidence.seriousSignalEligible && thesis.signalAction === "buy" ? "buy" : "watch";
  else if (thesis.signalAction === "watch" || thesis.signalAction === "buy") signalAction = "watch";
  const seriousSignal = confidence.seriousSignalEligible && ["buy", "sell", "watch_out"].includes(signalAction);
  const blockedReasons = [
    ...(direction === "neutral" ? ["event_does_not_change_the_thesis"] : []),
    ...(evidenceConfidence < 65 ? ["event_needs_official_or_independent_confirmation"] : []),
    ...(independentReceipts < 2 ? ["event_independent_receipts_below_two"] : []),
    ...(!confidence.seriousSignalEligible ? ["event_calibrated_confidence_below_90"] : []),
  ];
  const securityReadinessAfter: SecurityReadiness = seriousSignal
    ? "ready"
    : thesisStatusAfter === "broken" ? "not_decision_grade" : "wait_for_proof";
  const confidenceExplanation = [
    `Event confidence is ${confidence.overall}/100.`,
    `Official-source status: ${official ? "yes" : "no"}; independent receipts: ${independentReceipts}.`,
    ...confidence.confidenceCaps,
  ];
  return {
    path: "event",
    ticker: event.ticker.toUpperCase(),
    company: thesis.company,
    evaluatedAt: new Date().toISOString(),
    alertType,
    signalAction,
    seriousSignal,
    userAlertEligible: seriousSignal,
    abstained: !seriousSignal,
    horizonDays: thesis.originalUnderwriting?.horizonDays ?? 30,
    candidateBucket: thesisStatusAfter === "broken" ? "deprioritized_or_reject" : thesis.candidateBucket,
    thesisStatusBefore: thesis.companyStatus,
    thesisStatusAfter,
    securityReadinessBefore: thesis.securityReadiness,
    securityReadinessAfter,
    impact,
    confidence,
    confidenceExplanation,
    thesisDelta: direction === "confirming" ? "New evidence strengthens the existing foundation thesis." : direction === "disconfirming" ? "New evidence weakens or breaks an existing thesis." : "The event does not materially change the thesis yet.",
    firstRejection: seriousSignal ? "No immediate rejection; confirm price reaction and monitor the kill criteria." : confidence.confidenceCaps[0] ?? (official ? "The event still needs a second independent receipt and calibrated thesis." : "The source is not yet strong enough."),
    requiredFollowUp: ["Verify with an official receipt", "Obtain a second independent receipt", "Measure price and volume reaction", "Update valuation and scenario ranges", "Update historical calibration after the outcome window closes"],
    blockedReasons: [...new Set(blockedReasons)],
    evidence: [{ path: "event", direction, pillar: "catalyst", sourceName: event.source, sourceUrl: event.sourceUrl, rawSignalId: event.rawSignalId, observedAt: event.receivedAt, summary: event.summary || event.title, reliability: official ? "official" : event.sourceUrl ? "medium" : "low", payload: event.payload }],
    nextWorkflow: seriousSignal ? "guarded_serious_signal_review" : direction === "disconfirming" ? "thesis_red_team_and_risk_review" : direction === "confirming" ? "valuation_and_priced_in_check" : "wait_for_more_evidence",
    event,
  };
}
