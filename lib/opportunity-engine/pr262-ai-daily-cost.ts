import { readVersionedTextFromR2, writeVersionedJsonToR2 } from "@/lib/r2-warehouse";

const STATE_KEY = "branch-labs/pr-262/serious-signal/ai-cost-v1.json";
const WINDOW_MS = 24 * 60 * 60_000;
const DEFAULT_LIMIT_USD = 10;
const DEFAULT_WARNING_USD = 6;
const DEFAULT_UNKNOWN_USAGE_FALLBACK_USD = 0.5;

type Json = Record<string, unknown>;
type CostEntry = {
  id: string;
  recordedAt: string;
  ticker: string | null;
  alertType: string | null;
  costUsd: number;
  source: "actual_tokens" | "fallback_missing_usage";
};
type State = { version: 1; updatedAt: string; entries: CostEntry[] };

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
  return positiveEnv("SWING_UP_PR262_AI_DAILY_LIMIT_USD", DEFAULT_LIMIT_USD);
}

function warningUsd(limit: number) {
  return Math.min(limit, positiveEnv("SWING_UP_PR262_AI_DAILY_WARNING_USD", DEFAULT_WARNING_USD));
}

function emptyState(): State {
  return { version: 1, updatedAt: new Date(0).toISOString(), entries: [] };
}

function normalize(raw: unknown, now: Date): State {
  const value = object(raw);
  const entries = Array.isArray(value.entries) ? value.entries.flatMap((item): CostEntry[] => {
    const row = object(item);
    const recordedAt = typeof row.recordedAt === "string" ? row.recordedAt : "";
    const at = Date.parse(recordedAt);
    const costUsd = finite(row.costUsd);
    if (!row.id || typeof row.id !== "string" || !Number.isFinite(at) || costUsd === null || costUsd < 0 || now.getTime() - at < 0 || now.getTime() - at >= WINDOW_MS) return [];
    return [{
      id: row.id,
      recordedAt,
      ticker: typeof row.ticker === "string" ? row.ticker : null,
      alertType: typeof row.alertType === "string" ? row.alertType : null,
      costUsd,
      source: row.source === "actual_tokens" ? "actual_tokens" : "fallback_missing_usage",
    }];
  }) : [];
  return { version: 1, updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : new Date(0).toISOString(), entries };
}

async function load(now: Date) {
  const current = await readVersionedTextFromR2(STATE_KEY);
  if (!current.found || !current.text) return { state: emptyState(), etag: current.etag };
  try { return { state: normalize(JSON.parse(current.text), now), etag: current.etag }; }
  catch { return { state: emptyState(), etag: current.etag }; }
}

function total(entries: CostEntry[]) {
  return Math.round(entries.reduce((sum, item) => sum + item.costUsd, 0) * 1_000_000) / 1_000_000;
}

export async function getPr262AiDailyBudgetStatus(now = new Date()) {
  const loaded = await load(now);
  const spentUsd = total(loaded.state.entries);
  const limit = limitUsd();
  const warning = warningUsd(limit);
  return {
    allowed: spentUsd < limit,
    spentUsd,
    remainingUsd: Math.max(0, Math.round((limit - spentUsd) * 1_000_000) / 1_000_000),
    limitUsd: limit,
    warningUsd: warning,
    warning: spentUsd >= warning,
    hardFuseTripped: spentUsd >= limit,
    reviewsRecorded: loaded.state.entries.length,
    unknownUsageReviews: loaded.state.entries.filter((item) => item.source === "fallback_missing_usage").length,
  };
}

function actualCostFromReport(report: Json) {
  const committee = object(report.committee);
  const output = object(committee.output);
  const usageSummary = object(output.modelUsageSummary);
  const actual = object(usageSummary.actualOpenAiUsage);
  const tokens = object(actual.tokens);
  const prompt = finite(tokens.promptTokens);
  const cached = finite(tokens.cachedPromptTokens) ?? 0;
  const completion = finite(tokens.completionTokens);
  if (prompt === null || completion === null) return null;

  const inputRate = positiveEnv("AI_COMMITTEE_INPUT_USD_PER_MILLION", 0.4);
  const cachedRate = positiveEnv("AI_COMMITTEE_CACHED_INPUT_USD_PER_MILLION", 0.1);
  const outputRate = positiveEnv("AI_COMMITTEE_OUTPUT_USD_PER_MILLION", 1.6);
  const uncachedPrompt = Math.max(0, prompt - cached);
  return (uncachedPrompt * inputRate + cached * cachedRate + completion * outputRate) / 1_000_000;
}

export async function recordPr262AiCommitteeCost(reportValue: unknown, now = new Date()) {
  const report = object(reportValue);
  if (report.openAiCalled !== true) return { recorded: false, reason: "openai_not_called", ...(await getPr262AiDailyBudgetStatus(now)) };
  const id = typeof report.candidateFingerprint === "string" && report.candidateFingerprint
    ? report.candidateFingerprint
    : `${report.checkedAt ?? now.toISOString()}:${object(report.selectedCandidate).ticker ?? "unknown"}`;
  const loaded = await load(now);
  if (loaded.state.entries.some((item) => item.id === id)) return { recorded: false, reason: "already_recorded", ...(await getPr262AiDailyBudgetStatus(now)) };

  const actual = actualCostFromReport(report);
  const costUsd = actual !== null
    ? Math.max(0, actual)
    : positiveEnv("SWING_UP_PR262_AI_UNKNOWN_USAGE_FALLBACK_USD", DEFAULT_UNKNOWN_USAGE_FALLBACK_USD);
  const candidate = object(report.selectedCandidate);
  const entry: CostEntry = {
    id,
    recordedAt: now.toISOString(),
    ticker: typeof candidate.ticker === "string" ? candidate.ticker : null,
    alertType: typeof report.alertType === "string" ? report.alertType : null,
    costUsd: Math.round(costUsd * 1_000_000) / 1_000_000,
    source: actual !== null ? "actual_tokens" : "fallback_missing_usage",
  };
  const next: State = { version: 1, updatedAt: now.toISOString(), entries: [...loaded.state.entries, entry].slice(-200) };
  const written = await writeVersionedJsonToR2(STATE_KEY, next, loaded.etag ? { expectedEtag: loaded.etag } : { createOnly: true });
  if (written.conflict) throw new Error("pr262_ai_daily_cost_state_conflict");
  return { recorded: true, entry, ...(await getPr262AiDailyBudgetStatus(now)) };
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
