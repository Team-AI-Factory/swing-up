import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { runBranchSignalLab, type BranchProviderCallDecision, type BranchProviderCallRequest } from "@/lib/branch-signal-lab";
import { isLegacyExternalStopReason, noGainRepairAttempts, providerCallBudgetDecision, repairEligibleFailure } from "@/lib/branch-signal-lab-policy";

export const dynamic = "force-dynamic";

const REPORT_FILENAME = "swing-up-railway-branch-signal-lab.json";
const EPHEMERAL_REPORT_PATH = `/tmp/${REPORT_FILENAME}`;
const LAB_BRANCH = "agent/live-signal-evaluation-automation";
const MAX_OPENAI_RUNS_PER_24_HOURS = 3;
const OPENAI_EVIDENCE_COOLDOWN_MS = 12 * 60 * 60 * 1000;
const OUTCOME_EVALUATION_TOLERANCE_MS = 30 * 60 * 1000;
const OUTCOME_CHECKPOINTS = [
  { label: "1D", milliseconds: 24 * 60 * 60 * 1000 },
  { label: "3D", milliseconds: 3 * 24 * 60 * 60 * 1000 },
  { label: "7D", milliseconds: 7 * 24 * 60 * 60 * 1000 },
  { label: "30D", milliseconds: 30 * 24 * 60 * 60 * 1000 },
  { label: "90D", milliseconds: 90 * 24 * 60 * 60 * 1000 },
] as const;

type JsonRecord = Record<string, unknown>;
type OpenAiReservation = {
  id: string;
  candidateFingerprint: string;
  reservedAt: string;
  ticker: string;
  direction: "upside" | "downside";
  status: "pending" | "completed" | "attempted_no_completion" | "denied_storage_fallback";
  completedAt?: string;
};
type ProviderCallReservation = Omit<BranchProviderCallRequest, "checkedAt"> & { reservedAt: string };
type History = { version: number; branch: string; deploymentId: string | null; stopped: boolean; stopReason: string | null; totalRunCount: number; runs: JsonRecord[]; openAiReservations: OpenAiReservation[]; providerCallReservations: ProviderCallReservation[]; updatedAt: string };
type StateStorage = {
  path: string;
  backend: "railway_volume" | "configured_path" | "ephemeral_tmp";
  durable: boolean;
  fallbackActive: boolean;
  fallbackReason: string | null;
};

function branchAllowed() {
  if (process.env.SWING_UP_BRANCH_LAB_ALLOW_LOCAL === "true") return true;
  const branch = process.env.RAILWAY_GIT_BRANCH?.trim();
  const environment = process.env.RAILWAY_ENVIRONMENT_NAME?.trim().toLowerCase();
  return Boolean(process.env.RAILWAY_PROJECT_ID && branch === LAB_BRANCH && environment && environment !== "production");
}

function emptyHistory(): History {
  return { version: 4, branch: process.env.RAILWAY_GIT_BRANCH?.trim() || LAB_BRANCH, deploymentId: process.env.RAILWAY_DEPLOYMENT_ID?.trim() || null, stopped: false, stopReason: null, totalRunCount: 0, runs: [], openAiReservations: [], providerCallReservations: [], updatedAt: new Date().toISOString() };
}

function errorCode(error: unknown) {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") return error.code.toLowerCase();
  return error instanceof SyntaxError ? "invalid_json" : "state_storage_error";
}

function ephemeralStorage(fallbackReason: string | null = null): StateStorage {
  return { path: EPHEMERAL_REPORT_PATH, backend: "ephemeral_tmp", durable: false, fallbackActive: Boolean(fallbackReason), fallbackReason };
}

function requestedStorage(): StateStorage {
  const explicitPath = process.env.SWING_UP_BRANCH_LAB_STATE_PATH?.trim();
  if (explicitPath) {
    if (!isAbsolute(explicitPath)) return ephemeralStorage("configured_state_path_must_be_absolute");
    const path = explicitPath.toLowerCase().endsWith(".json") ? explicitPath : join(explicitPath, REPORT_FILENAME);
    return { path, backend: "configured_path", durable: true, fallbackActive: false, fallbackReason: null };
  }
  const volumeMountPath = process.env.RAILWAY_VOLUME_MOUNT_PATH?.trim();
  if (volumeMountPath) {
    if (!isAbsolute(volumeMountPath)) return ephemeralStorage("railway_volume_mount_path_must_be_absolute");
    return { path: join(volumeMountPath, REPORT_FILENAME), backend: "railway_volume", durable: true, fallbackActive: false, fallbackReason: null };
  }
  return ephemeralStorage("durable_state_not_configured");
}

async function prepareStorage(storage: StateStorage) {
  try {
    await mkdir(dirname(storage.path), { recursive: true });
    return storage;
  } catch (error) {
    if (!storage.durable) throw error;
    const fallback = ephemeralStorage(`durable_storage_${errorCode(error)}`);
    await mkdir(dirname(fallback.path), { recursive: true });
    return fallback;
  }
}

async function readHistory(storage: StateStorage) {
  try {
    const parsed = JSON.parse(await readFile(storage.path, "utf8")) as History;
    if (!parsed || !Array.isArray(parsed.runs)) return emptyHistory();
    if (!Number.isFinite(parsed.totalRunCount)) parsed.totalRunCount = Math.max(parsed.runs.length, ...parsed.runs.map((run) => finiteNumber(run.runNumber) ?? 0));
    if (!Array.isArray(parsed.openAiReservations)) parsed.openAiReservations = [];
    if (!Array.isArray(parsed.providerCallReservations)) parsed.providerCallReservations = [];
    if (parsed.stopped && isLegacyExternalStopReason(parsed.stopReason)) {
      parsed.stopped = false;
      parsed.stopReason = null;
    }
    return parsed;
  } catch (error) {
    if (errorCode(error) !== "enoent") throw error;
    return emptyHistory();
  }
}

async function loadHistory(): Promise<{ history: History; storage: StateStorage }> {
  let storage = await prepareStorage(requestedStorage());
  try {
    return { history: await readHistory(storage), storage };
  } catch (error) {
    if (!storage.durable) return { history: emptyHistory(), storage: { ...storage, fallbackActive: true, fallbackReason: errorCode(error) } };
    storage = await prepareStorage(ephemeralStorage(`durable_storage_${errorCode(error)}`));
    try {
      return { history: await readHistory(storage), storage };
    } catch {
      return { history: emptyHistory(), storage };
    }
  }
}

async function writeHistory(history: History, storage: StateStorage) {
  history.updatedAt = new Date().toISOString();
  const temporaryPath = `${storage.path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(history, null, 2)}\n`, "utf8");
  await rename(temporaryPath, storage.path);
}

async function saveHistory(history: History, storage: StateStorage) {
  try {
    await writeHistory(history, storage);
    return storage;
  } catch (error) {
    if (!storage.durable) throw error;
    const fallback = await prepareStorage(ephemeralStorage(`durable_storage_${errorCode(error)}`));
    await writeHistory(history, fallback);
    return fallback;
  }
}

function storageMetadata(storage: StateStorage) {
  return {
    backend: storage.backend,
    durable: storage.durable,
    survivesPreviewRedeploy: storage.durable,
    fallbackActive: storage.fallbackActive,
    fallbackReason: storage.fallbackReason,
  };
}

function suppliedToken(request: NextRequest) {
  return request.headers.get("x-swing-up-branch-lab-token")?.trim() || request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
}

function safeRun(run: JsonRecord) {
  return run.databaseWrites === false && run.publishing === false && run.notifications === false;
}

function realBranchPerformanceRun(run: JsonRecord) {
  return run.mode === "railway_branch_live_read_only" && run.realProviderResponsesOnly === true;
}

function countablePerformanceRun(run: JsonRecord) {
  return realBranchPerformanceRun(run) && safeRun(run);
}

function record(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
}

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function reservationConsumed(reservation: OpenAiReservation) {
  return reservation.status === "pending" || reservation.status === "completed" || reservation.status === "attempted_no_completion";
}

function recentReservations(history: History, now: number, windowMs: number) {
  return history.openAiReservations.filter((reservation) => reservationConsumed(reservation) && now - Date.parse(reservation.reservedAt) >= 0 && now - Date.parse(reservation.reservedAt) < windowMs);
}

function legacyOpenAiRuns(history: History, now: number, windowMs: number) {
  const countedReservationIds = new Set(recentReservations(history, now, windowMs).map((reservation) => reservation.id));
  return history.runs.filter((run) => {
    if (run.openAiCalled !== true || (typeof run.openAiReservationId === "string" && countedReservationIds.has(run.openAiReservationId))) return false;
    const checkedAt = Date.parse(String(run.checkedAt ?? ""));
    return Number.isFinite(checkedAt) && now - checkedAt >= 0 && now - checkedAt < windowMs;
  });
}

function openAiAttemptsInWindow(history: History, now: number, windowMs: number) {
  return recentReservations(history, now, windowMs).length + legacyOpenAiRuns(history, now, windowMs).length;
}

function reviewedFingerprintsInWindow(history: History, now: number, windowMs: number) {
  return [...new Set([
    ...recentReservations(history, now, windowMs).map((reservation) => reservation.candidateFingerprint),
    ...legacyOpenAiRuns(history, now, windowMs).map((run) => run.candidateFingerprint).filter((value): value is string => typeof value === "string"),
  ])];
}

function providerQuotaUsage(history: History, now: number) {
  const latestPolicy = new Map<string, ProviderCallReservation>();
  for (const reservation of history.providerCallReservations) latestPolicy.set(reservation.quotaKey, reservation);
  return [...latestPolicy.values()].map((policy) => {
    const callsInWindow = history.providerCallReservations.filter((reservation) => reservation.quotaKey === policy.quotaKey && now - Date.parse(reservation.reservedAt) >= 0 && now - Date.parse(reservation.reservedAt) < policy.rollingWindowMs).length;
    const latestCall = [...history.providerCallReservations].reverse().find((reservation) => reservation.quotaKey === policy.quotaKey);
    return { provider: policy.provider, quotaKey: policy.quotaKey, rollingWindowHours: policy.rollingWindowMs / (60 * 60 * 1000), maximumCallsInWindow: policy.maximumCallsInWindow, callsInWindow, remainingCallsInWindow: Math.max(0, policy.maximumCallsInWindow - callsInWindow), latestReservedAt: latestCall?.reservedAt ?? null };
  }).sort((left, right) => left.provider.localeCompare(right.provider));
}

function pruneHistory(history: History, now: number) {
  const recentQuietRunStart = Math.max(0, history.runs.length - 576);
  const outcomeRetentionMs = 91 * 24 * 60 * 60 * 1000;
  history.runs = history.runs.filter((run, index) => {
    if (index >= recentQuietRunStart) return true;
    const checkedAt = Date.parse(String(run.checkedAt ?? ""));
    const withinOutcomeWindow = Number.isFinite(checkedAt) && now - checkedAt >= 0 && now - checkedAt <= outcomeRetentionMs;
    return withinOutcomeWindow && (run.openAiCalled === true || run.seriousSignalFound === true || typeof run.candidateFingerprint === "string");
  });
  history.openAiReservations = history.openAiReservations.filter((reservation) => now - Date.parse(reservation.reservedAt) < 31 * 24 * 60 * 60 * 1000);
  history.providerCallReservations = history.providerCallReservations.filter((reservation) => now - Date.parse(reservation.reservedAt) < 31 * 24 * 60 * 60 * 1000);
}

function validOneDayOutcome(run: JsonRecord) {
  if (!Array.isArray(run.outcomeEvaluations)) return null;
  const startedAt = Date.parse(String(run.checkedAt ?? ""));
  const selected = record(run.selectedCandidate);
  const direction = selected?.direction === "downside" ? "downside" : selected?.direction === "upside" ? "upside" : null;
  if (!Number.isFinite(startedAt) || !direction) return null;
  for (const value of run.outcomeEvaluations) {
    const outcome = record(value);
    if (!outcome || outcome.checkpoint !== "1D" || outcome.source !== "CoinGecko live snapshot") continue;
    const targetAt = Date.parse(String(outcome.targetAt ?? ""));
    const evaluatedAt = Date.parse(String(outcome.evaluatedAt ?? ""));
    const evaluationPollCheckedAt = Date.parse(String(outcome.evaluationPollCheckedAt ?? ""));
    const delayMs = finiteNumber(outcome.evaluationDelayMs);
    const pollDelayMs = finiteNumber(outcome.evaluationPollDelayMs);
    const maximumDelayMs = finiteNumber(outcome.maximumEvaluationDelayMs);
    if (!Number.isFinite(targetAt) || !Number.isFinite(evaluatedAt) || !Number.isFinite(evaluationPollCheckedAt) || delayMs === null || pollDelayMs === null || maximumDelayMs !== OUTCOME_EVALUATION_TOLERANCE_MS) continue;
    if (Math.abs(targetAt - (startedAt + OUTCOME_CHECKPOINTS[0].milliseconds)) > 1_000 || delayMs < 0 || delayMs > OUTCOME_EVALUATION_TOLERANCE_MS || pollDelayMs < 0 || pollDelayMs > OUTCOME_EVALUATION_TOLERANCE_MS) continue;
    if (Math.abs((evaluatedAt - targetAt) - delayMs) > 1_000 || Math.abs((evaluationPollCheckedAt - targetAt) - pollDelayMs) > 1_000) continue;
    if (evaluatedAt > evaluationPollCheckedAt + 60_000 || evaluationPollCheckedAt - evaluatedAt > OUTCOME_EVALUATION_TOLERANCE_MS) continue;
    const priceAtSignal = finiteNumber(outcome.priceAtSignal);
    const evaluationPrice = finiteNumber(outcome.evaluationPrice);
    const forwardReturnPercent = finiteNumber(outcome.forwardReturnPercent);
    const directionAdjustedReturnPercent = finiteNumber(outcome.directionAdjustedReturnPercent);
    if (priceAtSignal === null || priceAtSignal <= 0 || evaluationPrice === null || evaluationPrice <= 0 || forwardReturnPercent === null || directionAdjustedReturnPercent === null || typeof outcome.usefulAtCheckpoint !== "boolean") continue;
    const calculatedForwardReturn = ((evaluationPrice - priceAtSignal) / priceAtSignal) * 100;
    const calculatedDirectionAdjustedReturn = direction === "downside" ? -calculatedForwardReturn : calculatedForwardReturn;
    if (Math.abs(calculatedForwardReturn - forwardReturnPercent) > 0.02 || Math.abs(calculatedDirectionAdjustedReturn - directionAdjustedReturnPercent) > 0.02 || outcome.usefulAtCheckpoint !== (calculatedDirectionAdjustedReturn >= 2)) continue;
    return outcome;
  }
  return null;
}

function updateForwardOutcomes(history: History, currentReport: JsonRecord) {
  const checkedAt = Date.parse(String(currentReport.checkedAt ?? ""));
  const snapshot = Array.isArray(currentReport.marketSnapshot) ? currentReport.marketSnapshot.map(record).filter((item): item is JsonRecord => Boolean(item)) : [];
  if (!countablePerformanceRun(currentReport) || !Number.isFinite(checkedAt) || !snapshot.length) return;
  for (const run of history.runs) {
    if (run.openAiCalled !== true || !countablePerformanceRun(run)) continue;
    const selected = record(run.selectedCandidate);
    const ticker = typeof selected?.ticker === "string" ? selected.ticker : null;
    const entryPrice = finiteNumber(selected?.price);
    const direction = selected?.direction === "downside" ? "downside" : "upside";
    const startedAt = Date.parse(String(run.checkedAt ?? ""));
    if (!ticker || !entryPrice || !Number.isFinite(startedAt)) continue;
    const current = snapshot.find((item) => item.ticker === ticker);
    const currentPrice = finiteNumber(current?.price);
    const sourceObservedAt = Date.parse(String(current?.observedAt ?? ""));
    const previousOutcomes = Array.isArray(run.outcomeEvaluations) ? run.outcomeEvaluations.map(record).filter((item): item is JsonRecord => Boolean(item)) : [];
    const outcomes = previousOutcomes.filter((outcome) => {
      const checkpoint = OUTCOME_CHECKPOINTS.find((item) => item.label === outcome.checkpoint);
      const targetAt = Date.parse(String(outcome.targetAt ?? ""));
      const evaluatedAt = Date.parse(String(outcome.evaluatedAt ?? ""));
      const evaluationPollCheckedAt = Date.parse(String(outcome.evaluationPollCheckedAt ?? ""));
      const delayMs = finiteNumber(outcome.evaluationDelayMs);
      const pollDelayMs = finiteNumber(outcome.evaluationPollDelayMs);
      if (!checkpoint) return false;
      return outcome.source === "CoinGecko live snapshot"
        && Number.isFinite(targetAt)
        && Math.abs(targetAt - (startedAt + checkpoint.milliseconds)) <= 1_000
        && Number.isFinite(evaluatedAt)
        && Number.isFinite(evaluationPollCheckedAt)
        && delayMs !== null
        && delayMs >= 0
        && delayMs <= OUTCOME_EVALUATION_TOLERANCE_MS
        && pollDelayMs !== null
        && pollDelayMs >= 0
        && pollDelayMs <= OUTCOME_EVALUATION_TOLERANCE_MS
        && Math.abs((evaluatedAt - targetAt) - delayMs) <= 1_000
        && Math.abs((evaluationPollCheckedAt - targetAt) - pollDelayMs) <= 1_000;
    });
    if (previousOutcomes.length > outcomes.length) run.discardedLegacyOutcomeEvaluationCount = previousOutcomes.length - outcomes.length;
    const existing = new Set(outcomes.map((outcome) => outcome.checkpoint));
    let snapshotUsedForCheckpoint = false;
    for (const checkpoint of OUTCOME_CHECKPOINTS) {
      const targetAt = startedAt + checkpoint.milliseconds;
      const evaluationDelayMs = sourceObservedAt - targetAt;
      const evaluationPollDelayMs = checkedAt - targetAt;
      if (snapshotUsedForCheckpoint || !currentPrice || !Number.isFinite(sourceObservedAt) || sourceObservedAt > checkedAt + 60_000 || checkedAt - sourceObservedAt > OUTCOME_EVALUATION_TOLERANCE_MS || evaluationDelayMs < 0 || evaluationDelayMs > OUTCOME_EVALUATION_TOLERANCE_MS || evaluationPollDelayMs < 0 || evaluationPollDelayMs > OUTCOME_EVALUATION_TOLERANCE_MS || existing.has(checkpoint.label)) continue;
      const forwardReturnPercent = ((currentPrice - entryPrice) / entryPrice) * 100;
      const directionAdjustedReturnPercent = direction === "downside" ? -forwardReturnPercent : forwardReturnPercent;
      outcomes.push({ checkpoint: checkpoint.label, targetAt: new Date(targetAt).toISOString(), evaluatedAt: new Date(sourceObservedAt).toISOString(), evaluationPollCheckedAt: new Date(checkedAt).toISOString(), evaluationDelayMs, evaluationPollDelayMs, maximumEvaluationDelayMs: OUTCOME_EVALUATION_TOLERANCE_MS, priceAtSignal: entryPrice, evaluationPrice: currentPrice, forwardReturnPercent: Math.round(forwardReturnPercent * 100) / 100, directionAdjustedReturnPercent: Math.round(directionAdjustedReturnPercent * 100) / 100, usefulAtCheckpoint: directionAdjustedReturnPercent >= 2, source: "CoinGecko live snapshot" });
      snapshotUsedForCheckpoint = true;
    }
    run.outcomeEvaluations = outcomes;
    run.outcomeCheckpointStatus = OUTCOME_CHECKPOINTS.map((checkpoint) => {
      const targetAt = startedAt + checkpoint.milliseconds;
      const outcome = outcomes.find((item) => item.checkpoint === checkpoint.label);
      if (outcome) return { checkpoint: checkpoint.label, targetAt: new Date(targetAt).toISOString(), status: "evaluated", evaluatedAt: outcome.evaluatedAt, evaluationDelayMs: outcome.evaluationDelayMs, evaluationPollDelayMs: outcome.evaluationPollDelayMs, maximumEvaluationDelayMs: OUTCOME_EVALUATION_TOLERANCE_MS };
      if (checkedAt < targetAt) return { checkpoint: checkpoint.label, targetAt: new Date(targetAt).toISOString(), status: "pending", maximumEvaluationDelayMs: OUTCOME_EVALUATION_TOLERANCE_MS };
      if (checkedAt <= targetAt + OUTCOME_EVALUATION_TOLERANCE_MS) return { checkpoint: checkpoint.label, targetAt: new Date(targetAt).toISOString(), status: "evaluation_window_open", maximumEvaluationDelayMs: OUTCOME_EVALUATION_TOLERANCE_MS };
      return { checkpoint: checkpoint.label, targetAt: new Date(targetAt).toISOString(), status: "missed_evaluation_window", missedByMs: checkedAt - targetAt - OUTCOME_EVALUATION_TOLERANCE_MS, maximumEvaluationDelayMs: OUTCOME_EVALUATION_TOLERANCE_MS };
    });
  }
}

export async function GET() {
  if (!branchAllowed()) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  const { history, storage } = await loadHistory();
  const recent = history.runs.slice(-3);
  const testedPerformanceRuns = history.runs.filter(realBranchPerformanceRun);
  const countedPerformanceRuns = testedPerformanceRuns.filter(safeRun);
  const unsafePerformanceRuns = testedPerformanceRuns.filter((run) => !safeRun(run));
  const consistentSafeBehavior = testedPerformanceRuns.length > 0 && unsafePerformanceRuns.length === 0;
  const validatedSeriousSignalRuns = countedPerformanceRuns.filter((run) => run.seriousSignalFound === true && typeof run.candidateFingerprint === "string" && run.candidateFingerprint.length > 0 && validOneDayOutcome(run));
  const validatedSeriousSignals = [...new Map(validatedSeriousSignalRuns.map((run) => [String(run.candidateFingerprint), run])).values()];
  const usefulValidatedSignals = validatedSeriousSignals.filter((run) => validOneDayOutcome(run)?.usefulAtCheckpoint === true);
  const consistentSeriousSignals = consistentSafeBehavior && validatedSeriousSignals.length >= 3 && usefulValidatedSignals.length / validatedSeriousSignals.length >= 2 / 3;
  return NextResponse.json({
    ok: true,
    mode: "railway_branch_live_read_only",
    branch: history.branch,
    deploymentId: history.deploymentId,
    stopped: history.stopped,
    stopReason: history.stopReason,
    runCount: history.totalRunCount,
    retainedRunCount: history.runs.length,
    testedPerformanceRunCount: testedPerformanceRuns.length,
    countedPerformanceRunCount: countedPerformanceRuns.length,
    unsafePerformanceRunCount: unsafePerformanceRuns.length,
    consistentSafeBehavior,
    consecutiveSeriousSignals: recent.filter((run) => run.seriousSignalFound === true).length,
    validatedSeriousSignalCount: validatedSeriousSignals.length,
    distinctValidatedEvidenceCount: validatedSeriousSignals.length,
    usefulValidatedSeriousSignalCount: usefulValidatedSignals.length,
    consistentSeriousSignals,
    outcomeEvaluationPolicy: { provider: "CoinGecko live snapshot", checkpoints: OUTCOME_CHECKPOINTS.map((checkpoint) => checkpoint.label), maximumDelayMinutes: OUTCOME_EVALUATION_TOLERANCE_MS / 60_000, lateSnapshotReuseAllowed: false },
    stateStorage: storageMetadata(storage),
    openAiReservationPolicy: { durableStateRequired: true, durableStateAvailable: storage.durable, stateBlocker: storage.durable ? null : "Attach a branch-preview Railway Volume or configure SWING_UP_BRANCH_LAB_STATE_PATH on one.", maxAttemptsPerRolling24Hours: MAX_OPENAI_RUNS_PER_24_HOURS, sameEvidenceCooldownHours: OPENAI_EVIDENCE_COOLDOWN_MS / (60 * 60 * 1000), consumedReservationCount: history.openAiReservations.filter(reservationConsumed).length },
    providerQuotaStorageDurable: storage.durable,
    providerQuotaUsage: providerQuotaUsage(history, Date.now()),
    latest: history.runs.at(-1) ?? null,
    runs: history.runs.slice(-6),
    updatedAt: history.updatedAt,
  });
}

export async function POST(request: NextRequest) {
  if (!branchAllowed()) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  const expected = process.env.SWING_UP_BRANCH_LAB_RUNTIME_TOKEN?.trim();
  if (!expected || suppliedToken(request) !== expected) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const loaded = await loadHistory();
  const history = loaded.history;
  let storage = loaded.storage;
  if (history.stopped) return NextResponse.json({ ok: false, stopped: true, stopReason: history.stopReason, runCount: history.totalRunCount, retainedRunCount: history.runs.length, stateStorage: storageMetadata(storage) }, { status: 409 });
  const now = Date.now();
  const openAiAttempts = openAiAttemptsInWindow(history, now, 24 * 60 * 60 * 1000);
  const reviewedFingerprints = reviewedFingerprintsInWindow(history, now, OPENAI_EVIDENCE_COOLDOWN_MS);
  const allowOpenAi = storage.durable && openAiAttempts < MAX_OPENAI_RUNS_PER_24_HOURS;
  let activeReservationId: string | null = null;
  let providerReservationQueue: Promise<void> = Promise.resolve();
  const reserveProviderCall = (request: BranchProviderCallRequest): Promise<BranchProviderCallDecision> => {
    let release!: () => void;
    const previous = providerReservationQueue;
    providerReservationQueue = new Promise<void>((resolve) => { release = resolve; });
    return previous.then(async () => {
      try {
        const reservationNow = Date.parse(request.checkedAt);
        const effectiveNow = Number.isFinite(reservationNow) ? reservationNow : Date.now();
        history.providerCallReservations = history.providerCallReservations.filter((reservation) => effectiveNow - Date.parse(reservation.reservedAt) < 31 * 24 * 60 * 60 * 1000);
        const decision = providerCallBudgetDecision(history.providerCallReservations, request, effectiveNow);
        if (!decision.allowed) return decision;
        history.providerCallReservations.push({ provider: request.provider, quotaKey: request.quotaKey, cadenceKey: request.cadenceKey, reservedAt: new Date(effectiveNow).toISOString(), rollingWindowMs: request.rollingWindowMs, maximumCallsInWindow: request.maximumCallsInWindow, minimumIntervalMs: request.minimumIntervalMs });
        storage = await saveHistory(history, storage);
        return { allowed: true, nextRetryAt: null, reason: "reserved" };
      } finally {
        release();
      }
    });
  };
  const report = await runBranchSignalLab({
    allowOpenAi,
    skipOpenAiCandidateFingerprints: reviewedFingerprints,
    beforeOpenAiCall: async (candidate) => {
      const reservationNow = Date.now();
      if (!storage.durable || openAiAttemptsInWindow(history, reservationNow, 24 * 60 * 60 * 1000) >= MAX_OPENAI_RUNS_PER_24_HOURS) return false;
      if (reviewedFingerprintsInWindow(history, reservationNow, OPENAI_EVIDENCE_COOLDOWN_MS).includes(candidate.candidateFingerprint)) return false;
      const reservation: OpenAiReservation = {
        id: `${candidate.candidateFingerprint}:${reservationNow}`,
        candidateFingerprint: candidate.candidateFingerprint,
        reservedAt: new Date(reservationNow).toISOString(),
        ticker: candidate.ticker,
        direction: candidate.direction,
        status: "pending",
      };
      history.openAiReservations.push(reservation);
      storage = await saveHistory(history, storage);
      if (!storage.durable) {
        reservation.status = "denied_storage_fallback";
        await saveHistory(history, storage);
        return false;
      }
      activeReservationId = reservation.id;
      return true;
    },
    beforeProviderCall: reserveProviderCall,
  }) as JsonRecord;
  updateForwardOutcomes(history, report);
  const repairFailure = repairEligibleFailure(report);
  const repairAttemptNumber = noGainRepairAttempts(history.runs, report);
  const activeReservation = activeReservationId ? history.openAiReservations.find((reservation) => reservation.id === activeReservationId) : null;
  if (activeReservation) {
    activeReservation.status = report.openAiCalled === true ? "completed" : "attempted_no_completion";
    activeReservation.completedAt = new Date().toISOString();
  }
  history.totalRunCount += 1;
  const runNumber = history.totalRunCount;
  history.runs.push({ ...report, runNumber, repairAttemptNumber, ...(activeReservationId ? { openAiReservationId: activeReservationId } : {}) });
  if (repairFailure && repairAttemptNumber >= 3) {
    history.stopped = true;
    history.stopReason = `Stopped after the same repair-eligible ${repairFailure.scope} failure produced no measurable gain three times: ${repairFailure.fingerprint}`;
  }
  pruneHistory(history, Date.now());
  storage = await saveHistory(history, storage);
  const openAiRunsLast24Hours = openAiAttemptsInWindow(history, Date.now(), 24 * 60 * 60 * 1000);
  return NextResponse.json({ ...report, runNumber, retainedRunCount: history.runs.length, repairAttemptNumber, stopped: history.stopped, stopReason: history.stopReason, openAiRunsLast24Hours, openAiAttemptsLast24Hours: openAiRunsLast24Hours, maxOpenAiRunsPer24Hours: MAX_OPENAI_RUNS_PER_24_HOURS, openAiReservationId: activeReservationId, openAiRequiresDurableState: true, openAiAllowedAtRunStart: allowOpenAi, openAiStateBlocker: storage.durable ? null : "Attach a branch-preview Railway Volume or configure SWING_UP_BRANCH_LAB_STATE_PATH on one.", stateStorage: storageMetadata(storage) });
}
