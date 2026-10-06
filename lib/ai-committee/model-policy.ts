/** Verified 2026-10-03 against official OpenAI model/API documentation.
 * Standard global text-only processing; no tools, regional endpoint or Fast mode. */
export const AI_COMMITTEE_MODEL_PRICES: Record<string, { input: number; cachedInput: number; cacheWrite: number; output: number }> = {
  "gpt-4.1-mini": { input: 0.4, cachedInput: 0.1, cacheWrite: 0.4, output: 1.6 },
  "gpt-4.1-mini-2025-04-14": { input: 0.4, cachedInput: 0.1, cacheWrite: 0.4, output: 1.6 },
  "gpt-6.1-sol": { input: 2, cachedInput: 0.1, cacheWrite: 2.5, output: 10 },
  "gpt-6-astra": { input: 10, cachedInput: 1, cacheWrite: 12.5, output: 50 },
  "gpt-6-luna": { input: 0.1, cachedInput: 0.01, cacheWrite: 0.125, output: 0.5 },
};
export const AI_COMMITTEE_ROLE_MODELS = { fast: "gpt-6-luna", deep: "gpt-6.1-sol", final: "gpt-6-astra" } as const;
export const AI_COMMITTEE_REVIEW_MAX_PROMPT_BYTES = 60_000;
export const AI_COMMITTEE_REVIEW_FRAMING_TOKENS = 1_000;
export const AI_COMMITTEE_REASONING_MAX_OUTPUT_TOKENS = 16_384;
export const AI_COMMITTEE_REVIEW_MAX_CALLS = 6;
export const AI_COMMITTEE_MODEL_POLICY_VERSION = "gpt6-evidence-quality-20261005-v2";
export function knownCommitteeModel(value: unknown): value is string {
  return typeof value === "string" && Object.hasOwn(AI_COMMITTEE_MODEL_PRICES, value);
}
export function reasoningCommitteeModel(model: string) {
  return model === "gpt-6.1-sol" || model === "gpt-6-astra" || model === "gpt-6-luna";
}
export function committeeModelOutputLimit(model: string, visibleOutputLimit: number) {
  return model === "gpt-6-astra" ? 16_384 : model === "gpt-6.1-sol" ? 8_192 : model === "gpt-6-luna" ? 4_096 : Math.min(1_000, visibleOutputLimit);
}
export function committeeModelMaximumCost(model: string, outputTokens: number, promptBytes = AI_COMMITTEE_REVIEW_MAX_PROMPT_BYTES) {
  const price = AI_COMMITTEE_MODEL_PRICES[model];
  if (!price || !Number.isFinite(promptBytes) || promptBytes < 0 || !Number.isFinite(outputTokens) || outputTokens < 0) return null;
  return ((promptBytes + AI_COMMITTEE_REVIEW_FRAMING_TOKENS) * Math.max(price.input, price.cacheWrite)
    + outputTokens * price.output) / 1_000_000;
}
// Non-final roles are bounded to Sol or cheaper; only one Astra final is allowed.
// Includes unknown/crashed-call exposure, never an invented charge.
export const AI_COMMITTEE_REVIEW_MAX_COST_USD = 5 * committeeModelMaximumCost("gpt-6.1-sol", committeeModelOutputLimit("gpt-6.1-sol", 1000))!
  + committeeModelMaximumCost("gpt-6-astra", committeeModelOutputLimit("gpt-6-astra", 1000))!;

export const COMMITTEE_ALLOWED_MODELS = Object.keys(AI_COMMITTEE_MODEL_PRICES);
export const COMMITTEE_MODEL_POLICY = AI_COMMITTEE_MODEL_POLICY_VERSION;
export function committeeReasoningEffort(model: string) { return model === "gpt-6-luna" ? "low" : "medium"; }
