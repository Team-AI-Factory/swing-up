import assert from "node:assert/strict";
import { loadTsModule } from "./helpers/load-typescript-module.mjs";
const now = new Date("2026-10-15T08:00:00.000Z"), later = new Date("2026-10-16T08:00:00.000Z");
const identity = { ticker: "AAUC", company: "Allied Gold Corp", cik: "0001993344" };
const base = "https://www.sec.gov/Archives/edgar/data/1993344/000162828026022512/";
const cover = base + "aaue-20251231.htm", aif = base + "a991-alliedx2026aif.htm", index = base + "0001628280-26-022512-index.html";
const binding = { cik: identity.cik, url: aif, form: "40-F", filedAt: "2026-04-01", annualFilingUrl: cover, annualFilingIndexUrl: index };
const business = "The Company produces precision instruments and calibration equipment for industrial laboratories. ".repeat(7);
const buyers = "Our customers include industrial laboratories and research institutions that buy precision instruments.";
const raw = `<html><body><h1>ANNUAL INFORMATION FORM</h1><p>For the year ended December 31, 2025</p><h2>DESCRIPTION OF THE BUSINESS</h2><p>${business}</p><p>${buyers}</p><h2>RISK FACTORS</h2></body></html>`;
const parser = loadTsModule("@/lib/company-profile"), codec = loadTsModule("@/lib/company-profile-complete-source");
const complete = codec.createCompleteSourceRecord({ binding, bytes: new TextEncoder().encode(raw), requestUrl: aif, finalUrl: aif, status: 200, eof: true, observedAt: now.toISOString() }, now);
assert.ok(complete);
const key = "research-evidence/company-profiles-v1.json", sourceKey = `research-evidence/company-profile-sources/${identity.cik}/000162828026022512-a991-alliedx2026aif.htm.json`;
const originalFetch = globalThis.fetch, originalInfo = console.info;
let realNetwork = 0;
globalThis.fetch = async () => { realNetwork++; throw new Error("Real network forbidden"); };
console.info = () => {};
try {
  for (const mode of ["missing", "mismatch", "invalid", "invalid_calendar", "section_only", "valid_complete", "complete_title_mismatch", "complete_metadata_mismatch"])
    for (const history of [false, true]) {
      const period = mode === "missing" ? undefined : mode === "invalid" ? "not-a-date" : mode === "invalid_calendar" ? "2025-02-30" : "2025-12-31";
      const row = { ...identity, profile: null, parserRevision: parser.COMPANY_PROFILE_PARSER_REVISION, cachedParserRevision: -1,
        updatedAt: now.toISOString(), nextAttemptAt: later.toISOString(), ...(history ? { firstVerifiedAt: "2026-09-01T00:00:00.000Z", verificationHistoryKnown: true } : {}),
        filing: { ...binding, checkedAt: now.toISOString(), industry: "Gold and Silver Ores", reportPeriod: period } };
      const source = { layoutRevision: 1, url: aif, filedAt: binding.filedAt, businessText: business + buyers,
        reportPeriod: ["mismatch", "complete_metadata_mismatch"].includes(mode) ? "2024-12-31" : period,
        ...(["valid_complete", "complete_title_mismatch", "complete_metadata_mismatch"].includes(mode) ? { completeSource: structuredClone(complete) } : {}) };
      if (mode === "complete_title_mismatch") row.filing.reportPeriod = source.reportPeriod = "2024-12-31";
      const objects = new Map([[key, { version: 1, entries: [row] }], [sourceKey, source], ["equity-universe/v1.json", { version: 1, entries: [{ ...identity, sourceNames: ["SEC company_tickers_exchange"] }] }]]);
      const cache = loadTsModule("@/lib/opportunity-engine/company-profile-cache", {
        "@/lib/r2-warehouse": {
          readVersionedTextFromR2: async name => ({ found: objects.has(name), text: objects.has(name) ? JSON.stringify(objects.get(name)) : null, etag: objects.has(name) ? "1" : null }),
          writeVersionedJsonToR2: async (name, value) => { objects.set(name, structuredClone(value)); return { written: true, conflict: false }; },
        }, "@/lib/opportunity-engine/pr262-storage": { pr262StorageKey: name => name },
      });
      const sourceBefore = JSON.stringify(source); const urls = [];
      const failSource = async url => { urls.push(String(url)); throw new Error("fixture_source_timeout"); };
      await cache.warmFoundationCompanyProfiles(failSource, now);
      const afterWarm = objects.get(key).entries[0];
      assert.equal(urls.length, 0, `${mode}: background repair cannot fetch before due`);
      assert.equal(Boolean(afterWarm.profile), mode === "valid_complete", `${mode}: warm path requires complete period-bound AIF bytes`);
      assert.equal(afterWarm.firstVerifiedAt, row.firstVerifiedAt);
      if (mode !== "valid_complete") {
        assert.equal(afterWarm.verificationHistoryKnown, row.verificationHistoryKnown); assert.equal(afterWarm.nextAttemptAt, row.nextAttemptAt);
        assert.equal(await cache.ensureCompanyProfile(identity, failSource, now), null); assert.equal(urls.length, 0);
        assert.equal(await cache.ensureCompanyProfile(identity, failSource, later), null, `${mode}: direct due path cannot promote a section or conflicting period`);
        assert.equal(urls.length, 1, "Failed existing source request ends the attempt without a new retry loop");
        assert.ok([cover, aif].includes(urls[0]));
        assert.equal(objects.get(key).entries[0].verificationHistoryKnown, row.verificationHistoryKnown);
        assert.equal(objects.get(key).entries[0].firstVerifiedAt, row.firstVerifiedAt);
      }
      assert.equal(JSON.stringify(objects.get(sourceKey)), sourceBefore, "Failed/metadata-only recovery preserves old source bytes");
    }
  assert.equal(realNetwork, 0);
} finally { globalThis.fetch = originalFetch; console.info = originalInfo; }
console.info("40-F period recovery: actual warm/direct paths, 8 source states × 2 histories, before-due zero source I/O, valid complete recovery, section-only/malformed/conflicting periods held, failed-source preservation passed.");
