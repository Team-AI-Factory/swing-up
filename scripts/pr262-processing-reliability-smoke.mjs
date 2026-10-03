import assert from "node:assert/strict";
import { loadTsModule } from "./helpers/load-typescript-module.mjs";

const { pr262ProcessingReliability: measure } = loadTsModule("@/lib/opportunity-engine/pr262-processing-reliability");
assert.equal(measure([{ status: "idle" }, { status: "busy" }]).processingFailureRatePercent, null);
const technical = { ok: true, status: "event_job_deferred", nonterminal: true, openAiCalled: true,
  analysisDiagnostics: { status: "committee_failed", committee: { status: "agent_failures", agentsFailed: 1,
    roleDiagnostics: [{ agentId: "final_judge", status: "failed", error: "prompt_too_large" }] } } };
const incomplete = { ...technical, analysisDiagnostics: { status: "candidate_needs_more_data",
  committee: { status: "completed", agentsCompleted: 4, agentsFailed: 0 } } };
const noSignal = { ok: true, status: "completed", analysisDiagnostics: { status: "no_qualified_signal" } };
const mixed = measure([technical, incomplete, noSignal, { ok: true, status: "event_job_deferred" }, { status: "idle" }]);
assert.equal(mixed.processingAttempts, 4);
assert.equal(mixed.processingFailures, 1);
assert.equal(mixed.processingFailureRatePercent, 25);
assert.equal(mixed.committeeReviewAttempts, 2);
assert.equal(mixed.committeeTechnicalFailures, 1);
assert.equal(mixed.committeeFailureRatePercent, 50);
assert.equal(mixed.nontechnicalDeferrals, 2);
assert.equal(mixed.committeeOutcomeUnknown, 0);
assert.equal(measure([{ ...technical, ok: false }]).processingFailures, 1, "One failed operation must not be counted twice");
assert.equal(measure([{ ok: false, status: "event_job_error" }]).processingFailures, 1);
assert.equal(measure([{ ok: true, openAiCalled: true }]).committeeOutcomeUnknown, 1, "Missing diagnostics cannot certify review success");
assert.equal(measure([{ ok: true, analysisDiagnostics: { status: "technical_failure" } }]).processingFailures, 1);

let saved = { version: 1, date: "2026-10-03", cycles: 7, eventFailures: 0 };
let rejectWrite = false;
let conflicts = 0;
const { recordPr262CostEffectiveness: record } = loadTsModule("@/lib/opportunity-engine/pr262-cost-effectiveness", {
  "@/lib/opportunity-engine/pr262-storage": { pr262StorageKey: key => `test-only/${key}` },
  "@/lib/r2-warehouse": {
    readVersionedTextFromR2: async () => ({ found: true, text: JSON.stringify(saved), etag: "fake-etag" }),
    writeVersionedJsonToR2: async (_key, value) => {
      if (conflicts-- > 0) return { conflict: true, written: false };
      if (!rejectWrite) saved = structuredClone(value);
      return { conflict: false, written: !rejectWrite };
    },
  },
});
const cycle = { checkedAt: "2026-10-03T11:00:00.000Z", durationMs: 1, sourceAttempts: 2, sourceFailures: 0,
  newEvents: 0, sectorFanoutEvents: 0, pendingEvents: 1, eventsProcessed: 0, eventFailures: 1,
  aiCalls: 2, seriousBuys: 0, seriousSells: 0, seriousWatchOuts: 0, processingReliability: mixed };
conflicts = 1;
const first = await record(cycle);
assert.equal(first.daily.cycles, 8);
assert.equal(first.daily.processingMeasuredCycles, 1, "Legacy cycles must not acquire invented processing measurements");
assert.equal(first.daily.processingMeasurementStartedAt, cycle.checkedAt);
assert.equal(first.daily.processingAttempts, 4);
assert.equal(first.daily.processingFailures, 1);
assert.equal(first.daily.derived.processingFailureRatePercent, 25);
assert.equal(first.daily.derived.committeeFailureRatePercent, 50);
const quiet = await record({ ...cycle, checkedAt: "2026-10-03T11:15:00.000Z", eventFailures: 0, aiCalls: 0, processingReliability: measure([]) });
assert.equal(quiet.daily.processingMeasuredCycles, 2);
assert.equal(quiet.daily.processingAttempts, 4, "Quiet runs must not dilute the denominator");
assert.equal(quiet.daily.derived.committeeFailureRatePercent, 50);
rejectWrite = true;
await assert.rejects(() => record(cycle), /metrics_write_failed/);
console.log("Processing reliability: failed required roles count despite HTTP success, no-signal and evidence decisions stay valid, idle excluded, partial usage unchanged, legacy measurement gaps visible.");
