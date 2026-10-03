import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadTsModule } from "./helpers/load-typescript-module.mjs";

const saved = { ...process.env };
const prefix = "branch-labs/simple-alerts/";
const env = {
  SWING_UP_SIMPLE_PILOT_ENABLED: "true", SWING_UP_SIMPLE_PILOT_ROLE: "sensor",
  RAILWAY_GIT_BRANCH: "pilot-simple-alerts", RAILWAY_GIT_COMMIT_SHA: "a".repeat(40),
  RAILWAY_PROJECT_ID: "83d99341-d622-475f-8035-00ef3d0916d1",
  RAILWAY_ENVIRONMENT_ID: "87afb8d7-c4fc-4f84-92b6-5d2820a689b6",
  SWING_UP_PR262_STORAGE_PREFIX: prefix, SWING_UP_R2_WRITE_PREFIX: prefix,
  SWING_UP_PR262_DELIVERY_TEST_RUNTIME_TOKEN: "ephemeral-test-only",
  SWING_UP_PR262_APPROVED_DELIVERY_TEST: "true", SWING_UP_PR262_DELIVERY_TEST_RUN_ID: `pilot-${"a".repeat(40)}`,
  SWING_UP_PR262_DELIVERY_TEST_EXTERNAL_ENABLED: "false", SWING_UP_PR262_EXTERNAL_NOTIFICATIONS_ENABLED: "false",
};
Object.assign(process.env, env);
const objects = new Map();
let serial = 0;
const io = {
  readVersionedTextFromR2: async key => {
    const item = objects.get(key);
    return item ? { found: true, text: JSON.stringify(item.payload), etag: item.etag } : { found: false, text: null, etag: null };
  },
  writeVersionedJsonToR2: async (key, payload, options = {}) => {
    assert.ok(key.startsWith(prefix), "No production namespace write is allowed");
    const old = objects.get(key);
    if (options.createOnly && old || options.expectedEtag && options.expectedEtag !== old?.etag) return { written: false, conflict: true, etag: null };
    const etag = String(++serial);
    objects.set(key, { payload: structuredClone(payload), etag });
    return { written: true, conflict: false, etag };
  },
  listR2ObjectKeys: async () => { throw new Error("Controls cannot scan live data"); },
};
const overrides = {
  "next/server": { NextResponse: { json: (value, options = {}) => Response.json(value, { status: options.status ?? 200 }) } },
  "@/lib/r2-warehouse": io,
  "@/lib/opportunity-engine/pr262-storage": { pr262StorageKey: key => `${prefix}${key}`, resolvePr262StoragePrefix: () => process.env.SWING_UP_PR262_STORAGE_PREFIX },
  "@/lib/opportunity-engine/company-profile-cache": { readCompanyProfiles: async () => new Map() },
};
const route = loadTsModule("@/app/api/internal/combined-opportunity-engine/delivery-test/route", overrides);
const request = (token = env.SWING_UP_PR262_DELIVERY_TEST_RUNTIME_TOKEN, confirm = true) => ({
  headers: new Headers({ "x-swing-up-pr262-delivery-test-token": token }), json: async () => ({ confirmDeliveryTest: confirm }),
});
const realFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error("No external delivery or model requests are permitted"); };
try {
  assert.equal((await route.POST(request("wrong"))).status, 404);
  assert.equal((await route.POST(request(undefined, false))).status, 400);
  for (const [key, value] of [["RAILWAY_GIT_BRANCH", "main"], ["SWING_UP_SIMPLE_PILOT_ROLE", "profiles"], ["SWING_UP_PR262_DELIVERY_TEST_EXTERNAL_ENABLED", "true"], ["RAILWAY_ENVIRONMENT_ID", "other"]]) {
    process.env[key] = value;
    assert.equal((await route.POST(request())).status, 404, `${key} must fail closed`);
    process.env[key] = env[key];
  }
  const firstResponse = await route.POST(request());
  const first = await firstResponse.json();
  assert.equal(firstResponse.status, 200, JSON.stringify(first));
  assert.equal(first.ok, true);
  assert.equal(first.testOnly, true);
  assert.equal(first.receiptVerified, true);
  assert.equal(first.negativeControlPassed, true);
  assert.equal(first.duplicateSuppressed, true);
  assert.equal(first.seriousSignalFeedExcluded, true);
  assert.equal(first.firstInvocationTelegramSent, false);
  const receipts = [...objects.keys()].filter(key => key.includes("/receipts/"));
  assert.equal(receipts.length, 1, "Only the positive isolated web receipt may exist");
  assert.equal(receipts[0], first.receiptKey);
  assert.ok(![...objects.keys()].some(key => key.includes("/delivery-v2/")), "Test controls must not touch the live feed or live jobs");
  const receiptBefore = structuredClone(objects.get(first.receiptKey));
  const repeated = await (await route.POST(request())).json();
  assert.equal(repeated.ok, true);
  assert.equal(repeated.firstInvocationWebFeedSent, false);
  assert.equal(repeated.duplicateSuppressed, true);
  assert.deepEqual(objects.get(first.receiptKey), receiptBefore, "Idempotent controls retain the original receipt");
  // A missing durable receipt must be visible even if a job claims delivery.
  objects.delete(first.receiptKey);
  const missing = await route.POST(request());
  assert.equal(missing.status, 503);
  assert.equal((await missing.json()).receiptVerified, false);
  const launcher = readFileSync("scripts/simple-alert-pilot-cycle.mjs", "utf8");
  assert.match(launcher, /--hostname", "127\.0\.0\.1/);
  assert.match(launcher, /crypto\.randomBytes\(32\)/);
  assert.match(launcher, /negativeControlPassed !== true/);
  assert.match(launcher, /seriousSignalFeedExcluded !== true/);
  console.log("Pilot live-control route: strict runtime/auth, durable receipt read-back, rejected negative control, idempotence, missing-receipt failure, no live feed or external requests passed.");
} finally {
  globalThis.fetch = realFetch;
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
  Object.assign(process.env, saved);
}
