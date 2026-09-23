import crypto from "node:crypto";
import { pathToFileURL } from "node:url";

const PREFIX = "production/pr262/";
const QUEUE = `${PREFIX}sensor/state-v1.json`;
const LEASE = `${PREFIX}event-job/runtime/lease-v1.json`;
const RESET_ID = "user-request-20260923-fresh-start-v1";
const RECEIPT = `${PREFIX}operations/queue-resets/${RESET_ID}.json`;
const sha = value => crypto.createHash("sha256").update(value).digest("hex");

/** One authorized reset, with an owned worker lease, verified backup and CAS. */
export async function freshStartPendingQueue(store, now = new Date()) {
  const prior = await store.get(RECEIPT);
  if (prior && JSON.parse(prior.body).completed === true) return { ...JSON.parse(prior.body), alreadyCompleted: true };
  const leaseState = await store.get(LEASE);
  // Do not initialize a missing lease: old workers may still use their legacy
  // ledger. Production must already have the dedicated shared worker lease.
  if (!leaseState?.etag) throw new Error("queue_reset_worker_lease_missing");
  const leaseJson = JSON.parse(leaseState.body);
  if (leaseJson.version !== 1) throw new Error("queue_reset_worker_lease_invalid");
  if (Date.parse(leaseJson.lease?.expiresAt ?? "") > now.getTime()) throw new Error("queue_reset_worker_busy");
  const ownerId = crypto.randomUUID();
  const acquired = await store.put(LEASE, JSON.stringify({ version: 1, updatedAt: now.toISOString(), lease: {
    eventId: `ops:${RESET_ID}`, ownerId, acquiredAt: now.toISOString(), expiresAt: new Date(now.getTime() + 300000).toISOString(),
  } }), leaseState?.etag ? { match: leaseState.etag } : { absent: true });
  if (!acquired) throw new Error("queue_reset_worker_busy");
  try {
    // Recover an interrupted successful write without resetting later arrivals.
    const initial = await store.get(QUEUE);
    if (!initial) throw new Error("queue_reset_state_missing");
    const initialState = JSON.parse(initial.body);
    if (initialState.version !== 2 || !Array.isArray(initialState.pending)
      || initialState.pending.some(event => !event || typeof event.id !== "string")) throw new Error("queue_reset_state_invalid");
    const checkpointKey = `${PREFIX}operations/queue-resets/${RESET_ID}-intent.json`;
    let checkpoint = await store.get(checkpointKey);
    if (!checkpoint) {
      const initialBackupKey = `${PREFIX}rollback/queue-fresh-start-${RESET_ID}-${sha(initial.body).slice(0, 20)}.json`;
      const saved = await store.get(initialBackupKey);
      if (!saved && !await store.put(initialBackupKey, initial.body, { absent: true })) throw new Error("queue_reset_backup_conflict");
      const verified = saved ?? await store.get(initialBackupKey);
      if (!verified || sha(verified.body) !== sha(initial.body)) throw new Error("queue_reset_backup_not_verified");
      const intent = { resetId: RESET_ID, resetAt: now.toISOString(), eventIds: initialState.pending.map(event => event.id),
        initialBackupKey, initialBackupSha256: sha(initial.body) };
      if (!await store.put(checkpointKey, JSON.stringify(intent), { absent: true })) throw new Error("queue_reset_intent_conflict");
      checkpoint = await store.get(checkpointKey);
    }
    const intent = JSON.parse(checkpoint.body);
    if (intent.resetId !== RESET_ID || !Array.isArray(intent.eventIds) || !intent.initialBackupKey) throw new Error("queue_reset_intent_invalid");
    const originalBackup = await store.get(intent.initialBackupKey);
    if (!originalBackup || sha(originalBackup.body) !== intent.initialBackupSha256) throw new Error("queue_reset_backup_not_verified");
    const ids = new Set(intent.eventIds);
    const backupKeys = [intent.initialBackupKey];
    for (let attempt = 0; attempt < 5; attempt++) {
      const held = await store.get(LEASE);
      const ownedLease = held && JSON.parse(held.body).lease;
      if (ownedLease?.ownerId !== ownerId || Date.parse(ownedLease.expiresAt) <= Date.now()) throw new Error("queue_reset_lease_lost");
      const current = await store.get(QUEUE);
      if (!current?.etag) throw new Error("queue_reset_etag_missing");
      const state = JSON.parse(current.body);
      if (state.version !== 2 || !Array.isArray(state.pending)
        || state.pending.some(event => !event || typeof event.id !== "string")) throw new Error("queue_reset_state_invalid");
      const pending = state.pending.filter(event => !ids.has(event.id));
      const backupKey = `${PREFIX}rollback/queue-fresh-start-${RESET_ID}-${sha(current.body).slice(0, 20)}.json`;
      const backup = await store.get(backupKey);
      if (!backup && !await store.put(backupKey, current.body, { absent: true })) throw new Error("queue_reset_backup_conflict");
      const verifiedBackup = backup ?? await store.get(backupKey);
      if (!verifiedBackup || sha(verifiedBackup.body) !== sha(current.body)) throw new Error("queue_reset_backup_not_verified");
      if (!backupKeys.includes(backupKey)) backupKeys.push(backupKey);
      // Seen IDs and every other state field stay untouched. New arrivals
      // outside the recorded reset intent remain queued after a write conflict.
      // A reset is not a market scan; retain the original scan timestamp.
      const next = { ...state, pending };
      if (!await store.put(QUEUE, JSON.stringify(next), { match: current.etag })) continue;
      const verified = await store.get(QUEUE);
      const after = verified && JSON.parse(verified.body);
      if (!after || !Array.isArray(after.pending) || after.pending.some(event => ids.has(event.id))) throw new Error("queue_reset_verification_failed");
      const receipt = { completed: true, resetId: RESET_ID, resetAt: intent.resetAt, verifiedAt: new Date().toISOString(),
        intendedRemovalCount: ids.size, removedInFinalWrite: state.pending.length - pending.length,
        pendingAfterReset: after.pending.length, backupKeys, preservedSeen: true, preservedDiscovery: true,
        preservedCostsAndAlertHistory: true, writesLimitedTo: PREFIX };
      if (!await store.put(RECEIPT, JSON.stringify(receipt), { absent: true })) throw new Error("queue_reset_receipt_conflict");
      return receipt;
    }
    throw new Error("queue_reset_state_conflict");
  } finally {
    const held = await store.get(LEASE);
    if (held && JSON.parse(held.body).lease?.ownerId === ownerId) {
      await store.put(LEASE, JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), lease: null }), { match: held.etag });
    }
  }
}

/** Existing reset-service credentials stay within its Railway runtime. */
export function productionR2Store() {
  if (process.env.RAILWAY_PROJECT_ID !== "83d99341-d622-475f-8035-00ef3d0916d1"
    || process.env.RAILWAY_ENVIRONMENT_ID !== "87afb8d7-c4fc-4f84-92b6-5d2820a689b6"
    || process.env.RAILWAY_SERVICE_ID !== "a90a72f1-dc27-4f84-bbcd-87a7e749bae0"
    || process.env.SWING_UP_PR262_STORAGE_PREFIX !== PREFIX || process.env.SWING_UP_R2_WRITE_PREFIX !== PREFIX) {
    throw new Error("queue_reset_production_scope_required");
  }
  const endpoint = new URL(process.env.R2_ENDPOINT ?? "");
  if (endpoint.protocol !== "https:" || !endpoint.hostname.endsWith(".r2.cloudflarestorage.com")) throw new Error("queue_reset_endpoint_invalid");
  const bucket = process.env.R2_BUCKET;
  const access = process.env.R2_ACCESS_KEY_ID;
  const secret = process.env.R2_SECRET_ACCESS_KEY;
  const region = process.env.R2_REGION || "auto";
  if (!bucket || !access || !secret) throw new Error("queue_reset_credentials_unavailable");
  const hmac = (key, value) => crypto.createHmac("sha256", key).update(value).digest();
  const request = async (method, key, body = "", conditional = {}) => {
    const allowed = key === QUEUE || key === LEASE || key.startsWith(`${PREFIX}operations/queue-resets/${RESET_ID}`)
      || key.startsWith(`${PREFIX}rollback/queue-fresh-start-${RESET_ID}-`);
    if (!allowed || key.includes("..")) throw new Error("queue_reset_key_out_of_scope");
    const url = new URL(`/${bucket}/${key.split("/").map(encodeURIComponent).join("/")}`, endpoint);
    const at = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
    const day = at.slice(0, 8), scope = `${day}/${region}/s3/aws4_request`;
    const headers = { host: url.host, "x-amz-content-sha256": sha(body), "x-amz-date": at,
      ...(method === "PUT" ? { "content-type": "application/json" } : {}),
      ...(conditional.match ? { "if-match": conditional.match } : {}), ...(conditional.absent ? { "if-none-match": "*" } : {}) };
    const names = Object.keys(headers).sort();
    const canonical = [method, url.pathname, "", names.map(name => `${name}:${headers[name]}\n`).join(""), names.join(";"), sha(body)].join("\n");
    const signingKey = hmac(hmac(hmac(hmac(`AWS4${secret}`, day), region), "s3"), "aws4_request");
    const signature = crypto.createHmac("sha256", signingKey).update(["AWS4-HMAC-SHA256", at, scope, sha(canonical)].join("\n")).digest("hex");
    headers.authorization = `AWS4-HMAC-SHA256 Credential=${access}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`;
    return fetch(url, { method, headers, ...(method === "PUT" ? { body } : {}), redirect: "error", signal: AbortSignal.timeout(15000) });
  };
  return {
    get: async key => {
      const response = await request("GET", key);
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`queue_reset_read_http_${response.status}`);
      const body = await response.text();
      if (Buffer.byteLength(body) > 32 * 1024 * 1024) throw new Error("queue_reset_state_too_large");
      return { body, etag: response.headers.get("etag") };
    },
    put: async (key, body, conditional) => {
      const response = await request("PUT", key, body, conditional);
      await response.body?.cancel();
      if (response.status === 412 || response.status === 409) return false;
      if (!response.ok) throw new Error(`queue_reset_write_http_${response.status}`);
      return true;
    },
  };
}

export async function main() {
  console.log(`[pr262-fresh-start] starting reset=${RESET_ID} queueVersion=2`);
  const store = productionR2Store();
  const until = Date.now() + 180000;
  while (true) {
    try {
      console.log(`[pr262-fresh-start] ${JSON.stringify(await freshStartPendingQueue(store))}`);
      return;
    } catch (error) {
      if (error.message !== "queue_reset_worker_busy" || Date.now() >= until) throw error;
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(`[pr262-fresh-start] ${error.message}`); process.exitCode = 1; });
}
