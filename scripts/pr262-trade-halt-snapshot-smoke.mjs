import assert from "node:assert/strict";
import { loadTsModule } from "./helpers/load-typescript-module.mjs";

const now = new Date("2026-09-18T14:00:00.000Z");
const key = "test/sensor/trade-halt-snapshot-v1.json";
let saved = null;
let revision = 0;
let writeFailure = false;
const storage = {
  readVersionedTextFromR2: async () => saved ? { found: true, text: JSON.stringify(saved.value), etag: saved.etag } : { found: false, text: null, etag: null },
  writeVersionedJsonToR2: async (actualKey, value, options) => {
    assert.equal(actualKey, key);
    if (writeFailure) throw new Error("storage unavailable");
    if (options.createOnly && saved || options.expectedEtag && saved?.etag !== options.expectedEtag) return { written: false, conflict: true };
    saved = { value: structuredClone(value), etag: String(++revision) };
    return { written: true, conflict: false, etag: saved.etag };
  },
};
const load = () => loadTsModule("@/lib/opportunity-engine/pr262-trade-halt-snapshot", {
  "@/lib/r2-warehouse": storage,
  "@/lib/opportunity-engine/pr262-storage": { pr262StorageKey: relative => `test/${relative}` },
});
const rows = [{ symbol: "HALT", issuerName: "Halted Corporation", formatedHaltDate: "2026-09-01", formatedHaltTime: "12:00:00", reason: "Regulatory Concern", sourceExchange: "NYSE" }];
const currentFeed = (records = rows) => async url => {
  assert.equal(String(url), "https://www.nyse.com/api/trade-halts/current");
  return Response.json({ totalCount: records.length, results: { tradeHalts: records } });
};
let deferredCalls = 0;
const deferred = async () => { deferredCalls += 1; throw new Error("pr262_sensor_budget_guard:nyse:minimum_interval;next_retry_at=2026-09-18T14:04:30.000Z"); };
const { fetchNasdaqTradeHalts } = loadTsModule("@/lib/equity-signal/event-sources");
const bareDeferred = await fetchNasdaqTradeHalts(deferred, now);
assert.equal(bareDeferred.status, "not_due");
assert.equal(bareDeferred.cached, false, "Reproduces the old targeted path: cadence loses all halt state");

const first = await load().fetchPr262TradeHalts(currentFeed(), now);
assert.equal(first.status, "connected");
assert.equal(saved.value.provider.receipts[0].rawEventType, "halt:REGULATORY_CONCERN:active");
assert.equal(saved.value.provider.receipts[0].publishedAt, "2026-09-01T12:00:00.000Z", "An old active halt retains its evidence date");
const firstSnapshot = structuredClone(saved);

const fiveMinutesLater = new Date(now.getTime() + 5 * 60_000);
const reused = await load().fetchPr262TradeHalts(deferred, fiveMinutesLater);
assert.equal(reused.status, "not_due");
assert.equal(reused.cached, true, "A separate module instance reuses the durable safety snapshot");
assert.equal(reused.cacheAgeMs, 5 * 60_000);
assert.equal(reused.checkedAt, now.toISOString(), "A later attempt cannot renew the original authoritative timestamp");
assert.equal(reused.receipts[0].symbolHints[0], "HALT");
assert.equal(deferredCalls, 2, "Cadence skips do not spend the backup Nasdaq allowance");
assert.deepEqual(saved, firstSnapshot, "Reusing a snapshot cannot refresh its durable timestamp");

const boundary = await load().fetchPr262TradeHalts(deferred, new Date(now.getTime() + 15 * 60_000));
assert.equal(boundary.cached, true);
const expired = await load().fetchPr262TradeHalts(deferred, new Date(now.getTime() + 15 * 60_000 + 1));
assert.equal(expired.cached, false);
assert.equal(expired.receipts.length, 0);
const future = await load().fetchPr262TradeHalts(deferred, new Date(now.getTime() - 1));
assert.equal(future.cached, false, "A snapshot from the future is not usable");
const unavailable = await load().fetchPr262TradeHalts(async () => { throw new Error("network unavailable"); }, fiveMinutesLater);
assert.equal(unavailable.status, "temporarily_unavailable");
assert.equal(unavailable.cached, false, "A transport outage is not converted to a successful safety check");

const clearAt = new Date(now.getTime() + 10 * 60_000);
await load().fetchPr262TradeHalts(currentFeed([]), clearAt);
assert.equal(saved.value.provider.receipts.length, 0, "An authoritative empty snapshot clears old active halts");
await load().fetchPr262TradeHalts(currentFeed(), now);
assert.equal(saved.value.provider.checkedAt, clearAt.toISOString(), "A slower older writer cannot resurrect cleared halts");
const empty = await load().fetchPr262TradeHalts(deferred, new Date(clearAt.getTime() + 60_000));
assert.equal(empty.cached, true);
assert.equal(empty.receipts.length, 0);

for (const corrupt of [
  { ...firstSnapshot.value, version: 2 },
  { ...firstSnapshot.value, provider: { ...firstSnapshot.value.provider, status: "partial" } },
  { ...firstSnapshot.value, provider: { ...firstSnapshot.value.provider, sourceUrls: ["https://example.test/"] } },
  { ...firstSnapshot.value, provider: { ...firstSnapshot.value.provider, receipts: [ { ...firstSnapshot.value.provider.receipts[0], rawEventType: null } ] } },
  { ...firstSnapshot.value, provider: { ...firstSnapshot.value.provider, receipts: [], recordsRead: 1 } },
]) {
  saved = { value: corrupt, etag: String(++revision) };
  const result = await load().fetchPr262TradeHalts(deferred, fiveMinutesLater);
  assert.equal(result.cached, false, "A malformed or incomplete snapshot fails closed");
}
saved = null;
writeFailure = true;
assert.equal((await load().fetchPr262TradeHalts(currentFeed([]), now)).status, "connected", "Storage failure does not discard this call's live authoritative observation");
assert.equal((await load().fetchPr262TradeHalts(deferred, fiveMinutesLater)).cached, false);
console.log("Shared trade-halt snapshot: real feed, cross-process cadence reuse, old active and empty snapshots, timestamp ordering, expiry and malformed-state rejection passed.");
