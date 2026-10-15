import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import crypto from "node:crypto";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { filingFixtureManifest, filingFixture } from "./helpers/filing-facts-fixture.mjs";
import { loadTsModule } from "./helpers/load-typescript-module.mjs";

// Every source response and storage call is local. Block accidental real I/O.
let blockedNetworkAttempts = 0;
const blocked = () => { blockedNetworkAttempts++; throw new Error("live_network_forbidden"); };
globalThis.fetch = blocked;
http.request = http.get = https.request = https.get = blocked;
net.Socket.prototype.connect = blocked;

const now = new Date("2026-10-14T06:00:00Z"), hour = 3600000;
const cik = "0000903651", indexUrl = `https://data.sec.gov/submissions/CIK${cik}.json`;
const indexBytes = readFileSync(new URL("./fixtures/sec-submissions-root-2026-10-07/INOD.json", import.meta.url));
assert.equal(crypto.createHash("sha256").update(indexBytes).digest("hex"),
  "070461656ae36691ad952bd53e529dd48fbb74b8f7191637d3c6bb79e27910f3");
// Both index and quarterly filing are immutable authentic SEC fixtures. The
// synthetic prefix below is used only for interrupted/partial transport cases.
const filingPrefix = `<html><body>${"Synthetic preface. ".repeat(140)}<p>Operating segments: synthetic segment.</p>`;
const filing = filingFixture(filingFixtureManifest.sources.find(r => r.source.cik === cik && r.source.form === "10-Q"));
const partial = (body, total) => new Response(body, { status: 206,
  headers: { "Content-Range": `bytes 0-${Buffer.byteLength(body) - 1}/${total}` } });
const interrupted = () => {
  let sent = false;
  return new Response(new ReadableStream({ pull(controller) {
    if (!sent) { sent = true; controller.enqueue(new TextEncoder().encode(filingPrefix)); }
    else controller.error(new Error("synthetic_transport_interrupted"));
  } }));
};
const baselineProbe = process.argv.includes("--probe-baseline");
const observations = [];
function setup(prior = null) {
  let stored = prior && structuredClone(prior), writes = 0;
  const calls = [];
  const { collectFinancialDocuments } = loadTsModule("@/lib/equity-signal/financial-evidence", {
    "@/lib/opportunity-engine/pr262-storage": { pr262StorageKey: key => `synthetic/${key}` },
    "@/lib/r2-warehouse": {
      readVersionedTextFromR2: async () => stored ? { found: true, text: JSON.stringify(stored), etag: "synthetic-etag" } : { found: false },
      writeVersionedJsonToR2: async (_key, value) => { stored = structuredClone(value); writes++; return { written: true }; },
    },
  });
  return {
    calls, get writes() { return writes; }, get stored() { return stored; },
    run(indexResponse = () => new Response(indexBytes), filingResponse = () => new Response(filing), at = now) {
      return collectFinancialDocuments(cik, async (url, options) => {
        assert.equal(options.redirect, "error");
        assert.equal(options.cache, "no-store");
        assert.ok(options.signal);
        assert.match(url, /^https:\/\/(?:data|www)\.sec\.gov\//);
        calls.push(url);
        return url === indexUrl ? indexResponse() : filingResponse();
      }, at);
    },
  };
}
function record(name, result, calls) {
  observations.push({ name, calls, documents: result.documents.length,
    readComplete: result.documents.map(doc => doc.readComplete), failures: result.failures.map(f => f.reason), nextCheckAt: result.nextCheckAt });
}
function backoff(result, at = now) {
  assert.equal(result.nextCheckAt, new Date(at.getTime() + hour).toISOString());
}

const positive = setup(), complete = await positive.run();
assert.equal(positive.calls.length, 3);
assert.equal(complete.documents.length, 2);
assert.ok(complete.documents.every(doc => doc.readComplete && doc.excerpts.length > 0));
assert.deepEqual(complete.failures, []);
assert.equal(complete.nextCheckAt, new Date(now.getTime() + 6 * hour).toISOString());
record("HTTP 200 complete filing and authentic index", complete, positive.calls.length);

for (const [name, indexResponse, filingResponse, expectedCalls, expectedFailures] of [
  ["HTTP 206 prefix filing reaches body EOF", undefined, () => partial(filingPrefix, Buffer.byteLength(filing)), 3, 2],
  // Valid JSON followed by omitted whitespace is a syntactically parseable range
  // of a larger entity. HTTP status must gate the index before it is used.
  ["HTTP 206 parseable authentic index", () => partial(indexBytes, indexBytes.length + 100), undefined, 1, 1],
  ["HTTP 206 filing without Content-Range", undefined, () => new Response(filingPrefix, { status: 206 }), 3, 2],
]) {
  const test = setup(), result = await test.run(indexResponse, filingResponse);
  record(name, result, test.calls.length);
  if (baselineProbe) {
    assert.equal(result.documents.length, 2, "Baseline should reproduce the false completeness attestation");
    assert.ok(result.documents.every(doc => doc.readComplete));
    assert.deepEqual(result.failures, []);
  } else {
    assert.equal(test.calls.length, expectedCalls);
    assert.deepEqual(result.documents, []);
    assert.equal(result.failures.length, expectedFailures);
    assert.ok(result.failures.every(f => f.reason === "http_206"));
    backoff(result);
  }
}
if (baselineProbe) {
  assert.equal(blockedNetworkAttempts, 0);
  console.log(JSON.stringify({ mode: "baseline reproduction", observations }, null, 2));
} else {
  for (const [name, indexResponse, filingResponse, expectedReason] of [
    ["HTTP 201 index rejected", () => new Response(indexBytes, { status: 201 }), undefined, "http_201"],
    ["HTTP 201 filing rejected", undefined, () => new Response(filing, { status: 201 }), "http_201"],
    ["HTTP 200 interrupted filing stream", undefined, interrupted, "document_unavailable_or_budget_deferred"],
    ["HTTP 200 truncated JSON index", () => new Response(indexBytes.subarray(0, 2000)), undefined, "index_unavailable_or_budget_deferred"],
    ["HTTP 200 index exceeds existing 4MB limit", () => new Response(Buffer.concat([indexBytes, Buffer.alloc(4000001 - indexBytes.length, 32)])), undefined, "issuer_index_too_large"],
  ]) {
    const test = setup(), result = await test.run(indexResponse, filingResponse);
    assert.deepEqual(result.documents, []);
    assert.ok(result.failures.length > 0 && result.failures.every(f => f.reason === expectedReason));
    backoff(result);
    record(name, result, test.calls.length);
  }
  const bounded = setup(), boundedResult = await bounded.run(undefined, () => new Response(`${filing}${" ".repeat(5000001)}`));
  assert.equal(boundedResult.documents.length, 1, "Capped supported quarterly filing cannot promote typed identity/numeric evidence");
  assert.equal(boundedResult.documents[0].form, "10-K");
  assert.equal(boundedResult.failures.length, 1);
  assert.ok(boundedResult.documents.every(doc => !doc.readComplete));
  record("HTTP 200 filing capped at existing 5MB limit stays incomplete", boundedResult, bounded.calls.length);

  // An old cache has no transport-status proof. Preserve its original provenance
  // and reuse behavior; this fresh-read guard does not retroactively certify it.
  const reused = await positive.run(blocked, blocked, new Date(now.getTime() + 60000));
  assert.equal(reused.cached, true);
  assert.deepEqual(reused.documents, complete.documents);
  assert.equal(positive.calls.length, 3);
  assert.equal(positive.writes, 1);
  const later = new Date(now.getTime() + 7 * hour), preserved = setup(complete);
  const indexFailure = await preserved.run(() => partial(indexBytes, indexBytes.length + 100), blocked, later);
  assert.deepEqual(indexFailure.documents, complete.documents, "An index failure keeps original dates, digest and excerpts");
  assert.equal(indexFailure.failures[0].reason, "http_206");
  assert.equal(preserved.calls.length, 1);
  backoff(indexFailure, later);
  const delayed = await preserved.run(blocked, blocked, new Date(later.getTime() + 30 * 60000));
  assert.equal(delayed.cached, true);
  assert.deepEqual(delayed.documents, complete.documents);
  assert.equal(preserved.calls.length, 1);
  assert.equal(preserved.writes, 1);
  const recovered = await preserved.run(undefined, blocked, new Date(later.getTime() + hour));
  assert.deepEqual(recovered.documents, complete.documents, "Previously complete documents remain untouched after index retry");
  assert.deepEqual(recovered.failures, []);
  assert.equal(preserved.calls.length, 2);
  record("Prior evidence retained across index 206, backoff and retry", recovered, preserved.calls.length);

  const oldIncomplete = { ...complete, documents: complete.documents.map(doc => ({ ...doc, readComplete: false })) };
  const filingRetention = setup(oldIncomplete);
  const filingFailure = await filingRetention.run(undefined, () => partial(filingPrefix, Buffer.byteLength(filing)), later);
  assert.deepEqual(filingFailure.documents, oldIncomplete.documents, "Partial refresh cannot replace prior genuine excerpts or promote their completeness");
  assert.ok(filingFailure.failures.every(f => f.reason === "http_206"));
  backoff(filingFailure, later);
  assert.equal(filingRetention.calls.length, 3);
  const filingDelayed = await filingRetention.run(blocked, blocked, new Date(later.getTime() + 60000));
  assert.equal(filingDelayed.cached, true);
  assert.equal(filingRetention.calls.length, 3);
  assert.equal(filingRetention.writes, 1);
  record("Prior incomplete excerpts preserved across filing 206 and backoff", filingFailure, filingRetention.calls.length);
  assert.equal(blockedNetworkAttempts, 0);
  console.log(JSON.stringify({ mode: "fixed regression pass", observations, blockedNetworkAttempts, realStorageCalls: 0 }, null, 2));
}
