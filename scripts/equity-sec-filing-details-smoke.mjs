import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync(new URL("../lib/equity-signal/sec-filing-details.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  fileName: "sec-filing-details.ts",
}).outputText;
const loaded = { exports: {} };
new Function("require", "module", "exports", output)(() => { throw new Error("Unexpected runtime import."); }, loaded, loaded.exports);
const { enrichSecFilingDetails, SEC_FILING_TEXT_MAX_CHARS } = loaded.exports;

const now = new Date("2026-07-22T12:00:00.000Z");
function receipt(overrides) {
  return {
    id: "receipt",
    title: "Official filing",
    summary: "Official SEC filing receipt.",
    url: "https://www.sec.gov/Archives/edgar/data/1000001/000100000126000001/example-index.html",
    publisher: "U.S. Securities and Exchange Commission",
    publishedAt: "2026-07-22T11:00:00.000Z",
    channel: "sec_current_filings",
    official: true,
    primarySource: true,
    scheduled: false,
    symbolHints: ["EXM"],
    companyHints: ["Example Corp", "CIK0001000001"],
    rawEventType: "8-K",
    ...overrides,
  };
}

const malformed = receipt({
  id: "newest-malformed",
  rawEventType: "6-K",
  publishedAt: "2026-07-22T11:50:00.000Z",
  url: "https://www.sec.gov/Archives/edgar/data/1000002/000100000226000001/malformed-index.html",
});
const selected = receipt({ id: "second-valid", publishedAt: "2026-07-22T11:40:00.000Z" });
const overLimit = receipt({
  id: "third-over-limit",
  rawEventType: "10-Q",
  publishedAt: "2026-07-22T11:30:00.000Z",
  url: "https://www.sec.gov/Archives/edgar/data/1000003/000100000326000001/third-index.html",
});
const stale = receipt({
  id: "stale",
  publishedAt: "2026-07-19T11:00:00.000Z",
  url: "https://www.sec.gov/Archives/edgar/data/1000004/000100000426000001/stale-index.html",
});
const nonSec = receipt({ id: "non-sec", channel: "google_news_rss", official: false, url: "https://example.com/story" });
const scheduled = receipt({ id: "scheduled", scheduled: true });
const unsupported = receipt({ id: "form-4", rawEventType: "4" });

const primaryUrl = "https://www.sec.gov/Archives/edgar/data/1000001/000100000126000001/form8-k.htm";
const exhibitUrl = "https://www.sec.gov/Archives/edgar/data/1000001/000100000126000001/exhibit99.htm";
const indexHtml = `
  <table class="tableFile" summary="Document Format Files">
    <tr><td>2</td><td>EX-99.1</td><td><a href="${exhibitUrl}">exhibit99.htm</a></td><td>EX-99.1</td><td>120 KB</td></tr>
    <tr><td>1</td><td>FORM 8-K</td><td><a href="/ixviewer/doc/action?doc=/Archives/edgar/data/1000001/000100000126000001/form8-k.htm">form8-k.htm</a></td><td>8-K</td><td>480 KB</td></tr>
  </table>`;
const visibleFacts = "Material factual filing content. ".repeat(Math.ceil(SEC_FILING_TEXT_MAX_CHARS / 20) + 100);
const documentHtml = `<html><style>STYLE_SECRET_42</style><script>DOCUMENT_SECRET_42</script><body><h1>FORM 8-K</h1><p>${visibleFacts}</p></body></html>`;
const calls = [];
const fetchImpl = async (value, init = {}) => {
  const url = String(value);
  calls.push({ url, headers: init.headers, signal: init.signal });
  if (url === malformed.url) return new Response(`<html><script>MALFORMED_SECRET_42</script><body>No filing table</body></html>`, { status: 200, headers: { "content-type": "text/html" } });
  if (url === selected.url) return new Response(indexHtml, { status: 200, headers: { "content-type": "text/html" } });
  if (url === primaryUrl) return new Response(documentHtml, { status: 200, headers: { "content-type": "text/html" } });
  throw new Error(`Unexpected URL: ${url}`);
};

const result = await enrichSecFilingDetails([stale, overLimit, nonSec, selected, unsupported, malformed, scheduled], fetchImpl, now);

assert.deepEqual(result.diagnostics.selectedReceiptIds, ["newest-malformed", "second-valid"]);
assert.equal(result.diagnostics.eligible, 3);
assert.equal(result.diagnostics.selected, 2);
assert.equal(result.diagnostics.enriched, 1);
assert.equal(result.diagnostics.failed, 1);
assert.equal(result.diagnostics.skipped.run_limit, 1);
assert.equal(result.diagnostics.skipped.stale, 1);
assert.equal(result.diagnostics.skipped.non_sec, 1);
assert.equal(result.diagnostics.skipped.scheduled, 1);
assert.equal(result.diagnostics.skipped.unsupported_form, 1);
assert.equal(result.provider.status, "partial");
assert.equal(result.provider.recordsRead, 1);
assert.equal(result.details.length, 1);
assert.equal(result.details[0].receipt.id, selected.id);
assert.equal(result.details[0].receipt.title, selected.title);
assert.deepEqual(result.details[0].receipt.symbolHints, selected.symbolHints);
assert.deepEqual(result.details[0].receipt.companyHints, selected.companyHints);
assert.equal(result.details[0].primaryDocumentUrl, primaryUrl);
assert.equal(result.details[0].textLength, SEC_FILING_TEXT_MAX_CHARS);
assert.equal(result.details[0].truncated, true);
assert.match(result.details[0].text, /FORM 8-K/);
assert.equal(result.policy.directionInferencePerformed, false);
assert.equal(result.policy.factualContentOnly, true);
assert.equal(result.policy.databaseWrites, false);
assert.equal(result.policy.publishing, false);
assert.equal(result.policy.notifications, false);

assert.equal(calls.some((call) => call.url === exhibitUrl), false);
assert.equal(calls.some((call) => call.url === overLimit.url), false);
assert.equal(calls.some((call) => call.url === stale.url), false);
assert.equal(calls.some((call) => call.url === nonSec.url), false);
assert.equal(calls.length, 3);
for (const call of calls) {
  assert.equal(call.headers["user-agent"], "SwingUp/1.0 support@swingup.app");
  assert.ok(call.signal instanceof AbortSignal);
}

const serialized = JSON.stringify(result);
assert.doesNotMatch(serialized, /STYLE_SECRET_42|DOCUMENT_SECRET_42|MALFORMED_SECRET_42/);
assert.equal(result.diagnostics.items.find((item) => item.receiptId === malformed.id)?.errorCategory, "primary_document_not_found");
assert.equal(result.diagnostics.items.find((item) => item.receiptId === selected.id)?.status, "enriched");

console.log(JSON.stringify({
  ok: true,
  newestTwoSelected: true,
  primaryDocumentSelected: true,
  factualTextCapped: true,
  staleAndNonSecSkipped: true,
  malformedIndexIsolated: true,
  secretsExcluded: true,
  directionInferencePerformed: false,
}, null, 2));
