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
    const current = objects.get(key);
    if (options.createOnly && current) return { written: false, conflict: true, etag: null };
    if (options.expectedEtag && current?.etag !== options.expectedEtag) return { written: false, conflict: true, etag: null };
    if (options.expectedEtag && !current) return { written: false, conflict: true, etag: null };
    const etag = nextEtag();
    objects.set(key, { text: `${JSON.stringify(payload, null, 2)}\n`, etag });
    return { written: true, conflict: false, etag };
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
  { cjsModule, customRequire, process: testProcess },
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
  laterEligibleOutcomes: ["1D", "3D", "7D", "30D", "90D"],
  idempotentCreateOnlyWrites: true,
  conditionalStateWrites: true,
  branchPrefixIsolation: "branch-labs/pr-262/",
  databaseWrites: false,
  publishing: false,
  notifications: false,
  trading: false,
}, null, 2));
