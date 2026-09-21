import assert from "node:assert/strict";
import { loadTsModule } from "./helpers/load-typescript-module.mjs";
const evidence = loadTsModule("@/lib/opportunity-engine/pr262-research-evidence");
const fundamentals = loadTsModule("@/lib/equity-signal/fundamentals", { "@/lib/equity-signal/analysis": { reassessCandidateAfterFundamentals: candidate => candidate } });
const now = new Date("2026-09-18T12:00:00Z");
const filingUrl = "https://www.sec.gov/Archives/edgar/data/1/000000000126000001/example-index.html";
const exhibitUrl = filingUrl.replace("example-index.html", "ex99-2.htm");
const report = {
  blockers: ["The referenced exhibit download failed.", "Need revenue year-over-year comparison for the same quarter.", "Current price observation and halt check are missing."],
  selectedCandidate: { ticker: "EXM", cik: "0000000001", quote: { observedAt: "2026-09-17T20:00:00Z" }, receipts: [{ id: "exact-filing", url: filingUrl }] },
  secFilingDetails: { items: [{ receiptId: "unrelated-cached-filing", indexUrl: "https://www.sec.gov/unrelated", eventExhibitStatus: "not_required" }, { receiptId: "exact-filing", indexUrl: filingUrl, primaryDocumentUrl: filingUrl.replace("example-index.html", "main.htm"), exhibitDocumentUrl: exhibitUrl, requiredExhibitType: "EX-99.2", eventExhibitStatus: "download_failed", errorCategory: "exhibit_http_error" }] },
};
const tasks = evidence.evidenceTasks(report).tasks;
const documentTask = tasks.find(task => task.type === "source_document");
assert.equal(documentTask.documents.length, 1, "Unrelated cached filings cannot become this event's collection target");
assert.equal(documentTask.documents[0].exhibitDocumentUrl, exhibitUrl);
assert.equal(documentTask.documents[0].requiredExhibitType, "EX-99.2");
assert.equal(documentTask.documents[0].failureReason, "exhibit_http_error");
assert.match(documentTask.action, /download failed/);
const marketTask = tasks.find(task => task.type === "market_evidence");
assert.equal(marketTask.ticker, "EXM");
assert.equal(marketTask.previousObservationAt, "2026-09-17T20:00:00Z");
assert.ok(marketTask.fields.includes("observedAt"));
const financialTask = tasks.find(task => task.type === "financial_facts");
assert.deepEqual(financialTask.fields, ["revenue", "revenue_prior_year"]);
assert.equal(financialTask.comparison, "prior_year_same_duration");
const noExhibit = evidence.evidenceTasks({ ...report, secFilingDetails: { items: [{ receiptId: "exact-filing", indexUrl: filingUrl, eventExhibitStatus: "not_required" }] } }).tasks.find(task => task.type === "source_document");
assert.match(noExhibit.action, /no event exhibit is required/);

const fact = (val, start, end, filed) => ({ val, start, end, filed, form: "10-Q" });
const body = { cik: 1, facts: { "us-gaap": {
  Revenues: { units: { USD: [
    fact(120, "2026-04-01", "2026-06-30", "2026-08-10"),
    fact(300, "2025-01-01", "2025-06-30", "2026-08-10"),
    fact(100, "2025-04-01", "2025-06-30", "2026-08-10"),
    fact(999, "2025-04-01", "2025-06-30", "2026-12-01"),
  ] } },
  Assets: { units: { USD: [fact(500, undefined, "2026-06-30", "2026-08-10")] } },
  NetIncomeLoss: { units: { USD: [fact(30, "2026-04-01", "2026-06-30", "2026-08-10")] } },
} } };
let saved = null, requests = 0;
const cache = { read: async () => saved, write: async value => { saved = structuredClone(value); } };
const candidate = () => ({ ticker: "EXM", cik: "0000000001", eventFamily: "valuation_gap", eventObservedAt: "2026-09-18T11:00:00Z" });
const fetchFacts = async () => { requests++; return Response.json(body); };
await fundamentals.enrichCandidateFundamentals(candidate(), fetchFacts, now, cache);
assert.equal(requests, 1);
const compared = await fundamentals.enrichCandidateFundamentals(candidate(), fetchFacts, now, { ...cache, requiredMetrics: financialTask.fields });
assert.equal(requests, 2, "Latest-only cache must not satisfy the requested prior-year comparison");
const previous = compared.candidate.fundamentals.items.find(item => item.metric === "revenue_prior_year");
assert.equal(previous.value, 100, "Comparison must select the matching quarter, not year-to-date or a future filing");
assert.equal(previous.periodStart, "2025-04-01");
assert.equal(previous.periodEnd, "2025-06-30");
assert.equal(compared.candidate.fundamentals.items.find(item => item.metric === "revenue").value, 120);
await fundamentals.enrichCandidateFundamentals(candidate(), fetchFacts, new Date(now.getTime() + 60000), { ...cache, requiredMetrics: financialTask.fields });
assert.equal(requests, 2, "A verified complete comparison must be reused without another collection");
const absent = structuredClone(body);
absent.facts["us-gaap"].Revenues.units.USD = [body.facts["us-gaap"].Revenues.units.USD[0], body.facts["us-gaap"].Revenues.units.USD[1]];
const missing = await fundamentals.enrichCandidateFundamentals(candidate(), async () => Response.json(absent), now, { ...cache, read: async () => null, requiredMetrics: financialTask.fields });
assert.equal(missing.candidate.fundamentals.items.some(item => item.metric === "revenue_prior_year"), false, "An incompatible period cannot fabricate missing comparative evidence");
const twoCurrentMetrics = structuredClone(body);
delete twoCurrentMetrics.facts["us-gaap"].NetIncomeLoss;
const incomplete = await fundamentals.enrichCandidateFundamentals(candidate(), async () => Response.json(twoCurrentMetrics), now, { ...cache, read: async () => null, requiredMetrics: financialTask.fields });
assert.equal(incomplete.candidate.fundamentals.items.length, 3);
assert.equal(incomplete.candidate.fundamentals.available, false, "Two current metrics plus a prior-year comparison must not pass the three-current-metric gate");

const stored = new Map(); let revision = 0;
const persistedEvidence = loadTsModule("@/lib/opportunity-engine/pr262-research-evidence", {
  "@/lib/company-profile": { verifiedCompanyProfile: () => ({ company: "Example Corp" }) },
  "@/lib/opportunity-engine/company-profile-cache": { readCompanyProfiles: async () => new Map() },
  "@/lib/opportunity-engine/pr262-storage": { pr262StorageKey: key => `test/${key}` },
  "@/lib/r2-warehouse": {
    readVersionedTextFromR2: async key => stored.has(key) ? { found: true, text: JSON.stringify(stored.get(key).value), etag: stored.get(key).etag } : { found: false, text: null, etag: null },
    writeVersionedJsonToR2: async (key, value) => { stored.set(key, { value: structuredClone(value), etag: String(++revision) }); return { written: true }; },
  },
});
const event = { id: "comparison-pending", ticker: "EXM", cik: "0000000001", observedAt: now.toISOString() };
const fullCandidate = { ...report.selectedCandidate, company: "Example Corp", industry: "Application software", currency: "USD", valuationRange: { conservativeValue: 8, baseValue: 15, optimisticValue: 18 }, direction: "upside", eventFamily: "earnings", eventHeadline: "Quarterly update", quote: { price: 10, observedAt: now.toISOString(), actionableForSeriousSignal: true }, fundamentals: missing.candidate.fundamentals };
const firstReport = { ...report, selectedCandidate: fullCandidate, openAiCalled: true, candidateFingerprint: "reviewed-facts", status: "candidate_needs_more_data", tradingHaltSafety: { currentStateKnown: true }, committee: { agentsCompleted: 14, output: { overallRecommendation: "needs_more_data" } } };
await persistedEvidence.recordResearchEvidence({ event, report: firstReport, sourceDecisionGrade: true, sourceFailureReason: null, now });
assert.equal((await persistedEvidence.readEvidenceFollowup(event.id)).quality.fields.financialFacts, false);
const later = new Date(now.getTime() + 15 * 60000);
const unpaid = { ...firstReport, openAiCalled: false, status: "qualified_signal_openai_reservation_denied", blockers: ["Paid budget is unavailable."], committee: null, selectedCandidate: { ...fullCandidate, quote: { ...fullCandidate.quote, observedAt: later.toISOString() } } };
await persistedEvidence.recordResearchEvidence({ event, report: unpaid, sourceDecisionGrade: true, sourceFailureReason: null, now: later });
const stillMissing = await persistedEvidence.readEvidenceFollowup(event.id);
assert.equal(stillMissing.status, "collecting_evidence", "Three latest metrics cannot mark a requested comparison complete");
assert.equal(stillMissing.quality.fields.financialFacts, false);
assert.ok(stillMissing.tasks.find(task => task.type === "financial_facts").fields.includes("revenue_prior_year"), "Unpaid collection must retain the exact Committee request");
assert.equal(stillMissing.tasks.find(task => task.type === "market_evidence").previousObservationAt, later.toISOString(), "Followup details must refresh as new observations arrive");
await persistedEvidence.recordResearchEvidence({ event, report: { ...unpaid, selectedCandidate: { ...unpaid.selectedCandidate, fundamentals: compared.candidate.fundamentals } }, sourceDecisionGrade: true, sourceFailureReason: null, now: later });
assert.equal((await persistedEvidence.readEvidenceFollowup(event.id)).status, "awaiting_committee_capacity", "Only verified matching-period facts complete the comparison collection");
console.log("Exact evidence followups: filing/download distinction, precise quote fields, dated matching-period comparisons, and verified comparison cache reuse passed.");
