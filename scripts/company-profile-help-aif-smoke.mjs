import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { loadTsModule } from "./helpers/load-typescript-module.mjs";
import { inSimpleAlertPilot } from "./helpers/simple-alert-pilot-fixture.mjs";

const fixture = new URL("./fixtures/help-aif/", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("manifest.json", fixture), "utf8"));
const bytes = new Map();
for (const source of manifest.files) {
  const compressed = readFileSync(new URL(source.file, fixture));
  assert.equal(createHash("sha256").update(compressed).digest("hex"), source.compressedSha256);
  const raw = gunzipSync(compressed);
  assert.equal(raw.length, source.bytes);
  assert.equal(createHash("sha256").update(raw).digest("hex"), source.sha256);
  assert.equal(source.status, 200); assert.equal(source.eof, true); assert.equal(source.url, source.finalUrl);
  bytes.set(source.url, raw);
}
const identity = manifest.issuer, now = new Date("2026-10-15T08:00:00.000Z");
const base = "https://www.sec.gov/Archives/edgar/data/1833141/000183314126000046/";
const cover = base + "cybn-20260331.htm", aif = base + "cybin-annualinformationfor.htm";
const index = base + "0001833141-26-000046-index.html";
const annualHtml = bytes.get(cover).toString(), indexHtml = bytes.get(index).toString();
const api = loadTsModule("@/lib/company-profile-annual-source");
const input = { cik: identity.cik, filing: { url: cover, form: "40-F", filedAt: manifest.filedAt }, annualHtml, indexHtml };
const expected = { url: aif, form: "40-F", filedAt: manifest.filedAt, cik: identity.cik, accessionNumber: manifest.accession, reportPeriod: "2026-03-31", annualFilingUrl: cover, annualFilingIndexUrl: index };
assert.equal((annualHtml.match(/href="cybin-annualinformationfor\.htm"/g) ?? []).length, 2, "Authentic cover splits its caption into two same-target anchors");
assert.deepEqual(api.resolve40FAnnualInformationForm(input), expected);
assert.deepEqual(api.resolve40FAnnualInformationForm({ ...input, cik: "1833141" }), expected);
const single = annualHtml.replace(/<a\b[^>]*href="cybin-annualinformationfor\.htm"[^>]*>6<\/a>/, "6");
assert.notEqual(single, annualHtml);
assert.deepEqual(api.resolve40FAnnualInformationForm({ ...input, annualHtml: single }), expected, "Existing one-anchor format remains valid");
const lastAnchor = /(<a\b[^>]*href=")cybin-annualinformationfor\.htm("[^>]*>6<\/a>)/;
const unsafe = ["", "different.htm", "https://www.sec.gov/Archives/edgar/data/1833142/000183314126000046/cybin-annualinformationfor.htm", "https://www.sec.gov/Archives/edgar/data/1833141/000183314126000047/cybin-annualinformationfor.htm", "https://example.com/aif.htm", "//www.sec.gov/Archives/edgar/data/1833141/000183314126000046/cybin-annualinformationfor.htm", "cybin-annualinformationfor.htm?x=1", "cybin-annualinformationfor.htm#fragment", "../cybin-annualinformationfor.htm", "%63ybin-annualinformationfor.htm", "javascript:void(0)"];
for (const target of unsafe) {
  const mutated = annualHtml.replace(lastAnchor, `$1${target}$2`);
  assert.notEqual(mutated, annualHtml);
  assert.equal(api.resolve40FAnnualInformationForm({ ...input, annualHtml: mutated }), null, `Mixed invalid or conflicting anchor is rejected: ${target}`);
}
const negatives = [
  { ...input, cik: "0001833142" },
  { ...input, filing: { ...input.filing, filedAt: "2026-06-28" } },
  { ...input, filing: { ...input.filing, form: "40-F/A" } },
  { ...input, annualHtml: annualHtml.replace('name="dei:DocumentType"', 'name="dei:UnknownDocumentType"') },
  { ...input, annualHtml: annualHtml.replace('name="dei:DocumentAnnualReport" format="ixt:fixed-true"', 'name="dei:DocumentAnnualReport" format="ixt:fixed-false"') },
  { ...input, annualHtml: annualHtml.replace('name="dei:DocumentRegistrationStatement" format="ixt:fixed-false"', 'name="dei:DocumentRegistrationStatement" format="ixt:fixed-true"') },
  { ...input, annualHtml: annualHtml.replace('name="dei:AnnualInformationForm" format="ixt:fixed-true"', 'name="dei:AnnualInformationForm" format="ixt:fixed-false"') },
  { ...input, annualHtml: annualHtml.replace(/>0001833141<\/ix:nonNumeric>/, '>0001833142</ix:nonNumeric>') },
  { ...input, annualHtml: annualHtml.replace('>Annual Information Form for the fiscal year ended March 31, 202</a>', '>Audited Financial Statements for the fiscal year ended March 31, 202</a>') },
  { ...input, indexHtml: indexHtml.replaceAll('cybin-annualinformationfor.htm', 'different.htm') },
  { ...input, indexHtml: indexHtml.replaceAll('0001833141-26-000046', '0001833141-26-000047') },
  { ...input, annualHtml: annualHtml.replace('name="dei:DocumentPeriodEndDate"', 'name="dei:UnknownPeriod"') },
  { ...input, annualHtml: annualHtml.replace(/(name="dei:DocumentPeriodEndDate"[^>]*>[\s\S]*?), 2026(<\/ix:nonNumeric>)/, '$1, 2025$2') },
  { ...input, annualHtml: annualHtml + '<ix:nonNumeric name="dei:DocumentPeriodEndDate">2026-03-31</ix:nonNumeric>' },
  { ...input, indexHtml: indexHtml.replace('Period of Report', 'Unknown Period') },
  { ...input, indexHtml: indexHtml.replace('2026-03-31', '2025-03-31') },
  { ...input, indexHtml: indexHtml + '<div>Period of Report</div><div>2026-03-31</div>' },
  { ...input, indexHtml: indexHtml.replace('2026-03-31', '2026-02-30') },
  { ...input, annualHtml: annualHtml.replace(lastAnchor, '$1cybin-annualinformationfor.htm$2').replace(/(href="cybin-annualinformationfor\.htm"[^>]*>)6<\/a>/, '$15</a>') },
  { ...input, annualHtml: annualHtml.replaceAll('Annual Information Form for the fiscal year ended March 31, 202', 'Annual Information Form dated March 31, 202') },
  { ...input, annualHtml: annualHtml.replace(/href="cybin-annualinformationfor\.htm"([^>]*>6<\/a>)/, 'id="missing-href"$1') },
  { ...input, annualHtml: annualHtml.replace('name="dei:DocumentPeriodEndDate"', 'continuedAt="unread-part" name="dei:DocumentPeriodEndDate"') },
  { ...input, annualHtml: annualHtml.replace('name="dei:DocumentPeriodEndDate"', 'xsi:nil="true" name="dei:DocumentPeriodEndDate"') },
  { ...input, annualHtml: annualHtml.replace('name="dei:DocumentPeriodEndDate" format="ixt:date-monthname-day-year-en"', 'name="dei:DocumentPeriodEndDate" format="ixt:fixed-zero"') },
  { ...input, annualHtml: annualHtml.replace(/(name="dei:DocumentPeriodEndDate"[^>]*>[\s\S]*?)March 31/, '$1February 30') },
];
for (const [negativeIndex, mutated] of negatives.entries()) {
  assert.notDeepEqual(mutated, input, "Every negative must actually mutate the authentic input");
  assert.equal(api.resolve40FAnnualInformationForm(mutated), null, `negative ${negativeIndex}`);
}
assert.ok(api.isAnnualInformationFormDocument(bytes.get(aif).toString()));
assert.ok(api.isAnnualInformationFormDocument(bytes.get(aif).toString(), "2026-03-31"));
for (const period of ["2025-03-31", "2026-02-30", "", "2026-06-29"]) assert.equal(api.isAnnualInformationFormDocument(bytes.get(aif).toString(), period), false);
const aifVariants = [
  bytes.get(aif).toString().replace("FOR THE YEAR ENDED MARCH 31, 2026", "FOR THE YEAR ENDED MARCH 31, 2025"),
  bytes.get(aif).toString().replace("FOR THE YEAR ENDED MARCH 31, 2026", "FOR THE YEAR ENDED FEBRUARY 30, 2026"),
  bytes.get(aif).toString().replace("FOR THE YEAR ENDED MARCH 31, 2026", "JUNE 29, 2026"),
  bytes.get(aif).toString().replace("FOR THE YEAR ENDED MARCH 31, 2026", "FOR THE YEAR ENDED MARCH 31, 2026; FOR THE YEAR ENDED MARCH 31, 2025"),
];
for (const html of aifVariants) assert.equal(api.isAnnualInformationFormDocument(html, "2026-03-31"), false, "AIF title must independently prove the same unique valid report period");
const originalFetch = globalThis.fetch, originalInfo = console.info;
let networkAttempts = 0;
globalThis.fetch = async () => { networkAttempts++; throw new Error("Real network forbidden"); };
console.info = () => {};
try {
  const objects = new Map(), urls = [];
  const cache = loadTsModule("@/lib/opportunity-engine/company-profile-cache", {
    "@/lib/r2-warehouse": {
      readVersionedTextFromR2: async key => ({ found: objects.has(key), text: objects.has(key) ? JSON.stringify(objects.get(key)) : null, etag: objects.has(key) ? "1" : null }),
      writeVersionedJsonToR2: async (key, value) => { objects.set(key, structuredClone(value)); return { written: true, conflict: false }; },
    },
    "@/lib/opportunity-engine/pr262-storage": { pr262StorageKey: key => key },
  });
  const fetcher = async (url, options) => {
    url = String(url); urls.push(url); assert.equal(options.redirect, "error"); assert.ok(options.signal);
    assert.ok(bytes.has(url), `No new source route: ${url}`);
    const response = new Response(bytes.get(url), { status: 200 });
    Object.defineProperty(response, "url", { value: url });
    return response;
  };
  assert.equal(await cache.ensureCompanyProfile(identity, fetcher, now), null, "Business-only clinical-stage source is not a full-profile success");
  assert.deepEqual(urls, [`https://data.sec.gov/submissions/CIK${identity.cik}.json`, cover, index, aif], "Existing four guarded 40-F reads only");
  const row = objects.get("research-evidence/company-profiles-v1.json").entries[0];
  assert.equal(row.filing.url, aif); assert.equal(row.filing.annualFilingUrl, cover); assert.equal(row.filing.annualFilingIndexUrl, index);
  assert.equal(row.extractionFailure, "company_profile_customers_not_extracted"); assert.equal(row.profile, null); assert.equal(row.firstVerifiedAt, undefined);
  const extraction = loadTsModule("@/lib/company-profile").inspectCompanyProfileExtraction({ identity, html: bytes.get(aif).toString(),
    form: "40-F", sourceUrl: aif, filedAt: manifest.filedAt, annualFilingUrl: cover, annualFilingIndexUrl: index, now });
  assert.equal(extraction.businessContext?.status, "sourced_business"); assert.match(extraction.businessContext.business, /clinical-stage pharmaceutical company/);
  assert.equal(extraction.profile, null);
  objects.set("equity-universe/v1.json", { version: 1, scope: "active_us_exchange_listed_common_equities_and_adrs", entries: [{ ...identity, sourceNames: ["SEC company_tickers_exchange"] }] });
  await inSimpleAlertPilot(async () => {
    const before = JSON.stringify([...objects]);
    assert.equal((await cache.readCompanyBusinessContexts([identity], now)).get("HELP")?.business, extraction.businessContext.business);
    assert.equal((await cache.readCompanyProfiles([identity], now)).size, 0, "Read-only pilot context does not become full-profile verification");
    assert.equal(JSON.stringify([...objects]), before, "Read-only business context cannot change counters/history");
  });
  assert.equal(await cache.ensureCompanyProfile(identity, fetcher, new Date(now.getTime() + 60000)), null);
  assert.equal(urls.length, 4, "Before-due retry uses zero source reads");
  assert.equal(await cache.ensureCompanyProfile(identity, fetcher, new Date(row.nextAttemptAt)), null);
  assert.deepEqual(urls.slice(4), [`https://data.sec.gov/submissions/CIK${identity.cik}.json`, cover, index], "Existing seven-day metadata rediscovery only; same complete AIF bytes are reused without another AIF GET");
  assert.equal(networkAttempts, 0);
  const sourceKey = `research-evidence/company-profile-sources/${identity.cik}/000183314126000046-cybin-annualinformationfor.htm.json`;
  const authenticatedSource = structuredClone(objects.get(sourceKey));
  assert.equal(authenticatedSource.reportPeriod, "2026-03-31");
  // Legacy source proof is repaired only at its already-due normal attempt.
  // A section cannot gain a title-page period through metadata alone.
  for (const [label, source, body] of [
    ["legacy_section", { ...authenticatedSource, completeSource: undefined, reportPeriod: undefined }, bytes.get(aif)],
    ["wrong_aif_period", { ...authenticatedSource, completeSource: undefined, reportPeriod: undefined }, aifVariants[0]],
    ["legacy_complete", { ...authenticatedSource, reportPeriod: undefined }, bytes.get(aif)],
  ]) {
    const old = { ...structuredClone(row), firstVerifiedAt: "2026-09-01T00:00:00.000Z", verificationHistoryKnown: true,
      filing: { ...row.filing, reportPeriod: undefined }, nextAttemptAt: new Date(now.getTime() + 3600000).toISOString() };
    objects.set("research-evidence/company-profiles-v1.json", { version: 1, entries: [old] }); objects.set(sourceKey, structuredClone(source));
    const sourceBefore = JSON.stringify(objects.get(sourceKey)); const start = urls.length;
    await inSimpleAlertPilot(async () => assert.equal((await cache.readCompanyBusinessContexts([identity], now)).size, 0, "Missing period metadata cannot mint a freshly bound short context"));
    const replay = async (url, options) => String(url) === aif ? (() => { urls.push(aif); const response = new Response(body, { status: 200 }); Object.defineProperty(response, "url", { value: aif }); return response; })() : fetcher(url, options);
    assert.equal(await cache.ensureCompanyProfile(identity, replay, now), null); assert.equal(urls.length, start, `${label}: before due no GET`);
    assert.equal(await cache.ensureCompanyProfile(identity, replay, new Date(old.nextAttemptAt)), null);
    assert.deepEqual(urls.slice(start), label === "legacy_complete" ? [cover, index] : [cover, index, aif], `${label}: existing bounded source path only`);
    const after = objects.get("research-evidence/company-profiles-v1.json").entries[0];
    assert.equal(after.firstVerifiedAt, old.firstVerifiedAt); assert.equal(after.verificationHistoryKnown, true); assert.equal(after.profile, null);
    if (label === "wrong_aif_period") {
      assert.equal(after.error, "company_profile_aif_document_unverified"); assert.equal(JSON.stringify(objects.get(sourceKey)), sourceBefore, "Failed repair preserves old section without new period proof");
    } else {
      assert.equal(after.filing.reportPeriod, "2026-03-31"); assert.equal(after.extractionFailure, "company_profile_customers_not_extracted");
      if (label === "legacy_complete") assert.equal(objects.get(sourceKey).completeSource.observedAt, authenticatedSource.completeSource.observedAt, "Metadata repair cannot renew original byte observation");
      else assert.ok(objects.get(sourceKey).completeSource);
    }
  }
  assert.equal(networkAttempts, 0);
} finally { globalThis.fetch = originalFetch; console.info = originalInfo; }
console.info(`HELP AIF: authentic split-anchor resolution, ${unsafe.length + negatives.length} fail-closed variants, four bounded wrapper reads, no false full-profile success, before/due cache reuse, zero real network passed.`);
