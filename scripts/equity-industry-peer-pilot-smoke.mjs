import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync(new URL("../lib/equity-signal/industry-peer-pilot.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const cjsModule = { exports: {} };
new Function("require", "module", "exports", output)((name) => { throw new Error(`Unexpected import: ${name}`); }, cjsModule, cjsModule.exports);
const { evaluateIndustryPeerPilotGate } = cjsModule.exports;

const profiles = [
  ["NYSE:CURR", ["CURR", "Current Semiconductor", "NYSE", "United States", "stock", true, "Electronic Technology", "Semiconductors"]],
  ["NASDAQ:PEER1", ["PEER1", "Peer One", "NASDAQ", "United States", "stock", true, "Electronic Technology", "Semiconductors"]],
  ["NASDAQ:PEER2", ["PEER2", "Peer Two", "NASDAQ", "United States", "stock", true, "Electronic Technology", "Semiconductors"]],
  ["NYSE:PEER3", ["PEER3", "Peer Three", "NYSE", "United States", "stock", true, "Electronic Technology", "Semiconductors"]],
  ["NYSE:OTHER", ["OTHER", "Other Retail", "NYSE", "United States", "stock", true, "Retail Trade", "Specialty Stores"]],
].map(([s, d]) => ({ s, d }));
const fetchImpl = async () => new Response(JSON.stringify({ totalCount: profiles.length, data: profiles }), { status: 200, headers: { "content-type": "application/json" } });

function record(index, ticker, returnPercent) {
  return {
    id: `record-${index}`,
    eventKey: `event-${index}`,
    ticker,
    eventFamily: "earnings_guidance",
    direction: "upside",
    relationship: "direct",
    causalChain: ["guidance raise", "higher earnings"],
    macroRegime: [],
    signalObservedAt: `2025-0${index + 1}-01T12:00:00.000Z`,
    featuresAsOf: `2025-0${index + 1}-01T11:00:00.000Z`,
    dataQuality: "real",
    provenance: { origin: "public_historical_bootstrap", eventPublisher: "Issuer", eventSourceUrl: `https://issuer.example/${index}`, priceSource: "Yahoo adjusted history", benchmarkSource: "SPY", methodologyVersion: "test" },
    checkpoints: { "7D": { returnPercent, observedAt: `2025-0${index + 1}-10T12:00:00.000Z`, source: "Yahoo adjusted history" } },
  };
}

const candidate = { ticker: "CURR", company: "Current Semiconductor", eventFamily: "earnings_guidance", direction: "upside", relationship: "direct", historicalAnalog: { items: [] } };
const passing = await evaluateIndustryPeerPilotGate({
  candidate,
  historicalSignals: [record(0, "PEER1", 4), record(1, "PEER2", 3), record(2, "PEER3", 2), record(3, "PEER1", 1), record(4, "PEER2", -1)],
  fetchImpl,
  now: new Date("2026-07-29T07:00:00.000Z"),
});
assert.equal(passing.passed, true);
assert.equal(passing.observedDirectionalHitRatePercent, 80);
assert.equal(passing.independentRealEventCount, 5);
assert.equal(passing.checks.sameCompanyOrIndustryPeer, true);
assert.equal(passing.mode, "same_industry_peer_history");
assert.equal(passing.statisticallyEquivalentToThirtySamples, false);

const failing = await evaluateIndustryPeerPilotGate({
  candidate,
  historicalSignals: [record(0, "PEER1", 4), record(1, "PEER2", 3), record(2, "PEER3", 2), record(3, "PEER1", -2), record(4, "PEER2", -1)],
  fetchImpl,
  now: new Date("2026-07-29T07:00:00.000Z"),
});
assert.equal(failing.passed, false);
assert.equal(failing.observedDirectionalHitRatePercent, 60);

console.log(JSON.stringify({ ok: true, sameIndustryPeersAllowed: true, fourOfFivePasses: true, threeOfFiveFails: true, noFutureLeakageRequired: true }, null, 2));
