import { verifiedCompanyProfile, type VerifiedCompanyProfile } from "@/lib/company-profile";
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

export function eventValuationException(candidate: Json, outlook: PriceOutlook | null | undefined, now = new Date()): boolean {
  return Boolean(candidate.kind !== "valuation" && typeof candidate.eventFamily === "string" && candidate.eventFamily.length > 0 && !["valuation_gap", "unknown"].includes(candidate.eventFamily)
    && outlook?.basis === "unavailable" && /^[A-Z]{3}$/.test(outlook.currency ?? "")
    && typeof outlook.currentPrice === "number" && Number.isFinite(outlook.currentPrice) && outlook.currentPrice > 0
    && [outlook.conservative?.price, outlook.base?.price, outlook.optimistic?.price,
      outlook.conservative?.changePercent, outlook.base?.changePercent, outlook.optimistic?.changePercent,
      outlook.potentialPercent, outlook.upsidePercent, outlook.downsidePercent].every(value => value === null)
    && verifiedNegativeEarnings(outlook.fairValueUnavailable, candidate, now));
}

export function alertDetails(candidate: Json, analysis?: Json, now = new Date()) {
  const companyProfile = verifiedCompanyProfile(candidate.companyProfile, candidate, now);
  const industry = industryLabel(analysis?.industry, candidate.industry, companyProfile?.industry);
  const outlook = candidatePriceOutlook(candidate, analysis, now);
  const valuationException = eventValuationException(candidate, outlook, now);
  const missing = [
    ...(!companyProfile ? ["A verified company profile with products or services and customers is required."] : []),
    ...(!industry ? ["The company's industry must be verified from its company data or SEC classification."] : []),
    ...(!completePriceOutlook(outlook) && !valuationException ? ["Current price, currency and a supported conservative, base and optimistic valuation or forecast range are required."] : []),
  ];
  return { companyProfile, industry, outlook, valuationException, missing, complete: missing.length === 0 };
}

export function publicAlertDetailsComplete(row: { companyProfile?: VerifiedCompanyProfile | unknown; industry?: unknown; outlook?: PriceOutlook | null } & Json, now = new Date()) {
  const profile = verifiedCompanyProfile(row.companyProfile, { ticker: row.ticker, company: row.company, cik: row.cik }, now);
  return Boolean(profile && industryLabel(row.industry, profile.industry)
    && (completePriceOutlook(row.outlook) || eventValuationException(row, row.outlook, now)));
}
