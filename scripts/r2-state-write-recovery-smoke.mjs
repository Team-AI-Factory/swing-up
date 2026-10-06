import assert from "node:assert/strict";
import { loadTsModule } from "./helpers/load-typescript-module.mjs";

const originalEnv = { ...process.env }, originalFetch = globalThis.fetch, originalWarn = console.warn;
Object.assign(process.env, { R2_ENDPOINT: "https://r2.example.test", R2_BUCKET: "test-only", R2_ACCESS_KEY_ID: "fixture-key",
  R2_SECRET_ACCESS_KEY: "fixture-secret", R2_REGION: "auto", SWING_UP_SIMPLE_PILOT_ENABLED: "false",
  SWING_UP_R2_WRITE_PREFIX: "branch-labs/pr-262/", SWING_UP_PR262_R2_WRITE_TELEMETRY: "false" });
const delays = [], diagnostics = [];
const r2 = loadTsModule("@/lib/r2-warehouse", {
  "@/lib/db/client": { prisma: {} },
  "@/lib/redact-secrets": { redactSecrets: value => value },
  "node:timers/promises": { setTimeout: async (ms, unused, options) => { options.signal.throwIfAborted(); delays.push(ms); } },
});
const key = "branch-labs/pr-262/research-evidence/company-profiles-v1.json";
const payload = { version: 1, owner: "unique-owner", entries: [{ cik: "0000000001", verified: true }] };
const content = r2.encodeVersionedJsonForR2(key, payload).body;
const ok = () => new Response(null, { status: 200, headers: { etag: '"new"' } });
const old = () => new Response('{"owner":"old"}\n', { headers: { etag: '"old"' } });
const exact = () => new Response(content, { headers: { etag: '"new"' } });
const fail = status => new Response("service unavailable", { status });
const conflict = { written: false, conflict: true, etag: null };
let calls = [];
function sequence(steps) {
  calls = []; delays.length = 0;
  globalThis.fetch = async (url, init) => {
    assert.equal(new URL(url).hostname, "r2.example.test", "All requests stay on the configured private S3 endpoint");
    calls.push({ method: init.method, body: init.body, headers: { ...init.headers } });
    assert.ok(steps.length, "Unexpected extra request");
    const step = steps.shift();
    assert.equal(init.method, step[0]);
    if (step[1] instanceof Error) throw step[1];
    return step[1]();
  };
  return () => assert.equal(steps.length, 0, "Every expected request happened");
}
try {
  console.warn = value => diagnostics.push(value);
  let done = sequence([["PUT", () => fail(502)], ["GET", old], ["PUT", ok]]);
  assert.deepEqual(await r2.writeVersionedJsonToR2(key, payload, { expectedEtag: "old" }), { written: true, conflict: false, etag: '"new"' });
  done();
  assert.equal(calls[0].headers["if-match"], '"old"');
  assert.equal(calls[2].headers["if-match"], '"old"', "Recovery never replaces the original condition");
  assert.deepEqual(calls[0].body, calls[2].body, "The encoded payload is identical on replay");
  assert.ok(delays[0] >= 1000 && delays[0] < 1250, "Retry backs off instead of hammering a hot object");

  for (const first of [() => fail(502), new TypeError("fetch failed"), Object.assign(new Error("timed out"), { name: "TimeoutError" })]) {
    done = sequence([["PUT", first], ["GET", exact]]);
    assert.equal((await r2.writeVersionedJsonToR2(key, payload, { expectedEtag: "old" })).written, true);
    done();
    assert.equal(calls.filter(x => x.method === "PUT").length, 1, "Already committed state is not written twice");
  }

  done = sequence([["PUT", () => fail(503)], ["GET", () => new Response('{"owner":"other"}', { headers: { etag: '"winner"' } })]]);
  assert.deepEqual(await r2.writeVersionedJsonToR2(key, payload, { expectedEtag: "old" }), conflict);
  done();
  done = sequence([["PUT", () => fail(502)], ["GET", old], ["PUT", () => fail(412)]]);
  assert.deepEqual(await r2.writeVersionedJsonToR2(key, payload, { expectedEtag: "old" }), conflict);
  done();

  done = sequence([["PUT", () => fail(412)]]);
  assert.deepEqual(await r2.writeVersionedJsonToR2(key, payload, { createOnly: true }), conflict);
  done();
  assert.equal(calls.length, 1, "An ordinary conflict never reads back and claims another lease");
  done = sequence([["PUT", () => fail(502)], ["GET", exact]]);
  assert.equal((await r2.writeVersionedJsonToR2(key, payload, { createOnly: true })).written, true);
  done();
  done = sequence([["PUT", () => fail(502)], ["GET", () => fail(404)], ["PUT", ok]]);
  assert.equal((await r2.writeVersionedJsonToR2(key, payload, { createOnly: true })).written, true);
  done();
  assert.ok(calls.filter(x => x.method === "PUT").every(x => x.headers["if-none-match"] === "*"));
  done = sequence([["PUT", () => fail(502)], ["GET", old]]);
  assert.deepEqual(await r2.writeVersionedJsonToR2(key, payload, { createOnly: true }), conflict);
  done();

  done = sequence(Array.from({ length: 3 }, () => [["PUT", () => fail(503)], ["GET", old]]).flat());
  await assert.rejects(r2.writeVersionedJsonToR2(key, payload, { expectedEtag: "old" }), /r2_state_write_http_503/);
  done();
  assert.equal(calls.length, 6, "At most three conditional writes and three reconciliation reads");
  assert.ok(delays[1] >= 2000 && delays[2] >= 4000, "Backoff increases on repeated failures");
  for (const status of [400, 401, 403, 409]) {
    done = sequence([["PUT", () => fail(status)]]);
    await assert.rejects(r2.writeVersionedJsonToR2(key, payload, { expectedEtag: "old" }), new RegExp(`r2_state_write_http_${status}`));
    done();
  }
  done = sequence([["PUT", () => fail(502)]]);
  await assert.rejects(r2.writeVersionedJsonToR2(key, payload), /r2_state_write_http_502/);
  done();
  done = sequence([["PUT", () => fail(502)], ["GET", () => fail(503)]]);
  await assert.rejects(r2.writeVersionedJsonToR2(key, payload, { expectedEtag: "old" }), /r2_state_write_reconciliation_failed/);
  done();

  done = sequence([["PUT", () => new Response(null, { status: 200 })], ["GET", exact]]);
  assert.equal((await r2.writeVersionedJsonToR2(key, payload, { expectedEtag: "old" })).written, true);
  done();
  done = sequence([["PUT", () => new Response(null, { status: 200 })], ["GET", old]]);
  assert.deepEqual(await r2.writeVersionedJsonToR2(key, payload, { expectedEtag: "old" }), conflict, "A missing ETag cannot adopt a different state");
  done();
  done = sequence([["PUT", () => new Response(null, { status: 429, headers: { "retry-after": "60" } })]]);
  await assert.rejects(r2.writeVersionedJsonToR2(key, payload, { createOnly: true }), /r2_state_write_http_429/);
  done();
  done = sequence([["PUT", () => new Response(null, { status: 429, headers: { "retry-after": "3" } })], ["GET", old], ["PUT", ok]]);
  await r2.writeVersionedJsonToR2(key, payload, { expectedEtag: "old" }); done();
  assert.ok(delays[0] >= 3000, "Short server cooldown is respected");

  sequence([]);
  await assert.rejects(r2.writeVersionedJsonToR2(key, payload, { createOnly: true, signal: AbortSignal.abort() }), /abort/i);
  await assert.rejects(r2.writeVersionedJsonToR2("production/pr262/forbidden.json", payload, { createOnly: true }), /r2_mutation_outside_write_prefix/);
  assert.equal(calls.length, 0, "Cancellation and write fences stop before network I/O");

  const compressedKey = "branch-labs/pr-262/sensor/state-v1.json";
  const large = { entries: ["sample-only".repeat(5000)] };
  const encoded = r2.encodeVersionedJsonForR2(compressedKey, large);
  assert.equal(encoded.compressed, true);
  done = sequence([["PUT", () => fail(502)], ["GET", () => new Response(encoded.body, { headers: { etag: '"compressed"' } })]]);
  assert.equal((await r2.writeVersionedJsonToR2(compressedKey, large, { createOnly: true })).etag, '"compressed"');
  done();
  assert.ok(diagnostics.some(line => line.includes("committed_write_verified")));
  assert.ok(diagnostics.some(line => line.includes("concurrent_change_preserved")));
  assert.ok(diagnostics.every(line => !/fixture-secret|fixture-key|authorization|unique-owner/.test(line)), "Diagnostics never include secrets, signatures or payload values");
  console.log("R2 recovery: bounded conditional retry, ambiguous commit read-back, unchanged ETag, concurrent winners, create-only leases, gzip, missing ETag, cooldown, cancellation, permission fences and secret-free diagnostics passed.");
} finally {
  globalThis.fetch = originalFetch; console.warn = originalWarn;
  for (const name of Object.keys(process.env)) if (!(name in originalEnv)) delete process.env[name];
  Object.assign(process.env, originalEnv);
}
