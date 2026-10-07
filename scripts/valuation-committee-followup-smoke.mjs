import { inSimpleAlertPilot } from "./helpers/simple-alert-pilot-fixture.mjs";
import { companyProfileFixture } from "./helpers/company-profile-fixture.mjs";
import assert from "node:assert/strict";
import { loadTsModule } from "./helpers/load-typescript-module.mjs";
const now = new Date("2026-09-16T15:00:00Z");
const analysis = { ticker: "TEST", company: "Test Software", industry: "Software", sector: "Technology", currency: "USD",
  observedAt: now.toISOString(), currentPrice: 50, fairValue: { conservativeValue: 95, baseValue: 100, optimisticValue: 105, methods: [{ method: "earnings_power", value: 95 }, { method: "owner_earnings_fcf", value: 105 }] },
  scores: { fairValueConfidence: 90, evidenceCompleteness: 90, businessQuality: 85, balanceSheet: 75, risk: 20 }, fundamentals: { revenue: 1000000000 }, decision: { action: "buy" } };
const receipt = { id: "valuation:TEST", title: "Test valuation review", summary: JSON.stringify(analysis), url: "https://www.tradingview.com/symbols/NASDAQ-TEST/", publisher: "TradingView company financials", publishedAt: now.toISOString(), channel: "market_price_sensor", official: false, primarySource: false, scheduled: false, symbolHints: ["TEST"], companyHints: ["Test Software"], rawEventType: "valuation_review" };
const provider = name => ({ provider: name, status: "connected", checkedAt: now.toISOString(), nextRetryAt: null, sourceUrls: [], receipts: [], recordsRead: 1, error: null, entitlementVerified: true, cached: false });
let invalidScope = false;
let roleCalls = 0, quoteReady = true, livePrice = 50, denyBudget = false, missingFacts = false, reservations = 0;
const promptCaptures = [];
const overrides = {
  "@/lib/ai-committee/provider": {
    modelForTier: () => "gpt-4.1-mini", getAiCommitteeProviderStatus: () => ({ configured: true, enabled: true, dryRunDefault: false }),
    runOpenAiCommitteeProvider: async input => {
      roleCalls++;
      assert.match(input.messages[0].content, /company-first valuation review/);
      const data = JSON.parse(input.messages[1].content);
      promptCaptures.push(data);
      assert.equal(data.evidencePack.analysisKind, "valuation");
      const companyProfile = data.evidencePack.evidenceSections.fundamentals.items.find(item => item.source === "verified_company_profile");
      assert.match(companyProfile.business, /inventory management software/);
      assert.match(companyProfile.customers, /retail stores/);
      assert.match(companyProfile.sourceUrl, /^https:\/\/www\.sec\.gov\/Archives\/edgar\/data\/1\//);
      assert.doesNotMatch(input.messages[0].content, /Require at least two genuinely independent/);
      if (data.agent.id !== "final_judge") assert.doesNotMatch(input.messages[0].content, /As Final Judge/);
      assert.match(data.decisionRules.discoveryProviderGap, /not required for valuation/);
      assert.equal(data.evidencePack.evidenceSections.fundamentals.items[0].source, "pr262_stored_company_analysis", "The valuation must reach the prompt instead of being sliced away behind three balance-sheet fields");
      return { ok: true, finishReason: "stop", model: "gpt-4.1-mini", content: JSON.stringify({ agentId: data.agent.id, verdict: "positive", confidence: 95, keyFindings: data.agent.id === "analyst_agent" ? ["Company: Test Software sells business software.", "What happened: Its price is below the model estimate.", "Why it matters: The estimate may be worth more than the market price.", "Possible outcome: The gap could close if the assumptions hold.", "Risks: Earnings could disappoint."] : [], supportingEvidence: [], concerns: [], missingData: invalidScope ? ["A new event-specific headline is required"] : [], followUpChecks: [], suggestedActionLabel: "Review valuation", riskNotes: [] }) };
    },
  },
  "@/lib/ai-committee/evidence-pack": { buildAiCommitteeEvidencePack: async () => { throw new Error("Unexpected DB read"); } },
  "@/lib/ai-committee/run-persistence": { persistAiCommitteeRun: async () => { throw new Error("Unexpected DB write"); } },
  "@/lib/equity-signal/event-sources": { collectEventSources: async () => { throw new Error("No broad feed required"); } },
  "@/lib/equity-signal/universe": { loadEquityUniverse: async () => { throw new Error("No universe rebuild required"); } },
  "@/lib/equity-signal/macro": { fetchMacroContext: async () => { throw new Error("No broad macro fetch required"); } },
  "@/lib/equity-signal/historical-bootstrap": { mergeHistoricalSignals: (...a) => a.flat(), bootstrapPublicHistoricalSignals: async () => { throw new Error("No history fetch required"); } },
  "@/lib/equity-signal/pilot-serious-signal-policy": { evaluateFiveCasePilotGate: () => ({ passed: false, blockers: ["No history"] }) },
  "@/lib/equity-signal/market": { enrichCandidateQuotes: async values => {
    for (const value of values) value.quote = { ticker: value.ticker, price: livePrice, previousClose: 50, changePercent: 0, volume: 10000, averageVolume: 10000, marketCap: 1000000000, observedAt: now.toISOString(), source: "test quote", delayedMinutes: 0, actionableForSeriousSignal: quoteReady, marketSession: "regular" };
    return { candidates: values, provider: provider("market_quote"), marketSnapshot: [], benchmarkQuote: null, benchmarkTicker: "SPY" };
  } },
};
const runner = loadTsModule("@/lib/equity-signal/runner", overrides);
const facts = { cik: 1, facts: { "us-gaap": Object.fromEntries(["Revenues", "NetIncomeLoss", "Assets", "CashAndCashEquivalentsAtCarryingValue"].map((name, i) => [name, { units: { USD: [{ val: 1000000 * (i + 1), start: "2025-01-01", end: "2025-12-31", filed: "2026-02-20", form: "10-K" }] } }])) } };
Object.assign(facts.facts["us-gaap"], Object.fromEntries([
  ["StockholdersEquity", "USD", 5000000], ["CommonStockSharesOutstanding", "shares", 1000000],
  ["EarningsPerShareDiluted", "USD/shares", 2], ["NetCashProvidedByUsedInOperatingActivities", "USD", 2000000],
  ["PaymentsToAcquirePropertyPlantAndEquipment", "USD", 100000],
].map(([concept, unit, val]) => [concept, { units: { [unit]: [{ val, start: "2025-01-01", end: "2025-12-31", filed: "2026-02-20", form: "10-K" }] } }])));
const input = { now, collectFinancialDocuments: async () => ({ version: 1, cik: "0000000001", checkedAt: now.toISOString(), nextCheckAt: now.toISOString(), cached: false, failures: [], documents: [{ url: "https://www.sec.gov/Archives/edgar/data/1/000000000126000001/annual.htm", form: "10-K", filedAt: "2026-02-20", digest: "test-financial-document", readComplete: true, excerpts: [{ topic: "segments", text: "Synthetic source-backed software segment facts" }, { topic: "customers", text: "Synthetic customer concentration facts" }, { topic: "margins", text: "Synthetic margin facts" }] }] }), resolveCompanyProfile: async identity => companyProfileFixture(identity, now), allowOpenAi: true, allowIncompleteCommitteeReview: true,
  beforeOpenAiCall: async () => { reservations++; return !denyBudget; },
  fetchImpl: async () => Response.json(missingFacts ? { cik: 1, facts: {} } : facts),
  targetedContext: { analysisKind: "valuation", universe: { entries: [{ ticker: "TEST", name: "Test Software", cik: "0000000001", aliases: [], exchange: "NASDAQ", securityType: "common_stock" }], coverage: {}, sources: [] },
    receipts: [receipt], providers: [provider("nasdaq_trade_halts")], historicalSignalsComplete: true, storedCompanyAnalysis: analysis, sourceEvidenceIncomplete: false } };
const approved = await runner.runEquitySignalLab(input);
assert.equal(approved.openAiCalled, true);
assert.equal(roleCalls, 4);
assert.equal(approved.seriousSignalFound, true, JSON.stringify(approved.blockers));
assert.equal(approved.selectedCandidate.eventFamily, "valuation_gap");
assert.match(approved.selectedCandidate.plainLanguageExplanation.companyDoes, /sells business software/);
quoteReady = false;
const stale = await runner.runEquitySignalLab(input);
assert.equal(roleCalls, 8);
assert.equal(stale.seriousSignalFound, false, "A dated price may support review but cannot create a Serious Signal");
quoteReady = true; missingFacts = true;
const incomplete = await runner.runEquitySignalLab(input);
assert.equal(roleCalls, 12);
assert.equal(incomplete.seriousSignalFound, false, "Positive AI votes cannot supply absent financial facts");
missingFacts = false; livePrice = 120;
const repriced = await runner.runEquitySignalLab(input);
assert.equal(repriced.seriousSignalFound, false, "A vanished valuation gap must not publish from the old foundation price");
assert.equal(roleCalls, 16);
livePrice = 50;
denyBudget = true; missingFacts = false;
const denied = await runner.runEquitySignalLab(input);
assert.equal(denied.openAiCalled, false);
assert.equal(roleCalls, 16);
assert.equal(reservations, 5);

const objects = new Map(); let revision = 0;
const storage = { readVersionedTextFromR2: async key => objects.has(key) ? { found: true, text: JSON.stringify(objects.get(key).value), etag: objects.get(key).etag } : { found: false, text: null, etag: null },
  writeVersionedJsonToR2: async (key, value, options = {}) => {
    const existing = objects.get(key);
    if ((options.createOnly && existing) || (options.expectedEtag && options.expectedEtag !== existing?.etag)) return { written: false, conflict: true };
    objects.set(key, { value: structuredClone(value), etag: String(++revision) }); return { written: true, conflict: false };
  } };
const evidence = loadTsModule("@/lib/opportunity-engine/pr262-research-evidence", { "@/lib/r2-warehouse": storage, "@/lib/opportunity-engine/pr262-storage": { pr262StorageKey: p => `test/${p}` } });
const event = { id: "valuation:TEST", ticker: "TEST", cik: "0000000001", observedAt: now.toISOString() };
const progress = await evidence.recordResearchEvidence({ event, report: stale, companyAnalysis: analysis, sourceDecisionGrade: true, sourceFailureReason: null, now });
assert.equal(progress.evidenceFollowupScheduled, true);
assert.equal(progress.nextEvidenceCheckAt, "2026-09-16T15:15:00.000Z");
const followup = await evidence.readEvidenceFollowup(event.id);
assert.equal(followup.paidReviewNotBefore, "2026-09-17T15:00:00.000Z");
assert.ok(followup.tasks.some(task => task.type === "market_evidence"));
const publicAlerts = await evidence.readResearchAlerts();
assert.equal(publicAlerts[0].userAlertEligible, true);
assert.equal(publicAlerts[0].committeeApproved, false);
assert.equal(publicAlerts[0].committeeStatus, "needs_more_data");
await evidence.recordResearchEvidence({ event, report: approved, approvedResultKey: "test/verified-result.json", companyAnalysis: analysis, sourceDecisionGrade: true, sourceFailureReason: null, now: new Date(now.getTime() + 3600000) });
assert.equal((await evidence.readResearchAlerts())[0].committeeApproved, true);
assert.equal((await evidence.readEvidenceFollowup(event.id)).status, "completed");
assert.equal((await evidence.readResearchAlerts()).length, 1, "Review updates replace the existing alert");
console.log("Valuation: real focused orchestration, no-news admission, financial/price publication gates, budget guard, explanations and durable evidence follow-up passed.");

const fundamentals = loadTsModule("@/lib/equity-signal/fundamentals");
const valuationHelpers = loadTsModule("@/lib/equity-signal/valuation-candidate");
let cached = null, requests = 0;
const cache = { read: async () => cached, write: async value => { cached = structuredClone(value); } };
const factFetch = async () => { requests++; return Response.json(facts); };
const freshCandidate = () => valuationHelpers.buildValuationCandidate(analysis, "0000000001", receipt, now);
await fundamentals.enrichCandidateFundamentals(freshCandidate(), factFetch, now, cache);
await fundamentals.enrichCandidateFundamentals(freshCandidate(), factFetch, new Date(now.getTime() + 60000), cache);
assert.equal(requests, 1, "Verified dated facts must be reused across collection attempts");
await fundamentals.enrichCandidateFundamentals(freshCandidate(), factFetch, new Date(now.getTime() + 120000), { ...cache, requiredMetrics: ["long_term_debt_noncurrent"] });
assert.equal(requests, 2, "A requested missing financial field must cause a fresh collection");
cached.cik = "0000000002";
await fundamentals.enrichCandidateFundamentals(freshCandidate(), factFetch, new Date(now.getTime() + 180000), cache);
assert.equal(requests, 3, "A different issuer's cache must never be reused");

let auditAdmitted = null;
for (let i = 0; i < 100 && !auditAdmitted; i++) auditAdmitted = await evidence.reserveRejectionAudit(`rejected-${i}`, now);
assert.ok(auditAdmitted);
assert.equal(await auditAdmitted.commit(now), true);
for (let i = 100; i < 130; i++) assert.equal(await evidence.reserveRejectionAudit(`rejected-${i}`, now), null, "False-negative audits must not exceed one paid reservation a day");

const unconfirmedCurrency = valuationHelpers.buildValuationCandidate({ ...analysis, currency: null }, "0000000001", receipt, now);
assert.equal(unconfirmedCurrency.gateChecks.valuationCurrencyConfirmed, false, "Unknown currency can be researched but cannot certify a price-to-value comparison");

const staleEventAlert = { kind: "event", createdAt: now.toISOString(), eventObservedAt: "2026-09-12T15:00:00Z" };
assert.equal(evidence.isResearchAlertCurrent(staleEventAlert, now.getTime()), false, "Retrying today cannot renew a four-day-old event");
assert.equal(evidence.isResearchAlertCurrent({ ...staleEventAlert, eventObservedAt: "2026-09-16T14:00:00Z" }, now.getTime()), true);
assert.equal(evidence.isResearchAlertCurrent({ kind: "valuation", createdAt: now.toISOString(), eventObservedAt: now.toISOString(), valuationObservedAt: "2026-09-15T14:59:00Z" }, now.getTime()), false, "A fresh retry cannot renew an expired valuation snapshot");
assert.equal(evidence.isResearchAlertCurrent({ kind: "valuation", valuationObservedAt: now.toISOString() }, now.getTime()), true);
assert.equal(evidence.isResearchAlertCurrent({ kind: "event", createdAt: now.toISOString() }, now.getTime()), false, "An update timestamp cannot substitute for missing evidence time");
assert.equal(evidence.isResearchAlertCurrent({ kind: "event", eventObservedAt: "2026-09-17T15:00:00Z" }, now.getTime()), false);

const legacyEvent = { ...event, id: "legacy-budget-blocked:TG" };
const legacyDeniedReport = { ...stale, openAiCalled: false, status: "qualified_signal_openai_reservation_denied", committee: null, blockers: ["The durable Committee budget denied this review."] };
const legacyPrior = { ...legacyDeniedReport, selectedCandidate: { ...stale.selectedCandidate, direction: "upside", fundamentals: { ...stale.selectedCandidate.fundamentals, available: true }, quote: { ...stale.selectedCandidate.quote, actionableForSeriousSignal: true } }, tradingHaltSafety: { currentStateKnown: true } };
await evidence.recordResearchEvidence({ event: legacyEvent, report: legacyPrior, companyAnalysis: analysis, sourceDecisionGrade: true, sourceFailureReason: null, now });
assert.equal((await evidence.readResearchAlerts()).find(row => row.eventId === legacyEvent.id).committeeStatus, "awaiting_review");
const legacyProgress = await evidence.recordResearchEvidence({ event: legacyEvent, report: legacyDeniedReport, companyAnalysis: analysis, sourceDecisionGrade: false, sourceFailureReason: "event_exhibit_not_found", now });
assert.equal(legacyProgress.evidenceFollowupScheduled, true, "Older incomplete cases must collect evidence even before another paid review");
assert.equal(legacyProgress.nextEvidenceCheckAt, "2026-09-16T15:15:00.000Z");
const legacyFollowup = await evidence.readEvidenceFollowup(legacyEvent.id);
assert.equal(legacyFollowup.status, "collecting_evidence");
assert.ok(legacyFollowup.tasks.some(task => task.type === "source_document"));
assert.ok(legacyFollowup.tasks.some(task => task.type === "market_evidence"));
assert.equal(legacyFollowup.paidReviewNotBefore, undefined, "Collection must not fabricate a paid review or reset its spending window");
const legacyAlert = (await evidence.readResearchAlerts()).find(row => row.eventId === legacyEvent.id);
assert.equal(legacyAlert.committeeStatus, "needs_more_data");
assert.equal(legacyAlert.committeeApproved, false);
const readyLegacy = await evidence.recordResearchEvidence({ event: legacyEvent, report: legacyPrior, companyAnalysis: analysis, sourceDecisionGrade: true, sourceFailureReason: null, now: new Date(now.getTime() + 15 * 60000) });
assert.equal(readyLegacy.evidenceFollowupScheduled, false, "Once all checks pass, paid capacity must not cause another evidence collection");
assert.equal((await evidence.readEvidenceFollowup(legacyEvent.id)).status, "awaiting_committee_capacity");
assert.equal((await evidence.readEvidenceFollowup(legacyEvent.id)).nextEvidenceCheckAt, null);
assert.equal((await evidence.readResearchAlerts()).find(row => row.eventId === legacyEvent.id).committeeStatus, "awaiting_review");
const missingAgain = await evidence.recordResearchEvidence({ event: legacyEvent, report: legacyDeniedReport, companyAnalysis: analysis, sourceDecisionGrade: false, sourceFailureReason: "event_exhibit_not_found", now: new Date(now.getTime() + 30 * 60000) });
assert.equal(missingAgain.evidenceFollowupScheduled, true, "New missing evidence must reopen collection without a paid review");
await evidence.recordResearchEvidence({ event: legacyEvent, report: legacyPrior, companyAnalysis: analysis, sourceDecisionGrade: true, sourceFailureReason: null, now: new Date(now.getTime() + 45 * 60000) });
assert.equal((await evidence.readEvidenceFollowup(legacyEvent.id)).status, "awaiting_committee_capacity");
const rejectedLegacy = await evidence.recordResearchEvidence({ event: legacyEvent, report: { ...legacyDeniedReport, committee: { output: { overallRecommendation: "reject" } } }, sourceDecisionGrade: false, sourceFailureReason: "event_exhibit_not_found", now });
assert.equal(rejectedLegacy.evidenceFollowupScheduled, false, "An explicit Committee rejection must not be converted into more paid work");
assert.equal((await evidence.readEvidenceFollowup(legacyEvent.id)).status, "rejected");

assert.equal((await evidence.readResearchAlerts()).find(row => row.eventId === legacyEvent.id).userAlertEligible, false, "Explicit rejection must override a previous awaiting-review card");

const held = await runner.runEquitySignalLab({ ...input, resolveCompanyProfile: async () => null });
assert.equal(held.status, "candidate_company_profile_pending");
assert.equal(held.openAiCalled, false);
await evidence.recordResearchEvidence({ event, report: { ...denied, openAiCalled: false, selectedCandidate: { ...approved.selectedCandidate, quote: { ...approved.selectedCandidate.quote, price: 60, observedAt: new Date(now.getTime() + 3600000).toISOString() } } }, companyAnalysis: analysis, sourceDecisionGrade: true, sourceFailureReason: null, now: new Date(now.getTime() + 3600000) });
assert.equal((await evidence.readResearchAlerts())[0].committeeApproved, false, "An unpaid refresh at a different quote invalidates the previous approval");

const riskBeforeCalls = roleCalls;
const trapped = await runner.runEquitySignalLab({ ...input, targetedContext: { ...input.targetedContext, storedCompanyAnalysis: { ...analysis, scores: { ...analysis.scores, risk: 85 } } } });
assert.equal(trapped.status, "candidate_valuation_risk_rejected");
assert.equal(trapped.openAiCalled, false);
assert.equal(roleCalls, riskBeforeCalls, "A known failing value-trap screen must not spend Committee budget");

await inSimpleAlertPilot(async () => {
  const identity = { ticker: "REKR", cik: "0001697851", company: "Rekor Systems, Inc." };
  const quarantinedEvent = { ...event, ...identity, id: "valuation:REKR:quarantined" };
  const quarantinedCandidate = { ...approved.selectedCandidate, ...identity, companyProfile: companyProfileFixture(identity, now) };
  const quarantinedReport = { ...approved, selectedCandidate: quarantinedCandidate };
  const quarantinedAnalysis = { ...analysis, ...identity };
  await evidence.recordResearchEvidence({ event: quarantinedEvent, report: quarantinedReport,
    approvedResultKey: "test/previously-approved-rekr.json", companyAnalysis: quarantinedAnalysis,
    sourceDecisionGrade: true, sourceFailureReason: null, now });
  let rows = await evidence.readResearchAlerts();
  let rekr = rows.find(row => row.eventId === quarantinedEvent.id);
  assert.equal(rekr.action, "price_watch");
  assert.equal(rekr.userAlertEligible, false);
  assert.equal(rekr.committeeApproved, false, "A supplied result pointer cannot override the cohort quarantine");
  assert.ok(rekr.sources.length > 0, "Monitoring retains the original source evidence");
  const stored = objects.get(evidence.RESEARCH_ALERT_INDEX_KEY).value.alerts.find(row => row.eventId === quarantinedEvent.id);
  assert.equal(stored.committeeApproved, false, "The persisted card is also held, not just its read projection");
  await evidence.recordResearchEvidence({ event: quarantinedEvent, report: { ...quarantinedReport, seriousSignalFound: false, openAiCalled: false },
    companyAnalysis: quarantinedAnalysis, sourceDecisionGrade: true, sourceFailureReason: null, now });
  rows = await evidence.readResearchAlerts();
  rekr = rows.find(row => row.eventId === quarantinedEvent.id);
  assert.equal(rekr.userAlertEligible, false, "An unpaid same-evidence refresh cannot restore eligibility");
  assert.equal(rekr.committeeApproved, false);
});
// Completed same-evidence reviews survive fresh scan IDs and small price changes.
denyBudget = false;
await evidence.recordResearchEvidence({ event, report: approved, approvedResultKey: "test/verified-result.json", companyAnalysis: analysis, sourceDecisionGrade: true, sourceFailureReason: null, now });
const previousValuationReview = await evidence.readLastValuationReview("0000000001");
assert.equal(previousValuationReview.outcome, "approved");
const callsBeforeUnchanged = roleCalls;
livePrice = 50.05;
const unchanged = await runner.runEquitySignalLab({ ...input, previousValuationReview,
  targetedContext: { ...input.targetedContext, receipts: [{ ...receipt, id: "valuation:TEST:next-scan", summary: JSON.stringify({ ...analysis, observedAt: now.toISOString() }) }] } });
assert.equal(unchanged.status, "qualified_candidate_already_reviewed", JSON.stringify({reason: unchanged.noSignalReason, blockers: unchanged.blockers, candidates: unchanged.rankedCandidates}));
assert.equal(unchanged.openAiCalled, false);
assert.equal(roleCalls, callsBeforeUnchanged, "An unchanged valuation review cannot spend again");
const changed = await runner.runEquitySignalLab({ ...input, previousValuationReview,
  targetedContext: { ...input.targetedContext, storedCompanyAnalysis: { ...analysis, fairValue: { ...analysis.fairValue, baseValue: 102 } } } });
assert.equal(changed.openAiCalled, true, "A changed model estimate may receive a new evidence review");
assert.notEqual(changed.candidateFingerprint, previousValuationReview.fingerprint);
livePrice = 50;
invalidScope = true;
const scopeMismatch = await runner.runEquitySignalLab(input);
assert.equal(scopeMismatch.seriousSignalFound, false);
assert.equal(scopeMismatch.reviewOutcome, "technical_failure");
assert.ok(scopeMismatch.committee.roleDiagnostics.some(role => role.error === "valuation_review_scope_mismatch"));
invalidScope = false;
console.log("Persisted unchanged-evidence deduplication, changed valuation admission and irrelevant event-demand rejection passed.");

// Historical debt can coexist with current general financial facts. A specific
// request for the current split must still reach every role as a blocking gap,
// even when all synthetic provider votes are positive.
const debtFacts = period => {
  const value = structuredClone(facts);
  for (const concept of ["Assets", "StockholdersEquity"]) value.facts["us-gaap"][concept].units.USD = [
    { val: 5000000, end: "2026-06-30", filed: "2026-08-06", form: "10-Q" },
  ];
  for (const concept of ["LongTermDebtCurrent", "LongTermDebtNoncurrent"]) value.facts["us-gaap"][concept] = {
    units: { USD: [{ val: 877000, end: period, filed: period === "2022-12-31" ? "2023-02-24" : "2026-08-06", form: "10-Q" }] },
  };
  return value;
};
const debtInput = { ...input, verifiedFactsCache: { requiredMetrics: ["long_term_debt_current", "long_term_debt_noncurrent"],
  read: async () => null, write: async () => {} } };
const startDebtPrompts = promptCaptures.length;
const staleDebt = await runner.runEquitySignalLab({ ...debtInput, fetchImpl: async () => Response.json(debtFacts("2022-12-31")) });
assert.equal(staleDebt.selectedCandidate.gateChecks.verifiedFinancialFacts, true, "The broad availability flag remains separate from requested debt completeness");
assert.equal(staleDebt.selectedCandidate.fundamentals.items.find(item => item.metric === "long_term_debt_current").periodEnd, "2022-12-31");
assert.equal(staleDebt.committee.output.overallRecommendation, "needs_more_data");
assert.equal(staleDebt.seriousSignalFound, false, "Positive synthetic votes cannot override a known current-debt evidence gap");
assert.equal(promptCaptures.length - startDebtPrompts, 4);
for (const prompt of promptCaptures.slice(startDebtPrompts)) {
  assert.ok(prompt.evidencePack.missingEvidence.some(gap => /current debt fact.*balance-sheet period/.test(gap)));
  assert.ok(prompt.evidencePack.missingEvidence.some(gap => /long-term debt fact.*balance-sheet period/.test(gap)));
}
const currentDebt = await runner.runEquitySignalLab({ ...debtInput, fetchImpl: async () => Response.json(debtFacts("2026-06-30")) });
assert.equal(currentDebt.committee.output.overallRecommendation, "approve");
assert.equal(currentDebt.seriousSignalFound, true, "Matching current debt removes only this gap; all existing synthetic approval controls still apply");
console.log("Requested debt reaches every real role prompt: old debt remains historical and cannot pass consensus; matching current-period debt clears only its evidence gap.");
// The completed-review baseline is a paid admission snapshot. Evidence refreshes
// and older completions must not replace it with a rolling quote comparison.
await evidence.recordResearchEvidence({ event, report: approved, companyAnalysis: analysis,
  sourceDecisionGrade: true, sourceFailureReason: null, now });
const paidMarker = await evidence.readLastValuationReview("0000000001");
assert.ok(paidMarker.valuationBaseline);
assert.equal(paidMarker.admittedAt, now.toISOString());
const jitterRefresh = { ...approved, openAiCalled: false, status: "qualified_signal_openai_reservation_denied", committee: null,
  candidateFingerprint: "valuation:0000000001:upside:new-penny-hash", selectedCandidate: { ...approved.selectedCandidate,
    valuationBaseline: { ...paidMarker.valuationBaseline, price: 50.01 }, valuationAdmittedAt: null } };
await evidence.recordResearchEvidence({ event, report: jitterRefresh, companyAnalysis: analysis,
  sourceDecisionGrade: true, sourceFailureReason: null, now: new Date(now.getTime() + 60000) });
assert.deepEqual(await evidence.readLastValuationReview("0000000001"), paidMarker, "Unpaid scans never advance the paid baseline or clock");
await evidence.recordResearchEvidence({ event, report: { ...approved, candidateFingerprint: "valuation:0000000001:upside:older-paid",
  selectedCandidate: { ...approved.selectedCandidate, valuationAdmittedAt: new Date(now.getTime() - 60000).toISOString() } },
  companyAnalysis: analysis, sourceDecisionGrade: true, sourceFailureReason: null,
  now: new Date(now.getTime() + 120000) });
assert.deepEqual(await evidence.readLastValuationReview("0000000001"), paidMarker, "Slow older completion cannot displace the newest admission");
const markerKey = "test/research-evidence/valuation-reviews/0000000001.json";
objects.set(markerKey, { etag: "legacy", value: { cik: "0000000001", fingerprint: "valuation:0000000001:upside:legacy", outcome: "rejected", reviewedAt: now.toISOString() } });
const legacyMarker = await evidence.readLastValuationReview("0000000001");
assert.equal(legacyMarker.reviewedAt, now.toISOString());
assert.equal(legacyMarker.admittedAt, null);
assert.equal(legacyMarker.valuationBaseline, undefined, "Migration cannot synthesize a paid baseline from today's scan");
objects.set(markerKey, { etag: "malformed", value: { cik: "0000000001" } });
await assert.rejects(() => evidence.readLastValuationReview("0000000001"), /valuation_review_marker_invalid/);
console.log("Paid marker snapshots, unpaid immutability, admission-time ordering and conservative legacy reads passed.");
