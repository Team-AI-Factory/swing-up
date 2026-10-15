import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import ts from "typescript";
import { loadTsModule } from "./helpers/load-typescript-module.mjs";
import { inSimpleAlertPilot } from "./helpers/simple-alert-pilot-fixture.mjs";
const manifest = JSON.parse(readFileSync(new URL("./fixtures/ev-equity-bridge/manifest.json", import.meta.url)));
const bytes = readFileSync(new URL("./fixtures/ev-equity-bridge/legacy-approved.json.gz", import.meta.url));
const json = gunzipSync(bytes), fixture = JSON.parse(json);
const hash = value => crypto.createHash("sha256").update(value).digest("hex");
assert.equal(hash(bytes), manifest.compressedSHA256);
assert.equal(hash(json), manifest.jsonSHA256);
assert.equal(fixture.synthetic, true);
assert.equal(fixture.baselineDeliveryStatus, "delivered");
const now = new Date(fixture.now), prefix = "branch-labs/simple-alerts/terminal-integration";
let objects = new Map(), writes = 0;
const storage = {
  readVersionedTextFromR2: async key => { const row = objects.get(key); return row ? { found: true, text: JSON.stringify(row.value), etag: row.etag } : { found: false, text: null, etag: null }; },
  listR2ObjectKeys: async (prefix, options = {}) => ({ keys: [...objects.keys()].filter(key => key.startsWith(prefix)).slice(0, options.limit), isTruncated: false, nextContinuationToken: null }),
  writeVersionedJsonToR2: async () => { writes++; throw new Error("publication_hold_must_be_read_only"); },
};
const overrides = { "@/lib/r2-warehouse": storage,
  "@/lib/opportunity-engine/pr262-storage": { pr262StorageKey: key => `${prefix}/${key}` },
  "@/lib/opportunity-engine/company-profile-cache": { readCompanyProfiles: async () => new Map() } };
const methods = loadTsModule("@/lib/opportunity-engine/us-sector-specialist-valuation");
const financial = loadTsModule("@/lib/equity-signal/financial-evidence");
const checks = [];
await inSimpleAlertPilot(async () => {
  process.env.SWING_UP_PR262_EXTERNAL_NOTIFICATIONS_ENABLED = "false";
  const delivery = loadTsModule("@/lib/notifications/serious-signal-delivery", overrides);
  for (const [name, seed] of [["first_delivery", fixture.objects], ["resumed_pending_delivery", fixture.pendingObjects]]) {
    objects = new Map(structuredClone(seed));
    const original = structuredClone(objects), candidate = objects.get(fixture.outboxKey).value.candidate;
    assert.ok(candidate.valuationRange.methods.some(method => method.method === "financial_ev_ebitda"));
    assert.equal(candidate.financialDocumentsRequired, true);
    assert.equal(financial.financialCandidatePublicationGap(candidate), null, "The packet reaches the EV boundary with complete annual document proof");
    assert.equal(methods.unsupportedEvEquityPublicationGap(candidate), "verified_ev_to_equity_bridge_unavailable");
    await assert.rejects(() => delivery.deliverSeriousSignalOutbox(fixture.outboxKey, { now }), /ev_to_equity_bridge_unverified/);
    assert.equal(writes, 0);
    assert.deepEqual(objects, original, "Neither pending state, historical approval, source nor receipt is rewritten");
    checks.push(name);
  }
  // Use the exact previously approved result, including its terminal bindings.
  objects = new Map(structuredClone(fixture.objects));
  const result = objects.get(fixture.resultKey).value;
  const source = readFileSync(new URL("../lib/opportunity-engine/pr262-event-job.ts", import.meta.url), "utf8")
    .replace("function committeeApproved(", "export function committeeApproved(");
  function approvalModule(extra = {}) {
    const cjs = { exports: {} };
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
    new Function("require", "module", "exports", code)(name => loadTsModule(name, { ...overrides, ...extra }), cjs, cjs.exports);
    return cjs.exports;
  }
  const before = structuredClone(objects);
  assert.equal(approvalModule({ "@/lib/opportunity-engine/us-sector-specialist-valuation": { ...methods, unsupportedEvEquityPublicationGap: () => null } })
    .committeeApproved(result.report, result.companyPointer, now), true, "Positive control: every pre-existing finalization gate accepts these exact baseline bytes");
  assert.equal(approvalModule().committeeApproved(result.report, result.companyPointer, now), false, "Resumed old results cannot create another current outbox");
  assert.deepEqual(objects, before);
  checks.push("saved_result_finalization");
  objects = new Map(structuredClone(fixture.deliveredObjects));
  const archive = structuredClone(objects);
  const repeated = await delivery.deliverSeriousSignalOutbox(fixture.outboxKey, { now });
  assert.equal(repeated.deliveryStatus, "delivered", "A canonical repeat returns the established delivery without republishing");
  assert.deepEqual(objects, archive);
  assert.equal(writes, 0);
  checks.push("canonical_delivered_repeat_preserved");
  const status = await delivery.getSeriousSignalStatus({ now });
  assert.equal(status.alerts.length, 1);
  assert.equal(status.alerts[0].publicationEligible, false);
  assert.equal(status.alerts[0].publicationHoldReason, "verified_ev_to_equity_bridge_unavailable");
  assert.equal(status.alerts[0].delivery.status, "delivered");
  assert.equal(status.alerts[0].committee.recommendation, "approve");
  assert.equal(status.summary.currentlyEligible, 0);
  assert.deepEqual(objects, archive, "The original approval and actual delivery receipt remain intact");
  assert.equal(writes, 0);
  checks.push("historical_delivery_visible_currently_held");
});
console.log(JSON.stringify({ ok: true, checks, baseline: fixture.baselineCommit, writes, fixtureSHA256: manifest.jsonSHA256 }));
