import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync(new URL("../lib/opportunity-engine/pr262-exposure-index.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

const prefix = "production/pr262/";
const stateKey = `${prefix}value-investing/resumable/state.json`;
const universeKey = `${prefix}equity-universe/v1.json`;
const exposureKey = `${prefix}sensor/exposure-index-v1.json`;
const batchKey = `${prefix}value-investing/resumable/cycles/cycle-1/batches/batch-000.json`;
const universeFingerprint = "complete-universe-fingerprint";
const objects = new Map();
let revision = 0;
let exposureWrites = 0;

function putSeed(key, value) {
  objects.set(key, { value: structuredClone(value), etag: `"seed-${++revision}"` });
}

const loaded = { exports: {} };
new Function("require", "module", "exports", output)((specifier) => {
  if (specifier === "@/lib/opportunity-engine/pr262-storage") {
    return {
      pr262StorageKey: (relative) => `${prefix}${relative}`,
      resolvePr262StoragePrefix: () => prefix,
    };
  }
  if (specifier === "@/lib/r2-warehouse") {
    return {
      readVersionedTextFromR2: async (key) => {
        const stored = objects.get(key);
        return stored
          ? { found: true, text: JSON.stringify(stored.value), etag: stored.etag }
          : { found: false, text: null, etag: null };
      },
      writeVersionedJsonToR2: async (key, value, options = {}) => {
        const current = objects.get(key);
        if (options.createOnly && current) return { written: false, conflict: true, etag: null };
        if (options.expectedEtag && current?.etag !== options.expectedEtag) return { written: false, conflict: true, etag: null };
        const etag = `"etag-${++revision}"`;
        objects.set(key, { value: structuredClone(value), etag });
        if (key === exposureKey) exposureWrites += 1;
        return { written: true, conflict: false, etag };
      },
    };
  }
  throw new Error(`Unexpected exposure-index import: ${specifier}`);
}, loaded, loaded.exports);

const now = new Date("2026-08-20T12:00:00.000Z");
putSeed(universeKey, {
  version: 1,
  entries: [
    { ticker: "AAA", cik: "0000000001", exchange: "NASDAQ" },
    { ticker: "BBB", cik: "0000000002", exchange: "NYSE" },
  ],
});
const analyses = [
  { ticker: "AAA", company: "Alpha Corp", tradingViewSymbol: "NASDAQ:AAA", exchange: "NASDAQ", sector: "Technology", industry: "Software", marketCap: 2_000_000_000, scores: { businessQuality: 80, risk: 20 }, fairValue: { buyBelowPrice: 80, strongBuyBelowPrice: 60, trimAbovePrice: 140, baseValue: 110 } },
  { ticker: "BBB", company: "Beta Corp", tradingViewSymbol: "NYSE:BBB", exchange: "NYSE", sector: "Industrials", industry: "Machinery", marketCap: 1_000_000_000, scores: { businessQuality: 70, risk: 30 }, fairValue: { buyBelowPrice: 40, strongBuyBelowPrice: 30, trimAbovePrice: 75, baseValue: 60 } },
];

function batchPayload(overrides = {}) {
  return {
    version: 1,
    kind: "us_value_investing_company_batch",
    cycleId: "cycle-1",
    universeFingerprint,
    batch: {
      batchIndex: 0,
      startIndex: 0,
      endIndexExclusive: 2,
      companyCount: 2,
    },
    analyses: structuredClone(analyses),
    ...overrides,
  };
}

function completeState(overrides = {}) {
  return {
    cycleId: "cycle-1",
    status: "complete",
    universeFingerprint,
    totalCompanies: 2,
    companiesStored: 2,
    batchSize: 500,
    totalBatches: 1,
    completedBatchKeys: [batchKey],
    ...overrides,
  };
}

putSeed(batchKey, batchPayload());
putSeed(stateKey, {
  cycleId: "cycle-1",
  status: "running",
  universeFingerprint,
  totalCompanies: 2,
  companiesStored: 1,
  batchSize: 500,
  totalBatches: 1,
  completedBatchKeys: [batchKey],
});

await assert.rejects(
  () => loaded.exports.loadPr262ExposureIndex(now),
  /pr262_exposure_value_cycle_incomplete/,
  "A partial valuation cycle must never become the cached exposure baseline.",
);
assert.equal(objects.has(exposureKey), false);
assert.equal(exposureWrites, 0);

putSeed(stateKey, completeState());
objects.delete(batchKey);
await assert.rejects(
  () => loaded.exports.loadPr262ExposureIndex(now),
  /pr262_exposure_value_batch_invalid/,
  "A missing completed batch object must fail closed.",
);

putSeed(batchKey, batchPayload({ analyses: analyses.slice(0, 1) }));
await assert.rejects(
  () => loaded.exports.loadPr262ExposureIndex(now),
  /pr262_exposure_value_batch_invalid/,
  "A batch containing fewer analyses than its coverage metadata must fail closed.",
);

putSeed(batchKey, batchPayload({ analyses: [analyses[0], { ...analyses[1], ticker: "AAA" }] }));
await assert.rejects(
  () => loaded.exports.loadPr262ExposureIndex(now),
  /pr262_exposure_value_analysis_invalid/,
  "Duplicate ticker records must not be collapsed into a falsely complete exposure index.",
);

putSeed(batchKey, batchPayload({ universeFingerprint: "wrong-universe" }));
await assert.rejects(
  () => loaded.exports.loadPr262ExposureIndex(now),
  /pr262_exposure_value_batch_invalid/,
  "A batch from a different universe fingerprint must fail closed.",
);

putSeed(batchKey, batchPayload());
const complete = await loaded.exports.loadPr262ExposureIndex(now);
assert.equal(complete.version, 2);
assert.equal(complete.valueCoverage.complete, true);
assert.equal(complete.valueCoverage.totalCompanies, 2);
assert.equal(complete.valueCoverage.companiesStored, 2);
assert.equal(complete.valueCoverage.completedBatches, 1);
assert.equal(complete.entries.length, 2);
assert.equal(exposureWrites, 1);

putSeed(exposureKey, { ...complete, entries: complete.entries.slice(0, 1) });
const rebuilt = await loaded.exports.loadPr262ExposureIndex(new Date(now.getTime() + 5 * 60_000));
assert.equal(rebuilt.entries.length, 2);
assert.equal(exposureWrites, 2, "A cached index with partial rows must be rejected and rebuilt.");

const cached = await loaded.exports.loadPr262ExposureIndex(new Date(now.getTime() + 10 * 60_000));
assert.equal(cached.builtAt, rebuilt.builtAt);
assert.equal(exposureWrites, 2, "A fresh complete exposure index should be reused without another write.");

console.log(JSON.stringify({
  ok: true,
  partialFoundationCannotBecomeExposureBaseline: true,
  missingOrTruncatedBatchRejected: true,
  duplicateTickerCannotHideMissingCoverage: true,
  universeFingerprintBoundToEveryBatch: true,
  completeValueCoverageProvenInIndex: true,
  oldOrPartialIndexContractsInvalidated: true,
  freshCompleteIndexReused: true,
}, null, 2));
