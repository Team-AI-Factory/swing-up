import { readOpenAiBillingAudit } from "@/lib/ai-committee/billing-audit";
import { readVersionedTextFromR2, writeVersionedJsonToR2 } from "@/lib/r2-warehouse";
import { pr262StorageKey } from "@/lib/opportunity-engine/pr262-storage";

const STATE_KEY = pr262StorageKey("serious-signal/ai-cost-v1.json");
const WINDOW_MS = 24 * 60 * 60_000;
const AUDIT_RETENTION_DAYS = 45;
const AUDIT_RETENTION_MS = AUDIT_RETENTION_DAYS * WINDOW_MS;
const DEFAULT_LIMIT_USD = 10;
const DEFAULT_WARNING_USD = 6;
// A temporary maximum exposure, never booked as spending: six bounded calls,
// at most one token per UTF-8 prompt byte plus framing, and 1,000 output tokens.
export const PR262_REVIEW_MAX_PROMPT_BYTES = 60_000;
export const PR262_REVIEW_MAX_OUTPUT_TOKENS = 1_000;
export const PR262_REVIEW_MAX_CALLS = 6;
export const PR262_REVIEW_MAX_COST_USD = PR262_REVIEW_MAX_CALLS * (((PR262_REVIEW_MAX_PROMPT_BYTES + 1000) * 0.4 + PR262_REVIEW_MAX_OUTPUT_TOKENS * 1.6) / 1_000_000);
const GPT_4_1_MINI_INPUT_USD_PER_MILLION = 0.4;
const GPT_4_1_MINI_CACHED_INPUT_USD_PER_MILLION = 0.1;
const GPT_4_1_MINI_OUTPUT_USD_PER_MILLION = 1.6;
// A reservation is retained for the full rolling spend window unless a known
// no-call path releases it or a completed call reconciles it. A crashed process
// therefore cannot silently reopen paid capacity whose usage is unknown.
const RESERVATION_TTL_MS = WINDOW_MS;

type Json = Record<string, unknown>;
type CostEntry = {
  id: string;
  recordedAt: string;
  ticker: string | null;
  alertType: string | null;
  costUsd: number;
  source: "actual_tokens" | "rejected_request" | "usage_pending" | "legacy_missing_usage";
  pendingUpperBoundUsd?: number;
  legacyEstimateUsd?: number;
  retryAt?: string;
};
type CostReservation = {
  id: string;
  reservedAt: string;
  expiresAt: string;
  ticker: string | null;
  direction: "upside" | "downside" | null;
  amountUsd: number;
};
type State = {
  version: 1;
  updatedAt: string;
  entries: CostEntry[];
  reservations: CostReservation[];
  auditEntries: CostEntry[];
  auditTrackingStartedAt: string;
  providerCooldown?: { until: string; category: string; code?: string; httpStatus?: number };
};

function object(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
}

function finite(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function positiveEnv(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function limitUsd() {
  // The PR262 production fuse is intentionally capped at $10. Operators may
  // lower the ceiling, but an accidental environment value cannot raise it.
  return Math.min(DEFAULT_LIMIT_USD, positiveEnv("SWING_UP_PR262_AI_DAILY_LIMIT_USD", DEFAULT_LIMIT_USD));
}

function warningUsd(limit: number) {
  return Math.min(limit, positiveEnv("SWING_UP_PR262_AI_DAILY_WARNING_USD", DEFAULT_WARNING_USD));
}

function reviewReservationUsd(limit: number) {
  void limit;
  return PR262_REVIEW_MAX_COST_USD;
}

function emptyState(now: Date): State {
  return { version: 1, updatedAt: new Date(0).toISOString(), entries: [], reservations: [], auditEntries: [], auditTrackingStartedAt: now.toISOString() };
}

function normalizeEntries(items: unknown[], now: Date, retentionMs: number): CostEntry[] {
  return items.flatMap((item): CostEntry[] => {
    const row = object(item);
    const recordedAt = typeof row.recordedAt === "string" ? row.recordedAt : "";
    const at = Date.parse(recordedAt);
    const costUsd = finite(row.costUsd);
    if (!row.id || typeof row.id !== "string" || !Number.isFinite(at) || costUsd === null || costUsd < 0) {
      throw new Error("pr262_ai_daily_cost_entry_invalid");
    }
    if (now.getTime() - at >= retentionMs) return [];
    return [{
      id: row.id,
      recordedAt,
      ticker: typeof row.ticker === "string" ? row.ticker : null,
      alertType: typeof row.alertType === "string" ? row.alertType : null,
      costUsd: row.source === "fallback_missing_usage" ? 0 : costUsd,
      source: row.source === "actual_tokens" ? "actual_tokens" : row.source === "rejected_request" ? "rejected_request" : row.source === "usage_pending" ? "usage_pending" : "legacy_missing_usage",
      ...(row.source === "fallback_missing_usage" ? { legacyEstimateUsd: costUsd } : finite(row.legacyEstimateUsd) !== null ? { legacyEstimateUsd: Number(row.legacyEstimateUsd) } : {}),
      ...(finite(row.pendingUpperBoundUsd) !== null ? { pendingUpperBoundUsd: Math.max(0, Number(row.pendingUpperBoundUsd)) } : {}),
      ...(typeof row.retryAt === "string" && Number.isFinite(Date.parse(row.retryAt)) ? { retryAt: row.retryAt } : {}),
    }];
  });
}

function normalize(raw: unknown, now: Date): State {
  const value = object(raw);
  if (value.version !== 1 || !Array.isArray(value.entries)) throw new Error("pr262_ai_daily_cost_state_invalid");
  const entries = normalizeEntries(value.entries, now, WINDOW_MS);
  const rawAuditEntries = value.auditEntries === undefined ? [] : value.auditEntries;
  if (!Array.isArray(rawAuditEntries)) throw new Error("pr262_ai_cost_audit_entries_invalid");
  // Preserve legacy entries during migration, but do not claim the previously
  // discarded history has been recovered. The fingerprint can recur after 24h,
  // so the timestamp is part of the audit identity.
  const auditEntries = [...new Map(
    normalizeEntries([...rawAuditEntries, ...value.entries], now, AUDIT_RETENTION_MS)
      .map((entry) => [`${entry.id}:${entry.recordedAt}`, entry] as const),
  ).values()];
  const auditTrackingStartedAt = typeof value.auditTrackingStartedAt === "string"
    && Number.isFinite(Date.parse(value.auditTrackingStartedAt))
    ? value.auditTrackingStartedAt : now.toISOString();
  const rawReservations = value.reservations === undefined ? [] : value.reservations;
  if (!Array.isArray(rawReservations)) throw new Error("pr262_ai_daily_cost_reservations_invalid");
  const reservations = rawReservations.flatMap((item): CostReservation[] => {
    const row = object(item);
    const reservedAt = typeof row.reservedAt === "string" ? row.reservedAt : "";
    const expiresAt = typeof row.expiresAt === "string" ? row.expiresAt : "";
    const reservedAtMs = Date.parse(reservedAt);
    const expiresAtMs = Date.parse(expiresAt);
    const amountUsd = finite(row.amountUsd);
    if (!row.id || typeof row.id !== "string"
      || !Number.isFinite(reservedAtMs)
      || !Number.isFinite(expiresAtMs)
      || expiresAtMs <= reservedAtMs
      || amountUsd === null
      || amountUsd <= 0
      || (row.direction !== null && row.direction !== "upside" && row.direction !== "downside")) {
      throw new Error("pr262_ai_daily_cost_reservation_invalid");
    }
    if (expiresAtMs <= now.getTime()) return [];
    return [{
      id: row.id,
      reservedAt,
      expiresAt,
      ticker: typeof row.ticker === "string" ? row.ticker : null,
      direction: row.direction as CostReservation["direction"],
      amountUsd,
    }];
  });
  return {
    version: 1,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : new Date(0).toISOString(),
    entries,
    reservations,
    auditEntries,
    auditTrackingStartedAt,
    ...(typeof object(value.providerCooldown).until === "string" ? { providerCooldown: value.providerCooldown as State["providerCooldown"] } : {}),
  };
}

async function load(now: Date) {
  const current = await readVersionedTextFromR2(STATE_KEY);
  if (!current.found || !current.text) return { state: emptyState(now), etag: current.etag };
  try { return { state: normalize(JSON.parse(current.text), now), etag: current.etag }; }
  catch (error) {
    throw new Error("pr262_ai_daily_cost_state_unreadable", { cause: error });
  }
}

function total(entries: CostEntry[]) {
  return Math.round(entries.reduce((sum, item) => sum + item.costUsd, 0) * 1_000_000) / 1_000_000;
}

function totalReservations(reservations: CostReservation[]) {
  return Math.round(reservations.reduce((sum, item) => sum + item.amountUsd, 0) * 1_000_000) / 1_000_000;
}

function pendingExposure(entries: CostEntry[]) {
  return entries.reduce((sum, entry) => sum + (entry.pendingUpperBoundUsd ?? 0), 0);
}

function auditWindow(state: State, now: Date, days: number) {
  const startMs = now.getTime() - days * WINDOW_MS;
  const entries = state.auditEntries.filter((entry) => {
    const at = Date.parse(entry.recordedAt);
    return at >= startMs && at <= now.getTime();
  });
  const metered = entries.filter((entry) => entry.source === "actual_tokens");
  const unknown = entries.filter((entry) => entry.source === "usage_pending" || entry.source === "legacy_missing_usage");
  const completeFromMs = Math.max(Date.parse(state.auditTrackingStartedAt), now.getTime() - AUDIT_RETENTION_MS);
  return {
    startAt: new Date(startMs).toISOString(),
    endAt: now.toISOString(),
    recordedReviews: entries.length,
    completeTokenUsageReviews: metered.length,
    completeTokenUsageEstimateUsd: total(metered),
    unknownUsageReviews: unknown.length,
    unknownUsageAllocationUsd: 0,
    pendingUsageUpperBoundUsd: pendingExposure(unknown),
    removedLegacyEstimateUsd: unknown.reduce((sum, entry) => sum + (entry.legacyEstimateUsd ?? 0), 0),
    rejectedRequests: entries.filter(entry => entry.source === "rejected_request").length,
    budgetAccountedUsd: total(entries),
    recordedReviewHistoryComplete: completeFromMs <= startMs,
    recordedReviewHistoryCompleteFrom: new Date(completeFromMs).toISOString(),
  };
}

function auditSummary(state: State, now: Date) {
  return {
    retentionDays: AUDIT_RETENTION_DAYS,
    providerInvoiceVerified: false,
    coversRecordedReviewsOnly: true,
    activeReservationUsd: totalReservations(state.reservations),
    activeReservations: state.reservations.length,
    last48Hours: auditWindow(state, now, 2),
    last30Days: auditWindow(state, now, 30),
  };
}

export async function getPr262AiCostAudit(now = new Date()) {
  const loaded = await load(now);
  return { ...auditSummary(loaded.state, now), providerBilling: await readOpenAiBillingAudit(now) };
}

function nextBudgetAdmissionAt(state: State, amountUsd: number, limit: number) {
  let exposureUsd = total(state.entries) + pendingExposure(state.entries) + totalReservations(state.reservations);
  if (exposureUsd + amountUsd <= limit + Number.EPSILON) return null;
  if (amountUsd > limit + Number.EPSILON) return null;

  const releases = new Map<number, number>();
  for (const entry of state.entries) {
    const expiresAt = Date.parse(entry.recordedAt) + WINDOW_MS;
    releases.set(expiresAt, (releases.get(expiresAt) ?? 0) + entry.costUsd + (entry.pendingUpperBoundUsd ?? 0));
  }
  for (const reservation of state.reservations) {
    const expiresAt = Date.parse(reservation.expiresAt);
    releases.set(expiresAt, (releases.get(expiresAt) ?? 0) + reservation.amountUsd);
  }
  for (const [expiresAt, releasedUsd] of [...releases.entries()].sort((left, right) => left[0] - right[0])) {
    exposureUsd = Math.max(0, exposureUsd - releasedUsd);
    if (exposureUsd + amountUsd <= limit + Number.EPSILON) return new Date(expiresAt).toISOString();
  }
  return null;
}

export async function getPr262AiDailyBudgetStatus(now = new Date(), includeAudit = false) {
  const loaded = await load(now);
  const spentUsd = total(loaded.state.entries);
  const reservedUsd = totalReservations(loaded.state.reservations);
  const pendingUsageUpperBoundUsd = pendingExposure(loaded.state.entries);
  const exposureUsd = Math.round((spentUsd + reservedUsd + pendingUsageUpperBoundUsd) * 1_000_000) / 1_000_000;
  const limit = limitUsd();
  const warning = warningUsd(limit);
  const nextReviewReservationUsd = reviewReservationUsd(limit);
  const providerCooldown = Date.parse(loaded.state.providerCooldown?.until ?? "") > now.getTime() ? loaded.state.providerCooldown : null;
  const budgetAvailable = exposureUsd + nextReviewReservationUsd <= limit + Number.EPSILON;
  const allowed = budgetAvailable && !providerCooldown;
  return {
    allowed,
    spentUsd,
    reservedUsd,
    exposureUsd,
    remainingUsd: Math.max(0, Math.round((limit - exposureUsd) * 1_000_000) / 1_000_000),
    limitUsd: limit,
    warningUsd: warning,
    warning: exposureUsd >= warning,
    hardFuseTripped: !budgetAvailable,
    providerCooldown,
    pendingUsageUpperBoundUsd,
    nextReviewReservationUsd,
    nextBudgetAdmissionAt: providerCooldown?.until ?? nextBudgetAdmissionAt(loaded.state, nextReviewReservationUsd, limit),
    reservationCheckedBeforePaidCommittee: true,
    activeReservations: loaded.state.reservations.length,
    reviewsRecorded: loaded.state.entries.length,
    unknownUsageReviews: loaded.state.entries.filter((item) => item.source === "usage_pending" || item.source === "legacy_missing_usage").length,
    completeTokenUsageEstimateUsd: total(loaded.state.entries.filter((item) => item.source === "actual_tokens")),
    unknownUsageAllocationUsd: 0,
    ...(includeAudit ? { costAudit: { ...auditSummary(loaded.state, now), providerBilling: await readOpenAiBillingAudit(now) } } : {}),
  };
}

export async function reservePr262AiCommitteeBudget(input: {
  candidateFingerprint: string;
  ticker?: string | null;
  direction?: "upside" | "downside" | null;
}, now = new Date()) {
  const id = input.candidateFingerprint.trim();
  const denied = async (reason: string, nextRetryAt: string | null = null) => {
    const status = await getPr262AiDailyBudgetStatus(now);
    return { ...status, budgetAdmissionAvailable: status.allowed, allowed: false as const, reason, nextRetryAt };
  };
  if (!id) return denied("candidate_fingerprint_missing");
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const loaded = await load(now);
    if (Date.parse(loaded.state.providerCooldown?.until ?? "") > now.getTime()) return denied("provider_cooldown", loaded.state.providerCooldown!.until);
    const recorded = loaded.state.entries.find((item) => item.id === id && item.source !== "legacy_missing_usage"
      && (item.source !== "rejected_request" || Date.parse(item.retryAt ?? "") > now.getTime()));
    if (recorded) {
      return denied(
        "candidate_already_recorded",
        recorded.retryAt ?? new Date(Date.parse(recorded.recordedAt) + WINDOW_MS).toISOString(),
      );
    }
    const activeReservation = loaded.state.reservations.find((item) => item.id === id);
    if (activeReservation) {
      return denied("candidate_already_reserved", activeReservation.expiresAt);
    }
    const limit = limitUsd();
    const amountUsd = reviewReservationUsd(limit);
    const exposureUsd = total(loaded.state.entries) + pendingExposure(loaded.state.entries) + totalReservations(loaded.state.reservations);
    if (exposureUsd + amountUsd > limit + Number.EPSILON) {
      return denied("daily_cost_fuse", nextBudgetAdmissionAt(loaded.state, amountUsd, limit));
    }
    const reservation: CostReservation = {
      id,
      reservedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + RESERVATION_TTL_MS).toISOString(),
      ticker: typeof input.ticker === "string" ? input.ticker.toUpperCase().slice(0, 20) : null,
      direction: input.direction === "upside" || input.direction === "downside" ? input.direction : null,
      amountUsd,
    };
    const next: State = {
      ...loaded.state,
      version: 1,
      updatedAt: now.toISOString(),
      entries: loaded.state.entries,
      reservations: [...loaded.state.reservations, reservation],
    };
    const written = await writeVersionedJsonToR2(
      STATE_KEY,
      next,
      loaded.etag ? { expectedEtag: loaded.etag } : { createOnly: true },
    );
    if (!written.conflict && !written.written) throw new Error("pr262_ai_cost_write_failed");
    if (!written.conflict) return { allowed: true as const, reason: "reserved", reservation, nextRetryAt: null };
  }
  throw new Error("pr262_ai_daily_cost_reservation_conflict");
}

export async function releasePr262AiCommitteeBudgetReservation(candidateFingerprint: string | null | undefined, now = new Date()) {
  const id = candidateFingerprint?.trim();
  if (!id) return { released: false, reason: "candidate_fingerprint_missing" };
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const loaded = await load(now);
    if (!loaded.state.reservations.some((item) => item.id === id)) return { released: false, reason: "reservation_not_found" };
    const next: State = {
      ...loaded.state,
      version: 1,
      updatedAt: now.toISOString(),
      entries: loaded.state.entries,
      reservations: loaded.state.reservations.filter((item) => item.id !== id),
    };
    const written = await writeVersionedJsonToR2(
      STATE_KEY,
      next,
      loaded.etag ? { expectedEtag: loaded.etag } : { createOnly: true },
    );
    if (!written.conflict && !written.written) throw new Error("pr262_ai_cost_write_failed");
    if (!written.conflict) return { released: true, reason: "released" };
  }
  throw new Error("pr262_ai_daily_cost_release_conflict");
}

function actualCostFromReport(report: Json) {
  const committee = object(report.committee);
  const output = object(committee.output);
  const usageSummary = object(output.modelUsageSummary);
  const actual = object(usageSummary.actualOpenAiUsage);
  // Each response's actual token receipt counts, including a partial review.
  if (!(Number(actual.responsesWithUsage) > 0)) return 0;
  const tokens = object(actual.tokens);
  const prompt = finite(tokens.promptTokens);
  const cached = finite(tokens.cachedPromptTokens) ?? 0;
  const completion = finite(tokens.completionTokens);
  if (prompt === null || completion === null || prompt < 0 || completion < 0 || cached < 0 || cached > prompt) return null;
  const models = Object.keys(object(actual.byModel));
  if (models.some(model => !["gpt-4.1-mini", "gpt-4.1-mini-2025-04-14"].includes(model))) return null;

  const inputRate = GPT_4_1_MINI_INPUT_USD_PER_MILLION;
  const cachedRate = GPT_4_1_MINI_CACHED_INPUT_USD_PER_MILLION;
  const outputRate = GPT_4_1_MINI_OUTPUT_USD_PER_MILLION;
  const uncachedPrompt = Math.max(0, prompt - cached);
  return (uncachedPrompt * inputRate + cached * cachedRate + completion * outputRate) / 1_000_000;
}

export async function recordPr262AiCommitteeCost(reportValue: unknown, now = new Date()) {
  const report = object(reportValue);
  if (report.openAiCalled !== true) return { recorded: false, reason: "openai_not_called", ...(await getPr262AiDailyBudgetStatus(now)) };
  const id = typeof report.candidateFingerprint === "string" && report.candidateFingerprint
    ? report.candidateFingerprint
    : `${report.checkedAt ?? now.toISOString()}:${object(report.selectedCandidate).ticker ?? "unknown"}`;
  const actual = actualCostFromReport(report);
  const candidate = object(report.selectedCandidate);
  const summary = object(object(object(report.committee).output).modelUsageSummary);
  const roles = Array.isArray(summary.roleDiagnostics) ? summary.roleDiagnostics.map(object) : [];
  const rejected = (role: Json) => [400, 401, 403, 404, 422, 429].includes(Number(object(role.providerFailure).httpStatus))
    || ["not_configured", "disabled", "confirmation_required", "model_not_configured", "model_not_allowed", "prompt_too_large"].includes(String(role.error));
  const uncertain = actual === null || (roles.length === 0 && !(Number(object(summary.actualOpenAiUsage).responsesWithUsage) > 0))
    || roles.some(role => role.status !== "blocked" && role.status !== "planned" && role.usageReported !== true && !rejected(role));
  const failure = roles.map(role => object(role.providerFailure)).find(value => typeof value.category === "string");
  const cooldownMs = failure ? Math.min(60 * 60_000, Math.max(5 * 60_000, Number(failure.retryAfterSeconds ?? 0) * 1000,
    ["quota", "authentication", "permission"].includes(String(failure.category)) ? 30 * 60_000 : 0)) : 0;
  const retryAt = new Date(now.getTime() + (cooldownMs || (uncertain ? WINDOW_MS : 5 * 60_000))).toISOString();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const loaded = await load(now);
    const hasReservation = loaded.state.reservations.some(item => item.id === id);
    const existingEntry = loaded.state.entries.find((item) => item.id === id && item.source !== "legacy_missing_usage"
      && !(item.source === "rejected_request" && hasReservation));
    if (existingEntry) {
      return {
        recorded: false,
        reason: "already_recorded",
        nextRetryAt: existingEntry.retryAt ?? new Date(Date.parse(existingEntry.recordedAt) + WINDOW_MS).toISOString(),
        ...(await getPr262AiDailyBudgetStatus(now)),
      };
    }
    const reservedAmount = loaded.state.reservations.find((item) => item.id === id)?.amountUsd
      ?? reviewReservationUsd(limitUsd());
    const costUsd = Math.max(0, actual ?? 0);
    const entry: CostEntry = {
      id,
      recordedAt: now.toISOString(),
      ticker: typeof candidate.ticker === "string" ? candidate.ticker : null,
      alertType: typeof report.alertType === "string" ? report.alertType : null,
      costUsd: Math.round(costUsd * 1_000_000) / 1_000_000,
      source: uncertain ? "usage_pending" : costUsd > 0 ? "actual_tokens" : "rejected_request",
      ...(uncertain ? { pendingUpperBoundUsd: Math.max(0, reservedAmount - costUsd) } : {}),
      ...(costUsd === 0 || uncertain ? { retryAt } : {}),
    };
    const next: State = {
      ...loaded.state,
      version: 1,
      updatedAt: now.toISOString(),
      // normalize() already removes entries outside the rolling 24-hour
      // window. Retain every in-window charge so a high review count can
      // never make the ledger forget spend and reopen the $10 fuse.
      entries: [...loaded.state.entries.filter(item => item.id !== id || item.source === "actual_tokens" || item.source === "usage_pending"), entry],
      auditEntries: [...loaded.state.auditEntries, entry],
      reservations: loaded.state.reservations.filter((item) => item.id !== id),
      providerCooldown: failure ? { until: retryAt, category: String(failure.category), ...(typeof failure.code === "string" ? { code: failure.code } : {}), ...(typeof failure.httpStatus === "number" ? { httpStatus: failure.httpStatus } : {}) } : undefined,
    };
    const written = await writeVersionedJsonToR2(
      STATE_KEY,
      next,
      loaded.etag ? { expectedEtag: loaded.etag } : { createOnly: true },
    );
    if (!written.conflict && !written.written) throw new Error("pr262_ai_cost_write_failed");
    if (!written.conflict) {
      return {
        recorded: true,
        entry,
        nextRetryAt: entry.retryAt ?? new Date(Date.parse(entry.recordedAt) + WINDOW_MS).toISOString(),
        ...(await getPr262AiDailyBudgetStatus(now)),
      };
    }
  }
  throw new Error("pr262_ai_daily_cost_state_conflict");
}

export async function recordPr262AiCommitteeCostFromResultKey(resultKey: string | null | undefined, now = new Date()) {
  if (!resultKey) return { recorded: false, reason: "no_result_key", ...(await getPr262AiDailyBudgetStatus(now)) };
  const stored = await readVersionedTextFromR2(resultKey);
  if (!stored.found || !stored.text) return { recorded: false, reason: "result_missing", ...(await getPr262AiDailyBudgetStatus(now)) };
  try {
    const payload = object(JSON.parse(stored.text));
    return recordPr262AiCommitteeCost(payload.report, now);
  } catch {
    return { recorded: false, reason: "result_invalid", ...(await getPr262AiDailyBudgetStatus(now)) };
  }
}

export const PR262_AI_DAILY_COST_KEY = STATE_KEY;
