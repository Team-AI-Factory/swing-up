import { loadTsModule } from "./helpers/load-typescript-module.mjs";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import ts from "typescript";

// Network-free replay of the SEC identity snapshot captured on 2026-10-03.
// SEC ticker metadata does not prove security type. HSAI exercises the reviewed
// primary-filing ADS attestation; a contradictory Nasdaq security type is blocked.
const cohort = JSON.parse(readFileSync(new URL("../config/simple-alert-pilot.json", import.meta.url), "utf8"));
const official = JSON.parse(readFileSync(new URL("./fixtures/simple-pilot-small-ai-sec-identities.json", import.meta.url), "utf8"));
const require = createRequire(import.meta.url);
const objects = new Map();
const reads = [];
const writes = [];
let pilot = true;
let revision = 0;
let pending = [];
let conflict = null;
const prefix = "branch-labs/simple-alerts/cohorts/small-ai-25-20261003-v1/";
const universeKey = "production/pr262/equity-universe/v1.json";
const directoryKey = `${prefix}sensor/company-directory-v1.json`;
const sensorKey = `${prefix}sensor/state-v1.json`;
const storageKey = relative => relative === "equity-universe/v1.json" ? universeKey : `${prefix}${relative}`;
const clone = value => JSON.parse(JSON.stringify(value));
const freshAt = new Date(Date.now() - 60_000).toISOString();
const sourceName = "SEC company_tickers_exchange";
assert.equal(cohort.cohortId, "small-ai-25-20261003-v1");
assert.equal(cohort.companies.length, 25);
assert.equal(official.data.length, 25);
assert.equal(official.source, "https://www.sec.gov/files/company_tickers_exchange.json");
const rows = official.data.map(([cik, name, ticker, exchange]) => ({
  ticker, name, exchange, cik: String(cik).padStart(10, "0"), aliases: [],
  securityType: "common_stock", sourceNames: [sourceName],
}));
for (const company of cohort.companies) {
  const row = rows.find(row => row.ticker === company.ticker);
  assert.equal(row.cik, company.cik);
  assert.equal(row.exchange, company.exchange);
}
const universe = {
  version: 1, scope: "active_us_exchange_listed_common_equities_and_adrs",
  constructionMode: "sec_official_fallback", refreshedAt: freshAt,
  entries: rows, coverage: { eligibleEquities: rows.length, cikMapped: rows.length }, sources: [],
};
function put(key, value) {
  objects.set(key, { text: JSON.stringify(value), etag: `etag-${++revision}` });
}
function load(relative, stubs) {
  const source = readFileSync(new URL(relative, import.meta.url), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
  }, fileName: relative }).outputText;
  const result = { exports: {} };
  new Function("require", "module", "exports", output)(name => name in stubs ? stubs[name] : require(name), result, result.exports);
  return result.exports;
}
const pilotScope = load("../lib/simple-alert-pilot-scope.ts", {
  "@/config/simple-alert-pilot.json": cohort,
  "@/lib/simple-alert-pilot-runtime": { isSimpleAlertPilot: () => pilot },
  "@/lib/company-profile": { profileCik: value => String(value).padStart(10, "0") },
});
const directory = load("../lib/opportunity-engine/pr262-company-directory.ts", {
  "@/lib/simple-alert-pilot-runtime": { isSimpleAlertPilot: () => pilot },
  "@/lib/equity-signal/security-classification": loadTsModule("@/lib/equity-signal/security-classification"),
  "@/lib/simple-alert-pilot-scope": pilotScope,
  "@/lib/opportunity-engine/pr262-storage": { pr262StorageKey: storageKey },
  "@/lib/opportunity-engine/pr262-change-sensor": { readPr262ChangeSensorState: async () => ({ pending }) },
  "@/lib/r2-warehouse": {
    readVersionedTextFromR2: async key => {
      reads.push(key);
      const current = objects.get(key);
      return current ? { found: true, ...current } : { found: false, text: null, etag: null };
    },
    writeVersionedJsonToR2: async (key, value, options = {}) => {
      assert.ok(key.startsWith(prefix), "Identity bootstrap must never mutate shared/main state.");
      writes.push(key);
      if (key === directoryKey && conflict) {
        const mutate = conflict;
        conflict = null;
        put(key, mutate(clone(value)));
        return { conflict: true, written: false };
      }
      const current = objects.get(key);
      if ((options.createOnly && current) || (options.expectedEtag && current?.etag !== options.expectedEtag)) {
        return { conflict: true, written: false };
      }
      put(key, value);
      return { conflict: false, written: true };
    },
  },
});
function reset(snapshot = universe) {
  objects.clear(); reads.length = 0; writes.length = 0; conflict = null;
  pending = cohort.companies.map(company => ({
    id: `sec:${company.cik}`, source: "sec", cik: company.cik,
    ticker: "WRONG_MENTIONED_TICKER", title: "Official issuer filing", company: null,
  }));
  put(universeKey, snapshot);
  put(sensorKey, { version: 2, pending });
}
async function mapping() { return directory.enrichPr262SensorCompanyMappings(); }
function stored() { return JSON.parse(objects.get(directoryKey).text); }
reset();
const first = await mapping();
assert.equal(first.directoryCompanies, 25);
assert.equal(first.cohortIdentityCoverage.mappedTickers.length, 25);
assert.deepEqual(first.cohortIdentityCoverage.missingTickers, []);
assert.equal(first.mapped, 25);
assert.equal(first.failClosed, 0);
const saved = stored();
assert.equal(saved.version, 6);
assert.equal(saved.cycleId, null);
assert.deepEqual(saved.batchKeys, []);
assert.equal(saved.recordsRead, 25);
for (const company of cohort.companies) {
  const resolved = await directory.readPr262ResolvedSensorCompany(`sec:${company.cik}`);
  assert.equal(resolved.directoryEntry.ticker, company.ticker);
  assert.equal(resolved.directoryEntry.cik, company.cik);
  assert.equal(resolved.directoryEntry.securityType, company.securityType);
  assert.equal(resolved.directoryEntry.isPrimaryListing, true);
  assert.equal(resolved.directoryEntry.batchKey, null);
  assert.equal(resolved.directoryEntry.analysisIndex, null);
  assert.equal(resolved.directoryEntry.valueCycleId, null);
  assert.equal(resolved.directoryEntry.valuationStatus, "missing");
  assert.equal(resolved.directoryEntry.identitySource, "pilot_cohort_sec_universe");
  assert.equal(resolved.valueAnalysis, null);
  assert.equal(resolved.event.mappingMethod, "official_sec_cik_exact");
  assert.equal("fairValue" in resolved.directoryEntry, false);
  assert.equal("currentPrice" in resolved.directoryEntry, false);
  assert.equal("marketCap" in resolved.directoryEntry, false);
  assert.equal("userAlertEligible" in resolved.directoryEntry, false);
}
assert.equal(reads.some(key => key.includes("value-investing/resumable")), false,
  "Missing analysis is explicit; pilot identity must not read or invent a foundation batch.");
const hsai = saved.entries.find(row => row.ticker === "HSAI");
assert.equal(hsai.securityIdentitySource, "pilot_reviewed_sec_ads_filing");
assert.equal(hsai.securityIdentitySourceUrl, cohort.companies.find(row => row.ticker === "HSAI").adsRatioSourceUrl);
assert.ok(saved.entries.find(row => row.ticker === "REKR"), "Quarantined issuer remains watchable without upside authority.");
assert.equal(writes.filter(key => key === directoryKey).length, 1, "Identical revalidated identity cache is reused.");

// Actual Nasdaq/SEC sibling descriptions captured on 2026-10-03. The old
// plural classifier and SEC-only suffix gap produced exactly22/25 live coverage.
const withDerivativeSiblings = clone(universe);
for (const [ticker, sibling, description, secOnly] of [
  ["PGY", "PGYWW", "Pagaya Technologies Ltd. - Warrants", false],
  ["AISP", "AISPW", "Airship AI Holdings, Inc - Warrants", false],
  ["BBAI", "BBAI-WT", "BigBear.ai Holdings, Inc.", true],
]) {
  const primary = withDerivativeSiblings.entries.find(row => row.ticker === ticker);
  primary.sourceNames = ["Nasdaq Trader nasdaqlisted", sourceName];
  primary.aliases = [`${primary.name} - Common Stock`];
  withDerivativeSiblings.entries.push({ ...primary, ticker: sibling, aliases: [description], sourceNames: secOnly ? [sourceName] : primary.sourceNames });
}
reset(withDerivativeSiblings);
assert.equal((await mapping()).directoryCompanies, 25, "Proven derivative siblings cannot shadow the independently described common shares");
assert.equal(stored().entries.some(row => ["PGYWW", "AISPW", "BBAI-WT"].includes(row.ticker)), false);
const trueCommonSibling = clone(withDerivativeSiblings);
trueCommonSibling.entries.find(row => row.ticker === "BBAI-WT").aliases = ["Example Class WT Common Stock"];
reset(trueCommonSibling);
assert.equal((await mapping()).directoryCompanies, 24, "Explicit common-share evidence overrides a derivative-looking ticker suffix");
const noClassEvidence = clone(withDerivativeSiblings);
noClassEvidence.entries.find(row => row.ticker === "BBAI").aliases = ["BigBear.ai Holdings, Inc."];
reset(noClassEvidence);
assert.equal((await mapping()).directoryCompanies, 24, "An unclassified sibling remains ambiguous without primary common-share evidence");

// Cached state cannot trump a newly changed official identity, even if the
// universe refresh timestamp is unchanged. Remaining cohort members still work.
const firstCompany = cohort.companies[0];
for (const [label, mutate] of [
  ["wrong CIK", row => { row.cik = "0009999999"; }],
  ["malformed CIK", row => { row.cik = `${row.cik.slice(0, 5)}-${row.cik.slice(5)}`; }],
  ["wrong exchange", row => { row.exchange = "NYSE"; }],
  ["OTC listing", row => { row.exchange = "OTC"; }],
  ["wrong security type", row => { row.securityType = "adr"; }],
  ["preferred security", row => { row.securityType = "preferred_stock"; }],
  ["non-primary listing", row => { row.isPrimaryListing = false; }],
  ["unofficial source", row => { row.sourceNames = ["unverified ticker text"]; }],
]) {
  reset(); await mapping();
  const bad = clone(universe);
  mutate(bad.entries.find(row => row.ticker === firstCompany.ticker));
  put(universeKey, bad);
  const result = await mapping();
  assert.equal(result.directoryCompanies, 24, label);
  assert.equal(result.failClosed, 1, label);
  assert.equal(await directory.readPr262ResolvedSensorCompany(`sec:${firstCompany.cik}`), null, label);
}
for (const [label, add] of [
  ["duplicate ticker", row => ({ ...row })],
  ["conflicting duplicate ticker", row => ({ ...row, cik: "0009999999" })],
  ["ambiguous primary listing", row => ({ ...row, ticker: "SECOND_CLASS" })],
]) {
  const bad = clone(universe);
  bad.entries.push(add(bad.entries.find(row => row.ticker === firstCompany.ticker)));
  reset(bad);
  assert.equal((await mapping()).directoryCompanies, 24, label);
}
reset(); await mapping();
const unknown = directory.resolvePr262SensorDirectoryEntry({ source: "sec", cik: "0009999999", ticker: firstCompany.ticker, title: "Mentioned ticker" }, saved.entries);
assert.equal(unknown.entry, null);
assert.equal(unknown.method, "sec_cik_unknown_fail_closed");
const wrongStructuredCik = directory.resolvePr262SensorDirectoryEntry({ source: "market_price", cik: "0009999999", ticker: firstCompany.ticker, title: "Quote" }, saved.entries);
assert.equal(wrongStructuredCik.entry, null);
assert.equal(wrongStructuredCik.method, "structured_ticker_cik_mismatch_fail_closed");
const duplicated = [saved.entries[0], saved.entries[0]];
assert.equal(directory.resolvePr262SensorDirectoryEntry({ source: "market_price", ticker: duplicated[0].ticker, cik: null, title: "Quote" }, duplicated).status, "ambiguous");
for (const offset of [-24 * 60 * 60_000 - 1, 6 * 60_000]) {
  const bad = clone(universe);
  bad.refreshedAt = new Date(Date.now() + offset).toISOString();
  put(universeKey, bad);
  await assert.rejects(mapping(), /pr262_authoritative_equity_universe_stale/);
}
objects.delete(universeKey);
await assert.rejects(mapping(), /pr262_authoritative_equity_universe_missing/);

// No ADS attestation may override a genuine Nasdaq security-class conflict.
const conflictingAds = clone(universe);
conflictingAds.entries.find(row => row.ticker === "HSAI").sourceNames.push("Nasdaq Trader nasdaqlisted");
reset(conflictingAds);
assert.equal((await mapping()).directoryCompanies, 24);
assert.equal(stored().entries.some(row => row.ticker === "HSAI"), false);
const provedAds = clone(conflictingAds);
provedAds.entries.find(row => row.ticker === "HSAI").securityType = "adr";
reset(provedAds);
assert.equal((await mapping()).directoryCompanies, 25);
assert.equal(stored().entries.find(row => row.ticker === "HSAI").securityIdentitySource, undefined);
const hsaiConfig = cohort.companies.find(row => row.ticker === "HSAI");
const originalHsai = clone(hsaiConfig);
for (const mutate of [
  row => { row.adsRatioSourceUrl = "https://www.sec.gov/Archives/edgar/data/1/000110465926082432/tm2620203d1_6k.htm"; row.sourceUrls.push(row.adsRatioSourceUrl); },
  row => { row.adsRatioSourceUrl = "https://www.sec.gov.evil.test/Archives/edgar/data/1861737/000110465926082432/tm2620203d1_6k.htm"; row.sourceUrls.push(row.adsRatioSourceUrl); },
  row => { row.adsOrdinarySharesRatio = 0; },
  row => { row.adsRatioEffectiveAt = "2099-01-01"; },
  row => { row.sourceUrls = []; },
]) {
  Object.assign(hsaiConfig, clone(originalHsai));
  mutate(hsaiConfig); reset();
  assert.equal((await mapping()).directoryCompanies, 24, "Missing or mismatched ADS attestation must fail closed.");
}
Object.assign(hsaiConfig, originalHsai);

// Cache tampering, stale cohort identities and conflicting concurrent writes fail
// closed or rebuild from the freshly validated identities, never old value data.
reset(); await mapping();
const tampered = stored(); tampered.entries.pop();
put(directoryKey, tampered);
assert.equal((await mapping()).directoryCompanies, 25);
reset(); conflict = value => value;
assert.equal((await mapping()).directoryCompanies, 25);
reset(); conflict = value => ({ ...value, entries: value.entries.slice(1) });
await assert.rejects(mapping(), /pr262_company_directory_state_conflict/);
reset(); conflict = value => ({ ...value, updatedAt: "2000-01-01T00:00:00.000Z" });
await assert.rejects(mapping(), /pr262_company_directory_state_conflict/);

// Pilot bootstrap is unavailable in ordinary/main mode. Legacy foundation
// pointers and financial reads retain their pre-existing requirements.
pilot = false; reset();
assert.equal(directory.resolvePr262SensorDirectoryEntry({ source: "sec", cik: hsai.cik, ticker: "HSAI", title: "Filing" }, [hsai]).entry, null);
await assert.rejects(mapping(), /pr262_value_analysis_batches_unavailable/);
console.log(JSON.stringify({ ok: true, cohortIdentities: 25, officialSecIdentityReplay: true,
  noFoundationRequiredInPilot: true, missingAnalysisExplicit: true, fabricatedFinancialValues: false,
  staleAndWrongIdentityFailClosed: true, duplicatesAndPrimaryAmbiguityFailClosed: true,
  hsaiReviewedAdsAttestation: true, genuineSecurityTypeConflictFailClosed: true,
  concurrentCacheValidation: true, nonPilotFoundationStillRequired: true, networkCalls: 0 }, null, 2));
