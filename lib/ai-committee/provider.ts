import type { AiCommitteeModelTier } from "@/lib/ai-committee/agents";

export type AiCommitteeProviderStatus = {
  provider: "openai";
  configured: boolean;
  enabled: boolean;
  dryRunDefault: boolean;
  modelEnvStatus: Record<"fast" | "deep" | "final", "configured" | "missing">;
  modelAllowlistConfigured: boolean;
  requestTimeoutMs: number;
  maxCostUsdPerRunConfigured: boolean;
  autonomousEnabled: boolean;
};

export type AiCommitteeTokenUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedPromptTokens: number;
};

export type AiCommitteeProviderFailure = {
  category: "authentication" | "permission" | "quota" | "rate_limit" | "rate_or_quota" | "invalid_request" | "unavailable" | "timeout" | "cancelled" | "transport" | "invalid_response";
  httpStatus?: number;
  code?: string;
  requestId?: string;
  retryAfterSeconds?: number;
  // These errors apply to the shared provider/configuration, not the evidence
  // assigned to an individual role. Do not repeat them thirteen more times.
  stopRemainingAgents: boolean;
};

const KNOWN_ERROR_CODES = new Set([
  "invalid_api_key", "insufficient_quota", "rate_limit_exceeded", "model_not_found",
  "permission_denied", "invalid_request_error", "context_length_exceeded",
  "billing_hard_limit_reached", "billing_not_active", "organization_deactivated",
  "account_deactivated", "unsupported_parameter", "unsupported_value",
  "invalid_value", "server_error", "service_unavailable",
  "credit_balance_exhausted", "organization_spend_limit_exceeded", "project_spend_limit_exceeded",
  "organization_usage_limit_exceeded", "slow_down", "server_is_overloaded",
]);

async function httpFailure(response: Response): Promise<AiCommitteeProviderFailure> {
  // Provider messages can echo prompts, keys, organization IDs, or headers.
  // Persist only allowlisted codes and safe correlation metadata.
  const data = await response.json().catch(() => null);
  const rawCode = data?.error?.code;
  const code = typeof rawCode === "string" && KNOWN_ERROR_CODES.has(rawCode) ? rawCode : undefined;
  const requestId = response.headers.get("x-request-id") ?? "";
  const retryAfter = Number(response.headers.get("retry-after"));
  const quota = Boolean(code && ["insufficient_quota", "billing_hard_limit_reached", "billing_not_active", "credit_balance_exhausted", "organization_spend_limit_exceeded", "project_spend_limit_exceeded", "organization_usage_limit_exceeded"].includes(code));
  return {
    category: response.status === 401 ? "authentication" : response.status === 403 ? "permission"
      : quota ? "quota" : response.status === 429 ? (["rate_limit_exceeded", "slow_down"].includes(code ?? "") ? "rate_limit" : "rate_or_quota")
        : response.status >= 500 ? "unavailable" : "invalid_request",
    httpStatus: response.status,
    ...(code ? { code } : {}),
    ...(/^[A-Za-z0-9_-]{1,100}$/.test(requestId) ? { requestId } : {}),
    ...(Number.isFinite(retryAfter) && retryAfter > 0 ? { retryAfterSeconds: Math.min(86400, Math.ceil(retryAfter)) } : {}),
    stopRemainingAgents: true,
  };
}

export type AiCommitteeRunOptions = {
  tier: AiCommitteeModelTier;
  confirmRun?: boolean;
  dryRun?: boolean;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  maxTokens?: number;
  signal?: AbortSignal;
  allowedModels?: readonly string[];
  maximumPromptBytes?: number;
};

function envFlag(name: string, defaultValue = false) {
  const value = process.env[name];
  if (value === undefined) return defaultValue;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function defaultModel() {
  return process.env.OPENAI_MODEL?.trim() || "gpt-4.1-mini";
}

function configuredModel(tier: AiCommitteeModelTier) {
  if (tier === "final") return process.env.AI_COMMITTEE_FINAL_MODEL?.trim() || defaultModel();
  if (tier === "deep") return process.env.AI_COMMITTEE_DEEP_MODEL?.trim() || defaultModel();
  return process.env.AI_COMMITTEE_FAST_MODEL?.trim() || defaultModel();
}

function configuredModelAllowlist() {
  return new Set((process.env.AI_COMMITTEE_MODEL_ALLOWLIST ?? "")
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean));
}

function requestTimeoutMs() {
  const configured = Number(process.env.AI_COMMITTEE_REQUEST_TIMEOUT_MS ?? 20_000);
  return Number.isFinite(configured) ? Math.max(1_000, Math.min(60_000, Math.round(configured))) : 20_000;
}

function dryRunDefault(configured: boolean, enabled: boolean) {
  return envFlag("AI_COMMITTEE_DRY_RUN_DEFAULT", !(configured && enabled));
}

export function getAiCommitteeProviderStatus(): AiCommitteeProviderStatus {
  const configured = Boolean(process.env.OPENAI_API_KEY?.trim());
  const enabled = envFlag("AI_COMMITTEE_ENABLED", configured);
  const modelAllowlist = configuredModelAllowlist();
  return {
    provider: "openai",
    configured,
    enabled,
    dryRunDefault: dryRunDefault(configured, enabled),
    modelEnvStatus: {
      fast: configuredModel("fast") ? "configured" : "missing",
      deep: configuredModel("deep") ? "configured" : "missing",
      final: configuredModel("final") ? "configured" : "missing",
    },
    modelAllowlistConfigured: modelAllowlist.size > 0,
    requestTimeoutMs: requestTimeoutMs(),
    maxCostUsdPerRunConfigured: true,
    autonomousEnabled: envFlag("AI_COMMITTEE_AUTONOMOUS", true),
  };
}

function modelForTier(tier: AiCommitteeModelTier) {
  return configuredModel(tier);
}

// This is an access check, not a completion: it generates no tokens and does
// not verify billing quota. It can diagnose configuration while the paid fuse
// correctly keeps uncertain earlier usage reserved.
export async function probeOpenAiCommitteeProviderAccess(signal?: AbortSignal) {
  const status = getAiCommitteeProviderStatus();
  const context = { readOnly: true, callsPaidModel: false, billingQuotaVerified: false };
  if (!status.configured || !status.enabled) return { ...context, status: "skipped", reason: !status.configured ? "not_configured" : "disabled" };
  try {
    const response = await fetch("https://api.openai.com/v1/models", {
      method: "GET", headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY?.trim()}` },
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(5_000)]) : AbortSignal.timeout(5_000),
    });
    if (!response.ok) return { ...context, status: "failed", failure: await httpFailure(response) };
    const data = await response.json() as { data?: Array<{ id?: string }> };
    if (!Array.isArray(data?.data)) return { ...context, status: "failed", failure: { category: "invalid_response" } };
    const available = new Set(data.data.map(model => model.id));
    return { ...context, status: "completed", httpStatus: response.status, modelAvailable: {
      fast: available.has(configuredModel("fast")), deep: available.has(configuredModel("deep")), final: available.has(configuredModel("final")),
    } };
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    return { ...context, status: "failed", failure: { category: signal?.aborted ? "cancelled" : name === "TimeoutError" || name === "AbortError" ? "timeout" : name === "SyntaxError" ? "invalid_response" : "transport" } };
  }
}

export async function runOpenAiCommitteeProvider(options: AiCommitteeRunOptions) {
  const status = getAiCommitteeProviderStatus();
  const dryRun = options.dryRun ?? status.dryRunDefault;
  const model = modelForTier(options.tier);

  if (!status.configured) return { ok: false as const, status: "not_configured" as const, providerStatus: status };
  if (!status.enabled) return { ok: false as const, status: "disabled" as const, providerStatus: status };
  if (!options.confirmRun) return { ok: false as const, status: "confirmation_required" as const, providerStatus: status };
  if (dryRun) return { ok: true as const, status: "dry_run" as const, modelTier: options.tier, modelConfigured: Boolean(model), providerStatus: status };
  if (!model) return { ok: false as const, status: "model_not_configured" as const, modelTier: options.tier, providerStatus: status };
  const modelAllowlist = configuredModelAllowlist();
  if (modelAllowlist.size > 0 && !modelAllowlist.has(model)) {
    return { ok: false as const, status: "model_not_allowed" as const, modelTier: options.tier, providerStatus: status };
  }
  if (options.allowedModels?.length && !options.allowedModels.includes(model)) {
    return { ok: false as const, status: "model_not_allowed" as const, modelTier: options.tier, providerStatus: status };
  }
  if (Number.isFinite(options.maximumPromptBytes)) {
    const maximumPromptBytes = Math.max(1_000, Math.floor(Number(options.maximumPromptBytes)));
    const promptBytes = new TextEncoder().encode(JSON.stringify(options.messages)).byteLength;
    if (promptBytes > maximumPromptBytes) {
      return { ok: false as const, status: "prompt_too_large" as const, modelTier: options.tier, providerStatus: status };
    }
  }

  console.info("AI Committee OpenAI provider run", { modelTier: options.tier, model });

  let response: Response;
  let data: {
    choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
      prompt_tokens_details?: { cached_tokens?: number };
    };
  };
  try {
    const timeoutSignal = AbortSignal.timeout(status.requestTimeoutMs);
    const signal = options.signal
      ? AbortSignal.any([options.signal, timeoutSignal])
      : timeoutSignal;
    response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY?.trim()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model, messages: options.messages, max_tokens: options.maxTokens ?? 700, temperature: 0.2, response_format: { type: "json_object" } }),
      signal,
    });
    if (!response.ok) {
      const failure = await httpFailure(response);
      return { ok: false as const, status: "provider_error" as const, modelTier: options.tier, model, httpStatus: response.status, failure, providerStatus: status };
    }
    // Consume the response inside the cancellation/error boundary as well.
    // A body read timeout must not discard earlier roles' recorded usage.
    data = await response.json();
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    const cancelled = options.signal?.aborted === true;
    const timedOut = !cancelled && (name === "TimeoutError" || name === "AbortError");
    const failure: AiCommitteeProviderFailure = {
      category: cancelled ? "cancelled" : timedOut ? "timeout" : name === "SyntaxError" ? "invalid_response" : "transport",
      stopRemainingAgents: cancelled || (!timedOut && name !== "SyntaxError"),
    };
    return { ok: false as const, status: timedOut ? "provider_timeout" as const : "provider_error" as const, modelTier: options.tier, model, failure, providerStatus: status };
  }

  const count = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
  const validUsage = data?.usage && [data.usage.prompt_tokens, data.usage.completion_tokens, data.usage.total_tokens]
    .every(value => typeof value === "number" && Number.isFinite(value) && value >= 0)
    && Number(data.usage.total_tokens) >= Number(data.usage.prompt_tokens) + Number(data.usage.completion_tokens);
  const tokenUsage: AiCommitteeTokenUsage | undefined = validUsage && data.usage ? {
    promptTokens: count(data.usage.prompt_tokens),
    completionTokens: count(data.usage.completion_tokens),
    totalTokens: count(data.usage.total_tokens),
    cachedPromptTokens: count(data.usage.prompt_tokens_details?.cached_tokens),
  } : undefined;
  if (!data || typeof data !== "object" || !Array.isArray(data.choices)) {
    const failure: AiCommitteeProviderFailure = { category: "invalid_response", stopRemainingAgents: false };
    return { ok: false as const, status: "provider_error" as const, modelTier: options.tier, model, tokenUsage, failure, providerStatus: status };
  }
  const rawContent = data.choices?.[0]?.message?.content;
  const rawFinishReason = data.choices?.[0]?.finish_reason;
  const finishReason = rawFinishReason && ["stop", "length", "content_filter", "tool_calls", "function_call"].includes(rawFinishReason) ? rawFinishReason : undefined;
  return { ok: true as const, status: "completed" as const, modelTier: options.tier, model, content: typeof rawContent === "string" ? rawContent : "", tokenUsage, finishReason, providerStatus: status };
}
