import crypto from "node:crypto";
import { pr262StorageKey } from "@/lib/opportunity-engine/pr262-storage";
import { readVersionedTextFromR2, writeVersionedJsonToR2 } from "@/lib/r2-warehouse";

/** One immutable delivery owner per issuer/evidence/direction, with no clock expiry. */
export async function bindSeriousSignalEvidence(input: {
  cik: string;
  evidenceKey: string;
  direction: "upside" | "downside";
  outboxKey: string;
  now: Date;
  signal?: AbortSignal;
  existingOnly?: boolean;
}) {
  if (!/^\d{10}$/.test(input.cik) || !/^[a-f0-9]{64}$/.test(input.evidenceKey)
    || !["upside", "downside"].includes(input.direction)) {
    throw new Error("serious_signal_evidence_binding_identity_invalid");
  }
  const relativePrefix = "serious-signal/evidence-delivery-v1";
  const bindingPrefix = pr262StorageKey(`${relativePrefix}/_scope.json`).slice(0, -"/_scope.json".length);
  const pilotRoot = bindingPrefix.slice(0, -relativePrefix.length);
  const validOutbox = (value: unknown): value is string => typeof value === "string"
    && value.length <= 1000 && value.startsWith(pilotRoot)
    && /^(?:cohorts\/[a-z0-9][a-z0-9-]{2,63}\/)?serious-signal\/outbox\/(?:event-job|watch-out-v2)\/[A-Za-z0-9._/-]+\.json$/.test(value.slice(pilotRoot.length))
    && !value.split("/").some(part => part === "." || part === "..");
  if (!validOutbox(input.outboxKey)) throw new Error("serious_signal_evidence_binding_outbox_invalid");
  const identity = crypto.createHash("sha256").update(JSON.stringify([input.cik, input.direction, input.evidenceKey])).digest("hex");
  const key = `${bindingPrefix}/${input.cik}/${identity}.json`;
  const parse = (raw: string | null) => {
    const row = raw ? JSON.parse(raw) as Record<string, unknown> : null;
    if (!row || row.version !== 1 || row.kind !== "serious_signal_evidence_delivery_binding"
      || row.cik !== input.cik || row.direction !== input.direction || row.evidenceKey !== input.evidenceKey
      || !validOutbox(row.outboxKey) || typeof row.createdAt !== "string" || !Number.isFinite(Date.parse(row.createdAt))) {
      throw new Error("serious_signal_evidence_binding_invalid");
    }
    return { key, outboxKey: row.outboxKey, duplicate: row.outboxKey !== input.outboxKey };
  };
  input.signal?.throwIfAborted();
  const prior = await readVersionedTextFromR2(key, { signal: input.signal });
  if (prior.found) return parse(prior.text);
  if (input.existingOnly) throw new Error("serious_signal_legacy_evidence_requires_migration");
  const payload = { version: 1, kind: "serious_signal_evidence_delivery_binding", cik: input.cik,
    direction: input.direction, evidenceKey: input.evidenceKey, outboxKey: input.outboxKey, createdAt: input.now.toISOString() };
  // Conditional creation elects exactly one owner even for concurrent daily IDs.
  // Always read back; an acknowledgement lost after a successful PUT cannot
  // permit another outbox to send, and an unreadable result fails closed.
  await writeVersionedJsonToR2(key, payload, { createOnly: true, signal: input.signal });
  const saved = await readVersionedTextFromR2(key, { signal: input.signal });
  if (!saved.found) throw new Error("serious_signal_evidence_binding_readback_missing");
  return parse(saved.text);
}
