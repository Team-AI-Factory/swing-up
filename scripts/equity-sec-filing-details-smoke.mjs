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
const {
  enrichSecFilingDetails,
  resetSecFilingDetailStateForTest,
  SEC_FILING_DETAIL_GRANT_CONTEXT,
  SEC_FILING_TEXT_MAX_CHARS,
  SEC_FILING_ANALYSIS_TEXT_MAX_CHARS,
} = loaded.exports;

const now = new Date("2026-07-22T12:00:00.000Z");

function receipt(overrides = {}) {
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

function filingIndexHtml(form, primaryUrl, exhibits = []) {
  return `
    <table class="tableFile" summary="Document Format Files">
      ${exhibits.map(({ url, type, sequence, description }) => `
        <tr><td>${sequence}</td><td>${description ?? type}</td><td><a href="${url}">${url.split("/").at(-1)}</a></td><td>${type}</td><td>120 KB</td></tr>
      `).join("")}
      <tr><td>1</td><td>FORM ${form}</td><td><a href="${primaryUrl}">${primaryUrl.split("/").at(-1)}</a></td><td>${form}</td><td>480 KB</td></tr>
    </table>`;
}

function sorted(values) {
  return [...values].sort();
}

// Core behavior: two new filings per run, duplicate accessions collapse, an
// explicitly referenced EX-99.2 wins over EX-99.1, and the event exhibit is
// guaranteed to remain inside the classifier's first analysis window.
resetSecFilingDetailStateForTest();
const offering = receipt({
  id: "offering-424b5",
  rawEventType: "424B5",
  publishedAt: "2026-07-22T11:58:00.000Z",
  url: "https://www.sec.gov/Archives/edgar/data/1000005/000100000526000001/offering-index.html",
});
const duplicateOfferingRow = receipt({
  ...offering,
  id: "offering-424b5-co-registrant-row",
  title: "Duplicate Atom row for the same accession",
  url: "https://www.sec.gov/Archives/edgar/data/9999999/000100000526000001/offering-index.html",
});
const eightK = receipt({
  id: "material-8k",
  rawEventType: "8-K",
  publishedAt: "2026-07-22T11:57:00.000Z",
  url: "https://www.sec.gov/Archives/edgar/data/1000001/000100000126000001/example-index.html",
});
const malformedSixK = receipt({
  id: "malformed-6k",
  rawEventType: "6-K",
  publishedAt: "2026-07-22T11:56:00.000Z",
  url: "https://www.sec.gov/Archives/edgar/data/1000002/000100000226000001/malformed-index.html",
});
const tenQ = receipt({
  id: "queued-10q",
  rawEventType: "10-Q",
  publishedAt: "2026-07-22T11:55:00.000Z",
  url: "https://www.sec.gov/Archives/edgar/data/1000003/000100000326000001/quarterly-index.html",
});
const tenK = receipt({
  id: "later-10k",
  rawEventType: "10-K",
  publishedAt: "2026-07-22T11:54:00.000Z",
  url: "https://www.sec.gov/Archives/edgar/data/1000006/000100000626000001/annual-index.html",
});
const stale = receipt({
  id: "stale",
  publishedAt: "2026-07-19T11:00:00.000Z",
  url: "https://www.sec.gov/Archives/edgar/data/1000004/000100000426000001/stale-index.html",
});
const nonSec = receipt({ id: "non-sec", channel: "google_news_rss", official: false, url: "https://example.com/story" });
const scheduled = receipt({ id: "scheduled", scheduled: true });
const unsupported = receipt({ id: "form-4", rawEventType: "4" });

const primaryUrls = new Map([
  [offering.url, "https://www.sec.gov/Archives/edgar/data/1000005/000100000526000001/prospectus.htm"],
  [eightK.url, "https://www.sec.gov/Archives/edgar/data/1000001/000100000126000001/form8-k.htm"],
  [tenQ.url, "https://www.sec.gov/Archives/edgar/data/1000003/000100000326000001/form10-q.htm"],
  [tenK.url, "https://www.sec.gov/Archives/edgar/data/1000006/000100000626000001/form10-k.htm"],
]);
const forms = new Map([
  [offering.url, "424B5"],
  [eightK.url, "8-K"],
  [tenQ.url, "10-Q"],
  [tenK.url, "10-K"],
]);
const eightKExhibit991 = "https://www.sec.gov/Archives/edgar/data/1000001/000100000126000001/exhibit99-1.htm";
const eightKExhibit992 = "https://www.sec.gov/Archives/edgar/data/1000001/000100000126000001/exhibit99-2.htm";
const longPrimary = `
  <html><body>
    <p>Exhibit 99.2 is furnished and incorporated by reference.</p>
    <p>LONG_PRIMARY_CONTEXT ${"primary inline-XBRL boilerplate ".repeat(5_000)}</p>
  </body></html>`;
const eventExhibit = `
  <html>
    <style>STYLE_SECRET_42</style>
    <script>DOCUMENT_SECRET_42</script>
    <body><h1>EXHIBIT_992_EVENT_FACT</h1><p>${"Time-sensitive factual event detail. ".repeat(700)}</p></body>
  </html>`;
const documentBodies = new Map([
  [primaryUrls.get(offering.url), "<html><body><h1>424B5</h1><p>Public offering priced.</p></body></html>"],
  [primaryUrls.get(eightK.url), longPrimary],
  [eightKExhibit991, "<html><body><p>UNREFERENCED_991_FACT</p></body></html>"],
  [eightKExhibit992, eventExhibit],
  [primaryUrls.get(tenQ.url), "<html><body><h1>FORM 10-Q</h1><p>Quarterly facts.</p></body></html>"],
  [primaryUrls.get(tenK.url), "<html><body><h1>FORM 10-K</h1><p>Annual facts.</p></body></html>"],
]);
const calls = [];
const accessReservationBatches = [];
const accessSequence = [];
let inFlight = 0;
let maximumInFlight = 0;
const fetchImpl = async (value, init = {}) => {
  const url = String(value);
  accessSequence.push(`fetch:${url}`);
  calls.push({
    url,
    headers: init.headers,
    signal: init.signal,
    grantKey: init[SEC_FILING_DETAIL_GRANT_CONTEXT] ?? null,
  });
  inFlight += 1;
  maximumInFlight = Math.max(maximumInFlight, inFlight);
  await Promise.resolve();
  try {
    if (url === malformedSixK.url) {
      return new Response("<html><body>No filing table</body></html>", { status: 200, headers: { "content-type": "text/html" } });
    }
    if (primaryUrls.has(url)) {
      const exhibits = url === eightK.url
        ? [
            { url: eightKExhibit991, type: "EX-99.1", sequence: "2", description: "PRESS RELEASE" },
            { url: eightKExhibit992, type: "EX-99.2", sequence: "3", description: "OTHER EVENT EXHIBIT" },
          ]
        : [];
      const primaryLink = url === eightK.url
        ? `/ix?doc=${new URL(primaryUrls.get(url)).pathname}`
        : primaryUrls.get(url);
      return new Response(filingIndexHtml(forms.get(url), primaryLink, exhibits), {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }
    if (documentBodies.has(url)) {
      return new Response(documentBodies.get(url), { status: 200, headers: { "content-type": "text/html" } });
    }
    throw new Error(`Unexpected URL: ${url}`);
  } finally {
    inFlight -= 1;
  }
};

const first = await enrichSecFilingDetails(
  [stale, tenQ, nonSec, eightK, unsupported, malformedSixK, scheduled, duplicateOfferingRow, offering],
  fetchImpl,
  now,
  async (requests) => {
    accessSequence.push("reserve");
    accessReservationBatches.push(structuredClone(requests));
    return requests.map(() => ({ allowed: true, nextRetryAt: null, reason: "reserved" }));
  },
);
assert.deepEqual(first.diagnostics.selectedReceiptIds, [offering.id, eightK.id]);
assert.equal(first.diagnostics.received, 9);
assert.equal(first.diagnostics.currentEligible, 4);
assert.equal(first.diagnostics.eligible, 4);
assert.equal(first.diagnostics.carriedForwardEligible, 0);
assert.equal(first.diagnostics.selected, 2);
assert.equal(first.diagnostics.newlyFetched, 2);
assert.equal(first.diagnostics.reusedFromCache, 0);
assert.equal(first.diagnostics.skipped.run_limit, 2);
assert.equal(first.diagnostics.skipped.stale, 1);
assert.equal(first.diagnostics.skipped.non_sec, 1);
assert.equal(first.diagnostics.skipped.scheduled, 1);
assert.equal(first.diagnostics.skipped.unsupported_form, 1);
assert.equal(first.diagnostics.skipped.duplicate_accession, 1);
assert.equal(first.diagnostics.backlog.count, 2);
assert.equal(first.diagnostics.backlog.byForm["6-K"], 1);
assert.equal(first.diagnostics.backlog.byForm["10-Q"], 1);
assert.equal(first.diagnostics.backlog.oldestPublishedAt, tenQ.publishedAt);
assert.equal(first.provider.status, "connected");
assert.equal(first.provider.cached, false);
assert.deepEqual(first.policy.priorityOrder, ["424B5", "8-K", "6-K", "424B3", "10-Q", "10-K"]);
assert.equal(first.policy.fairFormRotation, true);
assert.equal(first.policy.freshTimeSensitiveSlot, true);
assert.deepEqual(first.policy.freshPriorityForms, ["424B5", "8-K", "6-K", "424B3"]);
assert.equal(first.policy.freshPriorityWindowMinutes, 15);
assert.equal(first.policy.maximumQueuedFilings, 1_000);
assert.equal(first.policy.maximumCachedReplayPerRun, 24);
assert.equal(first.policy.maximumFilingsPerRun, 2);
assert.equal(first.policy.maximumNewFilingsPerRun, 2);
assert.equal(first.policy.serializedRequests, true);
assert.equal(first.policy.maximumRequestsPerNewAccession, 3);
assert.equal(first.policy.cachedReplayBehavior, "restores_one_accession_receipt_without_duplicate_evidence");
assert.equal(calls.length, 5);
assert.equal(maximumInFlight, 1);
assert.equal(accessSequence[0], "reserve");
assert.equal(accessReservationBatches.length, 1);
assert.equal(accessReservationBatches[0].length, 2);
assert.equal(accessReservationBatches[0].every((request) => request.maximumRequests === 3), true);
assert.deepEqual(
  sorted(accessReservationBatches[0].map((request) => request.filingKey)),
  sorted([...new Set(calls.map((call) => call.grantKey))]),
);
assert.deepEqual(
  [...new Set(calls.map((call) => call.grantKey).filter(Boolean))]
    .map((grantKey) => calls.filter((call) => call.grantKey === grantKey).length)
    .sort(),
  [2, 3],
);

const eightKDetail = first.details.find((detail) => detail.receipt.id === eightK.id);
const eightKDiagnostic = first.diagnostics.items.find((item) => item.receiptId === eightK.id);
assert.ok(eightKDetail);
assert.equal(eightKDetail.exhibitDocumentUrl, eightKExhibit992);
assert.equal(eightKDetail.exhibitDocumentType, "EX-99.2");
assert.equal(eightKDetail.documentsFetched, 2);
assert.equal(eightKDiagnostic?.status, "enriched");
assert.equal(calls.filter((call) => call.url === eightKExhibit992).length, 1);
assert.equal(calls.some((call) => call.url === eightKExhibit991), false);
assert.equal(calls.some((call) => call.url.includes("/ix?doc=")), false);
assert.equal(calls.some((call) => call.url === primaryUrls.get(eightK.url)), true);
const analysisWindow = eightKDetail.text.slice(0, SEC_FILING_ANALYSIS_TEXT_MAX_CHARS);
assert.match(analysisWindow, /EXHIBIT_992_EVENT_FACT/);
assert.doesNotMatch(analysisWindow, /LONG_PRIMARY_CONTEXT/);
assert.match(eightKDetail.text, /LONG_PRIMARY_CONTEXT/);
assert.equal(eightKDetail.textLength, SEC_FILING_TEXT_MAX_CHARS);
assert.equal(eightKDetail.truncated, true);
assert.doesNotMatch(eightKDetail.text, /STYLE_SECRET_42|DOCUMENT_SECRET_42/);
assert.ok(first.provider.sourceUrls.includes(eightKExhibit992));

// Cached successes add no network calls. The queue survives a provider
// snapshot that omits prior rows, and both remaining accessions advance.
const second = await enrichSecFilingDetails(
  [eightK, malformedSixK, unsupported],
  fetchImpl,
  new Date(now.getTime() + 5 * 60_000),
);
assert.deepEqual(second.diagnostics.selectedReceiptIds, [malformedSixK.id, tenQ.id]);
assert.deepEqual(sorted(second.diagnostics.cachedReceiptIds), sorted([offering.id, eightK.id]));
assert.equal(second.diagnostics.currentEligible, 2);
assert.equal(second.diagnostics.eligible, 4);
assert.equal(second.diagnostics.carriedForwardEligible, 2);
assert.equal(second.diagnostics.reusedFromCache, 2);
assert.equal(second.diagnostics.newlyFetched, 1);
assert.equal(second.diagnostics.failed, 1);
assert.equal(second.provider.status, "partial");
assert.equal(second.diagnostics.items.find((item) => item.receiptId === malformedSixK.id)?.errorCategory, "primary_document_not_found");
assert.equal(second.diagnostics.backlog.failureCooldownCount, 1);
assert.equal(calls.length, 8);

// A failed accession is skipped during its bounded cooldown, allowing a newly
// arrived filing to advance instead.
const third = await enrichSecFilingDetails([tenK], fetchImpl, new Date(now.getTime() + 10 * 60_000));
assert.deepEqual(third.diagnostics.failureCooldownReceiptIds, [malformedSixK.id]);
assert.deepEqual(third.diagnostics.selectedReceiptIds, [tenK.id]);
assert.equal(third.diagnostics.skipped.failure_cooldown, 1);
assert.equal(third.diagnostics.newlyFetched, 1);
assert.equal(third.diagnostics.failed, 0);
assert.equal(third.diagnostics.backlog.failureCooldownCount, 1);
assert.equal(calls.length, 10);

// The failed accession becomes eligible again once the one-hour cooldown
// expires, rather than remaining poisoned permanently.
const afterCooldown = await enrichSecFilingDetails([], fetchImpl, new Date(now.getTime() + 75 * 60_000));
assert.deepEqual(afterCooldown.diagnostics.selectedReceiptIds, [malformedSixK.id]);
assert.equal(afterCooldown.diagnostics.failureCooldownReceiptIds.length, 0);
assert.equal(afterCooldown.diagnostics.failed, 1);
assert.equal(calls.length, 11);

for (const call of calls) {
  assert.equal(call.headers["user-agent"], "SwingUp/1.0 support@swingup.app");
  assert.ok(call.signal instanceof AbortSignal);
}
assert.equal(calls.some((call) => call.url === stale.url), false);
assert.equal(calls.some((call) => call.url === nonSec.url), false);
assert.equal(first.policy.directionInferencePerformed, false);
assert.equal(first.policy.factualContentOnly, true);
assert.equal(first.policy.databaseWrites, false);
assert.equal(first.policy.publishing, false);
assert.equal(first.policy.notifications, false);

// A referenced exhibit that is absent from the filing table leaves the factual
// primary document available, but explicitly marks the evidence as partial.
resetSecFilingDetailStateForTest();
const missingExhibitReceipt = receipt({
  id: "missing-referenced-exhibit",
  rawEventType: "8-K",
  publishedAt: "2026-07-22T11:59:00.000Z",
  url: "https://www.sec.gov/Archives/edgar/data/3000001/000300000126000001/missing-index.html",
});
const missingPrimary = "https://www.sec.gov/Archives/edgar/data/3000001/000300000126000001/form8-k.htm";
const unrelated991 = "https://www.sec.gov/Archives/edgar/data/3000001/000300000126000001/unrelated99-1.htm";
const missingCalls = [];
const missingFetch = async (value) => {
  const url = String(value);
  missingCalls.push(url);
  if (url === missingExhibitReceipt.url) {
    return new Response(filingIndexHtml("8-K", missingPrimary, [
      { url: unrelated991, type: "EX-99.1", sequence: "2", description: "UNRELATED EXHIBIT" },
    ]), { status: 200, headers: { "content-type": "text/html" } });
  }
  if (url === missingPrimary) {
    return new Response(
      "<html><body><p>Exhibit 99.2 is furnished and incorporated by reference.</p><p>PRIMARY_PARTIAL_FACT remains available.</p></body></html>",
      { status: 200, headers: { "content-type": "text/html" } },
    );
  }
  throw new Error(`Unexpected missing-exhibit URL: ${url}`);
};
const missingResult = await enrichSecFilingDetails([missingExhibitReceipt], missingFetch, now);
const missingDetail = missingResult.details.find((detail) => detail.receipt.id === missingExhibitReceipt.id);
const missingDiagnostic = missingResult.diagnostics.items.find((item) => item.receiptId === missingExhibitReceipt.id);
assert.equal(missingResult.provider.status, "partial");
assert.equal(missingResult.provider.error, "some_selected_filings_incomplete");
assert.equal(missingResult.diagnostics.incomplete, 1);
assert.equal(missingResult.diagnostics.failed, 0);
assert.equal(missingResult.diagnostics.backlog.failureCooldownCount, 0);
assert.equal(missingResult.diagnostics.backlog.retryDeferredCount, 1);
assert.equal(missingDiagnostic?.status, "partial");
assert.equal(missingDiagnostic?.errorCategory, "event_exhibit_not_found");
assert.equal(missingDiagnostic?.eventExhibitMissing, true);
assert.equal(missingDetail?.eventExhibitMissing, true);
assert.equal(missingDetail?.documentsFetched, 1);
assert.equal(missingDetail?.exhibitDocumentUrl, null);
assert.match(missingDetail?.text, /PRIMARY_PARTIAL_FACT/);
assert.equal(missingCalls.includes(unrelated991), false);
assert.equal(missingResult.policy.partialRetryMinutes, 60);

// Two cached partials stay visible without consuming either of the two fetch
// slots. Sustained fresh pairs therefore advance every five-minute cycle, and
// the partial accessions become selectable again only at their one-hour retry.
resetSecFilingDetailStateForTest();
const partialA = receipt({
  id: "sustained-partial-a",
  rawEventType: "8-K",
  publishedAt: "2026-07-22T11:59:00.000Z",
  url: "https://www.sec.gov/Archives/edgar/data/3500001/000350000126000001/partial-a-index.html",
});
const partialB = receipt({
  id: "sustained-partial-b",
  rawEventType: "8-K",
  publishedAt: "2026-07-22T11:58:00.000Z",
  url: "https://www.sec.gov/Archives/edgar/data/3500002/000350000226000001/partial-b-index.html",
});
function freshPartialLaneReceipt(id, publishedAt, accession) {
  return receipt({
    id,
    rawEventType: "424B5",
    publishedAt,
    url: `https://www.sec.gov/Archives/edgar/data/3500010/${accession}/${id}-index.html`,
  });
}
const freshPartialLaneA = freshPartialLaneReceipt("partial-lane-fresh-a", "2026-07-22T12:05:00.000Z", "000350001026000001");
const freshPartialLaneB = freshPartialLaneReceipt("partial-lane-fresh-b", "2026-07-22T12:04:00.000Z", "000350001026000002");
const freshPartialLaneC = freshPartialLaneReceipt("partial-lane-fresh-c", "2026-07-22T12:10:00.000Z", "000350001026000003");
const freshPartialLaneD = freshPartialLaneReceipt("partial-lane-fresh-d", "2026-07-22T12:09:00.000Z", "000350001026000004");
const sustainedPartialPrimaryUrls = new Map([
  [partialA.url, partialA.url.replace("-index.html", ".htm")],
  [partialB.url, partialB.url.replace("-index.html", ".htm")],
  [freshPartialLaneA.url, freshPartialLaneA.url.replace("-index.html", ".htm")],
  [freshPartialLaneB.url, freshPartialLaneB.url.replace("-index.html", ".htm")],
  [freshPartialLaneC.url, freshPartialLaneC.url.replace("-index.html", ".htm")],
  [freshPartialLaneD.url, freshPartialLaneD.url.replace("-index.html", ".htm")],
]);
const sustainedPartialCalls = [];
const sustainedPartialFetch = async (value) => {
  const url = String(value);
  sustainedPartialCalls.push(url);
  if (sustainedPartialPrimaryUrls.has(url)) {
    const isPartial = url === partialA.url || url === partialB.url;
    return new Response(
      filingIndexHtml(isPartial ? "8-K" : "424B5", sustainedPartialPrimaryUrls.get(url)),
      { status: 200, headers: { "content-type": "text/html" } },
    );
  }
  const indexEntry = [...sustainedPartialPrimaryUrls].find(([, primaryUrl]) => primaryUrl === url);
  if (indexEntry) {
    const [indexUrl] = indexEntry;
    const isPartial = indexUrl === partialA.url || indexUrl === partialB.url;
    return new Response(
      isPartial
        ? "<html><body><p>Exhibit 99.2 is furnished and incorporated by reference.</p><p>SUSTAINED_PARTIAL_PRIMARY_FACT</p></body></html>"
        : "<html><body><p>Fresh factual offering content.</p></body></html>",
      { status: 200, headers: { "content-type": "text/html" } },
    );
  }
  throw new Error(`Unexpected sustained-partial URL: ${url}`);
};
function assertVisiblePartialReplay(result, expectedFreshIds) {
  assert.deepEqual(sorted(result.diagnostics.selectedReceiptIds), sorted(expectedFreshIds));
  assert.deepEqual(sorted(result.diagnostics.retryDeferredReceiptIds), sorted([partialA.id, partialB.id]));
  assert.equal(result.diagnostics.skipped.retry_not_due, 2);
  assert.equal(result.diagnostics.selected, 2);
  assert.equal(result.diagnostics.newlyFetched, 2);
  assert.equal(result.diagnostics.incomplete, 2);
  assert.equal(result.diagnostics.backlog.retryDeferredCount, 2);
  for (const partial of [partialA, partialB]) {
    const detail = result.details.find((candidate) => candidate.receipt.id === partial.id);
    const diagnostic = result.diagnostics.items.find((candidate) => candidate.receiptId === partial.id);
    assert.equal(detail?.eventExhibitMissing, true);
    assert.match(detail?.text, /SUSTAINED_PARTIAL_PRIMARY_FACT/);
    assert.equal(diagnostic?.status, "partial");
    assert.equal(diagnostic?.errorCategory, "event_exhibit_not_found");
  }
}
const sustainedPartialFirst = await enrichSecFilingDetails([partialA, partialB], sustainedPartialFetch, now);
assert.deepEqual(sustainedPartialFirst.diagnostics.selectedReceiptIds, [partialA.id, partialB.id]);
assert.equal(sustainedPartialFirst.diagnostics.incomplete, 2);
assert.equal(sustainedPartialFirst.diagnostics.newlyFetched, 2);
assert.equal(sustainedPartialFirst.diagnostics.backlog.retryDeferredCount, 2);
const partialCallsAfterFirst = new Map([
  [partialA.id, sustainedPartialCalls.filter((url) => url === partialA.url || url === sustainedPartialPrimaryUrls.get(partialA.url)).length],
  [partialB.id, sustainedPartialCalls.filter((url) => url === partialB.url || url === sustainedPartialPrimaryUrls.get(partialB.url)).length],
]);

const sustainedPartialSecond = await enrichSecFilingDetails(
  [freshPartialLaneA, freshPartialLaneB],
  sustainedPartialFetch,
  new Date(now.getTime() + 5 * 60_000),
);
assertVisiblePartialReplay(sustainedPartialSecond, [freshPartialLaneA.id, freshPartialLaneB.id]);
assert.equal(sustainedPartialSecond.diagnostics.reusedFromCache, 2);

const sustainedPartialThird = await enrichSecFilingDetails(
  [freshPartialLaneC, freshPartialLaneD],
  sustainedPartialFetch,
  new Date(now.getTime() + 10 * 60_000),
);
assertVisiblePartialReplay(sustainedPartialThird, [freshPartialLaneC.id, freshPartialLaneD.id]);
assert.equal(sustainedPartialThird.diagnostics.reusedFromCache, 4);
for (const partial of [partialA, partialB]) {
  const callsForPartial = sustainedPartialCalls.filter(
    (url) => url === partial.url || url === sustainedPartialPrimaryUrls.get(partial.url),
  ).length;
  assert.equal(callsForPartial, partialCallsAfterFirst.get(partial.id));
}

const sustainedPartialDue = await enrichSecFilingDetails(
  [],
  sustainedPartialFetch,
  new Date(now.getTime() + 60 * 60_000),
);
assert.deepEqual(sorted(sustainedPartialDue.diagnostics.selectedReceiptIds), sorted([partialA.id, partialB.id]));
assert.deepEqual(sustainedPartialDue.diagnostics.retryDeferredReceiptIds, []);
assert.equal(sustainedPartialDue.diagnostics.skipped.retry_not_due, 0);
assert.equal(sustainedPartialDue.diagnostics.selected, 2);
assert.equal(sustainedPartialDue.diagnostics.newlyFetched, 2);
assert.equal(sustainedPartialDue.diagnostics.incomplete, 2);
assert.equal(sustainedPartialDue.diagnostics.backlog.retryDeferredCount, 2);
for (const partial of [partialA, partialB]) {
  const callsForPartial = sustainedPartialCalls.filter(
    (url) => url === partial.url || url === sustainedPartialPrimaryUrls.get(partial.url),
  ).length;
  assert.equal(callsForPartial, (partialCallsAfterFirst.get(partial.id) ?? 0) + 2);
}

// Provider-budget and cadence denials are deferrals, not ordinary failures.
// They must not enter the ordinary failure cache or retry every five minutes.
// They become selectable again only when the explicit one-hour retry is due.
resetSecFilingDetailStateForTest();
const budgetReceipt = receipt({
  id: "provider-budget",
  rawEventType: "424B5",
  publishedAt: "2026-07-22T11:59:00.000Z",
  url: "https://sec.gov/Archives/edgar/data/4000001/000400000126000001/budget-index.html",
});
const cadenceReceipt = receipt({
  id: "cadence-denial",
  rawEventType: "8-K",
  publishedAt: "2026-07-22T11:58:00.000Z",
  url: "https://www.sec.gov/Archives/edgar/data/4000002/000400000226000001/cadence-index.html",
});
const canonicalBudgetIndex = budgetReceipt.url.replace("https://sec.gov/", "https://www.sec.gov/");
const budgetPrimary = "https://www.sec.gov/Archives/edgar/data/4000001/000400000126000001/prospectus.htm";
const cadencePrimary = "https://www.sec.gov/Archives/edgar/data/4000002/000400000226000001/form8-k.htm";
const retryAttempts = new Map();
const retryCalls = [];
const retryFetch = async (value) => {
  const url = String(value);
  retryCalls.push(url);
  if (url === canonicalBudgetIndex || url === cadenceReceipt.url) {
    const attempt = (retryAttempts.get(url) ?? 0) + 1;
    retryAttempts.set(url, attempt);
    if (attempt === 1 && url === canonicalBudgetIndex) {
      const error = new Error("provider budget exhausted");
      error.name = "ProviderBudgetError";
      throw error;
    }
    if (attempt === 1 && url === cadenceReceipt.url) throw new Error("cadence_guard:not_due");
    const form = url === canonicalBudgetIndex ? "424B5" : "8-K";
    const primaryUrl = url === canonicalBudgetIndex ? budgetPrimary : cadencePrimary;
    return new Response(filingIndexHtml(form, primaryUrl), { status: 200, headers: { "content-type": "text/html" } });
  }
  if (url === budgetPrimary || url === cadencePrimary) {
    return new Response("<html><body><p>The issuer entered into a material definitive agreement. Retried factual filing content.</p></body></html>", {
      status: 200,
      headers: { "content-type": "text/html" },
    });
  }
  throw new Error(`Unexpected retry URL: ${url}`);
};
const deferred = await enrichSecFilingDetails([budgetReceipt, cadenceReceipt], retryFetch, now);
assert.deepEqual(deferred.diagnostics.selectedReceiptIds, [budgetReceipt.id, cadenceReceipt.id]);
assert.deepEqual(sorted(deferred.diagnostics.deferredReceiptIds), sorted([budgetReceipt.id, cadenceReceipt.id]));
assert.equal(deferred.provider.status, "not_due");
assert.equal(deferred.diagnostics.deferred, 2);
assert.equal(deferred.diagnostics.failed, 0);
assert.equal(deferred.diagnostics.backlog.failureCooldownCount, 0);
assert.equal(deferred.diagnostics.backlog.retryDeferredCount, 2);
assert.equal(deferred.diagnostics.failureCooldownReceiptIds.length, 0);
assert.equal(deferred.diagnostics.items.every((item) => item.errorCategory === "provider_budget_not_due"), true);
assert.equal(deferred.provider.nextRetryAt, "2026-07-22T13:00:00.000Z");
assert.equal(deferred.policy.budgetRetryFallbackMinutes, 60);
const retryCallCountAfterDeferral = retryCalls.length;
const retryNotDue = await enrichSecFilingDetails(
  [budgetReceipt, cadenceReceipt],
  retryFetch,
  new Date(now.getTime() + 5 * 60_000),
);
assert.deepEqual(retryNotDue.diagnostics.selectedReceiptIds, []);
assert.deepEqual(sorted(retryNotDue.diagnostics.retryDeferredReceiptIds), sorted([budgetReceipt.id, cadenceReceipt.id]));
assert.equal(retryNotDue.diagnostics.skipped.retry_not_due, 2);
assert.equal(retryNotDue.diagnostics.selected, 0);
assert.equal(retryNotDue.diagnostics.newlyFetched, 0);
assert.equal(retryNotDue.diagnostics.deferred, 2);
assert.equal(retryNotDue.diagnostics.failed, 0);
assert.equal(retryNotDue.diagnostics.backlog.retryDeferredCount, 2);
assert.equal(retryNotDue.provider.status, "not_due");
assert.equal(retryNotDue.provider.error, "some_selected_filings_incomplete");
assert.equal(retryNotDue.provider.nextRetryAt, "2026-07-22T13:00:00.000Z");
assert.equal(retryCalls.length, retryCallCountAfterDeferral);
assert.equal(retryAttempts.get(canonicalBudgetIndex), 1);
assert.equal(retryAttempts.get(cadenceReceipt.url), 1);
const retried = await enrichSecFilingDetails([budgetReceipt, cadenceReceipt], retryFetch, new Date(now.getTime() + 60 * 60_000));
assert.deepEqual(retried.diagnostics.selectedReceiptIds, [budgetReceipt.id, cadenceReceipt.id]);
assert.equal(retried.provider.status, "connected");
assert.equal(retried.diagnostics.newlyFetched, 2);
assert.equal(retried.diagnostics.deferred, 0);
assert.equal(retried.provider.nextRetryAt, null);
assert.equal(retryAttempts.get(canonicalBudgetIndex), 2);
assert.equal(retryAttempts.get(cadenceReceipt.url), 2);
assert.equal(retryCalls.some((url) => url.startsWith("https://sec.gov/")), false);
assert.ok(retryCalls.includes(canonicalBudgetIndex));

// A prior budget deferral cannot hide behind a cached success. On the next
// five-minute scan the cached evidence remains readable, but provider health
// stays partial and exposes the deferred accession's exact actual retry time.
resetSecFilingDetailStateForTest();
const mixedCachedSuccess = receipt({
  id: "mixed-cached-success",
  rawEventType: "424B5",
  publishedAt: "2026-07-22T11:59:00.000Z",
  url: "https://www.sec.gov/Archives/edgar/data/4500001/000450000126000001/success-index.html",
});
const mixedBudgetDeferred = receipt({
  id: "mixed-budget-deferred",
  rawEventType: "8-K",
  publishedAt: "2026-07-22T11:58:00.000Z",
  url: "https://www.sec.gov/Archives/edgar/data/4500002/000450000226000001/deferred-index.html",
});
const mixedSuccessPrimary = mixedCachedSuccess.url.replace("-index.html", ".htm");
const mixedRetryAt = "2026-07-22T13:17:00.000Z";
const mixedCalls = [];
const mixedFetch = async (value) => {
  const url = String(value);
  mixedCalls.push(url);
  if (url === mixedCachedSuccess.url) {
    return new Response(filingIndexHtml("424B5", mixedSuccessPrimary), {
      status: 200,
      headers: { "content-type": "text/html" },
    });
  }
  if (url === mixedSuccessPrimary) {
    return new Response("<html><body><p>Cached successful filing fact.</p></body></html>", {
      status: 200,
      headers: { "content-type": "text/html" },
    });
  }
  if (url === mixedBudgetDeferred.url) {
    const error = new Error("provider budget unavailable until an explicit retry");
    error.name = "ProviderBudgetError";
    error.nextRetryAt = mixedRetryAt;
    throw error;
  }
  throw new Error(`Unexpected mixed-state URL: ${url}`);
};
const mixedInitial = await enrichSecFilingDetails([mixedCachedSuccess, mixedBudgetDeferred], mixedFetch, now);
assert.deepEqual(mixedInitial.diagnostics.selectedReceiptIds, [mixedCachedSuccess.id, mixedBudgetDeferred.id]);
assert.deepEqual(mixedInitial.diagnostics.deferredReceiptIds, [mixedBudgetDeferred.id]);
assert.equal(mixedInitial.diagnostics.deferred, 1);
assert.equal(mixedInitial.provider.status, "partial");
assert.equal(mixedInitial.provider.error, "some_selected_filings_incomplete");
assert.equal(mixedInitial.provider.nextRetryAt, mixedRetryAt);
assert.equal(mixedInitial.diagnostics.backlog.count, 1);
assert.equal(mixedInitial.diagnostics.backlog.retryDeferredCount, 1);
const mixedCallsAfterInitial = mixedCalls.length;

const mixedWaiting = await enrichSecFilingDetails(
  [mixedCachedSuccess, mixedBudgetDeferred],
  mixedFetch,
  new Date(now.getTime() + 5 * 60_000),
);
assert.deepEqual(mixedWaiting.diagnostics.selectedReceiptIds, []);
assert.deepEqual(mixedWaiting.diagnostics.deferredReceiptIds, []);
assert.deepEqual(mixedWaiting.diagnostics.retryDeferredReceiptIds, [mixedBudgetDeferred.id]);
assert.deepEqual(mixedWaiting.diagnostics.cachedReceiptIds, [mixedCachedSuccess.id]);
assert.equal(mixedWaiting.diagnostics.skipped.retry_not_due, 1);
assert.equal(mixedWaiting.diagnostics.deferred, 1);
assert.equal(mixedWaiting.diagnostics.reusedFromCache, 1);
assert.equal(mixedWaiting.diagnostics.newlyFetched, 0);
assert.equal(mixedWaiting.provider.cached, true);
assert.equal(mixedWaiting.provider.recordsRead, 1);
assert.equal(mixedWaiting.provider.status, "partial");
assert.equal(mixedWaiting.provider.error, "some_selected_filings_incomplete");
assert.equal(mixedWaiting.provider.nextRetryAt, mixedRetryAt);
assert.equal(mixedWaiting.diagnostics.backlog.count, 1);
assert.equal(mixedWaiting.diagnostics.backlog.retryDeferredCount, 1);
assert.equal(mixedCalls.length, mixedCallsAfterInitial);

// A valid short provider retry is authoritative. The accession stays deferred
// immediately before that boundary, then retries as soon as it passes instead
// of being stretched to the one-hour fallback.
resetSecFilingDetailStateForTest();
const shortRetryReceipt = receipt({
  id: "short-explicit-retry",
  rawEventType: "424B5",
  publishedAt: "2026-07-22T11:59:00.000Z",
  url: "https://www.sec.gov/Archives/edgar/data/4600001/000460000126000001/short-retry-index.html",
});
const shortRetryPrimary = shortRetryReceipt.url.replace("-index.html", ".htm");
const shortRetryAt = "2026-07-22T12:17:00.000Z";
let shortRetryIndexAttempts = 0;
const shortRetryCalls = [];
const shortRetryFetch = async (value) => {
  const url = String(value);
  shortRetryCalls.push(url);
  if (url === shortRetryReceipt.url) {
    shortRetryIndexAttempts += 1;
    if (shortRetryIndexAttempts === 1) {
      const error = new Error("short explicit provider retry");
      error.name = "ProviderBudgetError";
      error.nextRetryAt = shortRetryAt;
      throw error;
    }
    return new Response(filingIndexHtml("424B5", shortRetryPrimary), {
      status: 200,
      headers: { "content-type": "text/html" },
    });
  }
  if (url === shortRetryPrimary) {
    return new Response("<html><body><p>Short-retry factual filing content.</p></body></html>", {
      status: 200,
      headers: { "content-type": "text/html" },
    });
  }
  throw new Error(`Unexpected short-retry URL: ${url}`);
};
const shortRetryInitial = await enrichSecFilingDetails([shortRetryReceipt], shortRetryFetch, now);
assert.deepEqual(shortRetryInitial.diagnostics.deferredReceiptIds, [shortRetryReceipt.id]);
assert.equal(shortRetryInitial.diagnostics.deferred, 1);
assert.equal(shortRetryInitial.provider.status, "not_due");
assert.equal(shortRetryInitial.provider.error, "some_selected_filings_incomplete");
assert.equal(shortRetryInitial.provider.nextRetryAt, shortRetryAt);
const shortRetryCallsAfterInitial = shortRetryCalls.length;

const shortRetryWaiting = await enrichSecFilingDetails(
  [shortRetryReceipt],
  shortRetryFetch,
  new Date("2026-07-22T12:16:59.000Z"),
);
assert.deepEqual(shortRetryWaiting.diagnostics.selectedReceiptIds, []);
assert.deepEqual(shortRetryWaiting.diagnostics.retryDeferredReceiptIds, [shortRetryReceipt.id]);
assert.equal(shortRetryWaiting.diagnostics.skipped.retry_not_due, 1);
assert.equal(shortRetryWaiting.diagnostics.deferred, 1);
assert.equal(shortRetryWaiting.provider.status, "not_due");
assert.equal(shortRetryWaiting.provider.error, "some_selected_filings_incomplete");
assert.equal(shortRetryWaiting.provider.nextRetryAt, shortRetryAt);
assert.equal(shortRetryCalls.length, shortRetryCallsAfterInitial);
assert.equal(shortRetryIndexAttempts, 1);

const shortRetryCompleted = await enrichSecFilingDetails(
  [shortRetryReceipt],
  shortRetryFetch,
  new Date("2026-07-22T12:17:00.001Z"),
);
assert.deepEqual(shortRetryCompleted.diagnostics.selectedReceiptIds, [shortRetryReceipt.id]);
assert.deepEqual(shortRetryCompleted.diagnostics.retryDeferredReceiptIds, []);
assert.equal(shortRetryCompleted.diagnostics.newlyFetched, 1);
assert.equal(shortRetryCompleted.diagnostics.deferred, 0);
assert.equal(shortRetryCompleted.provider.status, "connected");
assert.equal(shortRetryCompleted.provider.error, null);
assert.equal(shortRetryCompleted.provider.nextRetryAt, null);
assert.equal(shortRetryIndexAttempts, 2);
assert.equal(shortRetryCalls.length, shortRetryCallsAfterInitial + 2);

// An ordinary failed accession also cannot hide behind a cached success. The
// mixed provider remains partial and publishes the exact retry time for the
// full failure cooldown, even though no new failure occurs on those scans.
resetSecFilingDetailStateForTest();
const cooldownCachedSuccess = receipt({
  id: "cooldown-cached-success",
  rawEventType: "424B5",
  publishedAt: "2026-07-22T11:59:00.000Z",
  url: "https://www.sec.gov/Archives/edgar/data/4700001/000470000126000001/cooldown-success-index.html",
});
const cooldownOrdinaryFailure = receipt({
  id: "cooldown-ordinary-failure",
  rawEventType: "8-K",
  publishedAt: "2026-07-22T11:58:00.000Z",
  url: "https://www.sec.gov/Archives/edgar/data/4700002/000470000226000001/cooldown-failure-index.html",
});
const cooldownSuccessPrimary = cooldownCachedSuccess.url.replace("-index.html", ".htm");
const ordinaryCooldownRetryAt = "2026-07-22T13:00:00.000Z";
const cooldownCalls = [];
const cooldownFetch = async (value) => {
  const url = String(value);
  cooldownCalls.push(url);
  if (url === cooldownCachedSuccess.url) {
    return new Response(filingIndexHtml("424B5", cooldownSuccessPrimary), {
      status: 200,
      headers: { "content-type": "text/html" },
    });
  }
  if (url === cooldownSuccessPrimary) {
    return new Response("<html><body><p>Cached success beside an ordinary failure.</p></body></html>", {
      status: 200,
      headers: { "content-type": "text/html" },
    });
  }
  if (url === cooldownOrdinaryFailure.url) {
    return new Response("<html><body>No filing document table.</body></html>", {
      status: 200,
      headers: { "content-type": "text/html" },
    });
  }
  throw new Error(`Unexpected ordinary-cooldown URL: ${url}`);
};
const cooldownInitial = await enrichSecFilingDetails(
  [cooldownCachedSuccess, cooldownOrdinaryFailure],
  cooldownFetch,
  now,
);
assert.equal(cooldownInitial.diagnostics.failed, 1);
assert.equal(cooldownInitial.diagnostics.backlog.failureCooldownCount, 1);
assert.equal(cooldownInitial.provider.status, "partial");
assert.equal(cooldownInitial.provider.error, "some_selected_filings_incomplete");
assert.equal(cooldownInitial.provider.nextRetryAt, ordinaryCooldownRetryAt);
const cooldownCallsAfterInitial = cooldownCalls.length;

function assertMixedOrdinaryCooldown(result) {
  assert.deepEqual(result.diagnostics.selectedReceiptIds, []);
  assert.deepEqual(result.diagnostics.cachedReceiptIds, [cooldownCachedSuccess.id]);
  assert.deepEqual(result.diagnostics.failureCooldownReceiptIds, [cooldownOrdinaryFailure.id]);
  assert.equal(result.diagnostics.skipped.failure_cooldown, 1);
  assert.equal(result.diagnostics.failed, 0);
  assert.equal(result.diagnostics.reusedFromCache, 1);
  assert.equal(result.diagnostics.backlog.count, 1);
  assert.equal(result.diagnostics.backlog.failureCooldownCount, 1);
  assert.equal(result.provider.cached, true);
  assert.equal(result.provider.recordsRead, 1);
  assert.equal(result.provider.status, "partial");
  assert.equal(result.provider.error, "some_selected_filings_incomplete");
  assert.equal(result.provider.nextRetryAt, ordinaryCooldownRetryAt);
  assert.equal(cooldownCalls.length, cooldownCallsAfterInitial);
}
const cooldownAtFive = await enrichSecFilingDetails(
  [cooldownCachedSuccess, cooldownOrdinaryFailure],
  cooldownFetch,
  new Date(now.getTime() + 5 * 60_000),
);
assertMixedOrdinaryCooldown(cooldownAtFive);
const cooldownAtFiftyNine = await enrichSecFilingDetails(
  [cooldownCachedSuccess, cooldownOrdinaryFailure],
  cooldownFetch,
  new Date(now.getTime() + 59 * 60_000),
);
assertMixedOrdinaryCooldown(cooldownAtFiftyNine);

// One just-filed time-sensitive accession always advances before an aged
// same-form backlog. The second slot still drains that backlog FIFO, preserving
// bounded fairness without making fresh market-moving filings wait for it.
resetSecFilingDetailStateForTest();
function sameFormReceipt(id, publishedAt, accession) {
  return receipt({
    id,
    rawEventType: "424B5",
    publishedAt,
    url: `https://www.sec.gov/Archives/edgar/data/5000000/${accession}/${id}-index.html`,
  });
}
const originalOld = sameFormReceipt("original-old", "2026-07-22T11:58:00.000Z", "000500000026000001");
const originalNew = sameFormReceipt("original-new", "2026-07-22T11:59:00.000Z", "000500000026000002");
const freshA = sameFormReceipt("fresh-a", "2026-07-22T12:00:00.000Z", "000500000026000003");
const freshB = sameFormReceipt("fresh-b", "2026-07-22T11:59:30.000Z", "000500000026000004");
const freshC = sameFormReceipt("fresh-c", "2026-07-22T12:05:00.000Z", "000500000026000005");
const freshD = sameFormReceipt("fresh-d", "2026-07-22T12:04:00.000Z", "000500000026000006");
const freshE = sameFormReceipt("fresh-e", "2026-07-22T12:10:00.000Z", "000500000026000007");
const freshF = sameFormReceipt("fresh-f", "2026-07-22T12:09:00.000Z", "000500000026000008");
const freshG = sameFormReceipt("fresh-g", "2026-07-22T12:16:00.000Z", "000500000026000009");
const freshH = sameFormReceipt("fresh-h", "2026-07-22T12:15:00.000Z", "000500000026000010");
const sameFormFetch = async (value) => {
  const url = String(value);
  if (/-index\.html$/i.test(url)) {
    const primary = url.replace(/-index\.html$/i, ".htm");
    return new Response(filingIndexHtml("424B5", primary), { status: 200, headers: { "content-type": "text/html" } });
  }
  if (/\.htm$/i.test(url)) {
    return new Response("<html><body><p>Same-form factual filing.</p></body></html>", {
      status: 200,
      headers: { "content-type": "text/html" },
    });
  }
  throw new Error(`Unexpected same-form URL: ${url}`);
};
const sameFormFirst = await enrichSecFilingDetails([originalOld, originalNew, freshA, freshB], sameFormFetch, now);
assert.deepEqual(sameFormFirst.diagnostics.selectedReceiptIds, [freshA.id, freshB.id]);
const sameFormSecond = await enrichSecFilingDetails([freshC, freshD], sameFormFetch, new Date(now.getTime() + 5 * 60_000));
assert.deepEqual(sameFormSecond.diagnostics.selectedReceiptIds, [freshC.id, freshD.id]);
const sameFormThird = await enrichSecFilingDetails([freshE, freshF], sameFormFetch, new Date(now.getTime() + 10 * 60_000));
assert.deepEqual(sameFormThird.diagnostics.selectedReceiptIds, [freshE.id, freshF.id]);
const sameFormFourth = await enrichSecFilingDetails([freshG, freshH], sameFormFetch, new Date(now.getTime() + 16 * 60_000));
assert.deepEqual(sameFormFourth.diagnostics.selectedReceiptIds, [freshG.id, originalOld.id]);
assert.equal(sameFormFourth.diagnostics.skipped.run_limit, 2);
assert.equal(sameFormFourth.policy.starvationAgeMinutes, 15);

// A continuous stream of fresh 8-Ks can occupy only the fresh slot. The
// second slot must keep rotating through every aged form instead of letting
// one high-volume form monopolize the backlog lane.
resetSecFilingDetailStateForTest();
const rotationForms = ["424B5", "8-K", "6-K", "424B3", "10-Q", "10-K"];
const rotationReceiptsByUrl = new Map();
function rotationReceipt(id, form, publishedAt, accession) {
  const item = receipt({
    id,
    rawEventType: form,
    publishedAt,
    url: `https://www.sec.gov/Archives/edgar/data/6000000/${accession}/${id}-index.html`,
  });
  rotationReceiptsByUrl.set(item.url, item);
  return item;
}
const agedRotationReceipts = rotationForms.map((form, index) => rotationReceipt(
  `aged-${form.toLowerCase()}`,
  form,
  "2026-07-22T11:00:00.000Z",
  `0006000000260000${String(index + 1).padStart(2, "0")}`,
));
const rotationFetch = async (value) => {
  const url = String(value);
  const queued = rotationReceiptsByUrl.get(url);
  if (queued) {
    return new Response(filingIndexHtml(queued.rawEventType, url.replace(/-index\.html$/i, ".htm")), {
      status: 200,
      headers: { "content-type": "text/html" },
    });
  }
  if (/\.htm$/i.test(url)) {
    return new Response("<html><body><p>Cross-form factual filing.</p></body></html>", {
      status: 200,
      headers: { "content-type": "text/html" },
    });
  }
  throw new Error(`Unexpected rotation URL: ${url}`);
};
const agedSelections = [];
for (let cycle = 0; cycle < rotationForms.length; cycle += 1) {
  const cycleNow = new Date(now.getTime() + cycle * 5 * 60_000);
  const fresh = rotationReceipt(
    `continuous-fresh-8k-${cycle}`,
    "8-K",
    cycleNow.toISOString(),
    `0006000000260001${String(cycle + 1).padStart(2, "0")}`,
  );
  const result = await enrichSecFilingDetails(
    cycle === 0 ? [...agedRotationReceipts, fresh] : [fresh],
    rotationFetch,
    cycleNow,
  );
  assert.equal(result.diagnostics.selectedReceiptIds[0], fresh.id);
  agedSelections.push(result.diagnostics.selectedReceiptIds[1]);
}
assert.deepEqual(agedSelections, agedRotationReceipts.map((item) => item.id));

// A targeted event-job accession must bypass the process-wide fairness backlog.
// This prevents unrelated carried-forward filings from making the exact current
// issuer filing appear temporarily unavailable.
resetSecFilingDetailStateForTest();
const targetedPriorityReceipts = [
  receipt({ id: "priority-backlog-424b5", rawEventType: "424B5", publishedAt: "2026-07-22T11:59:00.000Z", url: "https://www.sec.gov/Archives/edgar/data/7000001/000700000126000001/backlog-a-index.html" }),
  receipt({ id: "priority-backlog-8k", rawEventType: "8-K", publishedAt: "2026-07-22T11:58:00.000Z", url: "https://www.sec.gov/Archives/edgar/data/7000002/000700000226000001/backlog-b-index.html" }),
  receipt({ id: "priority-backlog-6k", rawEventType: "6-K", publishedAt: "2026-07-22T11:57:00.000Z", url: "https://www.sec.gov/Archives/edgar/data/7000003/000700000326000001/backlog-c-index.html" }),
  receipt({ id: "priority-backlog-424b3", rawEventType: "424B3", publishedAt: "2026-07-22T11:56:00.000Z", url: "https://www.sec.gov/Archives/edgar/data/7000004/000700000426000001/backlog-d-index.html" }),
];
const exactTargetedReceipt = receipt({
  id: "exact-targeted-10k",
  rawEventType: "10-K",
  publishedAt: "2026-07-22T10:00:00.000Z",
  url: "https://www.sec.gov/Archives/edgar/data/7000005/000700000526000001/exact-target-index.html",
});
const queuedExactTargetReceipt = receipt({
  id: "000-queued-hash-10k",
  rawEventType: exactTargetedReceipt.rawEventType,
  publishedAt: exactTargetedReceipt.publishedAt,
  url: exactTargetedReceipt.url,
});
const saturatedPriorityReceipts = Array.from({ length: 1_000 }, (_, index) => {
  const forms = ["8-K", "6-K", "424B5", "424B3", "10-Q", "10-K"];
  const cik = String(8_000_000 + index);
  const accession = `${cik}26000001`;
  return receipt({
    id: `saturated-priority-backlog-${index}`,
    rawEventType: forms[index % forms.length],
    publishedAt: "2026-07-22T11:30:00.000Z",
    url: `https://www.sec.gov/Archives/edgar/data/${cik}/${accession}/saturated-${index}-index.html`,
  });
});
const priorityReceiptByUrl = new Map(
  [
    ...targetedPriorityReceipts,
    ...saturatedPriorityReceipts,
    queuedExactTargetReceipt,
    exactTargetedReceipt,
  ].map((item) => [item.url, item]),
);
const priorityFetch = async (value) => {
  const url = String(value);
  const item = priorityReceiptByUrl.get(url);
  if (item) {
    return new Response(filingIndexHtml(item.rawEventType, url.replace(/-index\.html$/i, ".htm")), {
      status: 200,
      headers: { "content-type": "text/html" },
    });
  }
  if (/\.htm$/i.test(url)) {
    return new Response("<html><body><p>Exact targeted factual filing evidence.</p></body></html>", {
      status: 200,
      headers: { "content-type": "text/html" },
    });
  }
  throw new Error(`Unexpected targeted-priority URL: ${url}`);
};
await enrichSecFilingDetails([...targetedPriorityReceipts, queuedExactTargetReceipt], priorityFetch, now);
const targetedPriority = await enrichSecFilingDetails(
  [...saturatedPriorityReceipts, exactTargetedReceipt],
  priorityFetch,
  new Date(now.getTime() + 5 * 60_000),
  undefined,
  { priorityReceiptIds: [exactTargetedReceipt.id] },
);
assert.equal(targetedPriority.diagnostics.selectedReceiptIds[0], exactTargetedReceipt.id);
assert.deepEqual(targetedPriority.diagnostics.priorityReceiptIds, [exactTargetedReceipt.id]);
assert.deepEqual(targetedPriority.diagnostics.prioritySelectedReceiptIds, [exactTargetedReceipt.id]);
assert.equal(targetedPriority.policy.targetedReceiptPriority, true);

console.log(JSON.stringify({
  ok: true,
  maximumNewFilingsPerRun: 2,
  successfulDetailsCachedAndReused: true,
  duplicateAccessionRowsCollapsed: true,
  queueSurvivesWholeProviderSnapshotReplacement: true,
  failureCooldownPreventsStarvation: true,
  failedReceiptRetriesAfterCooldown: true,
  providerBudgetDeferralsWaitUntilExplicitRetry: true,
  cachedSuccessCannotMaskBudgetDeferral: true,
  providerExposesExactNextRetryAt: true,
  shortExplicitProviderRetryHonored: true,
  ordinaryCooldownCannotHideBehindCachedSuccess: true,
  partialRetriesWaitUntilExplicitRetry: true,
  cachedPartialsRemainVisibleWithoutConsumingFetchSlots: true,
  freshPairsAdvanceWhilePartialsWait: true,
  bareSecHostCanonicalized: true,
  secInlineXbrlIxLinksResolved: true,
  freshTimeSensitiveFilingsBypassAgedBacklog: true,
  sustainedSameFormArrivalsCannotStarveAgedFilings: true,
  agedSameFormFilingsUseFifo: true,
  continuousFreshArrivalsCannotStarveOtherForms: true,
  exactTargetedAccessionBypassesFairnessBacklog: true,
  exactTargetedAccessionReplacesDeduplicatedReceipt: true,
  exactTargetedAccessionSurvivesQueueCapacityBounding: true,
  selectedAccessionsReservedInOneBatchBeforeFetch: true,
  eachAccessionGrantCoversAtMostThreeChildRequests: true,
  explicitExhibit992Selected: true,
  exhibitPreservedInsideAnalysisWindow: true,
  missingReferencedExhibitRetainsPartialPrimary: true,
  requestsSerializedAndBounded: true,
  factualTextCapped: true,
  secretsExcluded: true,
  directionInferencePerformed: false,
  writesOrNotificationsPerformed: false,
}, null, 2));
