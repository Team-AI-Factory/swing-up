import assert from "node:assert/strict";
import { loadTsModule } from "./helpers/load-typescript-module.mjs";

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };
Object.assign(process.env, {
  R2_ENDPOINT: "https://r2.invalid", R2_BUCKET: "unit-tests", R2_ACCESS_KEY_ID: "unit-test-key", R2_SECRET_ACCESS_KEY: "unit-test-secret",
});
const r2 = loadTsModule("@/lib/r2-warehouse", {
  "@/lib/db/client": { prisma: {} },
  "@/lib/redact-secrets": { redactSecrets: value => value },
  "@/lib/simple-alert-pilot-runtime": { pilotSharedMutationAllowed: () => true, SIMPLE_PILOT_PREFIX: "branch-labs/simple-alerts/" },
});
const key = "branch-labs/simple-alerts/research-evidence/company-profiles-v1.json";
const controller = new AbortController();
try {
  let calls = [];
  globalThis.fetch = async (_url, options) => {
    calls.push(options);
    return new Response("{}", { headers: { ETag: '"v1"' } });
  };
  await r2.readVersionedTextFromR2(key, { signal: controller.signal });
  await r2.writeVersionedJsonToR2(key, {}, { expectedEtag: '"v1"', signal: controller.signal });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].headers["if-match"], '"v1"');
  controller.abort(new Error("role_deadline"));
  assert.ok(calls.every(call => call.signal.aborted), "The caller's abort reaches the actual GET and PUT fetch signals");
  await assert.rejects(() => r2.readVersionedTextFromR2(key, { signal: controller.signal }), /role_deadline/);
  await assert.rejects(() => r2.writeVersionedJsonToR2(key, {}, { createOnly: true, signal: controller.signal }), /role_deadline/);
  assert.equal(calls.length, 2, "An already-aborted operation never reaches fetch");

  calls = [];
  const ack = new AbortController();
  globalThis.fetch = async (_url, options) => {
    calls.push(options);
    return new Response(r2.encodeVersionedJsonForR2(key, {}).body, { headers: options.method === "GET" ? { ETag: '"v2"' } : {} });
  };
  assert.equal((await r2.writeVersionedJsonToR2(key, {}, { createOnly: true, signal: ack.signal })).written, true);
  assert.deepEqual(calls.map(call => call.method), ["PUT", "GET"]);
  assert.equal(calls[0].headers["if-none-match"], "*");
  ack.abort();
  assert.ok(calls.every(call => call.signal.aborted), "The missing-ETag readback shares the same caller deadline");

  calls = [];
  globalThis.fetch = async (_url, options) => { calls.push(options); return new Response("bad gateway", { status: 502 }); };
  await assert.rejects(() => r2.writeVersionedJsonToR2(key, {}), /r2_state_write_http_502/);
  assert.equal(calls.length, 1, "Unconditional R2 writes do not gain retries");
  assert.equal(calls[0].signal.aborted, false, "Calls without the new option retain the existing default timeout");
  console.log("PASS: R2 cancellation reaches GET/PUT and exact-content missing-ETag readback; CAS headers and unconditional single-attempt behavior remain intact.");
} finally {
  globalThis.fetch = originalFetch;
  for (const name of Object.keys(process.env)) if (!(name in originalEnv)) delete process.env[name];
  Object.assign(process.env, originalEnv);
}
