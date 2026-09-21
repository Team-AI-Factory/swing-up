// Synthetic source-backed profile for tests only; never imported by application code.
export function companyProfileFixture(identity = {}, now = new Date()) {
  const ticker = identity.ticker ?? "TEST", company = identity.company ?? "Test Company", cik = String(identity.cik ?? "1").padStart(10, "0");
  const business = `${company} develops and provides inventory management software and related support services.`;
  const customers = "Our customers include retail stores, wholesalers and manufacturing businesses that use the software to manage orders.";
  return { version: 1, status: "verified", ticker, company, cik, business, customers, description: `${business} ${customers}`,
    industry: "Application software", industrySourceUrl: `https://data.sec.gov/submissions/CIK${cik}.json`,
    sourceType: "sec_annual_filing", sourceUrl: `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/000000000126000001/annual.htm`,
    sourceFiledAt: new Date(now.getTime() - 30 * 86400000).toISOString().slice(0, 10), verifiedAt: now.toISOString() };
}
