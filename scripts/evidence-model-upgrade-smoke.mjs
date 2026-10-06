import assert from "node:assert/strict";
import { loadTsModule } from "./helpers/load-typescript-module.mjs";

const now = new Date("2026-10-03T12:00:00Z"), storage = new Map();
const io = {
  "@/lib/opportunity-engine/pr262-storage": { pr262StorageKey: key => `test/${key}` },
  "@/lib/r2-warehouse": {
    readVersionedTextFromR2: async key => storage.has(key) ? { found: true, text: JSON.stringify(storage.get(key)), etag: "saved" } : { found: false },
    writeVersionedJsonToR2: async (key, value) => { storage.set(key, structuredClone(value)); return { written: true }; },
  },
};
const evidence = loadTsModule("@/lib/equity-signal/financial-evidence", io);
const index = { cik: 1, filings: { recent: { form: ["10-K", "10-Q"], filingDate: ["2026-02-01", "2026-08-01"],
  reportDate: ["2025-12-31", "2026-06-30"], accessionNumber: ["0000000001-26-000001", "0000000001-26-000002"], primaryDocument: ["annual.htm", "quarterly.htm"] } } };
const filing = `<html>${"Verified filing preface. ".repeat(140)}<p>Operating segments: software revenue 120 million dollars, hardware revenue 50 million dollars.</p><p>Major customers accounted for 18% of annual revenue.</p><p>Gross margin increased from 41% to 44%.</p><p>Liquidity and capital resources: debt maturities total 20 million dollars in 2027.</p></html>`;
let sourceCalls = 0;
const fetchSource = async (url, options) => {
  sourceCalls++;
  assert.equal(options.redirect, "error", "A source cannot redirect the reader to an unverified host");
  assert.ok(options.signal);
  return url.includes("submissions") ? Response.json(index) : new Response(filing);
};
const docs = await evidence.collectFinancialDocuments("0000000001", fetchSource, now);
assert.equal(docs.documents.length, 2);
assert.equal(sourceCalls, 3);
assert.equal(docs.failures.length, 0);
assert.ok(docs.documents.every(d => d.readComplete && d.excerpts.some(e => e.topic === "customers")));
const cached = await evidence.collectFinancialDocuments("0000000001", fetchSource, new Date(now.getTime() + 60000));
assert.equal(sourceCalls, 3, "No repeat download while issuer evidence remains current");
assert.equal(cached.documents[0].collectedAt, docs.documents[0].collectedAt, "Reading the cache cannot renew evidence dates");
assert.equal(cached.documents[0].digest, docs.documents[0].digest);
const mismatch = await evidence.collectFinancialDocuments("0000000002", fetchSource, now);
assert.equal(mismatch.documents.length, 0);
assert.equal(mismatch.failures[0].reason, "issuer_mismatch");
const failed = await evidence.collectFinancialDocuments("0000000001", async () => { throw new Error("quota_guard"); }, new Date(now.getTime() + 7 * 3600000));
assert.equal(failed.failures.length, 1);
assert.equal(failed.documents[0].collectedAt, docs.documents[0].collectedAt);

const facts = { sourceUrl: "https://data.sec.gov/api/xbrl/companyfacts/CIK0000000001.json", items: [
  { metric: "diluted_eps_annual", value: 2, periodStart: "2025-01-01", periodEnd: "2025-12-31", unit: "USD/shares", filedAt: "2026-02-01" },
  { metric: "shares_outstanding", value: 100, periodEnd: "2026-06-30", unit: "shares", filedAt: "2026-08-01" },
] };
const audit = evidence.valuationEvidenceAudit({ currency: "USD", fairValue: { methods: [{ method: "earnings_power", value: 30, assumption: "15.0x normalized earnings" }] } }, facts, 20, now);
assert.equal(audit.methods[0].annualCrossCheck.value, 30);
assert.ok(audit.missingEssentialFacts.includes("net_income"), "A model value cannot satisfy missing financial facts");
assert.ok(Math.abs(audit.methods[0].sensitivity.lowerGapPercent - 20) < 1e-8, "Sensitivity uses the given estimate, not an invented source fact");

const revision = loadTsModule("@/lib/equity-signal/review-evidence-revision");
const a = revision.reviewEvidenceRevision({ source: [{ id: "day1", rawEventType: "valuation_review", summary: "scan one" }], facts: facts.items });
const b = revision.reviewEvidenceRevision({ source: [{ id: "day2", rawEventType: "valuation_review", summary: "scan two" }], facts: facts.items });
assert.equal(a, b, "A new day or generated valuation receipt is not new evidence");
assert.notEqual(a, revision.reviewEvidenceRevision({ source: [{ rawEventType: "valuation_review" }], facts: [...facts.items, { metric: "net_income", value: 5 }] }));

console.log("Financial evidence: exact issuer, bounded retrieval, original source dates, missing facts, annual valuation cross-check and meaningful evidence revisions passed.");
