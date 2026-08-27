import { readVersionedTextFromR2, writeVersionedJsonToR2 } from "@/lib/r2-warehouse";
import { pr262StorageKey } from "@/lib/opportunity-engine/pr262-storage";

const STATE_KEY = pr262StorageKey("serious-signal/ai-cost-v1.json");
const WINDOW_MS = 24 * 60 * 60_000;
const DEFAULT_LIMIT_USD = 10;
const DEFAULT_WARNING_USD = 6;
const DEFAULT_UNKNOWN_USAGE_FALLBACK_USD = 0.75;
const DEFAULT_REVIEW_RESERVATION_USD = 0.75;
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
  source: "actual_tokens" | "fallback_missing_usage";
};
type CostReservation = {
  id: string;
  reservedAt: string;
  expiresAt: string;
  ticker: string | null;
  direction: "upside" | "downside" | null;
  amountUsd: number;
};
type State = { version: 1; updatedAt: string; entries: CostEntry[]; reservations: CostReservation[] };

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
  return Math.max(
    DEFAULT_REVIEW_RESERVATION_USD,
    positiveEnv("SWING_UP_PR262_AI_REVIEW_RESERVATION_USD", DEFAULT_REVIEW_RESERVATION_USD),
  );
}

function emptyState(): State {
  return { version: 1, updatedAt: new Date(0).toISOString(), entries: [], reservations: [] };
}

function normalize(raw: unknown, now: Date): State {
  const value = object(raw);
  if (value.version !== 1 || !Array.isArray(value.entries)) throw new Error("pr262_ai_daily_cost_state_invalid");
  const entries = value.entries.flatMap((item): CostEntry[] => {
    const row = object(item);
    const recordedAt = typeof row.recordedAt === "string" ? row.recordedAt : "";
    const at = Date.parse(recordedAt);
    const costUsd = finite(row.costUsd);
    if (!row.id || typeof row.id !== "string" || !Number.isFinite(at) || costUsd === null || costUsd < 0) {
      throw new Error("pr262_ai_daily_cost_entry_invalid");
    }
    if (now.getTime() - at >= WINDOW_MS) return [];
    return [{
      id: row.id,
      recordedAt,
      ticker: typeof row.ticker === "string" ? row.ticker : null,
      alertType: typeof row.alertType === "string" ? row.alertType : null,
      costUsd,
      source: row.source === "actual_tokens" ? "actual_tokens" : "fallback_missing_usage",
    }];
  });
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
  };
}

async function load(now: Date) {
  const current = await readVersionedTextFromR2(STATE_KEY);
  if (!current.found || !current.text) return { state: emptyState(), etag: current.etag };
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

export async function getPr262AiDailyBudgetStatus(now = new Date()) {
  const loaded = await load(now);
  const spentUsd = total(loaded.state.entries);
  const reservedUsd = totalReservations(loaded.state.reservations);
  const exposureUsd = Math.round((spentUsd + reservedUsd) * 1_000_000) / 1_000_000;
  const limit = limitUsd();
  const warning = warningUsd(limit);
  const nextReviewReservationUsd = reviewReservationUsd(limit);
  const allowed = exposureUsd + nextReviewReservationUsd <= limit + Number.EPSILON;
  return {
    allowed,
    spentUsd,
    reservedUsd,
    exposureUsd,
    remainingUsd: Math.max(0, Math.round((limit - exposureUsd) * 1_000_000) / 1_000_000),
    limitUsd: limit,
    warningUsd: warning,
    warning: exposureUsd >= warning,
    hardFuseTripped: !allowed,
    nextReviewReservationUsd,
    reservationCheckedBeforePaidCommittee: true,
    activeReservations: loaded.state.reservations.length,
    reviewsRecorded: loaded.state.entries.length,
    unknownUsageReviews: loaded.state.entries.filter((item) => item.source === "fallback_missing_usage").length,
  };
}

export async function reservePr262AiCommitteeBudget(input: {
  candidateFingerprint: string;
  ticker?: string | null;
  direction?: "upside" | "downside" | null;
}, now = new Date()) {
  const id = input.candidateFingerprint.trim();
  const denied = async (reason: string) => {
    const status = await getPr262AiDailyBudgetStatus(now);
    return { ...status, budgetAdmissionAvailable: status.allowed, allowed: false as const, reason };
  };
  if (!id) return denied("candidate_fingerprint_missing");
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const loaded = await load(now);
    if (loaded.state.entries.some((item) => item.id === id)) {
      return denied("candidate_already_recorded");
    }
    if (loaded.state.reservations.some((item) => item.id === id)) {
      return denied("candidate_already_reserved");
    }
    const limit = limitUsd();
    const amountUsd = reviewReservationUsd(limit);
    const exposureUsd = total(loaded.state.entries) + totalReservations(loaded.state.reservations);
    if (exposureUsd + amountUsd > limit + Number.EPSILON) {
      return denied("daily_cost_fuse");
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
    if (!written.conflict) return { allowed: true as const, reason: "reserved", reservation };
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
    if (!written.conflict) return { released: true, reason: "released" };
  }
  throw new Error("pr262_ai_daily_cost_release_conflict");
}

function actualCostFromReport(report: Json) {
  const committee = object(report.committee);
  const output = object(committee.output);
  const usageSummary = object(output.modelUsageSummary);
  const actual = object(usageSummary.actualOpenAiUsage);
  // All 13 specialists plus the Final Judge must report usage. A partial
  // usage payload is not an exact bill and therefore reconciles to the full
  // conservative reservation instead of reopening capacity.
  if (Number(actual.responsesWithUsage) !== 14) return null;
  const tokens = object(actual.tokens);
  const prompt = finite(tokens.promptTokens);
  const cached = finite(tokens.cachedPromptTokens) ?? 0;
  const completion = finite(tokens.completionTokens);
  if (prompt === null || completion === null || prompt + completion <= 0) return null;

  const inputRate = Math.max(GPT_4_1_MINI_INPUT_USD_PER_MILLION, positiveEnv("AI_COMMITTEE_INPUT_USD_PER_MILLION", GPT_4_1_MINI_INPUT_USD_PER_MILLION));
  const cachedRate = Math.max(GPT_4_1_MINI_CACHED_INPUT_USD_PER_MILLION, positiveEnv("AI_COMMITTEE_CACHED_INPUT_USD_PER_MILLION", GPT_4_1_MINI_CACHED_INPUT_USD_PER_MILLION));
  const outputRate = Math.max(GPT_4_1_MINI_OUTPUT_USD_PER_MILLION, positiveEnv("AI_COMMITTEE_OUTPUT_USD_PER_MILLION", GPT_4_1_MINI_OUTPUT_USD_PER_MILLION));
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
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const loaded = await load(now);
    if (loaded.state.entries.some((item) => item.id === id)) {
      return { recorded: false, reason: "already_recorded", ...(await getPr262AiDailyBudgetStatus(now)) };
    }
    const reservedAmount = loaded.state.reservations.find((item) => item.id === id)?.amountUsd
      ?? reviewReservationUsd(limitUsd());
    const costUsd = actual !== null
      ? Math.max(0, actual)
      : Math.max(
          reservedAmount,
          positiveEnv("SWING_UP_PR262_AI_UNKNOWN_USAGE_FALLBACK_USD", DEFAULT_UNKNOWN_USAGE_FALLBACK_USD),
        );
    const entry: CostEntry = {
      id,
      recordedAt: now.toISOString(),
      ticker: typeof candidate.ticker === "string" ? candidate.ticker : null,
      alertType: typeof report.alertType === "string" ? report.alertType : null,
      costUsd: Math.round(costUsd * 1_000_000) / 1_000_000,
      source: actual !== null ? "actual_tokens" : "fallback_missing_usage",
    };
    const next: State = {
      version: 1,
      updatedAt: now.toISOString(),
      // normalize() already removes entries outside the rolling 24-hour
      // window. Retain every in-window charge so a high review count can
      // never make the ledger forget spend and reopen the $10 fuse.
      entries: [...loaded.state.entries, entry],
      reservations: loaded.state.reservations.filter((item) => item.id !== id),
    };
    const written = await writeVersionedJsonToR2(
      STATE_KEY,
      next,
      loaded.etag ? { expectedEtag: loaded.etag } : { createOnly: true },
    );
    if (!written.conflict) return { recorded: true, entry, ...(await getPr262AiDailyBudgetStatus(now)) };
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
