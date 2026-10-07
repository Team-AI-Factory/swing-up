import assert from "node:assert/strict";
import { loadTsModule } from "./helpers/load-typescript-module.mjs";

const objects = new Map(); let sequence = 0, writeFault = null, readFault = null;
const reads = [], writes = [];
const prefix = "fixture/pilot/";
const load = () => loadTsModule("@/lib/notifications/serious-signal-evidence-binding", {
  "@/lib/opportunity-engine/pr262-storage": { pr262StorageKey: key => prefix + key },
  "@/lib/r2-warehouse": {
    readVersionedTextFromR2: async (key, options = {}) => {
      options.signal?.throwIfAborted(); reads.push(key);
      if (readFault) throw readFault;
      const row = objects.get(key);
      return row ? { found: true, text: JSON.stringify(row.value), etag: row.etag } : { found: false, text: null, etag: null };
    },
    writeVersionedJsonToR2: async (key, value, options = {}) => {
      options.signal?.throwIfAborted(); writes.push(key);
      if (writeFault === "before") throw new Error("r2_state_write_http_502");
      if (objects.has(key)) return { written: false, conflict: true, etag: null };
      assert.equal(options.createOnly, true);
      const etag = String(++sequence); objects.set(key, { value: structuredClone(value), etag });
      if (writeFault === "after") throw new Error("r2_state_write_readback_failed_no_replay");
      return { written: true, conflict: false, etag };
    },
  },
}).bindSeriousSignalEvidence;
const base = { cik: "0001234567", direction: "upside", evidenceKey: "a".repeat(64),
  now: new Date("2026-10-07T00:00:00Z"), outboxKey: `${prefix}serious-signal/outbox/event-job/buy/AAA/day-one.json` };
const alternate = { ...base, outboxKey: `${prefix}serious-signal/outbox/event-job/buy/AAA/day-two.json`, now: new Date("2027-11-01T00:00:00Z") };
await assert.rejects(() => load()({ ...base, existingOnly: true }), /legacy_evidence_requires_migration/);
assert.equal(objects.size, 0, "A missing legacy record cannot manufacture a fresh send identity");
const first = await load()(base);
assert.equal(first.duplicate, false);
const later = await load()(alternate);
assert.equal(later.duplicate, true);
assert.equal(later.outboxKey, base.outboxKey, "Restart, new daily ID and elapsed time never replace the immutable owner");
assert.equal(objects.size, 1);

objects.clear(); writes.length = 0;
const contenders = await Promise.all([load()(base), load()(alternate)]);
assert.equal(new Set(contenders.map(row => row.outboxKey)).size, 1, "Concurrent creation elects one canonical outbox");
assert.equal(objects.size, 1);
const changed = await load()({ ...alternate, evidenceKey: "b".repeat(64) });
assert.equal(changed.duplicate, false, "A new approved evidence decision can own a separate delivery");
const returned = await load()(base);
assert.equal(returned.outboxKey, contenders[0].outboxKey, "A→B→A retains the original A binding");

objects.clear(); writeFault = "after";
await assert.rejects(() => load()(base), /readback_failed_no_replay/);
writeFault = null;
const recovered = await load()(alternate);
assert.equal(recovered.outboxKey, base.outboxKey, "Ambiguous first PUT cannot hand ownership to a retrying duplicate");
objects.clear(); writeFault = "before";
await assert.rejects(() => load()(base), /http_502/);
assert.equal(objects.size, 0);
writeFault = null;
const created = await load()(base);
objects.get(created.key).value.evidenceKey = "corrupt";
await assert.rejects(() => load()(alternate), /binding_invalid/);
readFault = new Error("r2_state_read_http_502");
await assert.rejects(() => load()(alternate), /read_http_502/);
readFault = null;
await assert.rejects(() => load()({ ...base, outboxKey: "unrelated/private-object.json" }), /outbox_invalid/);
const controller = new AbortController(); controller.abort(new Error("deadline"));
const writeCount = writes.length;
await assert.rejects(() => load()({ ...base, signal: controller.signal }), /deadline/);
assert.equal(writes.length, writeCount, "Cancelled work never creates a binding");
console.log("PASS: immutable evidence delivery binding, concurrent owner election, restart/day/age/A→B→A persistence, distinct evidence, ambiguous write recovery and corrupt-state failure; no live storage or channels.");
