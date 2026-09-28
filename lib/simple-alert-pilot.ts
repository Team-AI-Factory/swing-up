import cohort from "@/config/simple-alert-pilot.json";
import { verifiedCompanyProfile, sameCompanyName, profileCik } from "@/lib/company-profile";
import { companyCardFacts } from "@/lib/company-card-facts";

type Row = Record<string, unknown>;
const object = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};

/** Read-only feasibility assessment. It never approves, queues, publishes or
 * pays for a review. A fixed cohort makes missing companies visible. */
export function assessSimpleAlertPilot(snapshot: unknown, now = new Date()) {
  const input = object(snapshot);
  if (input.ok !== true || !Array.isArray(input.candidates)) throw new Error("pilot_snapshot_unavailable");
  const generated = Date.parse(String(input.generatedAt ?? ""));
  if (!Number.isFinite(generated) || generated > now.getTime() || now.getTime() - generated > 30 * 60_000) throw new Error("pilot_snapshot_stale");
  const candidates = input.candidates.map(object);
  const companies = cohort.companies.map(identity => {
    const matching = candidates.filter(row => row.ticker === identity.ticker && profileCik(row.cik) === identity.cik && sameCompanyName(row.company, identity.company));
    const row = matching.length === 1 ? matching[0] : undefined;
    const profile = row ? verifiedCompanyProfile(row.companyProfile, identity, now) : null;
    return {
      ticker: identity.ticker, company: identity.company,
      status: !row ? "missing_or_ambiguous" : !profile ? "profile_unverified" : "profile_verified",
      action: row?.action ?? null, eligibleResearch: Boolean(profile && row?.userAlertEligible === true),
      // This public snapshot is not a durable Committee or delivery receipt.
      reportedCommitteeApproved: Boolean(profile && row?.committeeApproved === true),
      companyFacts: companyCardFacts(profile, identity, now),
      revenueCountryVerified: Boolean(profile?.revenueGeography),
    };
  });
  return { name: cohort.name, cohortFrozenAt: cohort.frozenAt, observedAt: input.generatedAt,
    mode: "read_only_feasibility", scope: "existing valuation framework and verified profiles",
    totals: { companies: companies.length, verifiedProfiles: companies.filter(row => row.status === "profile_verified").length,
      eligibleResearch: companies.filter(row => row.eligibleResearch).length,
      reportedCommitteeApproved: companies.filter(row => row.reportedCommitteeApproved).length,
      revenueCountryVerified: companies.filter(row => row.revenueCountryVerified).length },
    approvedAlertReceiptsVerified: false, deliveryReceiptsVerified: false, companies };
}
