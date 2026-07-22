import { readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { runBranchSignalLab, type BranchProviderCallDecision, type BranchProviderCallRequest } from "@/lib/branch-signal-lab";
import { isLegacyExternalStopReason, noGainRepairAttempts, providerCallBudgetDecision, repairEligibleFailure } from "@/lib/branch-signal-lab-policy";
import type { HistoricalAnalogHorizon, HistoricalSignalRecord } from "@/lib/equity-signal/historical-analogs";
import { mergeHistoricalSignals } from "@/lib/equity-signal/historical-bootstrap";
import { getR2Config, readVersionedTextFromR2, writeVersionedJsonToR2 } from "@/lib/r2-warehouse";

export const dynamic = "force-dynamic";

const REPORT_FILENAME = "swing-up-railway-branch-signal-lab.json";
const WORKER_RUNTIME_STATUS_PATH = "/tmp/swing-up-branch-worker-runtime.json";
const R2_STATE_KEY = "branch-labs/pr-261/serious-signal/state.json";
const R2_EQUITY_HISTORY_KEY = "branch-labs/pr-261/serious-signal/equity-history-v1.json";
const LAB_BRANCH = "agent/live-signal-evaluation-automation";
const MAX_HISTORICAL_SIGNAL_RECORDS = 50_000;
const INVALIDATED_FALSE_MAPPING_EVENT_KEYS = new Set(["81c417f4d7038faf99bd"]);
const MAX_OPENAI_RUNS_PER_24_HOURS = 3;
const SCAN_LEASE_MS = 7 * 60 * 1000;
const OPENAI_EVIDENCE_COOLDOWN_MS = 12 * 60 * 60 * 1000;
const OUTCOME_CHECKPOINTS = [
  { label: "1D", milliseconds: 24 * 60 * 60 * 1000, maximumDelayMs: 72 * 60 * 60 * 1000 },
  { label: "3D", milliseconds: 3 * 24 * 60 * 60 * 1000, maximumDelayMs: 72 * 60 * 60 * 1000 },
  { label: "7D", milliseconds: 7 * 24 * 60 * 60 * 1000, maximumDelayMs: 72 * 60 * 60 * 1000 },
  { label: "30D", milliseconds: 30 * 24 * 60 * 60 * 1000, maximumDelayMs: 96 * 60 * 60 * 1000 },
  { label: "90D", milliseconds: 90 * 24 * 60 * 60 * 1000, maximumDelayMs: 96 * 60 * 60 * 1000 },
] as const;
const MINIMUM_DIRECTIONAL_MOVE_AFTER_COSTS_PERCENT = 0.5;

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
type SchedulerInvocation = {
  owner: "dedicated_worker";
  transport: "loopback";
  workerId: string;
  workerStartedAt: string;
  sequence: number;
};
type ScanLease = { ownerId: string; acquiredAt: string; expiresAt: string };
type History = { version: number; branch: string; deploymentId: string | null; stopped: boolean; stopReason: string | null; scanLease: ScanLease | null; totalRunCount: number; runs: JsonRecord[]; openAiReservations: OpenAiReservation[]; providerCallReservations: ProviderCallReservation[]; updatedAt: string };
type HistoricalSignalLibrary = { version: 1; records: HistoricalSignalRecord[]; updatedAt: string };
type HistoricalSignalLibraryLoad = { library: HistoricalSignalLibrary; etag: string | null; error: string | null; rewriteRequired: boolean };
type LegacyFileStorage = {
  path: string;
  backend: "railway_volume" | "configured_path";
};
type StateStorage = {
  backend: "cloudflare_r2" | "cloudflare_r2_unavailable";
  etag: string | null;
  durable: boolean;
  writable: boolean;
  fallbackReason: string | null;
  migratedFrom: LegacyFileStorage["backend"] | null;
};

function branchAllowed() {
  if (process.env.SWING_UP_BRANCH_LAB_ALLOW_LOCAL === "true") return true;
  const branch = process.env.RAILWAY_GIT_BRANCH?.trim();
  const environment = process.env.RAILWAY_ENVIRONMENT_NAME?.trim().toLowerCase();
  return Boolean(process.env.RAILWAY_PROJECT_ID && branch === LAB_BRANCH && environment && environment !== "production");
}

function emptyHistory(): History {
  return { version: 6, branch: process.env.RAILWAY_GIT_BRANCH?.trim() || LAB_BRANCH, deploymentId: process.env.RAILWAY_DEPLOYMENT_ID?.trim() || null, stopped: false, stopReason: null, scanLease: null, totalRunCount: 0, runs: [], openAiReservations: [], providerCallReservations: [], updatedAt: new Date().toISOString() };
}

function errorCode(error: unknown) {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") return error.code.toLowerCase();
  if (error instanceof Error && /^r2_(?:state|equity_history)_[a-z0-9_]+$/i.test(error.message)) return error.message.toLowerCase();
  return error instanceof SyntaxError ? "invalid_json" : "state_storage_error";
}

function r2Storage(etag: string | null, migratedFrom: StateStorage["migratedFrom"] = null): StateStorage {
  return { backend: "cloudflare_r2", etag, durable: true, writable: true, fallbackReason: null, migratedFrom };
}

function r2Unavailable(fallbackReason: string, migratedFrom: StateStorage["migratedFrom"] = null): StateStorage {
  return { backend: "cloudflare_r2_unavailable", etag: null, durable: false, writable: false, fallbackReason, migratedFrom };
}

function legacyStorage(): LegacyFileStorage | null {
  const explicitPath = process.env.SWING_UP_BRANCH_LAB_STATE_PATH?.trim();
  if (explicitPath) {
    if (!isAbsolute(explicitPath)) return null;
    const path = explicitPath.toLowerCase().endsWith(".json") ? explicitPath : join(explicitPath, REPORT_FILENAME);
    return { path, backend: "configured_path" };
  }
  const volumeMountPath = process.env.RAILWAY_VOLUME_MOUNT_PATH?.trim();
  if (volumeMountPath) {
    if (!isAbsolute(volumeMountPath)) return null;
    return { path: join(volumeMountPath, REPORT_FILENAME), backend: "railway_volume" };
  }
  return null;
}

function normalizeHistory(parsed: History) {
  if (!parsed || !Array.isArray(parsed.runs)) return emptyHistory();
  parsed.version = 6;
  if (!Number.isFinite(parsed.totalRunCount)) parsed.totalRunCount = Math.max(parsed.runs.length, ...parsed.runs.map((run) => finiteNumber(run.runNumber) ?? 0));
  if (!Array.isArray(parsed.openAiReservations)) parsed.openAiReservations = [];
  if (!Array.isArray(parsed.providerCallReservations)) parsed.providerCallReservations = [];
  if (!parsed.scanLease || typeof parsed.scanLease.ownerId !== "string" || !Number.isFinite(Date.parse(parsed.scanLease.expiresAt))) parsed.scanLease = null;
  if (parsed.stopped && isLegacyExternalStopReason(parsed.stopReason)) {
    parsed.stopped = false;
    parsed.stopReason = null;
  }
  return parsed;
}

async function readLegacyHistory(storage: LegacyFileStorage | null) {
  if (!storage) return { history: emptyHistory(), source: null };
  try {
    return { history: normalizeHistory(JSON.parse(await readFile(storage.path, "utf8")) as History), source: storage.backend };
  } catch (error) {
    if (errorCode(error) === "enoent") return { history: emptyHistory(), source: null };
    throw error;
  }
}

async function loadHistory(): Promise<{ history: History; storage: StateStorage }> {
  const legacy = await readLegacyHistory(legacyStorage()).catch(() => ({ history: emptyHistory(), source: null }));
  if (!getR2Config().configured) return { history: legacy.history, storage: r2Unavailable("cloudflare_r2_not_configured", legacy.source) };
  try {
    const current = await readVersionedTextFromR2(R2_STATE_KEY);
    if (current.found) {
      if (!current.text) throw new Error("r2_state_empty_object");
      if (!current.etag) throw new Error("r2_state_read_missing_etag");
      return { history: normalizeHistory(JSON.parse(current.text) as History), storage: r2Storage(current.etag) };
    }
    const initialized = await writeVersionedJsonToR2(R2_STATE_KEY, legacy.history, { createOnly: true });
    if (initialized.conflict) {
      const winner = await readVersionedTextFromR2(R2_STATE_KEY);
      if (!winner.found || !winner.text || !winner.etag) throw new Error("r2_state_initialize_conflict_read_failed");
      return { history: normalizeHistory(JSON.parse(winner.text) as History), storage: r2Storage(winner.etag) };
    }
    return { history: legacy.history, storage: r2Storage(initialized.etag, legacy.source) };
  } catch (error) {
    return { history: legacy.history, storage: r2Unavailable(errorCode(error), legacy.source) };
  }
}

function emptyHistoricalSignalLibrary(): HistoricalSignalLibrary {
  return { version: 1, records: [], updatedAt: new Date(0).toISOString() };
}

function isHistoricalSignalRecord(value: unknown): value is HistoricalSignalRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return typeof item.id === "string"
    && typeof item.eventKey === "string"
    && typeof item.ticker === "string"
    && typeof item.eventFamily === "string"
    && (item.direction === "upside" || item.direction === "downside")
    && (item.relationship === "direct" || item.relationship === "second_order" || item.relationship === "third_order")
    && Array.isArray(item.causalChain)
    && Array.isArray(item.macroRegime)
    && typeof item.signalObservedAt === "string"
    && Number.isFinite(Date.parse(item.signalObservedAt))
    && typeof item.featuresAsOf === "string"
    && Number.isFinite(Date.parse(item.featuresAsOf))
    && ["real", "mock", "synthetic", "unknown"].includes(String(item.dataQuality))
    && Boolean(item.checkpoints)
    && typeof item.checkpoints === "object"
    && !Array.isArray(item.checkpoints);
}

function normalizeHistoricalSignalLibrary(value: unknown): HistoricalSignalLibrary {
  if (!value || typeof value !== "object" || Array.isArray(value)) return emptyHistoricalSignalLibrary();
  const parsed = value as Record<string, unknown>;
  const records = Array.isArray(parsed.records)
    ? parsed.records.filter(isHistoricalSignalRecord).filter((item) => !INVALIDATED_FALSE_MAPPING_EVENT_KEYS.has(item.eventKey))
    : [];
  return {
    version: 1,
    records: mergeHistoricalSignals(records).slice(-MAX_HISTORICAL_SIGNAL_RECORDS),
    updatedAt: typeof parsed.updatedAt === "string" && Number.isFinite(Date.parse(parsed.updatedAt)) ? parsed.updatedAt : new Date(0).toISOString(),
  };
}

async function loadHistoricalSignalLibrary(): Promise<HistoricalSignalLibraryLoad> {
  if (!getR2Config().configured) return { library: emptyHistoricalSignalLibrary(), etag: null, error: "cloudflare_r2_not_configured", rewriteRequired: false };
  try {
    const current = await readVersionedTextFromR2(R2_EQUITY_HISTORY_KEY);
    if (!current.found) return { library: emptyHistoricalSignalLibrary(), etag: null, error: null, rewriteRequired: false };
    if (!current.text || !current.etag) throw new Error("r2_equity_history_invalid_object");
    const raw = JSON.parse(current.text) as Record<string, unknown>;
    const rawRecords = Array.isArray(raw.records) ? raw.records.filter(isHistoricalSignalRecord) : [];
    return {
      library: normalizeHistoricalSignalLibrary(raw),
      etag: current.etag,
      error: null,
      rewriteRequired: rawRecords.some((item) => INVALIDATED_FALSE_MAPPING_EVENT_KEYS.has(item.eventKey)),
    };
  } catch (error) {
    return { library: emptyHistoricalSignalLibrary(), etag: null, error: errorCode(error), rewriteRequired: false };
  }
}

function sameHistoricalSignals(left: HistoricalSignalRecord[], right: HistoricalSignalRecord[]) {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function persistHistoricalSignalLibrary(
  loaded: HistoricalSignalLibraryLoad,
  additions: HistoricalSignalRecord[],
): Promise<HistoricalSignalLibraryLoad> {
  const merged = mergeHistoricalSignals(loaded.library.records, additions).slice(-MAX_HISTORICAL_SIGNAL_RECORDS);
  if (!loaded.rewriteRequired && (!additions.length || sameHistoricalSignals(loaded.library.records, merged))) return { ...loaded, library: { ...loaded.library, records: merged } };
  const payload: HistoricalSignalLibrary = { version: 1, records: merged, updatedAt: new Date().toISOString() };
  try {
    const written = await writeVersionedJsonToR2(R2_EQUITY_HISTORY_KEY, payload, loaded.etag ? { expectedEtag: loaded.etag } : { createOnly: true });
    if (!written.conflict && written.etag) return { library: payload, etag: written.etag, error: null, rewriteRequired: false };
    const winner = await loadHistoricalSignalLibrary();
    if (winner.error) return winner;
    const retryRecords = mergeHistoricalSignals(winner.library.records, additions).slice(-MAX_HISTORICAL_SIGNAL_RECORDS);
    const retryPayload: HistoricalSignalLibrary = { version: 1, records: retryRecords, updatedAt: new Date().toISOString() };
    const retried = await writeVersionedJsonToR2(R2_EQUITY_HISTORY_KEY, retryPayload, winner.etag ? { expectedEtag: winner.etag } : { createOnly: true });
    if (retried.conflict || !retried.etag) throw new Error("r2_equity_history_write_conflict");
    return { library: retryPayload, etag: retried.etag, error: null, rewriteRequired: false };
  } catch (error) {
    return { library: { ...loaded.library, records: merged }, etag: loaded.etag, error: errorCode(error), rewriteRequired: loaded.rewriteRequired };
  }
}

function r2StateReady(storage: StateStorage) {
  return storage.backend === "cloudflare_r2" && storage.durable && storage.writable && Boolean(storage.etag);
}

async function saveHistory(history: History, storage: StateStorage) {
  if (!r2StateReady(storage)) throw new Error("r2_state_primary_unavailable");
  history.updatedAt = new Date().toISOString();
  const written = await writeVersionedJsonToR2(R2_STATE_KEY, history, storage.etag ? { expectedEtag: storage.etag } : { createOnly: true });
  if (written.conflict || !written.etag) throw new Error("r2_state_write_conflict");
  return r2Storage(written.etag, storage.migratedFrom);
}

function storageMetadata(storage: StateStorage) {
  return {
    backend: storage.backend,
    primary: "cloudflare_r2",
    durable: storage.durable,
    writable: storage.writable,
    survivesPreviewRedeploy: r2StateReady(storage),
    fallbackActive: false,
    fallbackReason: storage.fallbackReason,
    migratedFrom: storage.migratedFrom,
    postgresUsed: false,
    railwayVolumeUsedAsPrimary: false,
  };
}

function r2StateBlocker(storage: StateStorage) {
  return r2StateReady(storage)
    ? null
    : "Cloudflare R2 branch state is unavailable. Verify the R2 bucket, endpoint/account, access key, secret key, and Object Read/Write permissions in the PR preview environment.";
}

function suppliedToken(request: NextRequest) {
  return request.headers.get("x-swing-up-branch-lab-token")?.trim() || request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
}

function schedulerInvocation(request: NextRequest): SchedulerInvocation | null {
  if (request.headers.get("x-swing-up-branch-lab-scheduler") !== "dedicated_worker") return null;
  const workerId = request.headers.get("x-swing-up-branch-lab-worker-id")?.trim() || "";
  const workerStartedAt = request.headers.get("x-swing-up-branch-lab-worker-started-at")?.trim() || "";
  const sequence = Number(request.headers.get("x-swing-up-branch-lab-worker-sequence"));
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(workerId) || !Number.isFinite(Date.parse(workerStartedAt)) || !Number.isInteger(sequence) || sequence < 1) return null;
  return { owner: "dedicated_worker", transport: "loopback", workerId, workerStartedAt, sequence };
}

function activeScanLease(history: History, now: number) {
  if (!history.scanLease) return null;
  return Date.parse(history.scanLease.expiresAt) > now ? history.scanLease : null;
}

function scanLeaseResponse(reason: "active_scan_lease" | "lease_race_lost", lease: ScanLease | null = null) {
  return NextResponse.json({
    ok: true,
    mode: "railway_branch_live_read_only",
    status: "scan_already_in_progress",
    reason,
    leaseExpiresAt: lease?.expiresAt ?? null,
    seriousSignalFound: false,
    openAiCalled: false,
    realProviderResponsesOnly: true,
    databaseWrites: false,
    publishing: false,
    notifications: false,
    repairEligible: false,
    technicalFailureFingerprint: null,
  }, { status: 202 });
}

async function runtimeWorkerStatus() {
  try {
    const parsed = JSON.parse(await readFile(WORKER_RUNTIME_STATUS_PATH, "utf8")) as JsonRecord;
    return {
      stage: typeof parsed.stage === "string" ? parsed.stage : "unknown",
      at: typeof parsed.at === "string" ? parsed.at : null,
      workerStartedAt: typeof parsed.workerStartedAt === "string" ? parsed.workerStartedAt : null,
      workerId: typeof parsed.workerId === "string" ? parsed.workerId : null,
      sequence: finiteNumber(parsed.sequence) ?? 0,
      httpStatus: finiteNumber(parsed.httpStatus),
      exitCode: finiteNumber(parsed.exitCode),
      signal: typeof parsed.signal === "string" ? parsed.signal : null,
      errorCategory: typeof parsed.errorCategory === "string" ? parsed.errorCategory : null,
      reportStatus: typeof parsed.reportStatus === "string" ? parsed.reportStatus : null,
      failureScope: typeof parsed.failureScope === "string" ? parsed.failureScope : null,
      technicalFailureFingerprint: typeof parsed.technicalFailureFingerprint === "string" ? parsed.technicalFailureFingerprint : null,
      ephemeralDiagnosticsOnly: true,
      persistentSignalState: "cloudflare_r2",
    };
  } catch (error) {
    return {
      stage: "unavailable",
      at: null,
      errorCategory: errorCode(error),
      ephemeralDiagnosticsOnly: true,
      persistentSignalState: "cloudflare_r2",
    };
  }
}

function safeRun(run: JsonRecord) {
  return run.databaseWrites === false && run.publishing === false && run.notifications === false;
}

function realBranchPerformanceRun(run: JsonRecord) {
  return run.mode === "railway_branch_live_read_only"
    && run.assetClass === "public_equity"
    && run.realProviderResponsesOnly === true;
}

function countablePerformanceRun(run: JsonRecord) {
  return realBranchPerformanceRun(run) && safeRun(run);
}

type OutcomeTrackingEntry = { run: JsonRecord; candidate: JsonRecord; fingerprint: string; outcomeOwner: JsonRecord };

function outcomeTrackingEntries(history: History): OutcomeTrackingEntry[] {
  const seen = new Set<string>();
  const entries: OutcomeTrackingEntry[] = [];
  for (const run of history.runs) {
    if (!countablePerformanceRun(run)) continue;
    const selected = record(run.selectedCandidate);
    const trackers = Array.isArray(run.outcomeTrackingCandidates)
      ? run.outcomeTrackingCandidates.map(record).filter((item): item is JsonRecord => Boolean(item))
      : [];
    const candidates = trackers.length ? trackers : selected ? [selected] : [];
    for (const candidate of candidates) {
      const fallbackFingerprint = candidate === selected && typeof run.candidateFingerprint === "string" ? run.candidateFingerprint : "";
      const fingerprint = typeof candidate.evidenceFingerprint === "string" ? candidate.evidenceFingerprint.trim() : fallbackFingerprint.trim();
      const ticker = typeof candidate.ticker === "string" ? candidate.ticker.trim().toUpperCase() : "";
      const price = finiteNumber(candidate.price);
      const benchmarkPrice = finiteNumber(candidate.benchmarkPrice);
      const direction = candidate.direction;
      if (!fingerprint || INVALIDATED_FALSE_MAPPING_EVENT_KEYS.has(fingerprint) || !ticker || price === null || price <= 0 || benchmarkPrice === null || benchmarkPrice <= 0 || (direction !== "upside" && direction !== "downside") || seen.has(fingerprint)) continue;
      seen.add(fingerprint);
      const outcomeOwner = typeof run.candidateFingerprint === "string" && run.candidateFingerprint === fingerprint ? run : candidate;
      entries.push({ run, candidate, fingerprint, outcomeOwner });
    }
  }
  return entries;
}

function record(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
}

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function positiveEnvironmentNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function wilsonLowerBound(successes: number, total: number, z = 1.96) {
  if (total <= 0) return 0;
  const rate = successes / total;
  const denominator = 1 + (z * z) / total;
  const centre = rate + (z * z) / (2 * total);
  const margin = z * Math.sqrt((rate * (1 - rate) + (z * z) / (4 * total)) / total);
  return Math.max(0, (centre - margin) / denominator);
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
  const outcomeRetentionMs = 100 * 24 * 60 * 60 * 1000;
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
    if (!outcome || outcome.checkpoint !== "1D" || typeof outcome.source !== "string" || !outcome.source.trim()) continue;
    const targetAt = Date.parse(String(outcome.targetAt ?? ""));
    const evaluatedAt = Date.parse(String(outcome.evaluatedAt ?? ""));
    const evaluationPollCheckedAt = Date.parse(String(outcome.evaluationPollCheckedAt ?? ""));
    const delayMs = finiteNumber(outcome.evaluationDelayMs);
    const pollDelayMs = finiteNumber(outcome.evaluationPollDelayMs);
    const maximumDelayMs = finiteNumber(outcome.maximumEvaluationDelayMs);
    if (!Number.isFinite(targetAt) || !Number.isFinite(evaluatedAt) || !Number.isFinite(evaluationPollCheckedAt) || delayMs === null || pollDelayMs === null || maximumDelayMs !== OUTCOME_CHECKPOINTS[0].maximumDelayMs) continue;
    if (Math.abs(targetAt - (startedAt + OUTCOME_CHECKPOINTS[0].milliseconds)) > 1_000 || delayMs < 0 || delayMs > maximumDelayMs || pollDelayMs < 0 || pollDelayMs > maximumDelayMs) continue;
    if (Math.abs((evaluatedAt - targetAt) - delayMs) > 1_000 || Math.abs((evaluationPollCheckedAt - targetAt) - pollDelayMs) > 1_000) continue;
    if (evaluatedAt > evaluationPollCheckedAt + 60_000 || evaluationPollCheckedAt - evaluatedAt > maximumDelayMs) continue;
    const priceAtSignal = finiteNumber(outcome.priceAtSignal);
    const evaluationPrice = finiteNumber(outcome.evaluationPrice);
    const benchmarkPriceAtSignal = finiteNumber(outcome.benchmarkPriceAtSignal);
    const benchmarkEvaluationPrice = finiteNumber(outcome.benchmarkEvaluationPrice);
    const forwardReturnPercent = finiteNumber(outcome.forwardReturnPercent);
    const directionAdjustedReturnPercent = finiteNumber(outcome.directionAdjustedReturnPercent);
    const benchmarkReturnPercent = finiteNumber(outcome.benchmarkReturnPercent);
    const marketRelativeReturnPercent = finiteNumber(outcome.marketRelativeReturnPercent);
    const directionAdjustedMarketRelativeReturnPercent = finiteNumber(outcome.directionAdjustedMarketRelativeReturnPercent);
    if (priceAtSignal === null || priceAtSignal <= 0 || evaluationPrice === null || evaluationPrice <= 0 || benchmarkPriceAtSignal === null || benchmarkPriceAtSignal <= 0 || benchmarkEvaluationPrice === null || benchmarkEvaluationPrice <= 0 || forwardReturnPercent === null || directionAdjustedReturnPercent === null || benchmarkReturnPercent === null || marketRelativeReturnPercent === null || directionAdjustedMarketRelativeReturnPercent === null || typeof outcome.usefulAtCheckpoint !== "boolean") continue;
    const calculatedForwardReturn = ((evaluationPrice - priceAtSignal) / priceAtSignal) * 100;
    const calculatedDirectionAdjustedReturn = direction === "downside" ? -calculatedForwardReturn : calculatedForwardReturn;
    const calculatedBenchmarkReturn = ((benchmarkEvaluationPrice - benchmarkPriceAtSignal) / benchmarkPriceAtSignal) * 100;
    const calculatedMarketRelativeReturn = calculatedForwardReturn - calculatedBenchmarkReturn;
    const calculatedDirectionAdjustedMarketRelativeReturn = direction === "downside" ? -calculatedMarketRelativeReturn : calculatedMarketRelativeReturn;
    const useful = calculatedDirectionAdjustedReturn >= MINIMUM_DIRECTIONAL_MOVE_AFTER_COSTS_PERCENT && calculatedDirectionAdjustedMarketRelativeReturn > 0;
    if (Math.abs(calculatedForwardReturn - forwardReturnPercent) > 0.02 || Math.abs(calculatedDirectionAdjustedReturn - directionAdjustedReturnPercent) > 0.02 || Math.abs(calculatedBenchmarkReturn - benchmarkReturnPercent) > 0.02 || Math.abs(calculatedMarketRelativeReturn - marketRelativeReturnPercent) > 0.02 || Math.abs(calculatedDirectionAdjustedMarketRelativeReturn - directionAdjustedMarketRelativeReturnPercent) > 0.02 || outcome.usefulAtCheckpoint !== useful) continue;
    return outcome;
  }
  return null;
}

function updateForwardOutcomes(history: History, currentReport: JsonRecord) {
  const checkedAt = Date.parse(String(currentReport.checkedAt ?? ""));
  const snapshot = Array.isArray(currentReport.marketSnapshot) ? currentReport.marketSnapshot.map(record).filter((item): item is JsonRecord => Boolean(item)) : [];
  if (!countablePerformanceRun(currentReport) || !Number.isFinite(checkedAt) || !snapshot.length) return;
  for (const entry of outcomeTrackingEntries(history)) {
    const { run, candidate: selected, outcomeOwner } = entry;
    const ticker = typeof selected?.ticker === "string" ? selected.ticker : null;
    const entryPrice = finiteNumber(selected?.price);
    const benchmarkTicker = typeof selected?.benchmarkTicker === "string" ? selected.benchmarkTicker.trim().toUpperCase() : "SPY";
    const benchmarkEntryPrice = finiteNumber(selected?.benchmarkPrice);
    const direction = selected?.direction === "downside" ? "downside" : "upside";
    const startedAt = Date.parse(String(run.checkedAt ?? ""));
    if (!ticker || !entryPrice || !Number.isFinite(startedAt)) continue;
    const current = snapshot.find((item) => item.ticker === ticker);
    const currentBenchmark = snapshot.find((item) => item.ticker === benchmarkTicker);
    const currentPrice = finiteNumber(current?.price);
    const currentBenchmarkPrice = finiteNumber(currentBenchmark?.price);
    const sourceObservedAt = Date.parse(String(current?.observedAt ?? ""));
    const benchmarkObservedAt = Date.parse(String(currentBenchmark?.observedAt ?? ""));
    const previousOutcomes = Array.isArray(outcomeOwner.outcomeEvaluations) ? outcomeOwner.outcomeEvaluations.map(record).filter((item): item is JsonRecord => Boolean(item)) : [];
    const outcomes = previousOutcomes.filter((outcome) => {
      const checkpoint = OUTCOME_CHECKPOINTS.find((item) => item.label === outcome.checkpoint);
      const targetAt = Date.parse(String(outcome.targetAt ?? ""));
      const evaluatedAt = Date.parse(String(outcome.evaluatedAt ?? ""));
      const evaluationPollCheckedAt = Date.parse(String(outcome.evaluationPollCheckedAt ?? ""));
      const delayMs = finiteNumber(outcome.evaluationDelayMs);
      const pollDelayMs = finiteNumber(outcome.evaluationPollDelayMs);
      if (!checkpoint) return false;
      return typeof outcome.source === "string"
        && outcome.source.trim().length > 0
        && Number.isFinite(targetAt)
        && Math.abs(targetAt - (startedAt + checkpoint.milliseconds)) <= 1_000
        && Number.isFinite(evaluatedAt)
        && Number.isFinite(evaluationPollCheckedAt)
        && delayMs !== null
        && delayMs >= 0
        && delayMs <= checkpoint.maximumDelayMs
        && pollDelayMs !== null
        && pollDelayMs >= 0
        && pollDelayMs <= checkpoint.maximumDelayMs
        && Math.abs((evaluatedAt - targetAt) - delayMs) <= 1_000
        && Math.abs((evaluationPollCheckedAt - targetAt) - pollDelayMs) <= 1_000;
    });
    if (previousOutcomes.length > outcomes.length) outcomeOwner.discardedLegacyOutcomeEvaluationCount = previousOutcomes.length - outcomes.length;
    const existing = new Set(outcomes.map((outcome) => outcome.checkpoint));
    let snapshotUsedForCheckpoint = false;
    for (const checkpoint of OUTCOME_CHECKPOINTS) {
      const targetAt = startedAt + checkpoint.milliseconds;
      const evaluationDelayMs = sourceObservedAt - targetAt;
      const evaluationPollDelayMs = checkedAt - targetAt;
      if (snapshotUsedForCheckpoint || !currentPrice || !benchmarkEntryPrice || !currentBenchmarkPrice || !Number.isFinite(sourceObservedAt) || !Number.isFinite(benchmarkObservedAt) || Math.abs(sourceObservedAt - benchmarkObservedAt) > 30 * 60 * 1000 || sourceObservedAt > checkedAt + 60_000 || checkedAt - sourceObservedAt > checkpoint.maximumDelayMs || evaluationDelayMs < 0 || evaluationDelayMs > checkpoint.maximumDelayMs || evaluationPollDelayMs < 0 || evaluationPollDelayMs > checkpoint.maximumDelayMs || existing.has(checkpoint.label)) continue;
      const forwardReturnPercent = ((currentPrice - entryPrice) / entryPrice) * 100;
      const directionAdjustedReturnPercent = direction === "downside" ? -forwardReturnPercent : forwardReturnPercent;
      const benchmarkReturnPercent = ((currentBenchmarkPrice - benchmarkEntryPrice) / benchmarkEntryPrice) * 100;
      const marketRelativeReturnPercent = forwardReturnPercent - benchmarkReturnPercent;
      const directionAdjustedMarketRelativeReturnPercent = direction === "downside" ? -marketRelativeReturnPercent : marketRelativeReturnPercent;
      const usefulAtCheckpoint = directionAdjustedReturnPercent >= MINIMUM_DIRECTIONAL_MOVE_AFTER_COSTS_PERCENT && directionAdjustedMarketRelativeReturnPercent > 0;
      const quoteSource = typeof current?.source === "string" && current.source.trim() ? current.source.trim() : "live public-equity market snapshot";
      const benchmarkSource = typeof currentBenchmark?.source === "string" && currentBenchmark.source.trim() ? currentBenchmark.source.trim() : "live SPY benchmark snapshot";
      outcomes.push({ checkpoint: checkpoint.label, targetAt: new Date(targetAt).toISOString(), evaluatedAt: new Date(sourceObservedAt).toISOString(), evaluationPollCheckedAt: new Date(checkedAt).toISOString(), evaluationDelayMs, evaluationPollDelayMs, maximumEvaluationDelayMs: checkpoint.maximumDelayMs, priceAtSignal: entryPrice, evaluationPrice: currentPrice, forwardReturnPercent: Math.round(forwardReturnPercent * 100) / 100, directionAdjustedReturnPercent: Math.round(directionAdjustedReturnPercent * 100) / 100, benchmarkTicker, benchmarkPriceAtSignal: benchmarkEntryPrice, benchmarkEvaluationPrice: currentBenchmarkPrice, benchmarkObservedAt: new Date(benchmarkObservedAt).toISOString(), benchmarkReturnPercent: Math.round(benchmarkReturnPercent * 100) / 100, marketRelativeReturnPercent: Math.round(marketRelativeReturnPercent * 100) / 100, directionAdjustedMarketRelativeReturnPercent: Math.round(directionAdjustedMarketRelativeReturnPercent * 100) / 100, usefulAtCheckpoint, source: quoteSource, benchmarkSource });
      snapshotUsedForCheckpoint = true;
    }
    outcomeOwner.outcomeEvaluations = outcomes;
    outcomeOwner.outcomeCheckpointStatus = OUTCOME_CHECKPOINTS.map((checkpoint) => {
      const targetAt = startedAt + checkpoint.milliseconds;
      const outcome = outcomes.find((item) => item.checkpoint === checkpoint.label);
      if (outcome) return { checkpoint: checkpoint.label, targetAt: new Date(targetAt).toISOString(), status: "evaluated", evaluatedAt: outcome.evaluatedAt, evaluationDelayMs: outcome.evaluationDelayMs, evaluationPollDelayMs: outcome.evaluationPollDelayMs, maximumEvaluationDelayMs: checkpoint.maximumDelayMs };
      if (checkedAt < targetAt) return { checkpoint: checkpoint.label, targetAt: new Date(targetAt).toISOString(), status: "pending", maximumEvaluationDelayMs: checkpoint.maximumDelayMs };
      if (checkedAt <= targetAt + checkpoint.maximumDelayMs) return { checkpoint: checkpoint.label, targetAt: new Date(targetAt).toISOString(), status: "evaluation_window_open", maximumEvaluationDelayMs: checkpoint.maximumDelayMs };
      return { checkpoint: checkpoint.label, targetAt: new Date(targetAt).toISOString(), status: "missed_evaluation_window", missedByMs: checkedAt - targetAt - checkpoint.maximumDelayMs, maximumEvaluationDelayMs: checkpoint.maximumDelayMs };
    });
  }
}

function outcomeTickersDue(history: History, now: number) {
  const due = new Set<string>();
  for (const { run, candidate: selected, outcomeOwner } of outcomeTrackingEntries(history)) {
    const ticker = typeof selected?.ticker === "string" ? selected.ticker.trim().toUpperCase() : "";
    const startedAt = Date.parse(String(run.checkedAt ?? ""));
    if (!ticker || !Number.isFinite(startedAt)) continue;
    const completed = new Set(
      (Array.isArray(outcomeOwner.outcomeEvaluations) ? outcomeOwner.outcomeEvaluations : [])
        .map(record)
        .filter((item): item is JsonRecord => Boolean(item))
        .map((item) => String(item.checkpoint ?? "")),
    );
    for (const checkpoint of OUTCOME_CHECKPOINTS) {
      if (completed.has(checkpoint.label)) continue;
      const targetAt = startedAt + checkpoint.milliseconds;
      if (now >= targetAt - 5 * 60 * 1000 && now <= targetAt + checkpoint.maximumDelayMs) due.add(ticker);
    }
  }
  return [...due].slice(0, 6);
}

function historicalSignalRecords(history: History): HistoricalSignalRecord[] {
  const validHorizons = new Set<HistoricalAnalogHorizon>(OUTCOME_CHECKPOINTS.map((checkpoint) => checkpoint.label));
  return outcomeTrackingEntries(history).flatMap(({ run, candidate, fingerprint, outcomeOwner }) => {
    const ticker = typeof candidate.ticker === "string" ? candidate.ticker.trim().toUpperCase() : "";
    const direction = candidate.direction === "downside" ? "downside" : candidate.direction === "upside" ? "upside" : null;
    const relationship = candidate.relationship === "direct" || candidate.relationship === "second_order" || candidate.relationship === "third_order" ? candidate.relationship : null;
    const eventFamily = typeof candidate.eventFamily === "string" ? candidate.eventFamily.trim() : "";
    const signalObservedAt = typeof run.checkedAt === "string" ? run.checkedAt : "";
    const featuresAsOf = typeof candidate.featuresAsOf === "string" && Number.isFinite(Date.parse(candidate.featuresAsOf)) ? candidate.featuresAsOf : signalObservedAt;
    const causalChain = Array.isArray(candidate.causalChain) ? candidate.causalChain.filter((value): value is string => typeof value === "string" && value.trim().length > 0) : [];
    const candidateMacro = Array.isArray(candidate.macroRegime) ? candidate.macroRegime : [];
    const runMacro = record(run.macroContext);
    const runMacroRegime = Array.isArray(runMacro?.regime) ? runMacro.regime : [];
    const macroRegime = (candidateMacro.length ? candidateMacro : runMacroRegime).filter((value): value is string => typeof value === "string" && value.trim().length > 0);
    if (!ticker || !direction || !relationship || !eventFamily || !Number.isFinite(Date.parse(signalObservedAt))) return [];
    const checkpoints: HistoricalSignalRecord["checkpoints"] = {};
    for (const raw of Array.isArray(outcomeOwner.outcomeEvaluations) ? outcomeOwner.outcomeEvaluations : []) {
      const outcome = record(raw);
      const horizon = typeof outcome?.checkpoint === "string" && validHorizons.has(outcome.checkpoint as HistoricalAnalogHorizon) ? outcome.checkpoint as HistoricalAnalogHorizon : null;
      const returnPercent = finiteNumber(outcome?.forwardReturnPercent);
      const benchmarkReturnPercent = finiteNumber(outcome?.benchmarkReturnPercent);
      const observedAt = typeof outcome?.evaluatedAt === "string" ? outcome.evaluatedAt : "";
      const source = typeof outcome?.source === "string" ? outcome.source.trim() : "";
      if (!horizon || returnPercent === null || !Number.isFinite(Date.parse(observedAt)) || !source) continue;
      checkpoints[horizon] = { returnPercent, benchmarkReturnPercent, observedAt, source };
    }
    const receipts = Array.isArray(candidate.receipts) ? candidate.receipts.map(record).filter((item): item is JsonRecord => Boolean(item)) : [];
    const eventReceipt = receipts.find((item) => item.primarySource === true) ?? receipts[0] ?? null;
    const firstCheckpoint = Object.values(checkpoints).find(Boolean);
    return [{
      id: `${fingerprint}:${signalObservedAt}`,
      eventKey: fingerprint,
      ticker,
      eventFamily,
      direction,
      relationship,
      causalChain,
      macroRegime,
      signalObservedAt,
      featuresAsOf,
      dataQuality: "real" as const,
      provenance: {
        origin: "swing_up_forward_outcome",
        eventPublisher: typeof eventReceipt?.publisher === "string" ? eventReceipt.publisher : "Swing Up verified event receipts",
        eventSourceUrl: typeof eventReceipt?.url === "string" ? eventReceipt.url : "r2://branch-labs/pr-261/serious-signal/state.json",
        priceSource: firstCheckpoint?.source ?? "live public-equity market snapshot",
        benchmarkSource: firstCheckpoint?.source ?? "live SPY benchmark snapshot",
        methodologyVersion: "swing-up-forward-outcomes-v1",
      },
      checkpoints,
    }];
  });
}

export async function GET() {
  if (!branchAllowed()) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  const [{ history, storage }, historicalLibrary] = await Promise.all([loadHistory(), loadHistoricalSignalLibrary()]);
  const recent = history.runs.slice(-3);
  const testedPerformanceRuns = history.runs.filter(realBranchPerformanceRun);
  const countedPerformanceRuns = testedPerformanceRuns.filter(safeRun);
  const unsafePerformanceRuns = testedPerformanceRuns.filter((run) => !safeRun(run));
  const consistentSafeBehavior = testedPerformanceRuns.length > 0 && unsafePerformanceRuns.length === 0;
  const validatedSeriousSignalRuns = countedPerformanceRuns.filter((run) => run.seriousSignalFound === true && typeof run.candidateFingerprint === "string" && run.candidateFingerprint.length > 0 && validOneDayOutcome(run));
  const validatedSeriousSignals = [...new Map(validatedSeriousSignalRuns.map((run) => [String(run.candidateFingerprint), run])).values()];
  const usefulValidatedSignals = validatedSeriousSignals.filter((run) => validOneDayOutcome(run)?.usefulAtCheckpoint === true);
  const usefulRate = validatedSeriousSignals.length ? usefulValidatedSignals.length / validatedSeriousSignals.length : 0;
  const usefulRateLower95 = wilsonLowerBound(usefulValidatedSignals.length, validatedSeriousSignals.length);
  const threeSignalPipelineMilestone = consistentSafeBehavior && validatedSeriousSignals.length >= 3 && usefulRate >= 2 / 3;
  const consistentSeriousSignals = consistentSafeBehavior && validatedSeriousSignals.length >= 30 && usefulRate >= 0.75 && usefulRateLower95 >= 0.55;
  const latestRun = history.runs.at(-1) ?? null;
  const latestSchedulerInvocation = record(latestRun?.schedulerInvocation);
  const effectiveIntervalSeconds = positiveEnvironmentNumber(process.env.SWING_UP_BRANCH_LAB_EFFECTIVE_INTERVAL_SECONDS, 300);
  const latestRunAt = Date.parse(String(latestRun?.checkedAt ?? ""));
  const lastRunAgeSeconds = Number.isFinite(latestRunAt) ? Math.max(0, Math.round((Date.now() - latestRunAt) / 1000)) : null;
  const schedulerHealthy = !history.stopped
    && latestSchedulerInvocation?.owner === "dedicated_worker"
    && latestSchedulerInvocation?.transport === "loopback"
    && lastRunAgeSeconds !== null
    && lastRunAgeSeconds <= effectiveIntervalSeconds + 120;
  const runtimeWorker = await runtimeWorkerStatus();
  const scanLease = activeScanLease(history, Date.now());
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
    firstValidatedSeriousSignal: validatedSeriousSignals.length > 0,
    threeSignalPipelineMilestone,
    usefulValidatedSignalRate: Math.round(usefulRate * 10_000) / 100,
    usefulValidatedSignalRateLower95: Math.round(usefulRateLower95 * 10_000) / 100,
    consistentSeriousSignals,
    outcomeEvaluationPolicy: { provider: "event-qualified public-equity market snapshots", checkpoints: OUTCOME_CHECKPOINTS.map((checkpoint) => ({ label: checkpoint.label, maximumDelayHours: checkpoint.maximumDelayMs / (60 * 60 * 1000) })), tracksEveryUniqueQualifiedEvent: true, openAiReviewRequiredForTracking: false, alertWaitsForOutcomes: false, minimumDirectionalMoveAfterCostsPercent: MINIMUM_DIRECTIONAL_MOVE_AFTER_COSTS_PERCENT, lateSnapshotReuseAllowed: false, consistencyMinimumIndependentSignals: 30 },
    pollingPolicy: {
      schedulerOwner: process.env.SWING_UP_BRANCH_LAB_SCHEDULER_OWNER === "dedicated_worker" ? "dedicated_worker" : "unavailable",
      schedulerTransport: "loopback",
      supervisedProcess: true,
      workerHeartbeatTimeoutSeconds: 90,
      liveIntervalSeconds: effectiveIntervalSeconds,
      technicalRetrySeconds: positiveEnvironmentNumber(process.env.SWING_UP_BRANCH_LAB_EFFECTIVE_TECHNICAL_RETRY_SECONDS, 60),
      watchdogEnabled: true,
      lastWorkerInvocation: latestSchedulerInvocation,
      runtimeWorker,
      lastRunAgeSeconds,
      schedulerHealthy,
      distributedLease: { active: Boolean(scanLease), expiresAt: scanLease?.expiresAt ?? null, storage: "cloudflare_r2" },
    },
    stateStorage: storageMetadata(storage),
    historicalOutcomeLibrary: {
      backend: "cloudflare_r2",
      objectKey: R2_EQUITY_HISTORY_KEY,
      durable: historicalLibrary.error === null && getR2Config().configured,
      realRecordCount: historicalLibrary.library.records.filter((item) => item.dataQuality === "real").length,
      publicBootstrapRecordCount: historicalLibrary.library.records.filter((item) => item.provenance?.origin === "public_historical_bootstrap").length,
      swingUpForwardOutcomeRecordCount: historicalLibrary.library.records.filter((item) => item.provenance?.origin === "swing_up_forward_outcome" || !item.provenance).length,
      earliestSignalObservedAt: historicalLibrary.library.records[0]?.signalObservedAt ?? null,
      latestSignalObservedAt: historicalLibrary.library.records.at(-1)?.signalObservedAt ?? null,
      updatedAt: historicalLibrary.library.updatedAt,
      error: historicalLibrary.error,
      mockOrSyntheticRecordCount: historicalLibrary.library.records.filter((item) => item.dataQuality !== "real").length,
    },
    openAiReservationPolicy: { durableStateRequired: true, durableStateAvailable: r2StateReady(storage), stateBlocker: r2StateBlocker(storage), maxAttemptsPerRolling24Hours: MAX_OPENAI_RUNS_PER_24_HOURS, sameEvidenceCooldownHours: OPENAI_EVIDENCE_COOLDOWN_MS / (60 * 60 * 1000), consumedReservationCount: history.openAiReservations.filter(reservationConsumed).length },
    providerQuotaStorageDurable: r2StateReady(storage),
    providerQuotaUsage: providerQuotaUsage(history, Date.now()),
    latest: latestRun,
    runs: history.runs.slice(-6),
    updatedAt: history.updatedAt,
  });
}

async function executePost(request: NextRequest) {
  if (!branchAllowed()) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  const expected = process.env.SWING_UP_BRANCH_LAB_RUNTIME_TOKEN?.trim();
  if (!expected || suppliedToken(request) !== expected) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const invocation = schedulerInvocation(request);
  if (!invocation) return NextResponse.json({ ok: false, error: "invalid_scheduler" }, { status: 403 });
  const loaded = await loadHistory();
  const history = loaded.history;
  let storage = loaded.storage;
  if (history.stopped) return NextResponse.json({ ok: false, stopped: true, stopReason: history.stopReason, runCount: history.totalRunCount, retainedRunCount: history.runs.length, stateStorage: storageMetadata(storage) }, { status: 409 });
  if (!r2StateReady(storage)) {
    return NextResponse.json({
      ok: false,
      mode: "railway_branch_live_read_only",
      status: "state_storage_unavailable",
      failureScope: "external_storage",
      repairEligible: false,
      technicalFailureFingerprint: null,
      realProviderResponsesOnly: true,
      databaseWrites: false,
      publishing: false,
      notifications: false,
      openAiCalled: false,
      stateStorage: storageMetadata(storage),
      blocker: r2StateBlocker(storage),
    }, { status: 503 });
  }
  const leaseNow = Date.now();
  const existingLease = activeScanLease(history, leaseNow);
  if (existingLease) return scanLeaseResponse("active_scan_lease", existingLease);
  history.scanLease = {
    ownerId: `${invocation.workerId}:${invocation.sequence}`,
    acquiredAt: new Date(leaseNow).toISOString(),
    expiresAt: new Date(leaseNow + SCAN_LEASE_MS).toISOString(),
  };
  try {
    storage = await saveHistory(history, storage);
  } catch (error) {
    if (errorCode(error) === "r2_state_write_conflict") return scanLeaseResponse("lease_race_lost");
    throw error;
  }
  const now = Date.now();
  const openAiAttempts = openAiAttemptsInWindow(history, now, 24 * 60 * 60 * 1000);
  const reviewedFingerprints = reviewedFingerprintsInWindow(history, now, OPENAI_EVIDENCE_COOLDOWN_MS);
  const allowOpenAi = r2StateReady(storage) && openAiAttempts < MAX_OPENAI_RUNS_PER_24_HOURS;
  let activeReservationId: string | null = null;
  let historicalLibrary = await loadHistoricalSignalLibrary();
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
    outcomeTickers: outcomeTickersDue(history, Date.now()),
    historicalSignals: mergeHistoricalSignals(historicalLibrary.library.records, historicalSignalRecords(history)),
    skipOpenAiCandidateFingerprints: reviewedFingerprints,
    beforeOpenAiCall: async (candidate) => {
      const reservationNow = Date.now();
      if (!r2StateReady(storage) || openAiAttemptsInWindow(history, reservationNow, 24 * 60 * 60 * 1000) >= MAX_OPENAI_RUNS_PER_24_HOURS) return false;
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
      if (!r2StateReady(storage)) {
        reservation.status = "denied_storage_fallback";
        return false;
      }
      activeReservationId = reservation.id;
      return true;
    },
    beforeProviderCall: reserveProviderCall,
  }) as JsonRecord;
  const publicHistoricalAdditions = Array.isArray(report._historicalSignalLibraryAdditions)
    ? report._historicalSignalLibraryAdditions.filter(isHistoricalSignalRecord)
    : [];
  delete report._historicalSignalLibraryAdditions;
  updateForwardOutcomes(history, report);
  const forwardOutcomeAdditions = historicalSignalRecords(history).map((item): HistoricalSignalRecord => ({
    ...item,
    provenance: item.provenance ?? {
      origin: "swing_up_forward_outcome",
      eventPublisher: "Swing Up verified event receipts",
      eventSourceUrl: "r2://branch-labs/pr-261/serious-signal/state.json",
      priceSource: Object.values(item.checkpoints).find(Boolean)?.source ?? "live public-equity market snapshot",
      benchmarkSource: Object.values(item.checkpoints).find(Boolean)?.source ?? "live SPY benchmark snapshot",
      methodologyVersion: "swing-up-forward-outcomes-v1",
    },
  }));
  historicalLibrary = await persistHistoricalSignalLibrary(historicalLibrary, mergeHistoricalSignals(publicHistoricalAdditions, forwardOutcomeAdditions));
  const learning = record(report.historicalLearning) ?? {};
  report.historicalLearning = {
    ...learning,
    r2LibraryObject: R2_EQUITY_HISTORY_KEY,
    r2LibraryDurable: historicalLibrary.error === null,
    r2LibraryRealRecordCount: historicalLibrary.library.records.filter((item) => item.dataQuality === "real").length,
    r2LibraryPublicBootstrapRecordCount: historicalLibrary.library.records.filter((item) => item.provenance?.origin === "public_historical_bootstrap").length,
    r2LibrarySwingUpForwardRecordCount: historicalLibrary.library.records.filter((item) => item.provenance?.origin === "swing_up_forward_outcome").length,
    r2LibraryMockOrSyntheticRecordCount: historicalLibrary.library.records.filter((item) => item.dataQuality !== "real").length,
    r2LibraryError: historicalLibrary.error,
  };
  const repairFailure = repairEligibleFailure(report);
  const repairAttemptNumber = noGainRepairAttempts(history.runs, report);
  const activeReservation = activeReservationId ? history.openAiReservations.find((reservation) => reservation.id === activeReservationId) : null;
  if (activeReservation) {
    activeReservation.status = report.openAiCalled === true ? "completed" : "attempted_no_completion";
    activeReservation.completedAt = new Date().toISOString();
  }
  history.totalRunCount += 1;
  const runNumber = history.totalRunCount;
  history.runs.push({ ...report, runNumber, repairAttemptNumber, schedulerInvocation: invocation, ...(activeReservationId ? { openAiReservationId: activeReservationId } : {}) });
  if (repairFailure && repairAttemptNumber >= 3) {
    history.stopped = true;
    history.stopReason = `Stopped after the same repair-eligible ${repairFailure.scope} failure produced no measurable gain three times: ${repairFailure.fingerprint}`;
  }
  pruneHistory(history, Date.now());
  history.scanLease = null;
  storage = await saveHistory(history, storage);
  const openAiRunsLast24Hours = openAiAttemptsInWindow(history, Date.now(), 24 * 60 * 60 * 1000);
  return NextResponse.json({ ...report, runNumber, retainedRunCount: history.runs.length, repairAttemptNumber, schedulerInvocation: invocation, stopped: history.stopped, stopReason: history.stopReason, openAiRunsLast24Hours, openAiAttemptsLast24Hours: openAiRunsLast24Hours, maxOpenAiRunsPer24Hours: MAX_OPENAI_RUNS_PER_24_HOURS, openAiReservationId: activeReservationId, openAiRequiresDurableState: true, openAiAllowedAtRunStart: allowOpenAi, openAiStateBlocker: r2StateBlocker(storage), stateStorage: storageMetadata(storage), stateWritesToR2: true, productionR2DataWrites: false });
}

export async function POST(request: NextRequest) {
  try {
    return await executePost(request);
  } catch (error) {
    const category = errorCode(error);
    const technicalFailureFingerprint = `branch_route_${category}`;
    console.error(`[swing-up-branch-lab] ${technicalFailureFingerprint}`);
    return NextResponse.json({
      ok: false,
      mode: "railway_branch_live_read_only",
      status: "technical_failure",
      failureScope: "branch_route",
      repairEligible: true,
      technicalFailureFingerprint,
      errorCategory: category,
      realProviderResponsesOnly: true,
      databaseWrites: false,
      publishing: false,
      notifications: false,
      openAiCalled: false,
    }, { status: 500 });
  }
}
