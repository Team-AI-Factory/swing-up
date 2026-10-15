// Private in-process metadata, never an HTTP header. Object spread preserves
// it through the pacing wrapper; the budget boundary removes it before fetch.
const REQUEST_BUDGET = Symbol.for("swingup.pr262.submissions-request-budget.v1");
export const PR262_SEC_REQUEST_MAX_MS = 10_000;
// Staged admission floors reserve a useful tail without demanding a fresh
// full request window after every completed I/O. They are not latency SLAs.
export const PR262_SEC_ADMISSION_MIN_MS = 4_000;
export const PR262_SEC_RESERVATION_MIN_MS = 3_000;
export const PR262_SEC_SOURCE_MIN_MS = 2_000;
export const PR262_SEC_CACHE_WRITE_MIN_MS = 1_000;
type RequestBudget = { deadlineAtMs: number; durationMs: number; startedMonotonicMs: number };
type BudgetedInit = RequestInit & { [REQUEST_BUDGET]?: RequestBudget };

export function withPr262SubmissionsDeadline(init: RequestInit, deadlineAtMs: number): RequestInit {
  const durationMs = Math.min(PR262_SEC_REQUEST_MAX_MS, deadlineAtMs - Date.now());
  return { ...init, [REQUEST_BUDGET]: Object.freeze({ deadlineAtMs, durationMs, startedMonotonicMs: performance.now() }) } as BudgetedInit;
}

export function pr262SubmissionsRemainingMs(init?: RequestInit): number | null {
  const budget = (init as BudgetedInit | undefined)?.[REQUEST_BUDGET];
  if (budget === undefined) return null; // Existing callers retain their own deadlines.
  const elapsed = performance.now() - budget?.startedMonotonicMs;
  const wallRemaining = budget?.deadlineAtMs - Date.now();
  if (!Number.isFinite(elapsed) || elapsed < 0 || !Number.isFinite(wallRemaining)
    || !Number.isFinite(budget?.durationMs) || budget.durationMs <= 0 || budget.durationMs > PR262_SEC_REQUEST_MAX_MS) return 0;
  return Math.max(0, Math.min(wallRemaining, budget.durationMs - elapsed));
}

export function withoutPr262SubmissionsDeadline(init?: RequestInit): RequestInit | undefined {
  if (!init) return init;
  const clean: BudgetedInit = { ...init };
  delete clean[REQUEST_BUDGET];
  return clean;
}

export type Pr262SnapshotPersistence = "saved" | "deferred" | "conflict" | "failed";
export function pr262SnapshotPersistence(value: string | null): Pr262SnapshotPersistence | null {
  return value === "saved" || value === "deferred" || value === "conflict" || value === "failed" ? value : null;
}
