const MAX_SOURCE_WINDOW_MS = 60_000;
const PREPARATION_RESERVE_MS = 10_000;

// Reclaim only time that the early delivery-recovery pass did not use. The
// caller still checks paid admission immediately before each model request.
export function pr262PilotSourceWindow(input: {
  startedAtMs: number;
  processingDeadlineAtMs: number;
  paidAdmissionMinimumMs: number;
}) {
  const latestPreparationDeadlineAtMs = input.processingDeadlineAtMs - input.paidAdmissionMinimumMs;
  const deadlineAtMs = Math.min(input.startedAtMs + MAX_SOURCE_WINDOW_MS,
    latestPreparationDeadlineAtMs - PREPARATION_RESERVE_MS);
  return {
    deadlineAtMs,
    latestPaidAdmissionAtMs: latestPreparationDeadlineAtMs,
    preparationReserveMs: PREPARATION_RESERVE_MS,
    allocatedMs: Math.max(0, deadlineAtMs - input.startedAtMs),
  };
}
