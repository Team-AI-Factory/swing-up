import { completeCommitteeReview, FOCUSED_REVIEW_POLICY } from "@/lib/ai-committee/review-policy";
import { restrictedBetaScopeBlocker } from "@/lib/restricted-beta-policy";
import { isSimpleAlertPilot } from "@/lib/simple-alert-pilot-runtime";
import { usQuoteFreshness } from "@/lib/equity-signal/us-market-calendar";

type Json = Record<string, unknown>;
const object = (value: unknown): Json => value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
export const RISK_WARNING_POLICY = "direct_material_risk_v1";
export const RISK_WARNING_NOTICE = "Verified material-risk warning. Price impact, target price and expected return have not been established.";
const rules: Record<string, [string, RegExp]> = {
  earnings_guidance: ["earnings_guidance_cash_flow_break", /\b(cuts?|lowers?|reduces?|withdraws?)\s+(?:its\s+)?(?:revenue |earnings |profit )?(?:guidance|outlook)\b|\b(guidance cut|earnings miss|profit warning)\b/i],
  financing_dilution: ["dilution_or_financing_stress", /\b(offering|dilution|convertible|bankrupt|chapter 11|covenant breach|payment default)\b/i],
  regulatory_enforcement: ["regulatory_or_legal_risk", /\b(recall|clinical hold|complete response letter|enforcement|penalty|fined|settlement|sec charges|doj charges)\b/i],
  cyber_incident: ["cyber_or_operational_outage", /\b(cyberattack|ransomware|data breach|security breach|systems? outage)\b/i],
  leadership_change: ["leadership_or_governance_break", /\b(ceo resigns?|cfo resigns?|chief executive resigns?|chief financial officer resigns?|leadership shakeup)\b/i],
};

/** Separate risk authority, never a fallback for an incomplete valuation. The
 * initial path is restricted to an exact-issuer SEC disclosure; the existing
 * source collector must also prove full required source/document transport. */
export function directMaterialRiskRule(candidate: Json, now = new Date()): string | null {
  const rule = rules[String(candidate.eventFamily)];
  const quote = object(candidate.quote), gates = object(candidate.gateChecks);
  const cik = String(candidate.cik ?? "");
  const eventAt = Date.parse(String(candidate.eventObservedAt ?? ""));
  const finite = (key: string, min: number) => typeof candidate[key] === "number" && Number.isFinite(candidate[key]) && Number(candidate[key]) >= min;
  if (!rule || candidate.kind === "valuation" || candidate.relationship !== "direct" || candidate.direction !== "downside"
    || !/^\d{10}$/.test(cik) || /^0+$/.test(cik) || candidate.gatePassed !== true || candidate.rumour !== false
    || !finite("eventTruth", 80) || !finite("mappingConfidence", 95) || !finite("materiality", 65)
    || !finite("transmissionConfidence", 70) || !finite("evidenceIndependence", 78)
    || !["contradictionPenalty", "pricedInPenalty"].every(key => typeof candidate[key] === "number" && Number.isFinite(candidate[key]) && Number(candidate[key]) >= 0 && Number(candidate[key]) < 50)
    || !["freshEvidence", "primaryOrIndependentProof", "noSevereContradiction", "notRumour", "verifiedEventTruth", "reliableTickerMapping", "materialEvent", "causalTransmission", "directionResolved", "knockOnCausalPathVerified", "eventMagnitudeActionable"].every(key => gates[key] === true)
    || !Number.isFinite(eventAt) || eventAt > now.getTime() + 5 * 60000 || now.getTime() - eventAt > 24 * 3600000
    || quote.actionableForSeriousSignal !== true || !["pre_market", "regular", "post_market", "latest_close"].includes(String(quote.marketSession))
    || typeof quote.price !== "number" || !Number.isFinite(quote.price) || quote.price <= 0
    || !usQuoteFreshness(String(quote.observedAt ?? ""), now).usable) return null;
  const receipts = Array.isArray(candidate.receipts) ? candidate.receipts.map(object) : [];
  const authenticRisk = receipts.some(receipt => {
    if (receipt.official !== true || receipt.primarySource !== true || receipt.channel !== "sec_current_filings"
      || !rule[1].test(`${receipt.title ?? ""} ${receipt.summary ?? ""}`)) return false;
    const timestamp = Date.parse(String(receipt.publishedAt ?? ""));
    if (!Number.isFinite(timestamp) || timestamp > now.getTime() + 5 * 60000 || now.getTime() - timestamp > 24 * 3600000) return false;
    try {
      const url = new URL(String(receipt.url));
      return url.protocol === "https:" && ["sec.gov", "www.sec.gov"].includes(url.hostname)
        && !url.username && !url.password && !url.port && !url.search && !url.hash
        && new RegExp(`^/Archives/edgar/data/${Number(cik)}/\\d{18}/[A-Za-z0-9._-]+\\.html?$`).test(url.pathname);
    } catch { return false; }
  });
  return authenticRisk ? rule[0] : null;
}

export function riskOnlyWarning(candidate: Json, now = new Date()): boolean {
  return isSimpleAlertPilot() && !restrictedBetaScopeBlocker(candidate) && candidate.riskWarningPolicy === RISK_WARNING_POLICY
    && candidate.riskWarningRule === directMaterialRiskRule(candidate, now)
    && typeof candidate.riskWarningRule === "string";
}

/** Risk-specific required roles cannot disappear by shortening a saved plan. */
export function completeRiskWarningReview(candidate: Json, value: unknown): boolean {
  if (candidate.riskWarningPolicy !== RISK_WARNING_POLICY || !completeCommitteeReview(value)) return false;
  const plan = object(object(object(object(value).output).modelUsageSummary).reviewPlan);
  const role = ["earnings_guidance", "financing_dilution"].includes(String(candidate.eventFamily)) ? "accountant_agent"
    : candidate.eventFamily === "regulatory_enforcement" ? "industry_agent" : null;
  return plan.policy === FOCUSED_REVIEW_POLICY && Array.isArray(plan.agentIds) && role !== null && plan.agentIds.includes(role);
}
