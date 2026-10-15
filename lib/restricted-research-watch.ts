import { pilotCompanies } from "@/lib/simple-alert-pilot-scope";
import { profileCik, sameCompanyName, verifiedCompanyProfile } from "@/lib/company-profile";

type Json = Record<string, unknown>;
const object = (value: unknown): Json => value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
const text = (value: unknown, limit = 600) => typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, limit) : "";
const date = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null;

/** Read-only parked records. No eligibility, target, confidence or approval is
 * inherited, and no collection or retry is started to populate this view. */
export function assembleRestrictedResearchWatch(rows: Json[], now = new Date()) {
  const seen = new Set<string>();
  return rows.flatMap(row => {
    const identity = pilotCompanies().find(company => company.ticker === row.ticker
      && company.cik === profileCik(row.cik) && sameCompanyName(company.company, row.company));
    if (!identity || row.committeeApproved === true || row.test === true || row.isTest === true || row.synthetic === true) return [];
    const id = text(row.id, 160);
    if (!id || seen.has(id)) return [];
    seen.add(id);
    const explanation = object(row.explanation), quality = object(row.quality);
    const rawGaps = Array.isArray(explanation.missingInformation) ? explanation.missingInformation : [];
    const gaps = rawGaps.map(value => text(value)).filter(Boolean);
    if (!verifiedCompanyProfile(row.companyProfile, identity, now)) gaps.push("The full company profile is not currently verified; only the frozen pilot identity is shown here.");
    if (row.committeeStatus === "rejected") gaps.push("The saved review rejected this case.");
    if (row.committeeStatus === "not_eligible") gaps.push("The saved case did not pass the eligibility checks.");
    if (quality.technicalFailure === true) gaps.push("A technical review step failed; it is not an approval.");
    if (!gaps.length) gaps.push("A complete current approval and its publication checks have not been established.");
    const sources = (Array.isArray(row.sources) ? row.sources : []).map(object).flatMap(source => {
      try {
        const url = new URL(text(source.url, 2000));
        if (url.protocol !== "https:" || url.username || url.password) return [];
        url.search = "";
        return [{ label: text(source.label, 160) || "Recorded source", url: url.toString(), publishedAt: date(source.publishedAt) }];
      } catch { return []; }
    }).slice(0, 6);
    return [{ id, ticker: identity.ticker, company: identity.company, label: "RESEARCH WATCH" as const,
      status: "parked" as const, committeeApproved: false as const,
      headline: text(row.eventHeadline), missingInformation: [...new Set(gaps)].slice(0, 16), sources,
      sourceDates: { eventObservedAt: date(row.eventObservedAt), companyFilingDate: date(object(row.companyProfile).sourceFiledAt) },
      updatedAt: date(row.updatedAt ?? row.createdAt), currentPrice: null, targets: null,
      reopening: "Reopens only for relevant new evidence or an allowed controlled technical retry; saved review history is retained.",
      notice: "Candidate only. Not a Serious Alert, approval, or executable investment opportunity. Stale or unverified prices are omitted." }];
  }).slice(0, 100);
}
