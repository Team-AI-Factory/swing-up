import assert from "node:assert/strict";
import { loadTsModule } from "./helpers/load-typescript-module.mjs";
const savedEnv = { ...process.env }, originalFetch = globalThis.fetch;
Object.assign(process.env, { R2_ENDPOINT: "https://storage.invalid", R2_BUCKET: "synthetic-test-bucket",
  R2_ACCESS_KEY_ID: "synthetic-test-key", R2_SECRET_ACCESS_KEY: "synthetic-test-secret", SWING_UP_R2_WRITE_PREFIX: "tests/" });
const r2 = loadTsModule("@/lib/r2-warehouse", { "@/lib/db/client": { prisma: {} }, "@/lib/redact-secrets": { redactSecrets: value => value } });
try {
  for (const operation of ["read", "write"]) for (const name of ["TypeError", "TimeoutError"]) {
    const cause = Object.assign(new Error(name === "TypeError" ? "fetch failed" : "The operation was aborted due to timeout"), { name });
    let attempts = 0;
    globalThis.fetch = async url => { assert.equal(new URL(url).hostname, "storage.invalid"); attempts++; throw cause; };
    await assert.rejects(() => operation === "read" ? r2.readVersionedTextFromR2("tests/state.json")
      : r2.writeVersionedJsonToR2("tests/state.json", {}), error => {
      assert.equal(error.message, cause.message); assert.equal(error.name, cause.name); assert.equal(error.cause, cause);
      assert.equal(error.storageDomain, "r2_state"); assert.equal(error.storageOperation, operation); return true;
    });
    assert.equal(attempts, 1, "Provenance tagging cannot add a transport retry");
  }
  globalThis.fetch = async () => new Response(new ReadableStream({ start(controller) { controller.error(new Error("body read failed")); } }));
  await assert.rejects(() => r2.readVersionedTextFromR2("tests/state.json"), error => error.storageDomain === "r2_state" && error.storageOperation === "read" && error.message === "body read failed");
  globalThis.fetch = async () => new Response(null, { status: 412 });
  assert.deepEqual(await r2.writeVersionedJsonToR2("tests/state.json", {}, { createOnly: true }), { written: false, conflict: true, etag: null });
  globalThis.fetch = async () => new Response(null, { status: 502 });
  await assert.rejects(() => r2.writeVersionedJsonToR2("tests/state.json", {}), error => error.message === "r2_state_write_http_502" && error.storageDomain === "r2_state");
  globalThis.fetch = async () => { throw new Error("A forbidden write must never reach the network"); };
  await assert.rejects(() => r2.writeVersionedJsonToR2("forbidden/state.json", {}), /r2_mutation_outside_write_prefix/);
} finally {
  globalThis.fetch = originalFetch;
  for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
  Object.assign(process.env, savedEnv);
}
console.log("Versioned R2 failures retain read/write provenance and original message/name/cause; one attempt, CAS and prefix guards unchanged; no network calls.");
