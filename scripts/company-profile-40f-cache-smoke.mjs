import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadTsModule } from "./helpers/load-typescript-module.mjs";
const now = new Date(), cik = "0001993344", identity = { ticker: "AAUC", company: "Allied Gold Corp", cik };
const base = "https://www.sec.gov/Archives/edgar/data/1993344/000162828026022512/", cover = base + "aaue-20251231.htm", aif = base + "a991-alliedx2026aif.htm", index = base + "0001628280-26-022512-index.html";
const fact = (name, value) => `<ix:nonNumeric name="dei:${name}">${value}</ix:nonNumeric>`;
const wrapper = fact("DocumentType", "40-F") + fact("EntityCentralIndexKey", cik) + fact("DocumentAnnualReport", "true") + fact("DocumentRegistrationStatement", "false") + fact("AnnualInformationForm", "true") + `<table><tr><td>99.1</td><td><a href="a991-alliedx2026aif.htm">Annual Information Form for the year ended 2025</a></td></tr></table>`;
const indexHtml = `<div>SEC Accession No. 0001628280-26-022512</div><div>Filing Date</div><div>2026-04-01</div><span>CIK: 0001993344</span><table><tr><td>1</td><td>Annual</td><td><a href="aaue-20251231.htm">cover</a></td><td>40-F</td></tr><tr><td>2</td><td>Exhibit</td><td><a href="a991-alliedx2026aif.htm">AIF</a></td><td>EX-99.1</td></tr></table>`;
const business = "The Company produces precision instruments and calibration equipment for industrial laboratories.";
const buyers = "Our customers include industrial laboratories and research institutions that buy precision instruments.";
const html = `<h1>ANNUAL INFORMATION FORM</h1><h2>DESCRIPTION OF THE BUSINESS</h2><p>${business.repeat(7)}</p><p>${buyers}</p><h2>Risk Factors</h2>`;
const submissions = { cik: 1993344, tickers: ["AAUC"], sicDescription: "Gold and Silver Ores", filings: { recent: { form: ["40-F"], filingDate: ["2026-04-01"], accessionNumber: ["0001628280-26-022512"], primaryDocument: ["aaue-20251231.htm"] } } };
const originalInfo = console.info;
try {
  console.info = () => {};
  for (const mode of ["valid", "wrong_issuer", "registration", "wrong_aif_title", "wrong_accession", "actual_aauc"]) {
    if (mode === "actual_aauc" && !process.env.COMPANY_PROFILE_AIF_FIXTURES) continue;
    const objects = new Map(), urls = [];
    if (mode === "valid") objects.set("research-evidence/company-profiles-v1.json", { entries: [{ ...identity, profile: null, parserRevision: -1, error: "company_profile_annual_filing_unavailable", updatedAt: now.toISOString(), nextAttemptAt: new Date(now.getTime() + 86400000).toISOString() }] });
    const cache = loadTsModule("@/lib/opportunity-engine/company-profile-cache", {
      "@/lib/r2-warehouse": { readVersionedTextFromR2: async key => ({ found: objects.has(key), text: objects.has(key) ? JSON.stringify(objects.get(key)) : null, etag: objects.has(key) ? "1" : null }), writeVersionedJsonToR2: async (key, value) => { objects.set(key, structuredClone(value)); return { written: true, conflict: false }; } },
      "@/lib/opportunity-engine/pr262-storage": { pr262StorageKey: key => key },
    });
    const fetcher = async url => {
      url = String(url); urls.push(url);
      if (url.includes("submissions")) return Response.json(mode === "wrong_issuer" ? { ...submissions, cik: 1993345 } : submissions);
      if (mode === "actual_aauc") return new Response(readFileSync(resolve(process.env.COMPANY_PROFILE_AIF_FIXTURES, url.split("/").at(-1)), "utf8"));
      if (url === cover) return new Response(mode === "registration" ? wrapper.replace('dei:DocumentRegistrationStatement">false', 'dei:DocumentRegistrationStatement">true') : wrapper);
      if (url === index) return new Response(mode === "wrong_accession" ? indexHtml.replace("0001628280-26-022512", "0001628280-26-022513") : indexHtml);
      if (url === aif) return new Response(mode === "wrong_aif_title" ? html.replace("ANNUAL INFORMATION FORM", "ANNUAL FINANCIAL STATEMENTS") : html);
      throw new Error("unexpected_source_url");
    };
    const profile = await cache.ensureCompanyProfile(identity, fetcher, now);
    if (mode === "valid") {
      assert.ok(profile); assert.equal(profile.sourceForm, "40-F"); assert.equal(profile.sourceUrl, aif); assert.equal(profile.annualFilingUrl, cover); assert.equal(profile.annualFilingIndexUrl, index); assert.equal(profile.sourceFiledAt, "2026-04-01");
      assert.equal(urls.length, 4, "All 40-F provenance reads use caller's budgeted fetcher");
      const verifier = loadTsModule("@/lib/company-profile");
      assert.equal(verifier.verifiedCompanyProfile({ ...profile, annualFilingUrl: cover.replace("1993344", "1993345") }, identity, now), null);
      assert.equal(verifier.verifiedCompanyProfile({ ...profile, annualFilingIndexUrl: index.replace("022512-index", "022513-index") }, identity, now), null);
      assert.equal(verifier.verifiedCompanyProfile({ ...profile, annualFilingUrl: undefined }, identity, now), null);
      assert.ok(await cache.ensureCompanyProfile(identity, fetcher, new Date(now.getTime() + 60000)));
      assert.equal(urls.length, 4, "Verified cache reuse adds no network calls");
    } else assert.equal(profile, null, "Missing provenance/customer evidence cannot be counted as verified");
    if (mode === "actual_aauc") {
      const saved = objects.get("research-evidence/company-profiles-v1.json").entries[0];
      assert.equal(saved.filing.url, aif); assert.equal(saved.filing.annualFilingUrl, cover); assert.equal(saved.extractionFailure, "company_profile_customers_not_extracted");
      originalInfo("Actual AAUC source replay: annual 40-F resolves to correct AIF; missing customer evidence remains unverified.");
    }
  }
  originalInfo("40-F cache: four guarded provenance reads, exact source/date/CIK retention, source-repair retry, invalid-cover/index/title rejection and cache-only reuse passed.");
} finally { console.info = originalInfo; }
