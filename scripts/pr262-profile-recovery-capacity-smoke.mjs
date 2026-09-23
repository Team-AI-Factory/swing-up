import assert from "node:assert/strict";
import { loadTsModule } from "./helpers/load-typescript-module.mjs";
import { companyProfileFixture } from "./helpers/company-profile-fixture.mjs";

const now = new Date("2026-09-23T04:00:00Z");
const identities = Array.from({ length: 16 }, (_, index) => ({ ticker: `T${index}`, company: "Test Software", cik: String(index + 1).padStart(10, "0") }));
const objects = new Map();
let revision = 0;
const storage = {
  readVersionedTextFromR2: async key => objects.has(key) ? { found: true, text: JSON.stringify(objects.get(key).value), etag: objects.get(key).etag } : { found: false, text: null, etag: null },
  writeVersionedJsonToR2: async (key, value, options = {}) => {
    const previous = objects.get(key);
    if ((options.createOnly && previous) || (options.expectedEtag && previous?.etag !== options.expectedEtag)) return { written: false, conflict: true };
    objects.set(key, { value: structuredClone(value), etag: String(++revision) });
    return { written: true, conflict: false };
  },
};
const seed = async () => {
  objects.clear();
  await storage.writeVersionedJsonToR2("equity-universe/v1.json", { version: 1, scope: "active_us_exchange_listed_common_equities_and_adrs", entries: identities.map(identity => ({ ...identity, sourceNames: ["SEC company_tickers_exchange"] })) });
  await storage.writeVersionedJsonToR2("value-investing/resumable/latest/index.json", { seriousAlerts: { buy: identities.slice(0, 11) } });
  await storage.writeVersionedJsonToR2("sensor/state-v1.json", { pending: [
    { ...identities[13], observedAt: "2026-09-21T12:00:00Z" },
    { ...identities[14], observedAt: "2026-09-23T03:55:00Z" },
  ] });
};
const cache = loadTsModule("@/lib/opportunity-engine/company-profile-cache", {
  "@/lib/r2-warehouse": storage, "@/lib/opportunity-engine/pr262-storage": { pr262StorageKey: key => key },
});
await seed();
const requests = [], starts = [];
let firstIssuerBusy = false, slowIssuerTest = true, secondIssuerStartedWhileFirstBusy = false;
const fetcher = async url => {
  const value = String(url);
  requests.push(value); starts.push(Date.now());
  if (value.includes("submissions")) {
    const identity = identities.find(row => value.includes(`CIK${row.cik}`));
    assert.ok(identity);
    if (slowIssuerTest && identity.ticker === "T14") {
      firstIssuerBusy = true;
      await new Promise(resolve => setTimeout(resolve, 1600));
      firstIssuerBusy = false;
    }
    if (slowIssuerTest && identity.ticker === "T11") secondIssuerStartedWhileFirstBusy = firstIssuerBusy;
    return Response.json({ cik: Number(identity.cik), tickers: [identity.ticker], sicDescription: "Application software", filings: { recent: {
      form: ["10-K"], filingDate: ["2026-08-01"], accessionNumber: [`${identity.cik}-26-000001`], primaryDocument: ["annual.htm"],
    } } });
  }
  const identity = identities.find(row => value.includes(`/data/${Number(row.cik)}/`));
  assert.ok(identity);
  const fixture = companyProfileFixture(identity, now);
  return new Response(`<h2>Item 1. Business</h2><p>${fixture.business}</p><p>${fixture.customers}</p><p>${"We maintain regional support facilities. ".repeat(16)}</p><h2>Item 1A. Risk Factors</h2>`);
};
const result = await cache.warmFoundationCompanyProfiles(fetcher, now);
assert.equal(result.attempted, 2);
assert.equal(result.verified, 2);
assert.equal(result.eligibleCompanies, 16);
assert.equal(secondIssuerStartedWhileFirstBusy, true, "A slow first issuer must not idle the second recovery worker");
assert.ok(requests[0].includes(`CIK${identities[14].cik}`), "A fresh event receives profile recovery ahead of background valuation work");
const verified = await cache.readCompanyProfiles(identities, now);
assert.equal(verified.has("T14"), true);
assert.equal(verified.has("T11"), true, "Reserve one background slot so universe coverage keeps moving");
assert.ok(starts.every((value, index) => !index || value - starts[index - 1] >= 200), "Free SEC requests are paced, not fired in a burst");
assert.equal((await cache.warmFoundationCompanyProfiles(fetcher, new Date(now.getTime() + 60000))).attempted, 0, "Current capacity preserves the durable cadence");

await seed();
slowIssuerTest = false;
const controller = new AbortController();
let afterAbortRequests = 0;
const aborted = await cache.warmFoundationCompanyProfiles(async (url, init) => {
  afterAbortRequests++;
  controller.abort();
  return fetcher(url, init);
}, now, { signal: controller.signal });
assert.equal(aborted.deadlineReached, true);
assert.equal(aborted.attempted, 2, "Do not schedule later batches after the worker deadline");
assert.equal(afterAbortRequests, 1, "Abort also cancels requests waiting for pacing");
console.log("PASS: two-issuer recovery, fresh-event priority, background progress, paced SEC requests, durable cadence and deadline cancellation");
