import { completeCommitteeReview, FOCUSED_REVIEW_POLICY } from "@/lib/ai-committee/review-policy";
import { isSimpleAlertPilot } from "@/lib/simple-alert-pilot-runtime";
import { isDeepStrictEqual } from "node:util";
import { valuationEvidenceAudit } from "@/lib/equity-signal/financial-evidence";
import type { ImpactCandidate } from "@/lib/equity-signal/types";
import type { UsValueCompanyAnalysis } from "@/lib/opportunity-engine/us-value-investing-engine";

/** A single method needs a reproducible primary-fact bridge, not merely a
 * provider target. This does not replace quote, risk, review or delivery gates. */
export function singleValuationScenarioSupported(analysis: UsValueCompanyAnalysis | undefined, candidate: ImpactCandidate, now: Date) {
  if (!analysis || !Array.isArray(analysis.fairValue?.methods) || analysis.fairValue.methods.length !== 1 || !/^\d{10}$/.test(candidate.cik ?? "") || analysis.currency !== "USD") return false;
  const method = analysis.fairValue.methods[0], fair = analysis.fairValue;
  if (!method || !["earnings_power", "owner_earnings_fcf"].includes(method.method) || typeof method.assumption !== "string" || !method.assumption.trim()) return false;
  const supportedSectors = new Set(["technology", "technology services", "electronic technology", "commercial services", "consumer services", "producer manufacturing", "industrial services"]);
  if (!supportedSectors.has(String(analysis.sector ?? "").trim().toLowerCase())
    || typeof analysis.industry !== "string" || !analysis.industry.trim() || /bank|financial|credit|insurance|reit|real estate|mortgage|investment|biotech|exploration|mining|oil|gas/i.test(analysis.industry)) return false;
  const scenario = method.singleScenario;
  if (!scenario || scenario.version !== "engine-sensitivity-v1" || scenario.lowFactor !== 0.8 || scenario.highFactor !== 1.2
    || !Number.isFinite(scenario.parameter) || /missing|unreconciled|unsupported|unverified|unknown|incomplete|placeholder|todo/i.test(method.assumption)) return false;
  if (method.method === "earnings_power") {
    if (scenario.inputBasis !== "reported_eps" || scenario.parameter < 8 || scenario.parameter > 26
      || method.assumption !== `Reported earnings valued at a conservative ${scenario.parameter.toFixed(1)}x multiple based on quality and growth.`) return false;
  } else if (scenario.inputBasis !== "reported_fcf" || scenario.parameter < 0.045 || scenario.parameter > 0.1
    || method.assumption !== `Reported free cash flow valued at a ${(scenario.parameter * 100).toFixed(1)}% required free-cash-flow yield.`) return false;
  const [low, base, high] = [fair.conservativeValue, fair.baseValue, fair.optimisticValue];
  if (![low, base, high, method.value].every(value => typeof value === "number" && Number.isFinite(value) && value > 0)
    || low! > base! || base! > high! || low === high || Math.abs(base! - method.value) > Math.max(0.01, method.value * 0.001)
    || Math.abs(low! - method.value * 0.8) > 0.01 || Math.abs(high! - method.value * 1.2) > 0.01) return false;
  const price = candidate.quote?.price;
  if (typeof price !== "number" || !Number.isFinite(price) || price <= 0 || base! < price * 0.2 || base! > price * 5) return false;
  const source = `https://data.sec.gov/api/xbrl/companyfacts/CIK${candidate.cik}.json`;
  if (candidate.fundamentals?.available !== true || !Array.isArray(candidate.fundamentals.items) || candidate.fundamentals.error || candidate.fundamentals.issuerCik !== candidate.cik || candidate.fundamentals.sourceUrl !== source) return false;
  const audit = valuationEvidenceAudit(analysis, candidate.fundamentals, candidate.quote?.price ?? null, now);
  const crossCheck = audit.methods[0]?.annualCrossCheck;
  if (audit.missingEssentialFacts.length || !crossCheck || crossCheck.sourceUrl !== source) return false;
  // An annual calculation is not reconciled by an unrelated interim period.
  const facts = crossCheck.inputFacts.filter(Boolean) as Array<Record<string, unknown>>;
  if (!facts.length || facts.some(fact => {
    const start = Date.parse(String(fact.periodStart ?? "")), end = Date.parse(String(fact.periodEnd ?? "")), filed = Date.parse(String(fact.filedAt ?? ""));
    return !Number.isFinite(end) || !Number.isFinite(filed) || end > filed || filed > now.getTime()
      || now.getTime() - end > 550 * 86400000 || !Number.isFinite(start)
      || new Date(start).toISOString().slice(0, 10) !== fact.periodStart
      || (end - start) / 86400000 < 300 || (end - start) / 86400000 > 400
      || fact.sourceUrl !== source || fact.unit !== (method.method === "earnings_power" ? "USD/shares" : "USD");
  })) return false;
  if (method.method === "owner_earnings_fcf") {
    const shares = crossCheck.shareCountFact;
    const filed = Date.parse(String(shares?.filedAt ?? "")), end = Date.parse(String(shares?.periodEnd ?? ""));
    if (!shares || shares.unit !== "shares" || shares.sourceUrl !== source || !Number.isFinite(filed) || !Number.isFinite(end)
      || end > filed || filed > now.getTime() || now.getTime() - end > 550 * 86400000) return false;
  }
  const allFacts = candidate.fundamentals.items;
  const required = method.method === "earnings_power"
    ? ["shares_outstanding", "equity", "net_income", "net_income_annual", "diluted_eps", "diluted_eps_annual"]
    : ["shares_outstanding", "equity", "operating_cash_flow", "operating_cash_flow_annual", "capital_expenditure", "capital_expenditure_annual"];
  const periodStart = facts[0].periodStart, periodEnd = facts[0].periodEnd;
  // Fail closed on interim/annual mixing, units, provenance and share-date
  // mismatches. We do not infer normalization from a coincidentally equal value.
  for (const metric of required) {
    const rows = allFacts.filter(fact => fact.metric === metric);
    if (rows.length !== 1) return false;
    const fact = rows[0], end = Date.parse(fact.periodEnd ?? ""), filed = Date.parse(fact.filedAt ?? "");
    const balance = ["shares_outstanding", "equity"].includes(metric);
    if (!Number.isFinite(fact.value) || (metric.includes("capital_expenditure") ? fact.value < 0 : fact.value <= 0)
      || fact.sourceUrl !== source || fact.unit !== (metric === "shares_outstanding" ? "shares" : metric.startsWith("diluted_eps") ? "USD/shares" : "USD")
      || !Number.isFinite(end) || !Number.isFinite(filed) || end > filed || filed > now.getTime()
      || now.getTime() - end > 550 * 86400000 || fact.periodEnd !== periodEnd
      || new Date(end).toISOString().slice(0, 10) !== fact.periodEnd || new Date(filed).toISOString().slice(0, 10) !== fact.filedAt
      || !fact.concept || !/^\d{10}-\d{2}-\d{6}$/.test(fact.accession ?? "")
      || !["10-K", "20-F", "40-F"].includes(fact.form ?? "")
      || (!balance && fact.periodStart !== periodStart)) return false;
  }
  const reproduced = method.method === "earnings_power"
    ? Number(facts[0].value) * scenario.parameter
    : (Number(facts[0].value) - Number(facts[1]?.value)) / Number(crossCheck.shareCountFact?.value) / scenario.parameter;
  if (!Number.isFinite(reproduced) || Math.abs(reproduced - method.value) > 0.011) return false;
  return true;
}

/** Separate evidence qualification, never a replacement or uplift of the
 * scanner's method-count-capped confidence. 51 preserves the original 75 gate's
 * non-method contribution after its minimum two-method contribution (24).
 * The evidence rule replaces only that method-count requirement. */
export const SINGLE_SCENARIO_POLICY = "sec-annual-single-scenario-v1";
export function singleScenarioEvidenceQuality(analysis: UsValueCompanyAnalysis | undefined) {
  const scores = analysis?.scores;
  if (!scores || ![scores.evidenceCompleteness, scores.businessQuality, scores.balanceSheet, scores.risk, scores.fairValueConfidence]
    .every(value => Number.isFinite(value) && value >= 0 && value <= 100)) return false;
  const nonMethod = 30 + scores.evidenceCompleteness * 0.2 + scores.businessQuality * 0.14 - scores.risk * 0.08;
  return scores.evidenceCompleteness >= 75 && nonMethod >= 51;
}

/** Cheap research selection only. No fact verification, paid-review authority,
 * publication, provider fetch or new budget is created here. */
export function singleScenarioResearchCandidate(analysis: UsValueCompanyAnalysis) {
  const method = analysis.fairValue.methods[0], scenario = method?.singleScenario;
  const base = analysis.fairValue.baseValue;
  return isSimpleAlertPilot() && analysis.fairValue.methods.length === 1 && singleScenarioEvidenceQuality(analysis)
    && analysis.currency === "USD" && base !== null && base >= analysis.currentPrice * 0.2 && base <= analysis.currentPrice * 5
    && ["earnings_power", "owner_earnings_fcf"].includes(method.method) && scenario?.version === "engine-sensitivity-v1"
    && new Set(["technology", "technology services", "electronic technology", "commercial services", "consumer services", "producer manufacturing", "industrial services"]).has(String(analysis.sector ?? "").trim().toLowerCase())
    && Boolean(analysis.industry?.trim()) && !/bank|financial|credit|insurance|reit|real estate|mortgage|investment|biotech|exploration|mining|oil|gas/i.test(analysis.industry ?? "")
    && (method.method === "earnings_power" ? scenario.parameter >= 8 && scenario.parameter <= 26 : scenario.parameter >= 0.045 && scenario.parameter <= 0.1);
}

function annualCalculation(analysis: UsValueCompanyAnalysis, candidate: ImpactCandidate) {
  const method = analysis.fairValue.methods[0], scenario = method?.singleScenario;
  if (!scenario) return null;
  const metrics = method.method === "earnings_power" ? ["diluted_eps_annual"]
    : ["operating_cash_flow_annual", "capital_expenditure_annual", "shares_outstanding"];
  const inputs = metrics.map(metric => candidate.fundamentals?.items.find(fact => fact.metric === metric) ?? null);
  const amount = method.method === "earnings_power" ? inputs[0]?.value
    : inputs[0] && inputs[1] && inputs[2]?.value ? (inputs[0].value - inputs[1].value) / inputs[2].value : null;
  const reproduced = typeof amount === "number" ? method.method === "earnings_power" ? amount * scenario.parameter : amount / scenario.parameter : null;
  const requiredMetrics = method.method === "earnings_power"
    ? ["shares_outstanding", "equity", "net_income", "net_income_annual", "diluted_eps", "diluted_eps_annual"]
    : ["shares_outstanding", "equity", "operating_cash_flow", "operating_cash_flow_annual", "capital_expenditure", "capital_expenditure_annual"];
  return { basis: "reported_annual_sec_facts", providerTtmReconciled: false, inputs,
    issuerCik: candidate.fundamentals?.issuerCik ?? null, sourceUrl: candidate.fundamentals?.sourceUrl ?? null,
    requiredFacts: requiredMetrics.map(metric => candidate.fundamentals?.items.filter(fact => fact.metric === metric) ?? []),
    parameter: scenario.parameter,
    parameterMeaning: method.method === "earnings_power" ? "model_assumed_earnings_multiple" : "model_assumed_fcf_yield",
    base: reproduced === null ? null : Math.round(reproduced * 100) / 100, lowFactor: 0.8, highFactor: 1.2 };
}

export function singleScenarioEvidence(analysis: UsValueCompanyAnalysis | undefined, candidate: ImpactCandidate) {
  if (!isSimpleAlertPilot() || analysis?.fairValue.methods.length !== 1) return null;
  // Retrieval timestamps, quote jitter and provider routing are not new evidence.
  return { policy: SINGLE_SCENARIO_POLICY, basis: "reported_annual_facts", confidenceMeaning: "Unchanged scanner confidence; single-method cross-checking remains limited.",
    sensitivityMeaning: "Mechanical 0.8x to 1.2x sensitivity, not a forecast or probability.",
    annualCalculation: annualCalculation(analysis, candidate),
    analysis: { ticker: analysis.ticker, sector: analysis.sector, industry: analysis.industry, currency: analysis.currency,
      fundamentals: analysis.fundamentals, scores: analysis.scores, fairValue: analysis.fairValue } };
}

type Json = Record<string, unknown>;
const object = (value: unknown): Json => value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
/** Recompute from the saved primary facts and exact model inputs at every
 * publication boundary. Missing metadata cannot turn this into a generic route. */
export function singleScenarioPublicationGap(value: unknown, now: Date): string | null {
  const candidate = object(value), fair = object(candidate.valuationRange), evidence = object(candidate.singleScenarioEvidence);
  const methods = Array.isArray(fair.methods) ? fair.methods : [];
  if (candidate.eventFamily !== "valuation_gap" || (methods.length !== 1 && !candidate.singleScenarioEvidence)) return null;
  const invalid = "The single-scenario SEC evidence qualification is missing, stale, or no longer reproducible.";
  if (!isSimpleAlertPilot() || evidence.policy !== SINGLE_SCENARIO_POLICY || evidence.basis !== "reported_annual_facts") return invalid;
  const analysis = object(evidence.analysis) as unknown as UsValueCompanyAnalysis;
  if (!analysis.fairValue || !analysis.scores || !analysis.fundamentals || analysis.ticker !== candidate.ticker
    || analysis.sector !== candidate.sector || analysis.industry !== candidate.industry || analysis.currency !== candidate.currency
    || !isDeepStrictEqual(analysis.fairValue, candidate.valuationRange) || !singleScenarioEvidenceQuality(analysis)
    || analysis.scores.fairValueConfidence !== candidate.transmissionConfidence
    || !isDeepStrictEqual(evidence.annualCalculation, annualCalculation(analysis, candidate as unknown as ImpactCandidate))
    || !singleValuationScenarioSupported(analysis, candidate as unknown as ImpactCandidate, now)) return invalid;
  const base = analysis.fairValue.baseValue!, price = Number(object(candidate.quote).price);
  const gap = (base / price - 1) * 100;
  const scores = analysis.scores;
  const evidenceScore = Math.round((scores.fairValueConfidence + scores.evidenceCompleteness + Math.min(100, Math.abs(gap) * 2.5)) / 3);
  const expectedConfidence = Math.min(69, Math.round(30 + 12 + scores.evidenceCompleteness * 0.2 + scores.businessQuality * 0.14 - scores.risk * 0.08));
  const finiteScore = (key: string, minimum: number, maximum = 100) => typeof candidate[key] === "number"
    && Number.isFinite(candidate[key]) && Number(candidate[key]) >= minimum && Number(candidate[key]) <= maximum;
  if (!finiteScore("eventTruth", 80) || !finiteScore("mappingConfidence", 95) || !finiteScore("materiality", 65)
    || !finiteScore("evidenceIndependence", 78) || !finiteScore("transmissionConfidence", 0) || !finiteScore("score", 72)
    || !finiteScore("contradictionPenalty", 0, 49.999999) || !finiteScore("pricedInPenalty", 0, 49.999999) || candidate.rumour !== false
    || scores.fairValueConfidence !== expectedConfidence
    || candidate.eventTruth !== scores.evidenceCompleteness || candidate.evidenceIndependence !== scores.evidenceCompleteness
    || Number(candidate.score) > evidenceScore || Number(candidate.materiality) > Math.min(100, Math.abs(gap) * 2.5) + 1e-9
    || !["upside", "downside"].includes(String(candidate.direction))
    || (candidate.direction === "upside" ? gap < 20 : gap > -20)
    || evidenceScore < 72 || Number(candidate.score) < 72
    || (candidate.direction === "upside" && (scores.risk > 45 || scores.businessQuality < 70 || scores.balanceSheet < 50))) return invalid;
  return null;
}

export function qualifiedSingleScenario(value: unknown, now: Date) {
  const candidate = object(value);
  return candidate.eventFamily === "valuation_gap" && object(candidate.singleScenarioEvidence).policy === SINGLE_SCENARIO_POLICY
    && singleScenarioPublicationGap(candidate, now) === null;
}

/** A coherently shortened saved plan must not omit the valuation reviewer. */
export function completeSingleScenarioReview(candidateValue: unknown, committeeValue: unknown) {
  const candidate = object(candidateValue);
  if (!candidate.singleScenarioEvidence) return true;
  const summary = object(object(object(committeeValue).output).modelUsageSummary), plan = object(summary.reviewPlan);
  return completeCommitteeReview(committeeValue) && plan.policy === FOCUSED_REVIEW_POLICY
    && Array.isArray(plan.agentIds) && plan.agentIds.includes("valuation_dcf_agent");
}

export function singleScenarioNotice(value: unknown): string | null {
  const candidate = object(value), evidence = object(candidate.singleScenarioEvidence), calculation = object(evidence.annualCalculation);
  if (evidence.policy !== SINGLE_SCENARIO_POLICY) return null;
  const parameter = calculation.parameterMeaning === "model_assumed_earnings_multiple" ? `${calculation.parameter}x earnings`
    : `${Number(calculation.parameter) * 100}% required free-cash-flow yield`;
  const period = object((Array.isArray(calculation.inputs) ? calculation.inputs : [])[0]).periodEnd;
  return `One reported annual SEC scenario (period ended ${period}). Model assumption: ${parameter}. The range is a mechanical 20% sensitivity, not a forecast. Scanner confidence remains ${candidate.transmissionConfidence}/100; independent-method cross-checking is limited. Provider TTM figures are not certified as reconciled.`;
}
