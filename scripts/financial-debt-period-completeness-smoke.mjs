import assert from "node:assert/strict";
import { loadTsModule } from "./helpers/load-typescript-module.mjs";

const { requiredFinancialFactPresent, enrichCandidateFundamentals } = loadTsModule("@/lib/equity-signal/fundamentals");
const now = new Date("2026-10-06T12:00:00Z");
const sourceUrl = "https://data.sec.gov/api/xbrl/companyfacts/CIK0000903651.json";
const balance = (metric, value, overrides = {}) => ({ metric, value, unit: "USD", periodStart: null,
  periodEnd: "2026-06-30", filedAt: "2026-08-06", form: "10-Q", accession: "0001104659-26-092021", sourceUrl, ...overrides });
// The dated debt rows mirror the public INOD collector output observed Oct 6.
// All valuations, transport and storage in this regression are synthetic.
const anchors = [balance("assets", 356673000), balance("liabilities", 197139000), balance("equity", 159617000),
  balance("shares_outstanding", 34382651, { unit: "shares", periodEnd: "2026-07-31" })];
const historicalDebt = [balance("long_term_debt_noncurrent", 5079000, { periodEnd: "2022-12-31", filedAt: "2023-02-24", form: "10-K", accession: "0001410578-23-000153" }),
  balance("long_term_debt_current", 877000, { periodEnd: "2022-12-31", filedAt: "2023-02-24", form: "10-K", accession: "0001410578-23-000153" })];
const currentDebt = [balance("long_term_debt_noncurrent", 4000000), balance("long_term_debt_current", 500000)];
const needed = ["long_term_debt_noncurrent", "long_term_debt_current"];
const meets = items => needed.every(metric => requiredFinancialFactPresent(items, metric, now));
const historicalItems = [...anchors, ...historicalDebt], unchanged = structuredClone(historicalItems);
assert.equal(meets(historicalItems), false, "2022 debt cannot satisfy a current 2026 debt request");
assert.deepEqual(historicalItems, unchanged, "Historical debt and all original provenance remain available unchanged");
assert.equal(meets([...anchors, ...currentDebt]), true, "Current debt matches the June balance sheet despite a later July share-count date");
assert.equal(meets([...anchors, ...currentDebt.map(item => ({ ...item, value: 0 }))]), true, "An explicit numeric zero with matching dates is valid");
assert.equal(meets([...anchors, balance("total_debt", 2003129000)]), false, "Combined debt cannot stand in for either split or recourse analysis");
assert.equal(meets(currentDebt), false, "No balance-sheet period anchor means currentness is unresolved");
assert.equal(meets([...anchors.map(item => ({ ...item, unit: "EUR" })), ...currentDebt]), false, "A currency-mismatched anchor cannot certify USD debt");
assert.equal(meets([...anchors, ...currentDebt].map(item => ({ ...item, periodEnd: "2026-02-30", filedAt: "2026-03-06" }))), false,
  "JavaScript date normalization cannot make an invalid reporting date valid");
for (const changed of [
  { periodEnd: "2025-12-31" }, // Recent enough for 550 days, but not the current reporting period.
  { periodEnd: null }, { filedAt: null }, { periodEnd: "2026-12-31", filedAt: "2027-02-01" },
  { filedAt: "2026-12-01" }, { filedAt: "2026-01-01" }, { periodStart: "2026-01-01" },
  { periodStart: "" }, { periodStart: 0 }, { periodStart: false },
  { unit: "EUR" }, { unit: "shares" }, { value: null }, { value: NaN },
]) {
  assert.equal(meets([...anchors, ...currentDebt.map(item => ({ ...item, ...changed }))]), false, JSON.stringify(changed));
}
assert.equal(requiredFinancialFactPresent([{ ...historicalDebt[0], metric: "long_term_debt_noncurrent_prior_year" }],
  "long_term_debt_noncurrent_prior_year", now), true, "An explicitly historical request keeps its prior semantics");

const oldFundamentals = { available: true, sourceUrl, checkedAt: "2026-10-06T11:00:00Z", latestFiledAt: "2026-08-06",
  fiscalPeriodEnd: "2026-07-31", items: historicalItems, error: null };
const cacheSnapshot = { evidenceVersion: 2, cik: "0000903651", fundamentals: oldFundamentals, annualRevenue: null };
let fetches = 0;
const failedRefresh = await enrichCandidateFundamentals({ cik: "0000903651", eventFamily: "valuation_gap" },
  async () => { fetches++; throw new Error("synthetic_source_unavailable"); }, now, {
    requiredMetrics: needed, read: async () => cacheSnapshot, write: async () => { throw new Error("unexpected_write"); },
  });
assert.equal(fetches, 1, "A recent cache containing stale debt cannot suppress requested source collection");
assert.deepEqual(failedRefresh.candidate.fundamentals.items, historicalItems);
assert.equal(failedRefresh.candidate.fundamentals.checkedAt, oldFundamentals.checkedAt, "A failed refresh cannot renew evidence dates");
assert.equal(meets(failedRefresh.candidate.fundamentals.items), false);
const validCache = { ...cacheSnapshot, fundamentals: { ...oldFundamentals, items: [...anchors, ...currentDebt] } };
const reused = await enrichCandidateFundamentals({ cik: "0000903651", eventFamily: "valuation_gap" },
  async () => { throw new Error("unexpected_network"); }, now, { requiredMetrics: needed, read: async () => validCache,
    write: async () => { throw new Error("unexpected_write"); } });
assert.equal(reused.provider.cached, true, "The matching period can still reuse an eligible six-hour cache");

const objects = new Map();
const evidence = loadTsModule("@/lib/opportunity-engine/pr262-research-evidence", {
  "@/lib/r2-warehouse": {
    readVersionedTextFromR2: async key => ({ found: objects.has(key), text: objects.has(key) ? JSON.stringify(objects.get(key)) : null, etag: objects.has(key) ? "synthetic" : null }),
    writeVersionedJsonToR2: async (key, value) => { objects.set(key, structuredClone(value)); return { written: true, conflict: false }; },
  },
  "@/lib/opportunity-engine/pr262-storage": { pr262StorageKey: key => `synthetic/${key}` },
});
async function quality(items, id) {
  const candidate = { ticker: "INOD", company: "INNODATA INC", cik: "0000903651", eventFamily: "valuation_gap", direction: "downside",
    fundamentals: { ...oldFundamentals, items }, valuationAudit: { missingEssentialFacts: [] } };
  const result = await evidence.recordResearchEvidence({ event: { id, ticker: "INOD", cik: candidate.cik, observedAt: now.toISOString() },
    report: { status: "qualified_signal_openai_not_requested", openAiCalled: false, selectedCandidate: candidate,
      blockers: ["Verify current debt and debt maturities before valuation."] }, sourceDecisionGrade: true, sourceFailureReason: null, now });
  assert.equal(result.quality.committeeCompleted, false);
  return result.quality.fields.financialFacts;
}
assert.equal(await quality(historicalItems, "stale-debt"), false, "Actual follow-up completeness rejects historical metric presence");
assert.equal(await quality([...anchors, ...currentDebt], "current-debt"), true);
assert.equal(await quality([...anchors, balance("total_debt", 2003129000)], "combined-only"), false);
assert.equal(await quality([...anchors, ...currentDebt.map(item => ({ ...item, periodEnd: null }))], "missing-period"), false);
assert.equal(await quality([...anchors, ...currentDebt.map(item => ({ ...item, unit: "EUR" }))], "currency-mismatch"), false);
assert.deepEqual(cacheSnapshot.fundamentals, oldFundamentals);
console.log("Current debt completeness: reporting-period alignment, original history, dates, USD units, sourced zero, distinct combined debt, cache refresh and follow-up quality passed; no live model or storage calls.");
