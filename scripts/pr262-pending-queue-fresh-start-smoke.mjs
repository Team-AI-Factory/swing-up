import assert from "node:assert/strict";
import { freshStartPendingQueue, productionR2Store } from "./pr262-pending-queue-fresh-start.mjs";
import { loadTsModule } from "./helpers/load-typescript-module.mjs";

const prefix = "production/pr262/";
const queue = `${prefix}sensor/state-v1.json`;
const lease = `${prefix}event-job/runtime/lease-v1.json`;
const receipt = `${prefix}operations/queue-resets/user-request-20260923-fresh-start-v1.json`;
const sensor = loadTsModule("@/lib/opportunity-engine/pr262-change-sensor", {
  "@/lib/opportunity-engine/pr262-storage": { pr262StorageKey: key => `${prefix}${key}` },
  "@/lib/r2-warehouse": { readVersionedTextFromR2: async () => ({ found: false, text: null }) },
});
// Obtain the contract from the real sensor instead of inventing a queue schema.
const base = { ...await sensor.readPr262ChangeSensorState(), updatedAt: "2026-09-22T00:00:00Z",
  pending: [{ id: "old-1" }, { id: "old-2" }], seen: ["old-1", "old-2"] };

function memory() {
  const records = new Map();
  const writes = [];
  let revision = 0;
  const set = (key, value) => records.set(key, { body: typeof value === "string" ? value : JSON.stringify(value), etag: `"v${++revision}"` });
  set(queue, base);
  set(lease, { version: 1, lease: null });
  set(`${prefix}event-job/runtime/committee-budget-v1.json`, { reservations: ["keep"] });
  set(`${prefix}notifications/outbox/previous.json`, { delivered: true });
  const store = {
    get: async key => structuredClone(records.get(key) ?? null),
    put: async (key, body, options = {}) => {
      writes.push(key);
      if (options.absent && records.has(key)) return false;
      if (options.match && options.match !== records.get(key)?.etag) return false;
      set(key, body);
      return true;
    },
  };
  return { store, records, writes, set, read: key => JSON.parse(records.get(key).body) };
}

// One reset removes only pending work; immutable history and discovery survive.
{
  const m = memory();
  const before = m.records.get(queue).body;
  const result = await freshStartPendingQueue(m.store);
  assert.equal(result.intendedRemovalCount, 2);
  assert.equal(result.pendingAfterReset, 0);
  assert.deepEqual(m.read(queue), { ...base, pending: [] }, "Reset must not claim a new scan or discard other state");
  assert.equal(m.records.get(result.backupKeys[0]).body, before);
  assert.deepEqual(m.read(`${prefix}event-job/runtime/committee-budget-v1.json`), { reservations: ["keep"] });
  assert.deepEqual(m.read(`${prefix}notifications/outbox/previous.json`), { delivered: true });
  assert.equal(m.read(lease).lease, null);
  const writes = m.writes.length;
  m.set(queue, { ...m.read(queue), pending: [{ id: "new" }] });
  assert.equal((await freshStartPendingQueue(m.store)).alreadyCompleted, true);
  assert.equal(m.writes.length, writes);
  assert.deepEqual(m.read(queue).pending, [{ id: "new" }]);
}

// An active worker, an absent modern lease, and a competing acquisition fail closed.
for (const mode of ["busy", "missing", "conflict"]) {
  const m = memory();
  if (mode === "busy") m.set(lease, { version: 1, lease: { ownerId: "worker", expiresAt: new Date(Date.now() + 60000).toISOString() } });
  if (mode === "missing") m.records.delete(lease);
  if (mode === "conflict") m.store.put = async () => false;
  await assert.rejects(freshStartPendingQueue(m.store), /queue_reset_worker_/);
  assert.deepEqual(m.read(queue), base);
}

// A failed backup verification must never clear the live queue.
{
  const m = memory();
  const get = m.store.get;
  m.store.get = async key => key.includes("rollback/") && m.records.has(key) ? { body: "corrupt", etag: "x" } : get(key);
  await assert.rejects(freshStartPendingQueue(m.store), /backup_not_verified/);
  assert.deepEqual(m.read(queue), base);
  assert.equal(m.read(lease).lease, null);
}

// Concurrent ingestion invalidates the first write; new arrivals remain pending.
{
  const m = memory();
  const put = m.store.put;
  let conflict = true;
  m.store.put = async (key, body, options) => {
    if (key === queue && conflict) {
      conflict = false;
      m.set(queue, { ...base, pending: [...base.pending, { id: "fresh" }], seen: [...base.seen, "fresh"] });
    }
    return put(key, body, options);
  };
  const result = await freshStartPendingQueue(m.store);
  assert.equal(result.pendingAfterReset, 1);
  assert.deepEqual(m.read(queue).pending, [{ id: "fresh" }]);
  assert.deepEqual(m.read(queue).seen, [...base.seen, "fresh"]);
  assert.equal(result.backupKeys.length, 2);
}

// A crash after clearing but before the receipt is safe to resume, even after new intake.
{
  const m = memory();
  const original = m.records.get(queue).body;
  const put = m.store.put;
  m.store.put = async (key, body, options) => {
    if (key === receipt) throw new Error("simulated_receipt_failure");
    return put(key, body, options);
  };
  await assert.rejects(freshStartPendingQueue(m.store), /simulated_receipt_failure/);
  assert.equal(m.read(queue).pending.length, 0);
  m.set(queue, { ...m.read(queue), pending: [{ id: "after-crash" }] });
  m.store.put = put;
  const result = await freshStartPendingQueue(m.store);
  assert.deepEqual(m.read(queue).pending, [{ id: "after-crash" }]);
  assert.equal(result.intendedRemovalCount, 2);
  assert.ok(result.backupKeys.some(key => m.records.get(key).body === original));
}

// Production scope must be explicit before any network request is possible.
{
  const project = process.env.RAILWAY_PROJECT_ID;
  process.env.RAILWAY_PROJECT_ID = "wrong-project";
  assert.throws(productionR2Store, /production_scope_required/);
  if (project === undefined) delete process.env.RAILWAY_PROJECT_ID;
  else process.env.RAILWAY_PROJECT_ID = project;
}

console.log("PASS queue fresh-start: backup verification, full reset, history preservation, idempotency, worker exclusion, concurrent arrivals, interrupted receipt recovery, production scope");
