import crypto from "node:crypto";
import {
  getR2Config,
  normalizeR2WritePrefix,
  readVersionedTextFromR2,
  writeVersionedJsonToR2,
} from "@/lib/r2-warehouse";

const COMBINED_BRANCH = "agent/combined-opportunity-engine";
const R2_WRITE_PREFIX = "branch-labs/pr-262/";
const R2_LEDGER_PREFIX = `${R2_WRITE_PREFIX}worldwide-learning`;
const R2_STATE_KEY = `${R2_LEDGER_PREFIX}/state-v1.json`;
const MAX_PENDING_FINDINGS = 4_000;
const MAX_STATE_AGE_MS = 110 * 24 * 60 * 60 * 1000;
const CHECKPOINTS = [
  { label: "1D", milliseconds: 24 * 60 * 60 * 1000, maximumDelayMs: 7 * 24 * 60 * 60 * 1000 },
  { label: "3D", milliseconds: 3 * 24 * 60 * 60 * 1000, maximumDelayMs: 7 * 24 * 60 * 60 * 1000 },
  { label: "7D", milliseconds: 7 * 24 * 60 * 60 * 1000, maximumDelayMs: 7 * 24 * 60 * 60 * 1000 },
  { label: "30D", milliseconds: 30 * 24 * 60 * 60 * 1000, maximumDelayMs: 14 * 24 * 60 * 60 * 1000 },
  { label: "90D", milliseconds: 90 * 24 * 60 * 60 * 1000, maximumDelayMs: 14 * 24 * 60 * 60 * 1000 },
] as const;

type JsonRecord = Record<string, unknown>;
type CheckpointLabel = typeof CHECKPOINTS[number]["label"];

export type WorldwideLearningFinding = {
  kind: "certified_finding" | "research_finding" | "verification_rejection_summary";
  tradingViewSymbol: string;
  symbol: string;
  company: string;
  exchange: string;
  country: string | null;
  action: "buy" | "sell" | "watch_out";
  disposition: string;
  currentPrice: number | null;
  observedAt: string;
  qualifiedCertified: boolean;
  rejectionReasons: string[];
  evidence: JsonRecord;
};

export type WorldwideMarketObservation = {
  tradingViewSymbol: string;
  price: number;
  observedAt: string;
  source: string;
};

export type WorldwideLearningRun = {
  workflow: "global_serious_scan" | "global_deep_research";
  checkedAt: string;
  runtimeCommit: string | null;
  summary: JsonRecord;
  findings: WorldwideLearningFinding[];
  observations: WorldwideMarketObservation[];
};

type PendingFinding = {
  id: string;
  runId: string;
  workflow: WorldwideLearningRun["workflow"];
  tradingViewSymbol: string;
  symbol: string;
  action: WorldwideLearningFinding["action"];
  disposition: string;
  qualifiedCertified: boolean;
  entryPrice: number;
  signalObservedAt: string;
  checkpointObjects: Partial<Record<CheckpointLabel, string>>;
  missedCheckpoints: CheckpointLabel[];
};

type WorldwideLearningState = {
  version: 1;
  pendingFindings: PendingFinding[];
  updatedAt: string;
};

type StateLoad = {
  state: WorldwideLearningState;
  etag: string | null;
};

type OutcomeCandidate = {
  pending: PendingFinding;
  checkpoint: typeof CHECKPOINTS[number];
  observation: WorldwideMarketObservation;
  payload: JsonRecord;
  objectKey: string;
};

function record(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function finitePositive(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function validTime(value: unknown) {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
}

function stringList(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()) : [];
}

function safeSegment(value: string, fallback: string) {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100) || fallback;
}

function digest(value: unknown) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 24);
}

function emptyState(): WorldwideLearningState {
  return { version: 1, pendingFindings: [], updatedAt: new Date(0).toISOString() };
}

function normalizePending(value: unknown): PendingFinding | null {
  const item = record(value);
  const action = item?.action;
  const checkpointObjects = record(item?.checkpointObjects) ?? {};
  const signalObservedAt = validTime(item?.signalObservedAt);
  const entryPrice = finitePositive(item?.entryPrice);
  if (
    !item
    || !text(item.id)
    || !text(item.runId)
    || !["global_serious_scan", "global_deep_research"].includes(String(item.workflow))
    || !text(item.tradingViewSymbol)
    || !text(item.symbol)
    || !["buy", "sell", "watch_out"].includes(String(action))
    || !text(item.disposition)
    || entryPrice === null
    || !signalObservedAt
  ) {
    return null;
  }
  return {
    id: String(item.id),
    runId: String(item.runId),
    workflow: item.workflow as PendingFinding["workflow"],
    tradingViewSymbol: String(item.tradingViewSymbol).toUpperCase(),
    symbol: String(item.symbol).toUpperCase(),
    action: action as PendingFinding["action"],
    disposition: String(item.disposition),
    qualifiedCertified: item.qualifiedCertified === true,
    entryPrice,
    signalObservedAt,
    checkpointObjects: Object.fromEntries(
      CHECKPOINTS.flatMap((checkpoint) => {
        const objectKey = text(checkpointObjects[checkpoint.label]);
        return objectKey ? [[checkpoint.label, objectKey]] : [];
      }),
    ),
    missedCheckpoints: stringList(item.missedCheckpoints).filter((value): value is CheckpointLabel => CHECKPOINTS.some((checkpoint) => checkpoint.label === value)),
  };
}

function normalizeState(value: unknown): WorldwideLearningState {
  const parsed = record(value);
  const pending = Array.isArray(parsed?.pendingFindings)
    ? parsed.pendingFindings.map(normalizePending).filter((item): item is PendingFinding => item !== null)
    : [];
  return {
    version: 1,
    pendingFindings: [...new Map(pending.map((item) => [item.id, item])).values()],
    updatedAt: validTime(parsed?.updatedAt) ?? new Date(0).toISOString(),
  };
}

function validateRun(input: WorldwideLearningRun) {
  const checkedAt = validTime(input.checkedAt);
  if (!checkedAt) throw new Error("worldwide_learning_invalid_checked_at");
  if (!["global_serious_scan", "global_deep_research"].includes(input.workflow)) throw new Error("worldwide_learning_invalid_workflow");
  return { ...input, checkedAt };
}

function normalizedFinding(finding: WorldwideLearningFinding) {
  const observedAt = validTime(finding.observedAt);
  const tradingViewSymbol = text(finding.tradingViewSymbol)?.toUpperCase();
  const symbol = text(finding.symbol)?.toUpperCase();
  if (!observedAt || !tradingViewSymbol || !symbol) throw new Error("worldwide_learning_invalid_finding");
  return {
    ...finding,
    tradingViewSymbol,
    symbol,
    observedAt,
    rejectionReasons: [...new Set(finding.rejectionReasons.map((reason) => reason.trim()).filter(Boolean))].slice(0, 100),
  };
}

function normalizedObservation(observation: WorldwideMarketObservation) {
  const observedAt = validTime(observation.observedAt);
  const tradingViewSymbol = text(observation.tradingViewSymbol)?.toUpperCase();
  const price = finitePositive(observation.price);
  if (!observedAt || !tradingViewSymbol || price === null) return null;
  return { ...observation, tradingViewSymbol, observedAt, price };
}

function runIdentity(input: WorldwideLearningRun) {
  return digest({
    workflow: input.workflow,
    checkedAt: input.checkedAt,
    runtimeCommit: input.runtimeCommit,
    summary: input.summary,
    findings: input.findings.map((finding) => [finding.kind, finding.tradingViewSymbol, finding.action, finding.disposition, finding.currentPrice]),
  });
}

function immutableRunPayload(input: WorldwideLearningRun, runId: string) {
  return {
    version: 1,
    kind: "worldwide_real_test_run",
    runId,
    workflow: input.workflow,
    checkedAt: input.checkedAt,
    runtimeCommit: input.runtimeCommit,
    summary: input.summary,
    findingCount: input.findings.length,
    certifiedFindingCount: input.findings.filter((finding) => finding.qualifiedCertified).length,
    rejectedOrBlockedFindingCount: input.findings.filter((finding) => finding.rejectionReasons.length > 0).length,
    realProviderDataOnly: true,
    immutable: true,
    safety: { databaseWrites: false, publishing: false, notifications: false, trading: false, productionR2Writes: false },
  };
}

function immutableFindingPayload(input: WorldwideLearningRun, runId: string, finding: ReturnType<typeof normalizedFinding>) {
  const findingId = digest({
    runId,
    kind: finding.kind,
    tradingViewSymbol: finding.tradingViewSymbol,
    action: finding.action,
    disposition: finding.disposition,
    observedAt: finding.observedAt,
  });
  return {
    findingId,
    payload: {
      version: 1,
      kind: finding.kind,
      findingId,
      runId,
      workflow: input.workflow,
      checkedAt: input.checkedAt,
      tradingViewSymbol: finding.tradingViewSymbol,
      symbol: finding.symbol,
      company: finding.company,
      exchange: finding.exchange,
      country: finding.country,
      action: finding.action,
      disposition: finding.disposition,
      currentPrice: finitePositive(finding.currentPrice),
      signalObservedAt: finding.observedAt,
      qualifiedCertified: finding.qualifiedCertified,
      rejectionReasons: finding.rejectionReasons,
      evidence: finding.evidence,
      realProviderDataOnly: true,
      immutable: true,
      safety: { databaseWrites: false, publishing: false, notifications: false, trading: false, productionR2Writes: false },
    },
  };
}

function objectKeyDate(value: string) {
  return value.slice(0, 10);
}

function runObjectKey(input: WorldwideLearningRun, runId: string) {
  return `${R2_LEDGER_PREFIX}/runs/${objectKeyDate(input.checkedAt)}/${safeSegment(input.workflow, "workflow")}-${runId}.json`;
}

function findingObjectKey(input: WorldwideLearningRun, findingId: string) {
  return `${R2_LEDGER_PREFIX}/findings/${objectKeyDate(input.checkedAt)}/${findingId}.json`;
}

function outcomeObjectKey(pending: PendingFinding, checkpoint: CheckpointLabel) {
  return `${R2_LEDGER_PREFIX}/outcomes/${objectKeyDate(pending.signalObservedAt)}/${pending.id}-${checkpoint.toLowerCase()}.json`;
}

async function readState(): Promise<StateLoad> {
  const current = await readVersionedTextFromR2(R2_STATE_KEY);
  if (!current.found) return { state: emptyState(), etag: null };
  if (!current.text || !current.etag) throw new Error("worldwide_learning_state_invalid");
  return { state: normalizeState(JSON.parse(current.text)), etag: current.etag };
}

async function writeImmutable(
  objectKey: string,
  payload: JsonRecord,
  identityMatches: (existing: JsonRecord) => boolean,
) {
  const written = await writeVersionedJsonToR2(objectKey, payload, { createOnly: true });
  if (written.written) return payload;
  if (!written.conflict) throw new Error("worldwide_learning_immutable_write_failed");
  const existing = await readVersionedTextFromR2(objectKey);
  if (!existing.found || !existing.text) throw new Error("worldwide_learning_immutable_conflict_read_failed");
  const parsed = record(JSON.parse(existing.text));
  if (!parsed || !identityMatches(parsed)) throw new Error("worldwide_learning_immutable_content_conflict");
  return parsed;
}

function latestObservations(observations: WorldwideMarketObservation[]) {
  const bySymbol = new Map<string, WorldwideMarketObservation>();
  for (const raw of observations) {
    const observation = normalizedObservation(raw);
    if (!observation) continue;
    const current = bySymbol.get(observation.tradingViewSymbol);
    if (!current || observation.observedAt > current.observedAt) bySymbol.set(observation.tradingViewSymbol, observation);
  }
  return bySymbol;
}

function nextOutcomeCandidate(pending: PendingFinding, observation: WorldwideMarketObservation): OutcomeCandidate | null {
  const signalAt = Date.parse(pending.signalObservedAt);
  const observedAt = Date.parse(observation.observedAt);
  if (!Number.isFinite(signalAt) || !Number.isFinite(observedAt) || observedAt <= signalAt) return null;
  for (const checkpoint of CHECKPOINTS) {
    if (pending.checkpointObjects[checkpoint.label] || pending.missedCheckpoints.includes(checkpoint.label)) continue;
    const targetAt = signalAt + checkpoint.milliseconds;
    if (observedAt < targetAt) return null;
    if (observedAt > targetAt + checkpoint.maximumDelayMs) {
      pending.missedCheckpoints.push(checkpoint.label);
      continue;
    }
    const rawReturnPercent = ((observation.price - pending.entryPrice) / pending.entryPrice) * 100;
    const directionAdjustedReturnPercent = pending.action === "buy"
      ? rawReturnPercent
      : pending.action === "sell"
        ? -rawReturnPercent
        : null;
    const absoluteMovePercent = Math.abs(rawReturnPercent);
    const objectKey = outcomeObjectKey(pending, checkpoint.label);
    const payload = {
      version: 1,
      kind: "worldwide_forward_outcome_checkpoint",
      findingId: pending.id,
      sourceRunId: pending.runId,
      sourceWorkflow: pending.workflow,
      tradingViewSymbol: pending.tradingViewSymbol,
      symbol: pending.symbol,
      action: pending.action,
      dispositionAtSignal: pending.disposition,
      qualifiedCertifiedAtSignal: pending.qualifiedCertified,
      checkpoint: checkpoint.label,
      signalObservedAt: pending.signalObservedAt,
      targetAt: new Date(targetAt).toISOString(),
      evaluatedAt: observation.observedAt,
      maximumDelayMs: checkpoint.maximumDelayMs,
      priceAtSignal: pending.entryPrice,
      evaluationPrice: observation.price,
      forwardReturnPercent: Math.round(rawReturnPercent * 100) / 100,
      directionAdjustedReturnPercent: directionAdjustedReturnPercent === null ? null : Math.round(directionAdjustedReturnPercent * 100) / 100,
      absoluteMovePercent: Math.round(absoluteMovePercent * 100) / 100,
      usefulAtCheckpoint: pending.action === "watch_out"
        ? absoluteMovePercent >= 12
        : (directionAdjustedReturnPercent ?? Number.NEGATIVE_INFINITY) >= 0.5,
      source: observation.source,
      benchmarkAdjusted: false,
      immutable: true,
      safety: { databaseWrites: false, publishing: false, notifications: false, trading: false, productionR2Writes: false },
    };
    return { pending, checkpoint, observation, payload, objectKey };
  }
  return null;
}

function pendingFromFinding(
  input: WorldwideLearningRun,
  runId: string,
  findingId: string,
  finding: ReturnType<typeof normalizedFinding>,
): PendingFinding | null {
  const entryPrice = finitePositive(finding.currentPrice);
  if (entryPrice === null || finding.kind === "verification_rejection_summary") return null;
  return {
    id: findingId,
    runId,
    workflow: input.workflow,
    tradingViewSymbol: finding.tradingViewSymbol,
    symbol: finding.symbol,
    action: finding.action,
    disposition: finding.disposition,
    qualifiedCertified: finding.qualifiedCertified,
    entryPrice,
    signalObservedAt: finding.observedAt,
    checkpointObjects: {},
    missedCheckpoints: [],
  };
}

function prunedPending(pending: PendingFinding[], now: number) {
  return pending
    .filter((item) => {
      const signalAt = Date.parse(item.signalObservedAt);
      return Number.isFinite(signalAt)
        && now - signalAt <= MAX_STATE_AGE_MS
        && Object.keys(item.checkpointObjects).length < CHECKPOINTS.length;
    })
    .sort((left, right) => left.signalObservedAt.localeCompare(right.signalObservedAt))
    .slice(-MAX_PENDING_FINDINGS);
}

function assertBranchWriteIsolation() {
  if (process.env.RAILWAY_GIT_BRANCH?.trim() !== COMBINED_BRANCH) throw new Error("worldwide_learning_branch_not_allowed");
  if (normalizeR2WritePrefix(process.env.SWING_UP_R2_WRITE_PREFIX) !== R2_WRITE_PREFIX) throw new Error("worldwide_learning_r2_prefix_not_allowed");
  if (!getR2Config().configured) throw new Error("worldwide_learning_r2_not_configured");
}

export async function persistWorldwideLearningRun(rawInput: WorldwideLearningRun) {
  assertBranchWriteIsolation();
  const input = validateRun(rawInput);
  const findings = input.findings.map(normalizedFinding);
  const runId = runIdentity({ ...input, findings });
  const runPayload = immutableRunPayload({ ...input, findings }, runId);
  const runKey = runObjectKey(input, runId);
  await writeImmutable(runKey, runPayload, (existing) => existing.kind === "worldwide_real_test_run" && existing.runId === runId);

  const immutableFindings = findings.map((finding) => ({ finding, ...immutableFindingPayload(input, runId, finding) }));
  const findingKeys: string[] = [];
  for (const item of immutableFindings) {
    const objectKey = findingObjectKey(input, item.findingId);
    await writeImmutable(objectKey, item.payload, (existing) => existing.findingId === item.findingId && existing.runId === runId);
    findingKeys.push(objectKey);
  }

  const observations = latestObservations(input.observations);
  const outcomeKeys = new Set<string>();
  let finalPendingCount = 0;
  let stateWritten = false;
  for (let attempt = 0; attempt < 3 && !stateWritten; attempt += 1) {
    const loaded = await readState();
    const byId = new Map(loaded.state.pendingFindings.map((item) => [item.id, item]));
    for (const item of immutableFindings) {
      const pending = pendingFromFinding(input, runId, item.findingId, item.finding);
      if (pending && !byId.has(pending.id)) byId.set(pending.id, pending);
    }
    for (const pending of byId.values()) {
      const observation = observations.get(pending.tradingViewSymbol);
      if (!observation) continue;
      const due = nextOutcomeCandidate(pending, observation);
      if (!due) continue;
      const archived = await writeImmutable(
        due.objectKey,
        due.payload,
        (existing) => existing.kind === "worldwide_forward_outcome_checkpoint"
          && existing.findingId === pending.id
          && existing.checkpoint === due.checkpoint.label,
      );
      pending.checkpointObjects[due.checkpoint.label] = due.objectKey;
      if (archived.evaluatedAt !== due.payload.evaluatedAt) {
        const archivedObservedAt = validTime(archived.evaluatedAt);
        if (!archivedObservedAt) throw new Error("worldwide_learning_archived_outcome_invalid");
      }
      outcomeKeys.add(due.objectKey);
    }
    const state: WorldwideLearningState = {
      version: 1,
      pendingFindings: prunedPending([...byId.values()], Date.parse(input.checkedAt)),
      updatedAt: input.checkedAt,
    };
    const written = await writeVersionedJsonToR2(
      R2_STATE_KEY,
      state,
      loaded.etag ? { expectedEtag: loaded.etag } : { createOnly: true },
    );
    if (!written.conflict && written.written) {
      stateWritten = true;
      finalPendingCount = state.pendingFindings.length;
    }
  }
  if (!stateWritten) throw new Error("worldwide_learning_state_write_conflict");

  return {
    backend: "cloudflare_r2" as const,
    durable: true,
    branchNamespace: "pr-262",
    stateObject: R2_STATE_KEY,
    runObject: runKey,
    findingObjects: findingKeys,
    outcomeObjects: [...outcomeKeys],
    pendingOutcomeFindingCount: finalPendingCount,
    immutableCreateOnlyRecords: true,
    idempotent: true,
    safety: { databaseWrites: false, publishing: false, notifications: false, trading: false, productionR2Writes: false },
  };
}

export const WORLDWIDE_LEARNING_LEDGER_POLICY = {
  branch: COMBINED_BRANCH,
  r2WritePrefix: R2_WRITE_PREFIX,
  objectPrefix: R2_LEDGER_PREFIX,
  stateObject: R2_STATE_KEY,
  checkpoints: CHECKPOINTS.map((checkpoint) => ({
    label: checkpoint.label,
    maximumDelayDays: checkpoint.maximumDelayMs / (24 * 60 * 60 * 1000),
  })),
  historyRequiredForPromotion: false,
  findingsAndOutcomesAreLearningEvidenceOnly: true,
  databaseWrites: false,
  publishing: false,
  notifications: false,
  trading: false,
} as const;
