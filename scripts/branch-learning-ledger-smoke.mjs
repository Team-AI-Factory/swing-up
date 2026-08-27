import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";

const nodeRequire = createRequire(import.meta.url);
const routeSource = readFileSync(new URL("../app/api/internal/railway-branch-signal-lab/route.ts", import.meta.url), "utf8");
const runnerSource = readFileSync(new URL("../lib/equity-signal/runner.ts", import.meta.url), "utf8");
const instrumentedSource = `${routeSource}
export const __learningLedgerTest = {
  archiveCompletedOutcomeCheckpoints,
  historicalSignalRecords,
  outcomeArchiveKey,
  qualifiedFindingEntries,
  updateForwardOutcomes,
};`;
const compiled = ts.transpileModule(instrumentedSource, {
  compilerOptions: {
    esModuleInterop: true,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;

const objectStore = new Map();
const r2 = {
  getR2Config: () => ({ configured: true }),
  readVersionedTextFromR2: async (key) => objectStore.has(key)
    ? { found: true, text: objectStore.get(key), etag: '"test-etag"' }
    : { found: false, text: null, etag: null },
  writeVersionedJsonToR2: async (key, value, options = {}) => {
    if (options.createOnly && objectStore.has(key)) return { written: false, conflict: true, etag: null };
    objectStore.set(key, `${JSON.stringify(value, null, 2)}\n`);
    return { written: true, conflict: false, etag: '"test-etag"' };
  },
};
const customRequire = (id) => {
  if (id === "node:fs/promises" || id === "node:path") return nodeRequire(id);
  if (id === "next/server") return { NextRequest: class {}, NextResponse: { json: (body, init = {}) => ({ body, status: init.status ?? 200 }) } };
  if (id === "@/lib/r2-warehouse") return r2;
  if (id === "@/lib/branch-signal-lab") return { runBranchSignalLab: async () => ({}) };
  if (id === "@/lib/branch-signal-lab-policy") return {
    isLegacyExternalStopReason: () => false,
    noGainRepairAttempts: () => 0,
    providerCallBudgetDecision: () => ({ allowed: false }),
    repairEligibleFailure: () => null,
  };
  if (id === "@/lib/equity-signal/historical-bootstrap") return {
    mergeHistoricalSignals: (...groups) => groups.flat(),
  };
  throw new Error(`Unexpected test import: ${id}`);
};
const cjsModule = { exports: {} };
const testProcess = { ...process, env: { ...process.env, RAILWAY_GIT_BRANCH: "agent/combined-opportunity-engine" } };
vm.runInNewContext(
  `(function (exports, module, require, process) { ${compiled}\n})(cjsModule.exports, cjsModule, customRequire, process);`,
  { cjsModule, customRequire, process: testProcess },
);
const ledger = cjsModule.exports.__learningLedgerTest;

const checkedAt = "2026-07-20T10:00:00.000Z";
const baseRun = {
  mode: "railway_branch_live_read_only",
  assetClass: "public_equity",
  realProviderResponsesOnly: true,
  databaseWrites: false,
  publishing: false,
  notifications: false,
  checkedAt,
};
const finding = (fingerprint, ticker, priceAnchorStatus, price, benchmarkPrice) => ({
  evidenceFingerprint: fingerprint,
  ticker,
  company: `${ticker} Corp`,
  direction: "upside",
  eventFamily: "contract_award",
  relationship: "direct",
  eventHeadline: `${ticker} wins a material contract`,
  eventObservedAt: checkedAt,
  featuresAsOf: checkedAt,
  causalChain: ["verified award", "revenue impact", `${ticker} upside sensitivity`],
  macroRegime: ["stable_growth"],
  receipts: [{
    publisher: "sec.gov",
    primarySource: true,
    url: `https://www.sec.gov/${ticker.toLowerCase()}`,
  }],
  priceAnchorStatus,
  outcomeTrackingEligible: priceAnchorStatus === "anchored",
  price,
  benchmarkTicker: "SPY",
  benchmarkPrice,
});
const anchored = finding("aaaaaaaaaaaaaaaaaaaa", "AAA", "anchored", 100, 500);
const awaiting = finding("bbbbbbbbbbbbbbbbbbbb", "BBB", "awaiting_price_anchor", null, null);
const sameCycleHistory = {
  runs: [{
    ...baseRun,
    qualifiedFindings: [anchored, awaiting],
    outcomeTrackingCandidates: [anchored],
  }],
};

const explicitEntries = ledger.qualifiedFindingEntries(sameCycleHistory);
assert.equal(explicitEntries.length, 2);
const compactRecords = ledger.historicalSignalRecords(sameCycleHistory);
assert.equal(compactRecords.length, 2);
assert.deepEqual([...compactRecords.map((item) => item.eventKey)].sort(), ["aaaaaaaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbbbbbbb"]);
assert.ok(compactRecords.every((item) => item.provenance.origin === "swing_up_tracked_finding"));
assert.equal(compactRecords.find((item) => item.ticker === "BBB").provenance.priceSource, "awaiting price anchor");

const nextDay = "2026-07-21T10:00:00.000Z";
const outcomeHistory = {
  runs: [{
    ...baseRun,
    qualifiedFindings: [anchored],
    outcomeTrackingCandidates: [anchored],
  }],
};
const currentReport = {
  ...baseRun,
  checkedAt: nextDay,
  marketSnapshot: [
    { ticker: "AAA", price: 104, observedAt: nextDay, source: "public quote" },
    { ticker: "SPY", price: 505, observedAt: nextDay, source: "public benchmark quote" },
  ],
};
const completed = ledger.updateForwardOutcomes(outcomeHistory, currentReport);
assert.equal(completed.length, 1);
assert.equal(completed[0].outcome.checkpoint, "1D");
assert.equal(completed[0].outcome.forwardReturnPercent, 4);
assert.equal(completed[0].outcome.benchmarkReturnPercent, 1);

const firstArchive = await ledger.archiveCompletedOutcomeCheckpoints(completed);
assert.equal(firstArchive.length, 1);
assert.match(firstArchive[0], /^branch-labs\/pr-262\/serious-signal\/outcomes\/2026-07-20\//);
assert.equal(objectStore.size, 1);

const immutableEvaluationPrice = completed[0].outcome.evaluationPrice;
completed[0].outcome = { ...completed[0].outcome, evaluationPrice: 999 };
completed[0].outcomeOwner.outcomeEvaluations = [completed[0].outcome];
const retryArchive = await ledger.archiveCompletedOutcomeCheckpoints(completed);
assert.deepEqual(retryArchive, firstArchive);
assert.equal(completed[0].outcome.evaluationPrice, immutableEvaluationPrice);
assert.equal(completed[0].outcomeOwner.outcomeEvaluations[0].evaluationPrice, immutableEvaluationPrice);
assert.equal(objectStore.size, 1);

assert.match(runnerSource, /priceAnchorStatus: priceAnchored \? "anchored" as const : "awaiting_price_anchor" as const/);
assert.match(runnerSource, /qualifiedFindings,/);
assert.match(routeSource, /runs: \[\.\.\.history\.runs, provisionalRunRecord\]/);
assert.match(routeSource, /writeVersionedJsonToR2\(objectKey, payload, \{ createOnly: true \}\)/);
assert.match(routeSource, /newImmutableOutcomeCheckpointObjects/);

console.log(JSON.stringify({
  ok: true,
  everyQualifiedFindingExplicit: true,
  anchoredAndAwaitingPriceStatuses: true,
  sameCycleCompactHistory: true,
  immutableCheckpointArchive: true,
  idempotentConflictRecovery: true,
  branchPrefix: "branch-labs/pr-262/",
}, null, 2));
