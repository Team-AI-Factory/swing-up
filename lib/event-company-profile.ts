import { isSimpleAlertPilot } from "@/lib/simple-alert-pilot-runtime";
import { sourcedCompanyBusiness, verifiedCompanyProfile, profileCik, type CompanyIdentity, type SourcedCompanyBusiness, type VerifiedCompanyProfile } from "@/lib/company-profile";

export const EVENT_COMPANY_PROFILE_POLICY = "direct-sec-event-business-v1" as const;
export type EventCompanyContext = CompanyIdentity & {
  kind?: unknown; eventFamily?: unknown; relationship?: unknown; eventObservedAt?: unknown; receipts?: unknown;
  eventHeadline?: unknown; whatHappened?: unknown; causalChain?: unknown; plainLanguageExplanation?: unknown;
  profileDecisionDependencies?: unknown;
};
export type SourcedEventCompanyProfile = Omit<SourcedCompanyBusiness, "status"> & {
  status: "event_scoped"; scope: "direct_event_context"; policyVersion: typeof EVENT_COMPANY_PROFILE_POLICY;
  customers: null; customerType?: never; customerEvidence?: never; revenueGeography?: never;
  eventFamily: string; eventSource: { receiptId: string; url: string; publishedAt: string; facts: string };
  unknownDetails: readonly ["customers", "moat"];
};
export type PublicationCompanyProfile = VerifiedCompanyProfile | SourcedEventCompanyProfile;
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown) => typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
const directFamilies = new Set(["earnings_guidance", "financing_dilution", "regulatory_enforcement"]);
const dependency = /\b(?:customers?|clients?|consumers?|subscribers?|buyers?|moats?|competitiv\w*|market share|pricing power|retention|churn|demand|suppliers?|supply chain|market position)\b/i;

/** Conservative default: ambiguous or customer/moat-dependent claims need the full dossier. */
export function eventCompanyContextEligible(candidate: EventCompanyContext): boolean {
  const extraDependencies = candidate.profileDecisionDependencies;
  return candidate.kind !== "valuation" && candidate.relationship === "direct" && directFamilies.has(text(candidate.eventFamily))
    && (extraDependencies === undefined || (Array.isArray(extraDependencies) && extraDependencies.length === 0))
    && !dependency.test(JSON.stringify([candidate.eventHeadline, candidate.whatHappened, candidate.causalChain, candidate.plainLanguageExplanation]));
}
function eventSource(candidate: EventCompanyContext, now: Date) {
  if (!eventCompanyContextEligible(candidate)) return null;
  const cik = profileCik(candidate.cik), eventTime = Date.parse(text(candidate.eventObservedAt));
  if (!cik || !Number.isFinite(eventTime) || eventTime > now.getTime() || now.getTime() - eventTime > 48 * 3600000) return null;
  const receipts = Array.isArray(candidate.receipts) ? candidate.receipts.map(object) : [];
  for (const receipt of receipts) {
    const facts = text(receipt.summary), publishedAt = text(receipt.publishedAt), url = text(receipt.url);
    if (receipt.official !== true || receipt.primarySource !== true || receipt.channel !== "sec_current_filings"
      || !text(receipt.id) || facts.length < 60 || facts.length > 60000 || dependency.test(facts)
      || Date.parse(publishedAt) !== eventTime
      || !new RegExp(`^https://www\\.sec\\.gov/Archives/edgar/data/${Number(cik)}/\\d{18}/[A-Za-z0-9._-]+\\.html?$`).test(url)
      || !Array.isArray(receipt.symbolHints) || !receipt.symbolHints.includes(text(candidate.ticker).toUpperCase())) continue;
    if (/(?:^|\/)(?:index|[^/]*[-_]index)\.html?$/i.test(url)) {
      // The real SEC collector retains the exact filing-index permalink after
      // merging retrieved disclosure text. A bare index/headline is insufficient.
      const accession = url.split("/").at(-2)!;
      const indexName = `${accession.slice(0, 10)}-${accession.slice(10, 12)}-${accession.slice(12)}-index.html`;
      const marker = " Official filing content:";
      if (!url.endsWith(`/${indexName}`) || !facts.includes(marker) || facts.split(marker).slice(1).join(marker).trim().length < 200) continue;
    }
    return { receiptId: text(receipt.id), url, publishedAt, facts };
  }
  return null;
}

/** Bind sourced business context to one exact direct event; never write this into the full-profile cache. */
export function scopedEventCompanyProfile(value: unknown, candidate: EventCompanyContext, now = new Date()): SourcedEventCompanyProfile | null {
  if (!isSimpleAlertPilot() || !Number.isFinite(now.getTime())) return null;
  const business = sourcedCompanyBusiness(value, candidate, now), source = eventSource(candidate, now);
  if (!business || !source) return null;
  return { ...business, status: "event_scoped", scope: "direct_event_context", policyVersion: EVENT_COMPANY_PROFILE_POLICY,
    customers: null, eventFamily: text(candidate.eventFamily), eventSource: source, unknownDetails: ["customers", "moat"] };
}

/** Publication revalidates identity, source ages, exact receipt, event scope and decision dependencies. */
export function publicationCompanyProfile(value: unknown, candidate: EventCompanyContext, now = new Date()): PublicationCompanyProfile | null {
  const full = verifiedCompanyProfile(value, candidate, now);
  if (full) return full;
  const p = object(value);
  if (p.status !== "event_scoped" || p.scope !== "direct_event_context" || p.policyVersion !== EVENT_COMPANY_PROFILE_POLICY
    || p.customers !== null || p.customerEvidence != null || p.customerType != null || p.revenueGeography != null
    || p.description !== p.business || p.eventFamily !== candidate.eventFamily
    || JSON.stringify(p.unknownDetails) !== JSON.stringify(["customers", "moat"])) return null;
  const bound = scopedEventCompanyProfile({ ...p, status: "sourced_business" }, candidate, now);
  const source = object(p.eventSource);
  return bound && ["receiptId", "url", "publishedAt", "facts"].every(key => source[key] === bound.eventSource[key as keyof typeof bound.eventSource]) ? bound : null;
}
