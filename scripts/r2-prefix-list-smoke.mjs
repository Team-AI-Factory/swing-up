import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile(new URL("../lib/r2-warehouse.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { esModuleInterop: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const nodeRequire = createRequire(import.meta.url);
const loaded = { exports: {} };
new Function("require", "module", "exports", output)((specifier) => {
  if (specifier === "@/lib/db/client") return { prisma: {} };
  if (specifier === "@/lib/redact-secrets") return { redactSecrets: (value) => value };
  return nodeRequire(specifier);
}, loaded, loaded.exports);

const { listR2ObjectKeys, parseR2ObjectKeyPage } = loaded.exports;
const parsed = parseR2ObjectKeyPage(`<?xml version="1.0"?><ListBucketResult><IsTruncated>true</IsTruncated><Contents><Key>production/a&amp;b.json</Key></Contents><NextContinuationToken>opaque&amp;token</NextContinuationToken></ListBucketResult>`);
assert.deepEqual(parsed.keys, ["production/a&b.json"]);
assert.equal(parsed.isTruncated, true);
assert.equal(parsed.nextContinuationToken, "opaque&token");
assert.throws(
  () => parseR2ObjectKeyPage("<html><body>temporary upstream page</body></html>"),
  /r2_list_contract_invalid/,
  "An HTTP 200 with the wrong R2 schema must not look like an empty key page.",
);

Object.assign(process.env, {
  R2_BUCKET: "private-bucket",
  R2_ENDPOINT: "https://account.example.invalid",
  R2_REGION: "auto",
  R2_ACCESS_KEY_ID: "test-access-key",
  R2_SECRET_ACCESS_KEY: "test-secret-key",
});
let requestedUrl = null;
let requestedInit = null;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  requestedUrl = new URL(String(url));
  requestedInit = init;
  return new Response(`<?xml version="1.0"?><ListBucketResult><IsTruncated>false</IsTruncated><Contents><Key>production/fundamental-signal-v2/a.json</Key></Contents></ListBucketResult>`, { status: 200 });
};
try {
  const page = await listR2ObjectKeys("production/fundamental-signal-v2/", { limit: 25, continuationToken: "opaque/token+value" });
  assert.deepEqual(page.keys, ["production/fundamental-signal-v2/a.json"]);
  assert.equal(requestedInit.method, "GET");
  assert.equal(requestedInit.body, undefined);
  assert.equal(requestedUrl.searchParams.get("list-type"), "2");
  assert.equal(requestedUrl.searchParams.get("prefix"), "production/fundamental-signal-v2/");
  assert.equal(requestedUrl.searchParams.get("max-keys"), "25");
  assert.equal(requestedUrl.searchParams.get("continuation-token"), "opaque/token+value");
  assert.match(String(requestedInit.headers.authorization), /^AWS4-HMAC-SHA256 /);
  await assert.rejects(() => listR2ObjectKeys("../outside/"), /r2_list_prefix_invalid/);
  await assert.rejects(() => listR2ObjectKeys("/absolute/outside/"), /r2_list_prefix_invalid/);
  await assert.rejects(() => listR2ObjectKeys("production//outside/"), /r2_list_prefix_invalid/);
} finally {
  globalThis.fetch = originalFetch;
}

console.log(JSON.stringify({
  ok: true,
  signedPrivatePrefixList: true,
  boundedReadOnlyPage: true,
  continuationTokenPreserved: true,
  unsafePrefixRejected: true,
  successfulHttpWithWrongSchemaRejected: true,
}, null, 2));
