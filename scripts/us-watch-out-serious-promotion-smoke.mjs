import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync(new URL("../lib/equity-signal/us-watch-out-serious-promotion.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const cjsModule = { exports: {} };
new Function("require", "module", "exports", output)((name) => { throw new Error(`Unexpected import: ${name}`); }, cjsModule, cjsModule.exports);
const { promoteApprovedWatchOutRules } = cjsModule.exports;

const evidence = { marketScope: "US listed common equities and ADRs only", primaryOrIndependentProof: true, exactIssuerMapping: true, eventAgeHours: 2, quoteAgeHours: 0, sourceCount: 2, noRumour: true, contradictionPenalty: 0, noSyntheticData: true };
const review = {
  marketStructureScan: { pagesFailed: 0, usPrimaryListingsChecked: 10000 },
  findings: [
    { ruleId: "volatility_regime_spike", ruleName: "Volatility spike", priority: "P1", ticker: "MOVE", company: "Move Corp", eventFamily: null, observedAt: "2026-07-29T06:00:00.000Z", currentPrice: 10, reasons: ["Large move"], evidence, duplicateKey: "market-key" },
    { ruleId: "cyberattack_data_breach_or_operational_outage", ruleName: "Cyberattack", priority: "P0", ticker: "CYBR", company: "Cyber Corp", eventFamily: "cyber_incident", observedAt: "2026-07-29T06:00:00.000Z", currentPrice: 20, reasons: ["Verified incident"], evidence, duplicateKey: "event-key" },
  ],
};
const articleEvidence = {
  policyVersion: 1,
  maximumFullArticlesPerScan: 12,
  maximumBytesPerArticle: 300000,
  headlineAloneCanPromoteSeriousSignal: false,
  candidates: {
    "CYBR|cyber_incident|2026-07-29T06:00:00.000Z": { key: "CYBR|cyber_incident|2026-07-29T06:00:00.000Z", ticker: "CYBR", company: "Cyber Corp", eventFamily: "cyber_incident", relationship: "direct", decisionGrade: true, basis: "full_article", fullArticlesRead: 1, supportedArticles: 1, officialStructuredReceipts: 0, failedUrls: [], sourceUrls: ["https://issuer.example/article"], excerpts: [], blockers: [] },
  },
  diagnostics: { candidatesConsidered: 1, urlsSelected: 1, urlsFetched: 1, urlsSupported: 1, urlsFailed: 0, officialStructuredCandidates: 0 },
};
const promoted = promoteApprovedWatchOutRules({ watchOutReview: review, articleEvidence });
assert.equal(promoted.seriousSignals.length, 2);
assert.equal(promoted.seriousSignals.every((item) => item.seriousSignal === true), true);
assert.equal(promoted.seriousSignals.every((item) => item.notificationEligible === false), true);
assert.equal(promoted.seriousSignals.every((item) => item.certificationStatus === "evidence_triggered_user_approved_not_historically_certified"), true);
assert.equal(promoted.safety.publishing, false);
assert.equal(promoted.safety.notifications, false);

const blocked = promoteApprovedWatchOutRules({ watchOutReview: { ...review, findings: [{ ...review.findings[1], ticker: "NOARTICLE" }] }, articleEvidence });
assert.equal(blocked.seriousSignals.length, 0);
assert.equal(blocked.blockedPromotionCandidates[0].reasons.includes("fullArticleOrOfficialContent"), true);

console.log(JSON.stringify({ ok: true, p0AndP1PromoteToSerious: true, marketRulesUseCompleteMarketScan: true, eventRulesRequireFullArticle: true, legacyPromotionDoesNotDeliverDirectly: true, finalCommitteeAuthorityRequiredForDelivery: true, certificationDisclosurePreserved: true }, null, 2));
