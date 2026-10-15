import { isSimpleAlertPilot } from "@/lib/simple-alert-pilot-runtime";
import { riskOnlyWarning, RISK_WARNING_POLICY } from "@/lib/equity-signal/risk-warning-policy";
import { publicationCompanyProfile } from "@/lib/event-company-profile";
import { candidatePriceOutlook, type PriceOutlook } from "@/lib/signal-outlook";
import { verifiedNegativeEarnings } from "@/lib/valuation-availability";

type Json = Record<string, unknown>;
export function industryLabel(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const label = value.replace(/\s+/g, " ").trim();
    if (label.length >= 3 && label.length <= 160 && !/^(?:n\/?a|none|null|unknown|unclassified|not available|other|-)$/i.test(label)) return label;
  }
  return null;
}

/** Publication requires actual prices in a named currency, never invented targets. */
export function completePriceOutlook(value: PriceOutlook | null | undefined): boolean {
  if (!value || !value.currency || !/^[A-Z]{3}$/.test(value.currency) || value.basis === "unavailable") return false;
  const prices = [value.currentPrice, value.conservative?.price, value.base?.price, value.optimistic?.price];
  if (!prices.every(price => typeof price === "number" && Number.isFinite(price) && price > 0)) return false;
  if (value.conservative.price! > value.base.price! || value.base.price! > value.optimistic.price!) return false;
  return [value.conservative, value.base, value.optimistic].every(scenario =>
    scenario.changePercent === Math.round((scenario.price! / value.currentPrice! - 1) * 10000) / 100);
}

/** Legacy proof is retained only to display a previously delivered record.
 * It cannot authorize a new target-free Buy/Sell in the restricted pilot. */
export function legacyEventValuationException(candidate: Json, outlook: PriceOutlook | null | undefined, now = new Date()): boolean {
  return Boolean(candidate.kind !== "valuation" && typeof candidate.eventFamily === "string" && candidate.eventFamily.length > 0 && !["valuation_gap", "unknown"].includes(candidate.eventFamily)
    && outlook?.basis === "unavailable" && /^[A-Z]{3}$/.test(outlook.currency ?? "")
    && typeof outlook.currentPrice === "number" && Number.isFinite(outlook.currentPrice) && outlook.currentPrice > 0
    && [outlook.conservative?.price, outlook.base?.price, outlook.optimistic?.price,
      outlook.conservative?.changePercent, outlook.base?.changePercent, outlook.optimistic?.changePercent,
      outlook.potentialPercent, outlook.upsidePercent, outlook.downsidePercent].every(value => value === null)
    && verifiedNegativeEarnings(outlook.fairValueUnavailable, candidate, now));
}

export function eventValuationException(candidate: Json, outlook: PriceOutlook | null | undefined, now = new Date()): boolean {
  return !isSimpleAlertPilot() && legacyEventValuationException(candidate, outlook, now);
}

export function riskWarningOutlook(candidate: Json, outlook: PriceOutlook | null | undefined, now = new Date()): boolean {
  return riskOnlyWarning(candidate, now) && outlook?.basis === "unavailable"
    && /^[A-Z]{3}$/.test(outlook.currency ?? "") && typeof outlook.currentPrice === "number" && Number.isFinite(outlook.currentPrice) && outlook.currentPrice > 0
    && [outlook.conservative?.price, outlook.base?.price, outlook.optimistic?.price,
      outlook.conservative?.changePercent, outlook.base?.changePercent, outlook.optimistic?.changePercent,
      outlook.potentialPercent, outlook.upsidePercent, outlook.downsidePercent].every(value => value === null);
}

export function alertDetails(candidate: Json, analysis?: Json, now = new Date()) {
  const companyProfile = publicationCompanyProfile(candidate.companyProfile, candidate, now);
  const industry = industryLabel(analysis?.industry, candidate.industry, companyProfile?.industry);
  const outlook = candidatePriceOutlook(candidate, analysis, now);
  const valuationException = eventValuationException(candidate, outlook, now);
  const riskWarningException = riskWarningOutlook(candidate, outlook, now);
  const missing = [
    ...(candidate.riskWarningPolicy === RISK_WARNING_POLICY && !riskWarningException ? ["The direct material-risk warning evidence is incomplete or stale."] : []),
    ...(!companyProfile ? ["A verified full profile or sourced direct-event business context is required; decision-dependent customer details remain mandatory."] : []),
    ...(!industry ? ["The company's industry must be verified from its company data or SEC classification."] : []),
    ...(!completePriceOutlook(outlook) && !valuationException && !riskWarningException ? ["Current price, currency and a supported conservative, base and optimistic valuation or forecast range are required."] : []),
  ];
  return { companyProfile, industry, outlook, valuationException, riskWarningException, missing, complete: missing.length === 0 };
}

export function publicAlertDetailsComplete(row: { companyProfile?: unknown; industry?: unknown; outlook?: PriceOutlook | null } & Json, now = new Date()) {
  const profile = publicationCompanyProfile(row.companyProfile, { ...row, ticker: row.ticker, company: row.company, cik: row.cik }, now);
  return Boolean(profile && industryLabel(row.industry, profile.industry)
    && (row.riskWarningPolicy ? row.action === "watch_out" && riskWarningOutlook(row, row.outlook, now)
      : completePriceOutlook(row.outlook) || eventValuationException(row, row.outlook, now)));
}
