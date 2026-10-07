import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { loadTsModule } from "./helpers/load-typescript-module.mjs";

// Exact, complete HTTP 200 bodies captured once each from the official roots.
// Tests replay local bytes only; no SEC calls or live storage writes occur.
const fixtureRoot = new URL("./fixtures/sec-submissions-root-2026-10-07/", import.meta.url);
const provenance = JSON.parse(readFileSync(new URL("provenance.json", fixtureRoot)));
const fixtures = provenance.map(source => {
  const bytes = readFileSync(new URL(`${source.ticker}.json`, fixtureRoot));
  assert.equal(bytes.length, source.bytes);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), source.sha256);
  const body = JSON.parse(bytes);
  const recent = body.filings.recent;
  assert.equal(recent.accessionNumber.length, source.rowCount);
  assert.ok(Object.values(recent).every(rows => Array.isArray(rows) && rows.length === source.rowCount));
  assert.deepEqual(recent.primaryDocument.flatMap((value, index) => value === "" ? [index] : []), source.emptyPrimaryDocumentRows);
  return { ...source, body, company: body.name };
});
const schema = loadTsModule("@/lib/opportunity-engine/pr262-sec-submissions-schema");
const realDate = Date;
let clock = realDate.parse("2026-10-07T00:54:00.000Z");
class TestDate extends realDate {
  constructor(...args) { super(...(args.length ? args : [clock])); }
  static now() { return clock; }
}
globalThis.Date = TestDate;
let objects = new Map(), revision = 0, network = 0, pilot = true;
const prefix = "branch-labs/simple-alerts/cohorts/sec-schema-test/";
const registryKey = `${prefix}sensor/direct-company-feeds-v1.json`;
const overrides = {
  "@/lib/simple-alert-pilot-runtime": { isSimpleAlertPilot: () => pilot },
  "@/lib/simple-alert-pilot-scope": { pilotCompanies: () => fixtures },
  "@/config/simple-alert-issuer-sources.json": { companies: [] },
  "@/lib/opportunity-engine/pr262-storage": { pr262StorageKey: key => prefix + key },
  "node:timers/promises": { setTimeout: async ms => { clock += ms; } },
  "@/lib/r2-warehouse": {
    readVersionedTextFromR2: async key => {
      const saved = objects.get(key);
      return { found: Boolean(saved), text: saved ? JSON.stringify(saved.value) : null, etag: saved?.etag ?? null };
    },
    writeVersionedJsonToR2: async (key, value, options) => {
      const prior = objects.get(key);
      if ((options?.createOnly && prior) || (options?.expectedEtag && prior?.etag !== options.expectedEtag)) return { written: false, conflict: true };
      const etag = `revision-${++revision}`;
      objects.set(key, { value: structuredClone(value), etag });
      return { written: true, conflict: false, etag };
    },
  },
};
const budgetModule = loadTsModule("@/lib/opportunity-engine/pr262-sensor-fetch-budget", overrides);
const direct = loadTsModule("@/lib/opportunity-engine/pr262-direct-announcements", overrides);
function reset(source) {
  objects = new Map(); network = 0; pilot = true;
  objects.set(registryKey, { etag: `revision-${++revision}`, value: {
    version: 1, updatedAt: new Date().toISOString(), discoveryCursor: 0, lastDiscoveryCycleAt: new Date().toISOString(),
    entries: [{ ticker: source.ticker, company: source.company, cik: source.cik,
      investorWebsite: null, feedUrl: null, discoveredAt: new Date().toISOString(), lastDiscoveryAt: new Date().toISOString(),
      lastCheckedAt: null, lastSuccessAt: null, nextCheckAt: new Date(clock + 86400_000).toISOString(), error: null }],
  } });
}
async function run(source, body, status = 200) {
  reset(source);
  const budget = await budgetModule.createPr262SensorBudgetedFetch({ fetchImpl: async request => {
    network++;
    assert.equal(String(request), source.url);
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  } });
  const result = await direct.runPr262DirectAnnouncementMonitor({ exposure: [source], now: new Date(), fetchImpl: budget.fetchImpl });
  return { result, budget, snapshot: objects.get(`${prefix}sensor/submissions-cache/${source.cik}.json`)?.value };
}
function currentBody(source) {
  return { cik: source.cik, tickers: [source.ticker], filings: { recent: {
    accessionNumber: ["0000903651-26-000001", "0000903651-26-000002", "0000903651-26-000003"],
    form: ["8-K", "8-K", "4"], filingDate: Array(3).fill(new Date(clock - 3600_000).toISOString().slice(0, 10)),
    primaryDocument: ["current-report.htm", "", "ownership.xml"],
    acceptanceDateTime: Array(3).fill(new Date(clock - 3600_000).toISOString()),
  } } };
}
try {
  for (const source of fixtures) {
    assert.equal(schema.completePr262SecSubmissionsRoot(source.body, source), true);
    const { result, budget, snapshot } = await run(source, source.body);
    assert.equal(result.secCheckSuccesses, 1);
    assert.equal(result.issuerSourceCoverage[0].sec.status, "current_snapshot");
    assert.equal(result.events.length, 0, "Old filings and current non-decision forms must not become fresh events.");
    assert.deepEqual(JSON.parse(snapshot.body), source.body, "Keep the complete original root, including blank historical documents.");
    const fetchedAt = snapshot.fetchedAt;
    clock += 60_000;
    const cached = await budget.fetchImpl(source.url);
    assert.equal(cached.headers.get("x-swingup-submissions-cache"), "hit");
    assert.equal(cached.headers.get("x-swingup-submissions-fetched-at"), fetchedAt);
    assert.equal(network, 1, "Cache reuse must not make another SEC request.");
    const recent = source.body.filings.recent;
    const position = recent.form.findIndex(form => form.startsWith("8-K"));
    clock = realDate.parse(recent.acceptanceDateTime[position]) + 60_000;
    const replay = await run(source, source.body);
    const original = replay.result.events.find(event => event.id === `sec:${recent.accessionNumber[position]}`);
    assert.ok(original, "A decision-grade event remains detectable in the real index at its original acceptance time.");
    assert.equal(original.observedAt, recent.acceptanceDateTime[position]);
    assert.match(original.reason, /Initial source catch-up/);
    clock = realDate.parse("2026-10-07T00:54:00.000Z");
  }
  const source = fixtures[0];
  const valid = currentBody(source);
  const result = (await run(source, valid)).result;
  assert.equal(result.events.length, 1, "Blank documents are coverage only, and Form 4 remains outside the decision-grade allowlist.");
  assert.equal(result.events[0].observedAt, valid.filings.recent.acceptanceDateTime[0]);
  assert.equal(result.events[0].cik, source.cik);
  assert.equal(result.events[0].ticker, source.ticker);
  assert.equal(result.events[0].canonicalSecIndexUrl, "https://www.sec.gov/Archives/edgar/data/903651/000090365126000001/0000903651-26-000001-index.html");

  const malformed = [
    ["wrong CIK", body => { body.cik = fixtures[1].cik; }],
    ["wrong ticker", body => { body.tickers = [fixtures[1].ticker]; }],
    ["missing document column", body => { delete body.filings.recent.primaryDocument; }],
    ["short document column", body => { body.filings.recent.primaryDocument.pop(); }],
    ["null document", body => { body.filings.recent.primaryDocument[1] = null; }],
    ["whitespace document", body => { body.filings.recent.primaryDocument[1] = " "; }],
    ["missing acceptance column", body => { delete body.filings.recent.acceptanceDateTime; }],
    ["short acceptance column", body => { body.filings.recent.acceptanceDateTime.pop(); }],
    ["empty acceptance", body => { body.filings.recent.acceptanceDateTime[1] = ""; }],
    ["date-only acceptance", body => { body.filings.recent.acceptanceDateTime[1] = body.filings.recent.filingDate[1]; }],
    ["no acceptance timezone", body => { body.filings.recent.acceptanceDateTime[1] = "2026-10-06T23:54:00"; }],
    ["rolled acceptance date", body => { body.filings.recent.acceptanceDateTime[1] = "2026-02-30T23:54:00Z"; }],
    ["rolled acceptance hour", body => { body.filings.recent.acceptanceDateTime[1] = "2026-10-06T24:00:00Z"; }],
    ["bad accession", body => { body.filings.recent.accessionNumber[1] = "unknown"; }],
    ["missing form", body => { body.filings.recent.form[1] = ""; }],
    ["rolled filing date", body => { body.filings.recent.filingDate[1] = "2026-02-30"; }],
  ];
  for (const [label, mutate] of malformed) {
    const body = structuredClone(valid); mutate(body);
    assert.equal(schema.completePr262SecSubmissionsRoot(body, source), false, label);
    const { result, snapshot } = await run(source, body);
    assert.equal(snapshot, undefined, `${label}: never cache`);
    assert.equal(result.secCheckSuccesses, 0, `${label}: never certify coverage`);
    assert.equal(result.issuerSourceCoverage[0].sec.snapshotFetchedAt, null, label);
    assert.equal(result.events.length, 0, `${label}: never emit events`);
  }
  for (const [label, body, status] of [["truncated JSON", "{\"cik\":", 200], ["partial HTTP", valid, 206], ["access refused", valid, 403], ["rate limited", valid, 429]]) {
    const { result, snapshot } = await run(source, body, status);
    assert.equal(snapshot, undefined, label);
    assert.equal(result.secCheckSuccesses, 0, label);
    assert.equal(result.events.length, 0, label);
    assert.equal(network, 1, `${label}: no retry`);
  }
  assert.equal(schema.pr262SecAcceptanceTime("20261006235400"), null, "A zone-less SEC header clock must not be invented as UTC");
  assert.equal(schema.pr262SecAcceptanceTime("2026-10-06T19:54:00-04:00"), realDate.parse("2026-10-06T23:54:00Z"));
  for (const value of [null, undefined, "", "2026-10-06", "20260230235400", "20261006240000"]) assert.equal(schema.pr262SecAcceptanceTime(value), null);

  // Legacy issuer discovery also cannot manufacture noon from filingDate.
  reset(source); pilot = false;
  objects.get(registryKey).value.lastDiscoveryCycleAt = null;
  objects.get(registryKey).value.entries = [];
  const legacy = currentBody(source); delete legacy.filings.recent.acceptanceDateTime;
  const noDateFallback = await direct.runPr262DirectAnnouncementMonitor({ exposure: [source], now: new Date(),
    fetchImpl: async request => { assert.equal(String(request), source.url); return new Response(JSON.stringify(legacy)); } });
  assert.equal(noDateFallback.events.length, 0);
  console.log("PASS SEC complete root replay: INOD/TSSI historical blanks, original event times, cache reuse, partial bodies, identity/alignment and adversarial event gates.");
} finally {
  globalThis.Date = realDate;
}
