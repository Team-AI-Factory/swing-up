import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadTsModule } from "./helpers/load-typescript-module.mjs";
import { inSimpleAlertPilot } from "./helpers/simple-alert-pilot-fixture.mjs";
import { companyProfileFixture } from "./helpers/company-profile-fixture.mjs";

const config = JSON.parse(readFileSync(new URL("../config/simple-alert-pilot.json", import.meta.url), "utf8"));
const objects = new Map(), decisions = new Map(); let serial = 0, failReceiptFor = null;
const r2 = {
  readVersionedTextFromR2: async (key, options = {}) => {
    options.signal?.throwIfAborted();
    const row = objects.get(key);
    return row ? { found: true, text: JSON.stringify(row.value), etag: row.etag } : { found: false, text: null, etag: null };
  },
  writeVersionedJsonToR2: async (key, value, options = {}) => {
    options.signal?.throwIfAborted(); const prior = objects.get(key);
    if (key.includes("/receipts/web_feed/") && value.outboxKey === failReceiptFor) {
      failReceiptFor = null;
      throw new Error("fixture_receipt_write_failed");
    }
    if ((options.createOnly && prior) || (options.expectedEtag && prior?.etag !== options.expectedEtag)) return { conflict: true, written: false, etag: null };
    const etag = String(++serial); objects.set(key, { value: structuredClone(value), etag });
    return { conflict: false, written: true, etag };
  },
  listR2ObjectKeys: async prefix => ({ keys: [...objects.keys()].filter(key => key.startsWith(prefix)), isTruncated: false, nextContinuationToken: null }),
};

await inSimpleAlertPilot(async () => {
  process.env.SWING_UP_PR262_EXTERNAL_NOTIFICATIONS_ENABLED = "false";
  const terminal = loadTsModule("@/lib/equity-signal/terminal-review-evidence");
  const load = cohortId => {
    const overrides = {
      "@/config/simple-alert-pilot.json": { ...config, cohortId },
      "@/lib/r2-warehouse": r2,
      "@/lib/opportunity-engine/company-profile-cache": { readCompanyProfiles: async () => new Map() },
      "@/lib/opportunity-engine/pr262-terminal-reviews": { readTerminalDecision: async ({ cik, decisionKey, signal }) => {
        signal?.throwIfAborted(); return decisions.get(`${cik}:${decisionKey}`) ?? null;
      } },
    };
    return { storage: loadTsModule("@/lib/opportunity-engine/pr262-storage", overrides),
      delivery: loadTsModule("@/lib/notifications/serious-signal-delivery", overrides) };
  };
  const now = new Date("2026-10-06T19:00:00Z"), identity = { ticker: "TEST", cik: "0001234567", company: "Test Software Company" };
  const make = tag => {
    const fingerprint = `fixture-${tag}`;
    const evidence = terminal.terminalReviewEvidence({ ...identity, scope: "event", price: 42, analysis: {},
      evidence: { source: [{ rawEventType: "8-K", summary: `Verified source content ${tag}` }], facts: [], financialDocuments: [],
        outlookRange: { currency: "USD", base: 55 }, priceReady: true, haltKnown: true, halted: false } });
    decisions.set(`${identity.cik}:${evidence.decisionKey}`, { version: 1, ...identity, direction: "upside", decisionKey: evidence.decisionKey,
      outcome: "approved", fingerprint, evidence, decidedAt: now.toISOString(), eventId: `event-${tag}` });
    const outbox = { version: 1, kind: "pr262_committee_verified_event_signal", createdAt: now.toISOString(), ticker: identity.ticker, cik: identity.cik,
      alertType: "buy", candidateFingerprint: fingerprint,
      candidate: { ...identity, direction: "upside", currency: "USD", industry: "Application software", companyProfile: companyProfileFixture(identity),
        evidenceFingerprint: fingerprint, terminalEvidence: evidence, terminalDecisionKey: evidence.decisionKey,
        valuationRange: { conservativeValue: 38, baseValue: 55, optimisticValue: 65 }, gatePassed: true, eventTruth: 96,
        mappingConfidence: 100, materiality: 88, transmissionConfidence: 90, evidenceIndependence: 92, contradictionPenalty: 0,
        pricedInPenalty: 0, rumour: false, eventHeadline: "Verified guidance increased", whatHappened: "A dated filing raised the current operating guidance.",
        quote: { price: 42, observedAt: "2026-10-06T18:58:00Z", actionableForSeriousSignal: true, marketSession: "regular" },
        receipts: [{ source: "SEC", url: "https://www.sec.gov/Archives/edgar/data/1234567/fixture.htm" }] },
      committee: { agentsCompleted: 14, agentsFailed: 0, finalJudge: { verdict: "positive", confidence: 88 }, output: { overallRecommendation: "approve" } },
      authority: { exactIssuerMapping: true, currentEvidenceGatesPassed: true, freshQuoteAndHaltStateKnown: true,
        fullCommitteeAgentsCompleted: 14, finalJudgePositiveMinimumConfidence: 80, historicalCasesRequired: false } };
    decisions.get(`${identity.cik}:${evidence.decisionKey}`).publicationPacketKey = terminal.terminalPublicationPacketKey(outbox.candidate);
    return outbox;
  };
  const a = load("cohort-a"), b = load("cohort-b");
  assert.equal(a.storage.pr262StorageKey("serious-signal/evidence-delivery-v1/probe.json"), b.storage.pr262StorageKey("serious-signal/evidence-delivery-v1/probe.json"),
    "The real pilot routing keeps evidence ownership outside cohort namespaces");
  assert.notEqual(a.storage.pr262StorageKey("serious-signal/delivery-v2"), b.storage.pr262StorageKey("serious-signal/delivery-v2"));
  const firstKey = a.storage.pr262StorageKey("serious-signal/outbox/event-job/buy/TEST/first.json");
  const aliasKey = b.storage.pr262StorageKey("serious-signal/outbox/event-job/buy/TEST/daily-alias.json");
  const first = make("A");
  await r2.writeVersionedJsonToR2(firstKey, first, { createOnly: true });
  assert.equal((await a.delivery.deliverSeriousSignalOutbox(firstKey, { now })).deliveryStatus, "delivered");
  await r2.writeVersionedJsonToR2(aliasKey, first, { createOnly: true });
  const replay = await b.delivery.deliverSeriousSignalOutbox(aliasKey, { now: new Date(now.getTime() + 36 * 3600000) });
  assert.equal(replay.duplicateSuppressed, true);
  assert.equal(replay.canonicalOutboxKey, firstKey);
  assert.equal(replay.canonicalDeliveryStatus, "delivered");
  const forFirst = fragment => [...objects].filter(([key, row]) => key.includes(fragment) && row.value.outboxKey === firstKey);
  assert.equal(forFirst("/receipts/web_feed/").length, 1, "A cohort change cannot create a new receipt for the old canonical outbox");
  assert.equal(forFirst("/feed/").length, 1);
  assert.equal(forFirst("/jobs/").length, 1);
  assert.ok(forFirst("/receipts/web_feed/")[0][0].includes("/cohorts/cohort-a/"));
  assert.equal([...objects].filter(([key]) => key.includes("/cohorts/cohort-b/") && /\/receipts\/|\/feed\//.test(key)).length, 0);
  const newKey = b.storage.pr262StorageKey("serious-signal/outbox/event-job/buy/TEST/new-source.json");
  await r2.writeVersionedJsonToR2(newKey, make("B"), { createOnly: true });
  assert.equal((await b.delivery.deliverSeriousSignalOutbox(newKey, { now })).deliveryStatus, "delivered");
  assert.equal((await a.delivery.deliverSeriousSignalOutbox(firstKey, { now })).deliveryStatus, "delivered");
  assert.equal([...objects].filter(([key]) => key.includes("/receipts/web_feed/")).length, 2, "A→B→A keeps exactly two genuine evidence deliveries");
  const retryA = a.storage.pr262StorageKey("serious-signal/outbox/event-job/buy/TEST/retry-original.json");
  const retryB = b.storage.pr262StorageKey("serious-signal/outbox/event-job/buy/TEST/retry-alias.json");
  const retryPayload = make("C");
  await r2.writeVersionedJsonToR2(retryA, retryPayload, { createOnly: true });
  failReceiptFor = retryA;
  const waiting = await a.delivery.deliverSeriousSignalOutbox(retryA, { now });
  assert.equal(waiting.deliveryStatus, "retry_scheduled");
  await r2.writeVersionedJsonToR2(retryB, retryPayload, { createOnly: true });
  const proxy = await b.delivery.deliverSeriousSignalOutbox(retryB, { now });
  assert.equal(proxy.deliveryStatus, "retry_scheduled", "A cohort alias retains the canonical retry until it actually settles");
  assert.equal(proxy.canonicalDeliveryStatus, "retry_scheduled");
  const recovered = await b.delivery.processPendingSeriousSignalDeliveries({ now: new Date(Date.parse(waiting.nextAttemptAt) + 1), maxJobs: 25 });
  assert.equal(recovered.ok, true);
  const aliasJob = [...objects.values()].find(row => row.value.kind === "serious_signal_delivery_job" && row.value.outboxKey === retryB).value;
  assert.equal(aliasJob.status, "duplicate_suppressed");
  assert.equal([...objects].filter(([key, row]) => key.includes("/receipts/web_feed/") && row.value.outboxKey === retryA).length, 1);
  assert.equal([...objects].filter(([key, row]) => key.includes("/receipts/web_feed/") && row.value.outboxKey === retryB).length, 0);
});
console.log("PASS: actual pilot storage routing preserves canonical jobs/receipts/feed across cohort changes, reloads, elapsed time and A→B→A; isolated in-memory storage only.");
