import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";

const nodeRequire = createRequire(import.meta.url);
const source = readFileSync(new URL("../lib/opportunity-engine/worldwide-learning-ledger.ts", import.meta.url), "utf8");
const globalRoute = readFileSync(new URL("../app/api/internal/combined-opportunity-engine/global-scan/route.ts", import.meta.url), "utf8");
const deepRoute = readFileSync(new URL("../app/api/internal/combined-opportunity-engine/global-deep-research/route.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    esModuleInterop: true,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;

const objects = new Map();
let etagSequence = 0;
let activeFindingWrites = 0;
let maximumConcurrentFindingWrites = 0;
let findingCreateAttempts = 0;
let findingWriteDelayMs = 0;
let transientFindingFailuresRemaining = 0;
let persistentFindingFailureSymbol = null;
const findingAttemptKeys = new Set();
let activeOutcomeWrites = 0;
let maximumConcurrentOutcomeWrites = 0;
let outcomeCreateAttempts = 0;
let outcomeWriteDelayMs = 0;
const outcomeAttemptKeys = new Set();
const nextEtag = () => `"etag-${++etagSequence}"`;
const r2 = {
  getR2Config: () => ({ configured: true }),
  normalizeR2WritePrefix: (value) => value?.trim() || null,
  readVersionedTextFromR2: async (key) => {
    const current = objects.get(key);
    return current
      ? { found: true, text: current.text, etag: current.etag }
      : { found: false, text: null, etag: null };
  },
  writeVersionedJsonToR2: async (key, payload, options = {}) => {
    const findingCreate = options.createOnly === true && key.includes("/findings/");
    const outcomeCreate = options.createOnly === true && key.includes("/outcomes/");
    if (findingCreate) {
      findingCreateAttempts += 1;
      findingAttemptKeys.add(key);
      activeFindingWrites += 1;
      maximumConcurrentFindingWrites = Math.max(maximumConcurrentFindingWrites, activeFindingWrites);
    }
    if (outcomeCreate) {
      outcomeCreateAttempts += 1;
      outcomeAttemptKeys.add(key);
      activeOutcomeWrites += 1;
      maximumConcurrentOutcomeWrites = Math.max(maximumConcurrentOutcomeWrites, activeOutcomeWrites);
    }
    try {
      if (findingCreate && findingWriteDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, findingWriteDelayMs));
      }
      if (outcomeCreate && outcomeWriteDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, outcomeWriteDelayMs));
      }
      if (findingCreate && transientFindingFailuresRemaining > 0) {
        transientFindingFailuresRemaining -= 1;
        throw new Error("simulated_transient_r2_write_failure");
      }
      if (findingCreate && payload.tradingViewSymbol === persistentFindingFailureSymbol) {
        throw new Error("simulated_persistent_r2_write_failure");
      }
      const current = objects.get(key);
      if (options.createOnly && current) return { written: false, conflict: true, etag: null };
      if (options.expectedEtag && current?.etag !== options.expectedEtag) return { written: false, conflict: true, etag: null };
      if (options.expectedEtag && !current) return { written: false, conflict: true, etag: null };
      const etag = nextEtag();
      objects.set(key, { text: `${JSON.stringify(payload, null, 2)}\n`, etag });
      return { written: true, conflict: false, etag };
    } finally {
      if (findingCreate) activeFindingWrites -= 1;
      if (outcomeCreate) activeOutcomeWrites -= 1;
    }
  },
};
const customRequire = (id) => {
  if (id === "node:crypto") return nodeRequire(id);
  if (id === "@/lib/r2-warehouse") return r2;
  throw new Error(`Unexpected test import: ${id}`);
};
const cjsModule = { exports: {} };
const testProcess = {
  ...process,
  env: {
    ...process.env,
    RAILWAY_GIT_BRANCH: "agent/combined-opportunity-engine",
    SWING_UP_R2_WRITE_PREFIX: "branch-labs/pr-262/",
  },
};
vm.runInNewContext(
  `(function (exports, module, require, process) { ${compiled}\n})(cjsModule.exports, cjsModule, customRequire, process);`,
  { cjsModule, customRequire, process: testProcess, setTimeout },
);
const ledger = cjsModule.exports;

const firstAt = "2026-07-20T10:00:00.000Z";
const finding = (overrides = {}) => ({
  kind: "research_finding",
  tradingViewSymbol: "NASDAQ:AAA",
  symbol: "AAA",
  company: "AAA Corp",
  exchange: "NASDAQ",
  country: "United States",
  action: "buy",
  disposition: "advance_to_committee_research",
  currentPrice: 100,
  observedAt: firstAt,
  qualifiedCertified: false,
  rejectionReasons: ["Independent Buy certification is unavailable."],
  evidence: { evidenceScore: 88, realProviderDataOnly: true },
  ...overrides,
});
const firstRun = {
  workflow: "global_deep_research",
  checkedAt: firstAt,
  runtimeCommit: "abc123",
  summary: { ok: true, researched: 2, safety: { databaseWrites: false, publishing: false, notifications: false, trading: false } },
  findings: [
    finding(),
    finding({
      tradingViewSymbol: "NYSE:BBB",
      symbol: "BBB",
      company: "BBB Corp",
      action: "watch_out",
      disposition: "reject_or_deprioritize",
      currentPrice: 50,
      rejectionReasons: ["Current prices conflict.", "Insufficient independent evidence."],
    }),
  ],
  observations: [
    { tradingViewSymbol: "NASDAQ:AAA", price: 100, observedAt: firstAt, source: "TradingView public stock scanner" },
    { tradingViewSymbol: "NYSE:BBB", price: 50, observedAt: firstAt, source: "TradingView public stock scanner" },
  ],
};

const first = await ledger.persistWorldwideLearningRun(firstRun);
assert.equal(first.durable, true);
assert.equal(first.branchNamespace, "pr-262");
assert.equal(first.findingObjects.length, 2);
assert.equal(first.outcomeObjects.length, 0);
assert.equal(first.pendingOutcomeFindingCount, 2);
assert.match(first.runObject, /^branch-labs\/pr-262\/worldwide-learning\/runs\//);
assert.ok(first.findingObjects.every((key) => key.startsWith("branch-labs/pr-262/worldwide-learning/findings/")));
assert.equal(first.safety.databaseWrites, false);
assert.equal(first.safety.publishing, false);
assert.equal(first.safety.notifications, false);
assert.equal(first.safety.trading, false);

const firstFindingPayload = JSON.parse(objects.get(first.findingObjects[1]).text);
assert.deepEqual(firstFindingPayload.rejectionReasons, ["Current prices conflict.", "Insufficient independent evidence."]);
assert.equal(firstFindingPayload.immutable, true);
assert.equal(firstFindingPayload.realProviderDataOnly, true);

const objectCountAfterFirst = objects.size;
const identicalRetry = await ledger.persistWorldwideLearningRun(firstRun);
assert.equal(objects.size, objectCountAfterFirst);
assert.equal(identicalRetry.runObject, first.runObject);
assert.deepEqual(identicalRetry.findingObjects, first.findingObjects);

const secondAt = "2026-07-21T10:00:00.000Z";
const secondRun = {
  ...firstRun,
  checkedAt: secondAt,
  runtimeCommit: "def456",
  findings: firstRun.findings.map((item) => ({ ...item, observedAt: secondAt })),
  observations: [
    { tradingViewSymbol: "NASDAQ:AAA", price: 104, observedAt: secondAt, source: "TradingView public stock scanner" },
    { tradingViewSymbol: "NYSE:BBB", price: 57, observedAt: secondAt, source: "TradingView public stock scanner" },
  ],
};
const second = await ledger.persistWorldwideLearningRun(secondRun);
assert.equal(second.outcomeObjects.length, 2);
assert.ok(second.outcomeObjects.every((key) => key.startsWith("branch-labs/pr-262/worldwide-learning/outcomes/")));
const outcomes = second.outcomeObjects.map((key) => JSON.parse(objects.get(key).text));
const buyOutcome = outcomes.find((item) => item.tradingViewSymbol === "NASDAQ:AAA");
const watchOutcome = outcomes.find((item) => item.tradingViewSymbol === "NYSE:BBB");
assert.equal(buyOutcome.checkpoint, "1D");
assert.equal(buyOutcome.forwardReturnPercent, 4);
assert.equal(buyOutcome.directionAdjustedReturnPercent, 4);
assert.equal(watchOutcome.checkpoint, "1D");
assert.equal(watchOutcome.forwardReturnPercent, 14);
assert.equal(watchOutcome.directionAdjustedReturnPercent, null);
assert.equal(watchOutcome.usefulAtCheckpoint, true);
assert.ok(outcomes.every((item) => item.immutable === true));
assert.ok(outcomes.every((item) => item.safety.databaseWrites === false && item.safety.publishing === false && item.safety.notifications === false && item.safety.trading === false));

const state = JSON.parse(objects.get("branch-labs/pr-262/worldwide-learning/state-v1.json").text);
const oldPending = state.pendingFindings.filter((item) => item.signalObservedAt === firstAt);
assert.equal(oldPending.length, 2);
assert.ok(oldPending.every((item) => typeof item.checkpointObjects["1D"] === "string"));

const duplicateConflictAt = "2026-07-21T12:00:00.000Z";
await assert.rejects(
  () => ledger.persistWorldwideLearningRun({
    ...firstRun,
    checkedAt: duplicateConflictAt,
    runtimeCommit: "duplicate-identity-conflict",
    findings: [
      finding({ observedAt: duplicateConflictAt }),
      finding({ observedAt: duplicateConflictAt, company: "Conflicting payload for the same finding identity" }),
    ],
    observations: [],
  }),
  /worldwide_learning_duplicate_finding_identity_conflict/,
);

const drainAt = "2026-07-21T13:00:00.000Z";
const drainFindings = Array.from({ length: 24 }, (_, index) => finding({
  tradingViewSymbol: `NASDAQ:DRAIN${String(index).padStart(2, "0")}`,
  symbol: `DRAIN${String(index).padStart(2, "0")}`,
  company: `Drain Corp ${index}`,
  observedAt: drainAt,
}));
findingAttemptKeys.clear();
persistentFindingFailureSymbol = "NASDAQ:DRAIN00";
await assert.rejects(
  () => ledger.persistWorldwideLearningRun({
    ...firstRun,
    checkedAt: drainAt,
    runtimeCommit: "drain-before-throw-regression",
    findings: drainFindings,
    observations: [],
  }),
  /simulated_persistent_r2_write_failure/,
);
persistentFindingFailureSymbol = null;
assert.equal(findingAttemptKeys.size, drainFindings.length, "Workers stopped before all independent immutable writes drained.");

const bulkFindingCount = 64;
const bulkAt = "2026-07-22T10:00:00.000Z";
const bulkFindings = Array.from({ length: bulkFindingCount }, (_, index) => finding({
  tradingViewSymbol: `NASDAQ:BULK${String(index).padStart(3, "0")}`,
  symbol: `BULK${String(index).padStart(3, "0")}`,
  company: `Bulk Corp ${index}`,
  currentPrice: 10 + index,
  observedAt: bulkAt,
}));
maximumConcurrentFindingWrites = 0;
findingCreateAttempts = 0;
findingAttemptKeys.clear();
findingWriteDelayMs = 15;
transientFindingFailuresRemaining = 1;
const bulkStartedAt = performance.now();
const bulk = await ledger.persistWorldwideLearningRun({
  ...firstRun,
  checkedAt: bulkAt,
  runtimeCommit: "bulk-concurrency-regression",
  findings: [...bulkFindings, ...bulkFindings.slice(0, 8)],
  observations: bulkFindings.map((item) => ({
    tradingViewSymbol: item.tradingViewSymbol,
    price: item.currentPrice,
    observedAt: item.observedAt,
    source: "TradingView public stock scanner",
  })),
});
const bulkDurationMs = performance.now() - bulkStartedAt;
findingWriteDelayMs = 0;
assert.equal(bulk.findingObjects.length, bulkFindingCount);
assert.equal(new Set(bulk.findingObjects).size, bulkFindingCount);
assert.equal(findingAttemptKeys.size, bulkFindingCount);
assert.equal(findingCreateAttempts, bulkFindingCount + 1);
assert.ok(maximumConcurrentFindingWrites > 1, "Immutable finding writes were serialized.");
assert.ok(maximumConcurrentFindingWrites <= 12, "Immutable finding write concurrency exceeded its safety bound.");
assert.ok(
  bulkDurationMs < (bulkFindingCount * 15) / 2,
  `Bounded concurrent writes did not materially outperform the ${bulkFindingCount * 15}ms sequential floor: ${bulkDurationMs.toFixed(1)}ms.`,
);
assert.equal(bulk.immutableFindingWriteConcurrency, 12);

maximumConcurrentOutcomeWrites = 0;
outcomeCreateAttempts = 0;
outcomeAttemptKeys.clear();
outcomeWriteDelayMs = 15;
const bulkOutcomeAt = "2026-07-23T10:00:00.000Z";
const outcomesStartedAt = performance.now();
const bulkOutcomes = await ledger.persistWorldwideLearningRun({
  workflow: "global_deep_research",
  checkedAt: bulkOutcomeAt,
  runtimeCommit: "bulk-outcome-concurrency-regression",
  summary: { ok: true, matured: bulkFindingCount, safety: { databaseWrites: false, publishing: false, notifications: false, trading: false } },
  findings: [],
  observations: bulkFindings.map((item) => ({
    tradingViewSymbol: item.tradingViewSymbol,
    price: item.currentPrice * 1.1,
    observedAt: bulkOutcomeAt,
    source: "TradingView public stock scanner",
  })),
});
const bulkOutcomeDurationMs = performance.now() - outcomesStartedAt;
outcomeWriteDelayMs = 0;
assert.equal(bulkOutcomes.outcomeObjects.length, bulkFindingCount);
assert.equal(new Set(bulkOutcomes.outcomeObjects).size, bulkFindingCount);
assert.equal(outcomeAttemptKeys.size, bulkFindingCount);
assert.equal(outcomeCreateAttempts, bulkFindingCount);
assert.ok(maximumConcurrentOutcomeWrites > 1, "Immutable outcome writes were serialized.");
assert.ok(maximumConcurrentOutcomeWrites <= 12, "Immutable outcome write concurrency exceeded its safety bound.");
assert.ok(
  bulkOutcomeDurationMs < (bulkFindingCount * 15) / 2,
  `Bounded concurrent outcome writes did not materially outperform the ${bulkFindingCount * 15}ms sequential floor: ${bulkOutcomeDurationMs.toFixed(1)}ms.`,
);
assert.equal(bulkOutcomes.immutableOutcomeWriteConcurrency, 12);

testProcess.env.RAILWAY_GIT_BRANCH = "main";
await assert.rejects(() => ledger.persistWorldwideLearningRun(firstRun), /worldwide_learning_branch_not_allowed/);
testProcess.env.RAILWAY_GIT_BRANCH = "agent/combined-opportunity-engine";
testProcess.env.SWING_UP_R2_WRITE_PREFIX = "branch-labs/pr-261/";
await assert.rejects(() => ledger.persistWorldwideLearningRun(firstRun), /worldwide_learning_r2_prefix_not_allowed/);

for (const routeSource of [globalRoute, deepRoute]) {
  assert.match(routeSource, /persistWorldwideLearningRun/);
  assert.match(routeSource, /learningLedger/);
}
assert.match(globalRoute, /verification_rejection_summary/);
assert.match(deepRoute, /rejectionReasons: \[\.\.\.new Set\(\[\.\.\.finding\.blockedReasons, \.\.\.finding\.providerErrors\]\)\]/);

console.log(JSON.stringify({
  ok: true,
  immutableRunSummaries: true,
  immutableFindingsAndRejections: true,
  duplicateFindingsCollapsedToUniqueObjects: true,
  conflictingDuplicateFindingPayloadsRejected: true,
  workersDrainBeforeFailure: true,
  immutableFindingWriteConcurrency: maximumConcurrentFindingWrites,
  immutableOutcomeWriteConcurrency: maximumConcurrentOutcomeWrites,
  bulkFindingCount,
  bulkDurationMs: Math.round(bulkDurationMs),
  bulkOutcomeDurationMs: Math.round(bulkOutcomeDurationMs),
  laterEligibleOutcomes: ["1D", "3D", "7D", "30D", "90D"],
  idempotentCreateOnlyWrites: true,
  conditionalStateWrites: true,
  branchPrefixIsolation: "branch-labs/pr-262/",
  databaseWrites: false,
  publishing: false,
  notifications: false,
  trading: false,
}, null, 2));
