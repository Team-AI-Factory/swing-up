import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile(new URL("../lib/notifications/serious-signal-delivery.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { esModuleInterop: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

const prefix = "production/fundamental-signal-v2/";
const objects = new Map();
let etagCounter = 0;
function stored(key) {
  const value = objects.get(key);
  return value
    ? { found: true, text: `${JSON.stringify(value.payload)}\n`, etag: value.etag }
    : { found: false, text: null, etag: null };
}
async function write(key, payload, options = {}) {
  const current = objects.get(key);
  if (options.createOnly && current) return { written: false, conflict: true, etag: null };
  if (options.expectedEtag && current?.etag !== options.expectedEtag) return { written: false, conflict: true, etag: null };
  const etag = `"etag-${++etagCounter}"`;
  objects.set(key, { payload: structuredClone(payload), etag });
  return { written: true, conflict: false, etag };
}
async function list(prefixValue, options = {}) {
  const all = [...objects.keys()].filter((key) => key.startsWith(prefixValue)).sort();
  const start = options.continuationToken ? Number(options.continuationToken) : 0;
  const limit = options.limit ?? 250;
  const keys = all.slice(start, start + limit);
  const next = start + keys.length;
  return {
    keys,
    isTruncated: next < all.length,
    nextContinuationToken: next < all.length ? String(next) : null,
  };
}
function storageKey(relative) {
  return `${prefix}${relative}`;
}

const loaded = { exports: {} };
new Function("require", "module", "exports", output)((specifier) => {
  if (specifier === "node:crypto") return crypto;
  if (specifier === "@/lib/r2-warehouse") {
    return {
      listR2ObjectKeys: list,
      readVersionedTextFromR2: async (key) => stored(key),
      writeVersionedJsonToR2: write,
    };
  }
  if (specifier === "@/lib/opportunity-engine/pr262-storage") return { pr262StorageKey: storageKey };
  throw new Error(`Unexpected delivery import: ${specifier}`);
}, loaded, loaded.exports);

const {
  deliverSeriousSignalOutbox,
  processPendingSeriousSignalDeliveries,
  getSeriousSignalStatus,
} = loaded.exports;

function validOutbox(ticker, createdAt, overrides = {}) {
  const fingerprint = `${ticker.toLowerCase()}-evidence-fingerprint`;
  return {
    version: 1,
    kind: "pr262_committee_verified_event_signal",
    createdAt,
    ticker,
    cik: "0001234567",
    alertType: "buy",
    candidateFingerprint: fingerprint,
    candidate: {
      ticker,
      cik: "0001234567",
      direction: "upside",
      evidenceFingerprint: fingerprint,
      gatePassed: true,
      eventTruth: 96,
      mappingConfidence: 100,
      materiality: 88,
      transmissionConfidence: 90,
      evidenceIndependence: 92,
      contradictionPenalty: 0,
      pricedInPenalty: 0,
      rumour: false,
      eventHeadline: `${ticker} raises guidance`,
      whatHappened: "Verified guidance increased materially.",
      quote: { price: 42, observedAt: createdAt, actionableForSeriousSignal: true, marketSession: "regular" },
      receipts: [{ source: "SEC", url: "https://www.sec.gov/filing?document=guidance-8k&api_token=private-query#internal-fragment" }],
    },
    committee: {
      agentsCompleted: 14,
      agentsFailed: 0,
      finalJudge: { verdict: "positive", confidence: 88 },
      output: { overallRecommendation: "approve", SwingUpView: "Evidence is decision-grade." },
    },
    authority: {
      exactIssuerMapping: true,
      currentEvidenceGatesPassed: true,
      freshQuoteAndHaltStateKnown: true,
      fullCommitteeAgentsCompleted: 14,
      finalJudgePositiveMinimumConfidence: 80,
      historicalCasesRequired: false,
    },
    ...overrides,
  };
}

const originalEnvironment = { ...process.env };
const originalFetch = globalThis.fetch;
delete process.env.RAILWAY_GIT_BRANCH;
delete process.env.TELEGRAM_BOT_TOKEN;
delete process.env.TELEGRAM_SERIOUS_SIGNAL_CHAT_ID;
delete process.env.SWING_UP_SERIOUS_SIGNAL_WEBHOOK_URL;
process.env.RAILWAY_GIT_BRANCH = "main";
process.env.SWING_UP_SERIOUS_SIGNAL_DELIVERY_MAX_ATTEMPTS = "3";

try {
  const start = new Date("2026-08-19T10:00:00.000Z");
  const outboxKey = `${prefix}serious-signal/outbox/event-job/buy/SAFE/fingerprint.json`;
  await write(outboxKey, validOutbox("SAFE", start.toISOString()), { createOnly: true });

  const noChannel = await deliverSeriousSignalOutbox(outboxKey, { now: start, ownerId: "no-channel" });
  assert.equal(noChannel.ok, false, "No configured channel must be a visible failure.");
  assert.equal(noChannel.deliveryStatus, "blocked_no_channel");
  assert.equal(noChannel.lastError, "serious_signal_delivery_no_channel_configured");
  assert.equal(noChannel.exactlyOnceExternallyGuaranteed, false);

  process.env.SWING_UP_SERIOUS_SIGNAL_WEBHOOK_URL = "https://alerts.example.test/swing-up";
  let webhookCalls = 0;
  let webhookIdempotencyKey = null;
  globalThis.fetch = async (_url, init) => {
    webhookCalls += 1;
    webhookIdempotencyKey = new Headers(init.headers).get("idempotency-key");
    await new Promise((resolve) => setTimeout(resolve, 5));
    return new Response("ok", { status: 200 });
  };
  const afterRecheck = new Date(start.getTime() + 6 * 60_000);
  const [firstConcurrent, secondConcurrent] = await Promise.all([
    deliverSeriousSignalOutbox(outboxKey, { now: afterRecheck, ownerId: "worker-a" }),
    deliverSeriousSignalOutbox(outboxKey, { now: afterRecheck, ownerId: "worker-b" }),
  ]);
  assert.equal(webhookCalls, 1, "A durable claim must prevent concurrent duplicate sends.");
  assert.match(webhookIdempotencyKey, /^swing-up-[a-f0-9]{32}$/);
  assert.ok([firstConcurrent, secondConcurrent].some((result) => result.deliveryStatus === "delivered"));

  const retryOutboxKey = `${prefix}serious-signal/outbox/event-job/buy/RETRY/fingerprint.json`;
  await write(retryOutboxKey, validOutbox("RETRY", afterRecheck.toISOString()), { createOnly: true });
  globalThis.fetch = async () => new Response("temporary", { status: 503 });
  const failed = await deliverSeriousSignalOutbox(retryOutboxKey, { now: afterRecheck, ownerId: "retry-first" });
  assert.equal(failed.deliveryStatus, "retry_scheduled");
  assert.equal(failed.attempts, 1);
  globalThis.fetch = async () => {
    webhookCalls += 1;
    return new Response("ok", { status: 200 });
  };
  const retried = await processPendingSeriousSignalDeliveries({
    now: new Date(afterRecheck.getTime() + 2 * 60_000),
    maxJobs: 8,
    ownerId: "retry-consumer",
  });
  assert.equal(retried.errors.length, 0);
  assert.ok(retried.delivered >= 1, "The durable consumer must retry and deliver a failed job.");
  assert.ok(retried.discovery.maximumOutboxObjectReadsPerCycle <= 300, "Discovery must remain strictly bounded.");
  assert.ok(retried.maximumJobStateReadsPerCycle <= 100, "Job scanning must remain strictly bounded.");

  const status = await getSeriousSignalStatus({ now: new Date(afterRecheck.getTime() + 3 * 60_000), hours: 48 });
  assert.equal(status.summary.total, 2);
  assert.equal(status.summary.buy, 2);
  assert.equal(status.feedSource, "bounded_feed_index");
  assert.equal(status.sensor.verifiedLive, false, "An alert store alone must not pretend the scanner is live.");
  assert.equal(status.emptyResultVerified, false);
  assert.equal(status.secretsIncluded, false);
  assert.ok(status.alerts.every((alert) => JSON.stringify(alert).includes("document=guidance-8k")), "Status feed must preserve harmless evidence-link query data.");
  assert.ok(status.alerts.every((alert) => !JSON.stringify(alert).includes("private-query")), "Status feed must strip credential-like query data.");
  assert.ok(status.alerts.every((alert) => !JSON.stringify(alert).includes("internal-fragment")), "Status feed must strip URL fragments.");
  assert.ok(status.alerts.every((alert) => !JSON.stringify(alert).includes(outboxKey)), "Status feed must hide private R2 keys.");
  assert.ok(status.alerts.every((alert) => !("lastError" in alert.delivery)), "Status feed must not expose internal delivery errors.");
  const feedIndex = objects.get(`${prefix}serious-signal/delivery-v2/feed-index-v1.json`)?.payload;
  assert.equal(feedIndex.kind, "serious_signal_status_feed_index");
  assert.ok(feedIndex.pointers.length <= 500, "The live feed index must remain strictly bounded.");

  const invalidKey = `${prefix}serious-signal/outbox/event-job/buy/BAD/fingerprint.json`;
  await write(invalidKey, validOutbox("BAD", start.toISOString(), {
    committee: { agentsCompleted: 13, agentsFailed: 1, finalJudge: { verdict: "positive", confidence: 99 }, output: { overallRecommendation: "approve" } },
  }), { createOnly: true });
  await assert.rejects(() => deliverSeriousSignalOutbox(invalidKey, { now: start }), /serious_signal_delivery_incomplete_committee/);

  const missingAuthorityKey = `${prefix}serious-signal/outbox/event-job/buy/NOAUTH/fingerprint.json`;
  await write(missingAuthorityKey, validOutbox("NOAUTH", start.toISOString(), { authority: {} }), { createOnly: true });
  await assert.rejects(() => deliverSeriousSignalOutbox(missingAuthorityKey, { now: start }), /serious_signal_delivery_authority_missing/);

  const staleQuoteKey = `${prefix}serious-signal/outbox/event-job/buy/STALE/fingerprint.json`;
  const staleQuote = validOutbox("STALE", start.toISOString());
  staleQuote.candidate.quote.actionableForSeriousSignal = false;
  await write(staleQuoteKey, staleQuote, { createOnly: true });
  await assert.rejects(() => deliverSeriousSignalOutbox(staleQuoteKey, { now: start }), /serious_signal_delivery_market_state_not_actionable/);

  const oldObservationKey = `${prefix}serious-signal/outbox/event-job/buy/OLDQUOTE/fingerprint.json`;
  const oldObservation = validOutbox("OLDQUOTE", start.toISOString());
  oldObservation.candidate.quote.observedAt = new Date(start.getTime() - 16 * 60_000).toISOString();
  await write(oldObservationKey, oldObservation, { createOnly: true });
  await assert.rejects(() => deliverSeriousSignalOutbox(oldObservationKey, { now: start }), /serious_signal_delivery_market_state_not_actionable/);

  const pricedInKey = `${prefix}serious-signal/outbox/event-job/buy/PRICED/fingerprint.json`;
  const pricedIn = validOutbox("PRICED", start.toISOString());
  pricedIn.candidate.pricedInPenalty = 70;
  await write(pricedInKey, pricedIn, { createOnly: true });
  await assert.rejects(() => deliverSeriousSignalOutbox(pricedInKey, { now: start }), /serious_signal_delivery_current_evidence_not_approved/);

  const delayedKey = `${prefix}serious-signal/outbox/event-job/buy/DELAYED/fingerprint.json`;
  await write(delayedKey, validOutbox("DELAYED", start.toISOString()), { createOnly: true });
  const callsBeforeDelayed = webhookCalls;
  const delayed = await deliverSeriousSignalOutbox(delayedKey, {
    now: new Date(start.getTime() + 31 * 60_000),
    ownerId: "delayed-delivery",
  });
  assert.equal(delayed.deliveryStatus, "expired", "A recovered alert must expire before its quote can be presented as current.");
  assert.equal(webhookCalls, callsBeforeDelayed, "An economically stale alert must not reach an external channel.");

  const later = new Date("2026-08-27T10:00:00.000Z");
  const sensorKey = `${prefix}sensor/state-v1.json`;
  await write(sensorKey, {
    version: 1,
    updatedAt: later.toISOString(),
    sourceHealth: {},
  }, { createOnly: true });
  const invalidSensor = await getSeriousSignalStatus({ now: later, hours: 48 });
  assert.equal(invalidSensor.sensor.verifiedLive, false, "A malformed sensor contract must never certify an empty result.");

  await write(sensorKey, {
    version: 2,
    updatedAt: later.toISOString(),
    sourceHealth: {},
  }, { expectedEtag: objects.get(sensorKey).etag });
  const verifiedRailwayQuietCycle = await getSeriousSignalStatus({ now: later, hours: 48 });
  assert.equal(verifiedRailwayQuietCycle.sensor.verifiedLive, true, "A completed quiet Railway cycle must remain visible even when every source is not due.");
  assert.equal(verifiedRailwayQuietCycle.sensor.coverageVerified, false, "A fresh clock alone must not certify an empty market result.");
  assert.equal(verifiedRailwayQuietCycle.emptyResultVerified, false);
  assert.equal(verifiedRailwayQuietCycle.sensor.owner, "railway");

  await write(sensorKey, {
    version: 2,
    updatedAt: later.toISOString(),
    cloudflareSensor: { owner: "cloudflare_worker", checkedAt: later.toISOString() },
    sensorReadiness: { version: 1, checkedAt: later.toISOString(), universeReady: true, universeEntries: 6_000, exposureReady: true, exposureEntries: 5_900 },
    sourceHealth: Object.fromEntries(["cf_sec_broad", "cf_sec_urgent", "cf_google_news", "cf_trade_halts"].map((provider) => [provider, { status: "connected", attemptedThisCycle: true, checkedAt: later.toISOString(), lastSuccessAt: later.toISOString() }])),
  }, { expectedEtag: objects.get(sensorKey).etag });
  const verifiedEmpty = await getSeriousSignalStatus({ now: later, hours: 48 });
  assert.equal(verifiedEmpty.summary.total, 0);
  assert.equal(verifiedEmpty.sensor.verifiedLive, true);
  assert.equal(verifiedEmpty.sensor.coverageVerified, true);
  assert.equal(verifiedEmpty.sensor.owner, "cloudflare_worker");
  assert.equal(verifiedEmpty.emptyResultVerified, true, "Only a fresh sensor state may certify an empty alert window.");

  objects.set(sensorKey, {
    payload: {
      ...objects.get(sensorKey).payload,
      sourceHealth: Object.fromEntries(["cf_sec_broad", "cf_sec_urgent", "cf_google_news", "cf_trade_halts"].map((provider) => [provider, { status: "not_due", attemptedThisCycle: false, checkedAt: later.toISOString(), lastSuccessAt: later.toISOString() }])),
    },
    etag: `etag-${++etagCounter}`,
  });
  const skippedCriticalCycle = await loaded.exports.getSeriousSignalStatus({ now: later, hours: 48 });
  assert.equal(skippedCriticalCycle.emptyResultVerified, false, "A current scan that skipped critical sources must not certify a zero-alert result from an older success.");

  await write(sensorKey, {
    version: 2,
    updatedAt: later.toISOString(),
    sourceHealth: Object.fromEntries(["cf_sec_broad", "cf_sec_urgent", "cf_google_news", "cf_trade_halts"].map((provider, index) => [provider, { status: index === 0 ? "partial" : "connected", attemptedThisCycle: true, checkedAt: later.toISOString(), lastSuccessAt: later.toISOString() }])),
    sensorReadiness: { version: 1, checkedAt: later.toISOString(), universeReady: true, universeEntries: 8_000, exposureReady: true, exposureEntries: 8_000 },
    cloudflareSensor: { version: 1, owner: "cloudflare_worker", checkedAt: later.toISOString() },
  }, { expectedEtag: objects.get(sensorKey).etag });
  const partialCriticalCycle = await getSeriousSignalStatus({ now: later, hours: 1, limit: 10 });
  assert.equal(partialCriticalCycle.sensor.coverageVerified, false);
  assert.equal(partialCriticalCycle.emptyResultVerified, false, "A partial critical feed may discover candidates but can never certify zero alerts.");

  const staleCloudflareCheckedAt = new Date(later.getTime() - 21 * 60_000).toISOString();
  await write(sensorKey, {
    ...objects.get(sensorKey).payload,
    updatedAt: later.toISOString(),
    cloudflareSensor: { version: 1, owner: "cloudflare_worker", checkedAt: staleCloudflareCheckedAt },
  }, { expectedEtag: objects.get(sensorKey).etag });
  const analysisWriteAfterStoppedWorker = await getSeriousSignalStatus({ now: later, hours: 1, limit: 10 });
  assert.equal(analysisWriteAfterStoppedWorker.sensor.verifiedLive, false, "A Railway state write must not impersonate a fresh Cloudflare scan.");
  assert.equal(analysisWriteAfterStoppedWorker.emptyResultVerified, false);

  const feedIndexKey = `${prefix}serious-signal/delivery-v2/feed-index-v1.json`;
  const currentFeedIndex = objects.get(feedIndexKey);
  await write(feedIndexKey, {
    ...currentFeedIndex.payload,
    truncated: true,
  }, { expectedEtag: currentFeedIndex.etag });
  const truncatedEmpty = await getSeriousSignalStatus({ now: later, hours: 48 });
  assert.equal(truncatedEmpty.summary.total, 0);
  assert.equal(truncatedEmpty.feedSource, "immutable_pointer_fallback", "A truncated compact index must recover from immutable daily pointers.");
  assert.equal(truncatedEmpty.truncated, false, "A complete daily fallback can prove the requested window even when the lifetime index is full.");

  for (let index = 0; index < 101; index += 1) {
    objects.set(`${prefix}serious-signal/delivery-v2/feed/2026-08-27/dummy-${String(index).padStart(3, "0")}.json`, {
      payload: { version: 1, kind: "invalid_test_pointer" },
      etag: `etag-${++etagCounter}`,
    });
  }
  const boundedFallback = await getSeriousSignalStatus({ now: later, hours: 48 });
  assert.equal(boundedFallback.truncated, true);
  assert.equal(boundedFallback.emptyResultVerified, false, "A truncated immutable daily page can never certify an empty alert window.");
} finally {
  globalThis.fetch = originalFetch;
  for (const key of Object.keys(process.env)) if (!(key in originalEnvironment)) delete process.env[key];
  Object.assign(process.env, originalEnvironment);
}

console.log(JSON.stringify({
  ok: true,
  noChannelFailsClosed: true,
  concurrentClaimPreventsDuplicateSend: true,
  webhookIdempotencyKeyIncluded: true,
  durableRetryConsumer: true,
  boundedCursorScanning: true,
  sanitizedFortyEightHourFeed: true,
  boundedRecoverableFeedIndex: true,
  deliveryRequiresExactAuthority: true,
  staleQuoteCannotReachUser: true,
  staleMarketObservationCannotReachUser: true,
  pricedInSignalCannotReachUser: true,
  delayedNotificationCannotReuseOldQuote: true,
  emptyWindowRequiresFreshCompleteSensorProof: true,
  partialCriticalFeedCannotCertifyEmptyWindow: true,
  railwayWriteCannotImpersonateCloudflareHeartbeat: true,
  truncatedFeedCannotCertifyEmptyWindow: true,
  externalGuaranteeAccuratelyAtLeastOnce: true,
}, null, 2));
