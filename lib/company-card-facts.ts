import { verifiedCompanyProfile, type CompanyIdentity } from "@/lib/company-profile";

export type CompanyCardFacts = {
  business: string; customers: string; revenueCountry: string;
  sourceUrl: string | null; sourceFiledAt: string | null;
};
const plain = (text: string) => text.replace(/\butilize\b/gi, "use")
  .replace(/\butilizes\b/gi, "uses").replace(/\bmanufactures\b/gi, "makes")
  .replace(/\bmanufacture\b/gi, "make").replace(/\bprincipally\b/gi, "mainly")
  .replace(/\bprimarily\b/gi, "mainly");

export function companyCardFacts(value: unknown, identity: CompanyIdentity, now = new Date()): CompanyCardFacts {
  const profile = verifiedCompanyProfile(value, identity, now);
  const geography = profile?.revenueGeography;
  return {
    business: profile ? plain(profile.business) : "Products and services have not yet been verified.",
    customers: profile ? plain(profile.customers) : "Customer groups have not yet been verified.",
    revenueCountry: geography ? `${geography.country} — ${geography.percent}% of total revenue in ${geography.year}.`
      : "Not yet verified from country-level revenue disclosures. The headquarters location is not a substitute.",
    sourceUrl: profile?.sourceUrl ?? null, sourceFiledAt: profile?.sourceFiledAt ?? null,
  };
}
