import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync(new URL("../lib/equity-signal/historical-bootstrap.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;
const cjsModule = { exports: {} };
new Function("require", "module", "exports", output)((name) => {
  if (name === "node:crypto") return crypto;
  throw new Error(`Unexpected historical bootstrap import: ${name}`);
}, cjsModule, cjsModule.exports);

const { bootstrapPublicHistoricalSignals, historicalBootstrapSeedsForTest, mergeHistoricalSignals } = cjsModule.exports;
const seeds = historicalBootstrapSeedsForTest();
const calls = [];

function barsFor(ticker) {
  const relevant = ticker === "SPY" ? seeds : seeds.filter((seed) => seed.ticker === ticker);
  const timestamps = [];
  for (const seed of relevant) {
    const eventAt = Date.parse(`${seed.eventDate}T23:59:59.000Z`);
    for (const days of [1, 2, 4, 8, 31, 91, 95]) timestamps.push(Math.floor((eventAt + days * 24 * 60 * 60 * 1000) / 1000));
  }
  const unique = [...new Set(timestamps)].sort((left, right) => left - right);
  const base = ticker === "SPY" ? 400 : 100;
  const direction = seeds.find((seed) => seed.ticker === ticker)?.direction ?? "upside";
  const values = unique.map((_, index) => base * (1 + (direction === "downside" ? -1 : 1) * index * 0.01));
  return { timestamps: unique, values };
}

const fakeFetch = async (input) => {
  const url = input instanceof URL ? input : new URL(String(input));
  calls.push(url.toString());
  assert.equal(url.hostname, "query1.finance.yahoo.com");
  const ticker = decodeURIComponent(url.pathname.split("/").at(-1));
  const bars = barsFor(ticker);
  return new Response(JSON.stringify({
    chart: {
      result: [{
        timestamp: bars.timestamps,
        indicators: { adjclose: [{ adjclose: bars.values }], quote: [{ close: bars.values }] },
      }],
      error: null,
    },
  }), { status: 200, headers: { "content-type": "application/json" } });
};

const first = await bootstrapPublicHistoricalSignals([], fakeFetch, new Date("2026-07-22T12:00:00.000Z"));
assert.equal(first.records.length, seeds.length);
assert.equal(first.provider.status, "connected");
assert.equal(first.seedsRemaining, 0);
assert.equal(new Set(first.records.map((record) => record.eventKey)).size, seeds.length);
assert.ok(first.records.every((record) => record.dataQuality === "real"));
assert.ok(first.records.every((record) => record.provenance?.origin === "public_historical_bootstrap"));
assert.ok(first.records.every((record) => record.provenance?.eventSourceUrl.startsWith("https://")));
assert.ok(first.records.every((record) => record.checkpoints["1D"]?.source.includes("benchmark")));
assert.ok(first.records.every((record) => Date.parse(record.featuresAsOf) < Date.parse(record.signalObservedAt)));
assert.equal(calls.length, new Set([...seeds.map((seed) => seed.ticker), "SPY"]).size);

const callCount = calls.length;
const second = await bootstrapPublicHistoricalSignals(first.records, fakeFetch, new Date("2026-07-22T12:05:00.000Z"));
assert.equal(second.records.length, 0);
assert.equal(second.provider.status, "not_due");
assert.equal(calls.length, callCount);

const poorer = { ...first.records[0], checkpoints: { "1D": first.records[0].checkpoints["1D"] }, provenance: undefined };
const merged = mergeHistoricalSignals([poorer], [first.records[0]]);
assert.equal(merged.length, 1);
assert.ok(Object.keys(merged[0].checkpoints).length > 1);
assert.equal(merged[0].provenance.origin, "public_historical_bootstrap");

console.log(JSON.stringify({
  ok: true,
  realPublicEvents: first.records.length,
  numericReturnsFetchedNotHardCoded: true,
  benchmarkRelativeCheckpoints: true,
  pointInTimeCutoffPreserved: true,
  duplicateFetchAvoidedAfterR2Load: true,
}, null, 2));
