import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync(new URL("../lib/equity-signal/article-evidence.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const cjsModule = { exports: {} };
new Function("require", "module", "exports", output)((name) => { throw new Error(`Unexpected import: ${name}`); }, cjsModule, cjsModule.exports);
const { buildArticleEvidenceReport, articleEvidenceForCandidate } = cjsModule.exports;

const candidate = {
  ticker: "EXM",
  company: "Example Medical Inc",
  eventFamily: "regulatory_enforcement",
  relationship: "direct",
  eventHeadline: "Example Medical receives FDA clinical hold",
  whatHappened: "The FDA placed the lead programme on clinical hold after a safety signal.",
  eventObservedAt: "2026-07-29T06:00:00.000Z",
  causalChain: ["clinical hold", "development delay", "pipeline value impairment"],
  receipts: [{
    title: "FDA places Example Medical programme on clinical hold",
    summary: "Short feed summary.",
    url: "https://issuer.example/full-release",
    publisher: "Example Medical",
    primarySource: true,
    official: true,
  }],
};

const html = `<html><main><p>Example Medical announced that the FDA placed its lead programme on clinical hold.</p><p>The clinical hold followed a safety signal and delays development.</p><p>The company is reviewing the FDA request and the programme outlook.</p><p>Investors should consider the resulting pipeline value risk.</p></main></html>`;
const fetchImpl = async () => new Response(html, { status: 200, headers: { "content-type": "text/html" } });
const report = await buildArticleEvidenceReport({ candidates: [candidate], selectedCandidate: candidate, fetchImpl, maximumArticles: 2 });
const evidence = articleEvidenceForCandidate(report, candidate);
assert.equal(evidence.decisionGrade, true);
assert.equal(evidence.basis, "full_article");
assert.equal(evidence.supportedArticles, 1);
assert.equal(report.headlineAloneCanPromoteSeriousSignal, false);
assert.equal(report.maximumFullArticlesPerScan, 2);

const failedReport = await buildArticleEvidenceReport({
  candidates: [{ ...candidate, ticker: "NOPE", company: "Nope Corp", receipts: [{ ...candidate.receipts[0], url: "https://publisher.example/blocked" }] }],
  fetchImpl: async () => new Response("Unavailable", { status: 503 }),
  maximumArticles: 1,
});
assert.equal(Object.values(failedReport.candidates)[0].decisionGrade, false);
assert.equal(Object.values(failedReport.candidates)[0].basis, "headline_only_blocked");

console.log(JSON.stringify({ ok: true, fullArticleRequired: true, headlineOnlyBlocked: true, articleBudgetEnforced: true }, null, 2));
