import crypto from "node:crypto";
import { completeCommitteeReview } from "@/lib/ai-committee/review-policy";
import { legacyTerminalReviewEvidence, legacyPrimarySourceReviewEvidence, sameTerminalReviewEvidence, terminalPublicationPacketKey, validatedTerminalEvidence, type TerminalEvidence } from "@/lib/equity-signal/terminal-review-evidence";
import { pr262StorageKey } from "@/lib/opportunity-engine/pr262-storage";
import { readVersionedTextFromR2, writeVersionedJsonToR2 } from "@/lib/r2-warehouse";

type Json = Record<string, unknown>;
const object = (v: unknown): Json => v && typeof v === "object" && !Array.isArray(v) ? v as Json : {};
const hash = (v: string) => crypto.createHash("sha256").update(v).digest("hex");
const canonical = (v: unknown): unknown => Array.isArray(v) ? v.map(canonical) : v && typeof v === "object"
  ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, value]) => [k, canonical(value)])) : v;
const seal = (v: unknown) => hash(JSON.stringify(canonical(v)));
const root = () => pr262StorageKey("terminal-reviews-v1");
const journalKey = (cik: string) => { if (!/^\d{10}$/.test(cik)) throw new Error("terminal_review_identity_invalid"); return `${root()}/companies/${cik}.json`; };
const attemptKey = (id: string) => `${root()}/attempts/${hash(id)}.json`;
type Identity = { cik: string; ticker: string };
export type TerminalDecision = {
  version: 1; cik: string; ticker: string; direction: "upside" | "downside" | "unknown";
  decisionKey: string; outcome: "approved" | "rejected" | "needs_more_data"; fingerprint: string;
  evidence: TerminalEvidence; decidedAt: string; eventId: string; resultKey?: string;
  publicationPacketKey: string;
};
type Decision = TerminalDecision & { committee: Json; publicationGatePassed: boolean; integrity: string };
type Legacy = { fingerprint: string; outcome: "approved" | "rejected" | "needs_more_data" | "unknown"; evidence: TerminalEvidence | null; completionProven: boolean };
type Pending = Identity & { attemptId: string; eventId: string; fingerprint: string; direction: string; evidence: TerminalEvidence; admittedAt: string };
type Journal = { version: 1; cik: string; decisions: Decision[]; legacy: Legacy[]; pending: Pending[] };
export type LegacyTerminalReview = { cik?: string; fingerprint: string; outcome: string; completionProven?: boolean; reviewEvidenceSnapshot?: unknown; primarySourceProvenance?: unknown };
type Query = Identity & { fingerprint: string; evidence: TerminalEvidence; legacy?: LegacyTerminalReview | LegacyTerminalReview[] | null; signal?: AbortSignal };

function validateDecision(value: unknown, cik: string): Decision {
  const r = object(value), { integrity, ...unsealed } = r;
  const evidence = validatedTerminalEvidence(r.evidence, { cik, ticker: r.ticker });
  if (r.version !== 1 || r.cik !== cik || !evidence || evidence.comparison.provenance !== "current"
    || r.decisionKey !== evidence.decisionKey || !["approved", "rejected", "needs_more_data"].includes(String(r.outcome))
    || !["upside", "downside", "unknown"].includes(String(r.direction)) || typeof r.fingerprint !== "string" || !r.fingerprint
    || typeof r.eventId !== "string" || !r.eventId || !Number.isFinite(Date.parse(String(r.decidedAt)))
    || typeof r.publicationGatePassed !== "boolean"
    || typeof r.publicationPacketKey !== "string" || !/^[a-f0-9]{64}$/.test(r.publicationPacketKey)
    || !completeCommitteeReview(r.committee) || object(object(r.committee).output).overallRecommendation !== (r.outcome === "approved" ? "approve" : r.outcome === "rejected" ? "reject" : "needs_more_data")
    || integrity !== seal(unsealed)) throw new Error("terminal_review_decision_invalid");
  return r as Decision;
}

async function load(cik: string, signal?: AbortSignal) {
  const saved = await readVersionedTextFromR2(journalKey(cik), { signal });
  if (!saved.found) return { state: { version: 1, cik, decisions: [], legacy: [], pending: [] } as Journal, etag: null };
  if (!saved.text || !saved.etag) throw new Error("terminal_review_journal_invalid");
  const r = object(JSON.parse(saved.text));
  if (r.version !== 1 || r.cik !== cik || !Array.isArray(r.decisions) || !Array.isArray(r.legacy) || !Array.isArray(r.pending)
    || r.integrity !== seal({ version: r.version, cik: r.cik, decisions: r.decisions, legacy: r.legacy, pending: r.pending })) throw new Error("terminal_review_journal_invalid");
  const decisions = r.decisions.map(v => validateDecision(v, cik));
  if (new Set(decisions.map(d => d.decisionKey)).size !== decisions.length) throw new Error("terminal_review_journal_duplicate");
  const legacy = r.legacy.map(v => {
    const row = object(v);
    if (typeof row.fingerprint !== "string" || !row.fingerprint || !["approved", "rejected", "needs_more_data", "unknown"].includes(String(row.outcome))
      || typeof row.completionProven !== "boolean"
      || !(row.evidence === null || validatedTerminalEvidence(row.evidence, { cik, ticker: object(row.evidence).ticker }))) throw new Error("terminal_review_legacy_invalid");
    return row as Legacy;
  });
  const pending = r.pending.map(v => {
    const row = object(v);
    if (row.cik !== cik || typeof row.attemptId !== "string" || !row.attemptId || typeof row.eventId !== "string" || !row.eventId
      || typeof row.fingerprint !== "string" || !Number.isFinite(Date.parse(String(row.admittedAt)))
      || !["upside", "downside", "unknown"].includes(String(row.direction))
      || !validatedTerminalEvidence(row.evidence, { cik, ticker: row.ticker })) throw new Error("terminal_review_pending_invalid");
    return row as Pending;
  });
  return { state: { version: 1, cik, decisions, legacy, pending } as Journal, etag: saved.etag };
}

async function save(state: Journal, etag: string | null, signal?: AbortSignal) {
  const written = await writeVersionedJsonToR2(journalKey(state.cik), { ...state, integrity: seal(state) },
    { ...(etag ? { expectedEtag: etag } : { createOnly: true }), signal });
  if (!written.written && !written.conflict) throw new Error("terminal_review_journal_write_failed");
  return written.written === true && !written.conflict;
}

function addLegacy(state: Journal, input: Query) {
  let changed = false;
  for (const legacy of Array.isArray(input.legacy) ? input.legacy : input.legacy ? [input.legacy] : []) {
    if (!["approved", "approved_pending_checks", "rejected", "needs_more_data", "unknown"].includes(legacy.outcome)
      || state.decisions.some(r => r.fingerprint === legacy.fingerprint)) continue;
    if (!legacy.fingerprint || !(legacy.fingerprint.startsWith(`valuation:${input.cik}:`) || legacy.cik === input.cik)) throw new Error("terminal_review_legacy_identity_invalid");
    const direction = /^valuation:\d{10}:(upside|downside|unknown):/.exec(legacy.fingerprint)?.[1] ?? "unknown";
    const evidence = legacyTerminalReviewEvidence(legacy.reviewEvidenceSnapshot, { ...input, fingerprint: legacy.fingerprint, direction })
      ?? legacyPrimarySourceReviewEvidence(legacy.primarySourceProvenance, input);
    const existing = state.legacy.find(r => r.fingerprint === legacy.fingerprint);
    if (existing) {
      if (!existing.evidence && evidence) { existing.evidence = evidence; changed = true; }
      continue;
    }
    state.legacy.push({ fingerprint: legacy.fingerprint,
      outcome: legacy.outcome === "unknown" ? "unknown" : legacy.outcome === "rejected" ? "rejected" : legacy.outcome === "needs_more_data" ? "needs_more_data" : "approved", evidence,
      completionProven: legacy.completionProven !== false });
    changed = true;
  }
  return changed;
}

function match(state: Journal, input: Query) {
  const decision = state.decisions.find(d => sameTerminalReviewEvidence(d.evidence, input.evidence));
  if (decision) return { kind: "terminal" as const, decision };
  const legacy = state.legacy.find(d => d.fingerprint === input.fingerprint || !d.evidence || sameTerminalReviewEvidence(d.evidence, input.evidence));
  if (legacy) return { kind: "held" as const, reason: !legacy.completionProven ? "terminal_legacy_completion_unknown"
    : legacy.evidence ? "terminal_legacy_same_evidence" : "terminal_legacy_provenance_unknown", outcome: legacy.outcome };
  // An uncertain admitted request cannot expire into another paid request.
  if (state.pending.some(p => sameTerminalReviewEvidence(p.evidence, input.evidence))) return { kind: "held" as const, reason: "terminal_review_recovery_pending" };
  return { kind: "eligible" as const };
}

/** A write-ahead receipt repairs append failures/restarts without paid replay. */
async function recover(state: Journal, signal?: AbortSignal) {
  let changed = false;
  for (const pending of [...state.pending]) {
    const saved = await readVersionedTextFromR2(attemptKey(pending.attemptId), { signal });
    if (!saved.found) continue;
    if (!saved.text) throw new Error("terminal_review_receipt_invalid");
    const receipt = object(JSON.parse(saved.text));
    if (receipt.version !== 1 || receipt.attemptId !== pending.attemptId || receipt.cik !== state.cik
      || receipt.integrity !== seal({ version: receipt.version, attemptId: receipt.attemptId, cik: receipt.cik, decision: receipt.decision })) throw new Error("terminal_review_receipt_invalid");
    if (receipt.decision !== null) {
      const decision = validateDecision(receipt.decision, state.cik);
      if (decision.eventId !== pending.eventId || decision.fingerprint !== pending.fingerprint
        || decision.decisionKey !== pending.evidence.decisionKey) throw new Error("terminal_review_receipt_mismatch");
      const existing = state.decisions.find(d => d.decisionKey === decision.decisionKey || sameTerminalReviewEvidence(d.evidence, decision.evidence));
      if (existing && existing.outcome !== decision.outcome) throw new Error("terminal_review_conflicting_decisions");
      if (!existing) state.decisions.push(decision);
    }
    state.pending = state.pending.filter(p => p.attemptId !== pending.attemptId);
    changed = true;
  }
  return changed;
}

export async function checkTerminalReview(input: Query) {
  if (!validatedTerminalEvidence(input.evidence, input)) throw new Error("terminal_review_evidence_invalid");
  for (let attempt = 0; attempt < 6; attempt++) {
    const { state, etag } = await load(input.cik, input.signal);
    const recovered = await recover(state, input.signal), migrated = addLegacy(state, input);
    if ((recovered || migrated) && !await save(state, etag, input.signal)) continue;
    return match(state, input);
  }
  throw new Error("terminal_review_journal_conflict");
}

export async function reserveTerminalReview(input: Query & { eventId: string; attemptId: string; direction: string; now: Date }) {
  if (!validatedTerminalEvidence(input.evidence, input)) throw new Error("terminal_review_evidence_invalid");
  for (let attempt = 0; attempt < 6; attempt++) {
    const { state, etag } = await load(input.cik, input.signal);
    const recovered = await recover(state, input.signal), migrated = addLegacy(state, input);
    const decision = match(state, input);
    if (decision.kind !== "eligible") {
      if ((recovered || migrated) && !await save(state, etag, input.signal)) continue;
      return false;
    }
    state.pending.push({ cik: input.cik, ticker: input.ticker, eventId: input.eventId, attemptId: input.attemptId,
      fingerprint: input.fingerprint, direction: input.direction, evidence: input.evidence, admittedAt: input.now.toISOString() });
    if (await save(state, etag, input.signal)) return true;
  }
  throw new Error("terminal_review_admission_conflict");
}

async function receipt(input: { cik: string; attemptId: string; decision: Decision | null; signal?: AbortSignal }) {
  const body = { version: 1, cik: input.cik, attemptId: input.attemptId, decision: input.decision };
  const payload = { ...body, integrity: seal(body) }, key = attemptKey(input.attemptId);
  const result = await writeVersionedJsonToR2(key, payload, { createOnly: true, signal: input.signal });
  if (result.conflict) {
    const saved = await readVersionedTextFromR2(key, { signal: input.signal });
    if (!saved.found || !saved.text || seal(JSON.parse(saved.text)) !== seal(payload)) throw new Error("terminal_review_receipt_conflict");
  } else if (!result.written) throw new Error("terminal_review_receipt_write_failed");
}

/** Call only after the runner returned a report (including technical failure),
 * or before any provider call when another admission guard denied this attempt.
 * This journal release never changes either money or count reservations. */
export async function finishTerminalReviewAttempt(input: Identity & { attemptId: string; eventId: string; report: Json; now: Date; resultKey?: string; signal?: AbortSignal }) {
  const candidate = object(input.report.selectedCandidate), committee = object(input.report.committee);
  const outcome = object(committee.output).overallRecommendation;
  const terminal = input.report.openAiCalled === true && completeCommitteeReview(committee) && ["approve", "reject", "needs_more_data"].includes(String(outcome));
  let decision: Decision | null = null;
  if (terminal) {
    const evidence = validatedTerminalEvidence(candidate.terminalEvidence, input);
    if (!evidence || !["upside", "downside", "unknown"].includes(String(candidate.direction)) || typeof input.report.candidateFingerprint !== "string") throw new Error("terminal_review_completed_evidence_invalid");
    const body: Omit<Decision, "integrity"> = { version: 1, cik: input.cik, ticker: input.ticker, direction: candidate.direction as "upside" | "downside" | "unknown",
      decisionKey: evidence.decisionKey, outcome: outcome === "approve" ? "approved" : outcome === "reject" ? "rejected" : "needs_more_data", fingerprint: input.report.candidateFingerprint,
      evidence, decidedAt: String(committee.finishedAt ?? input.report.checkedAt ?? input.now.toISOString()), eventId: input.eventId,
      ...(input.resultKey ? { resultKey: input.resultKey } : {}), committee, publicationGatePassed: candidate.gatePassed === true,
      publicationPacketKey: terminalPublicationPacketKey(candidate) };
    decision = { ...body, integrity: seal(body) };
    validateDecision(decision, input.cik);
  }
  await receipt({ ...input, decision });
  for (let attempt = 0; attempt < 6; attempt++) {
    const { state, etag } = await load(input.cik, input.signal);
    const pending = state.pending.find(p => p.attemptId === input.attemptId);
    if (pending && pending.eventId !== input.eventId) throw new Error("terminal_review_attempt_mismatch");
    await recover(state, input.signal);
    if (decision && !state.decisions.some(d => d.decisionKey === decision!.decisionKey)) {
      const equivalent = state.decisions.find(d => sameTerminalReviewEvidence(d.evidence, decision!.evidence));
      if (equivalent && equivalent.outcome !== decision.outcome) throw new Error("terminal_review_conflicting_decisions");
      if (!equivalent) state.decisions.push(decision);
    }
    if (await save(state, etag, input.signal)) {
      const stored = decision ? state.decisions.find(d => d.decisionKey === decision!.decisionKey || sameTerminalReviewEvidence(d.evidence, decision!.evidence)) : null;
      if (stored) { candidate.terminalDecisionKey = stored.decisionKey; candidate.terminalEvidence = stored.evidence; }
      return stored ?? null;
    }
  }
  throw new Error("terminal_review_completion_conflict");
}

export async function readTerminalDecision(input: { cik: string; decisionKey: string; signal?: AbortSignal }): Promise<TerminalDecision | null> {
  if (!/^[a-f0-9]{64}$/.test(input.decisionKey)) throw new Error("terminal_review_decision_key_invalid");
  const { state } = await load(input.cik, input.signal);
  const found = state.decisions.find(d => d.decisionKey === input.decisionKey);
  if (!found) return null;
  return { version: 1, cik: found.cik, ticker: found.ticker, direction: found.direction, decisionKey: found.decisionKey,
    outcome: found.outcome, fingerprint: found.fingerprint, evidence: found.evidence, decidedAt: found.decidedAt,
    eventId: found.eventId, ...(found.resultKey ? { resultKey: found.resultKey } : {}), publicationPacketKey: found.publicationPacketKey };
}
