import type { CompanyCardFacts } from "@/lib/company-card-facts";

export function CompanyFacts({ facts }: { facts?: CompanyCardFacts }) {
  return <section aria-label="About the company">
    <p><strong>What it does and sells:</strong> {facts?.business ?? "Products and services have not yet been verified."}</p>
    <p><strong>Main customers:</strong> {facts?.customers ?? "Customer groups have not yet been verified."}</p>
    <p><strong>Country providing most revenue:</strong> {facts?.revenueCountry ?? "Not yet verified from country-level revenue disclosures."}</p>
    {facts?.sourceUrl ? <small><a href={facts.sourceUrl} target="_blank" rel="noreferrer">Company disclosure</a> · filed {facts.sourceFiledAt}</small> : null}
  </section>;
}
