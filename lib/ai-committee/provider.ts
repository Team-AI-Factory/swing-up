import type { AiCommitteeModelTier } from "@/lib/ai-committee/agents";
import { isSimpleAlertPilot } from "@/lib/simple-alert-pilot-runtime";
import { AI_COMMITTEE_MODEL_POLICY_VERSION, AI_COMMITTEE_REVIEW_MAX_PROMPT_BYTES, AI_COMMITTEE_ROLE_MODELS, committeeModelOutputLimit, committeeReasoningEffort, knownCommitteeModel, reasoningCommitteeModel } from "@/lib/ai-committee/model-policy";

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
  cacheWritePromptTokens?: number;
  cacheReadUsageReported?: boolean;
  reasoningTokens?: number;
  pricingVerified?: boolean;
};

export type AiCommitteeProviderFailure = {
  category: "authentication" | "permission" | "quota" | "rate_limit" | "rate_or_quota" | "invalid_request" | "unavailable" | "timeout" | "cancelled" | "transport" | "invalid_response" | "input_limit";
  httpStatus?: number;
  code?: string;
  requestId?: string;
  retryAfterSeconds?: number;
  promptBytes?: number;
  maximumPromptBytes?: number;
  // Stop remaining roles in this review. input_limit is local to its packet,
  // not evidence of a shared provider outage.
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
  responseSchema?: { name: string; schema: Record<string, unknown> };
};

function envFlag(name: string, defaultValue = false) {
  const value = process.env[name];
  if (value === undefined) return defaultValue;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function configuredModel(tier: AiCommitteeModelTier) {
  const fallback = process.env.OPENAI_MODEL?.trim() || AI_COMMITTEE_ROLE_MODELS[tier];
  if (tier === "final") return process.env.AI_COMMITTEE_FINAL_MODEL?.trim() || fallback;
  if (tier === "deep") return process.env.AI_COMMITTEE_DEEP_MODEL?.trim() || fallback;
  return process.env.AI_COMMITTEE_FAST_MODEL?.trim() || fallback;
}

function configuredModelAllowlist() {
  return new Set((process.env.AI_COMMITTEE_MODEL_ALLOWLIST ?? "")
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean));
}

function requestTimeoutMs() {
  if (isSimpleAlertPilot()) return 60_000;
  const configured = Number(process.env.AI_COMMITTEE_REQUEST_TIMEOUT_MS ?? 60_000);
  return Number.isFinite(configured) ? Math.max(1_000, Math.min(60_000, Math.round(configured))) : 60_000;
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

export function modelForTier(tier: AiCommitteeModelTier) {
  return configuredModel(tier);
}

function modelDiagnostic(tier: AiCommitteeModelTier, model: string, allowed: boolean) {
  const configured = configuredModelAllowlist();
  return { policyVersion: AI_COMMITTEE_MODEL_POLICY_VERSION, tier,
    model: knownCommitteeModel(model) ? model : "unrecognized_model",
    expectedPilotModel: AI_COMMITTEE_ROLE_MODELS[tier], allowed,
    allowlist: [...configured].filter(knownCommitteeModel),
    unrecognizedAllowlistEntries: [...configured].filter(value => !knownCommitteeModel(value)).length,
    reasoningEffort: reasoningCommitteeModel(model) ? committeeReasoningEffort(model) : null,
    totalOutputCeiling: committeeModelOutputLimit(model, 1000), requestTimeoutMs: reasoningCommitteeModel(model) ? 60_000 : requestTimeoutMs(), serviceTier: "default" };
}

// One harmless, non-billable catalogue read per worker. Models Read permission
// is separate from completion permission; 403 or a failed probe is diagnostic,
// not proof that an otherwise authorized completion is unavailable.
let compatibilityRead: Promise<unknown> | null = null;

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
  const roleMismatch = reasoningCommitteeModel(model) && model !== AI_COMMITTEE_ROLE_MODELS[options.tier];
  if (!knownCommitteeModel(model) || roleMismatch || (isSimpleAlertPilot() && model !== AI_COMMITTEE_ROLE_MODELS[options.tier])
    || (modelAllowlist.size > 0 && !modelAllowlist.has(model))) {
    console.info("AI Committee model policy", modelDiagnostic(options.tier, model, false));
    return { ok: false as const, status: "model_not_allowed" as const, modelTier: options.tier, providerStatus: status };
  }
  if (options.allowedModels?.length && !options.allowedModels.includes(model)) {
    console.info("AI Committee model policy", modelDiagnostic(options.tier, model, false));
    return { ok: false as const, status: "model_not_allowed" as const, modelTier: options.tier, providerStatus: status };
  }
  const responseFormat = options.responseSchema
    ? { type: "json_schema", json_schema: { ...options.responseSchema, strict: true } }
    : { type: "json_object" };
  const reasoning = reasoningCommitteeModel(model);
  const messages = options.messages.map(message => reasoning && message.role === "system" ? { ...message, role: "developer" } : message);
  const configuredPromptLimit = options.maximumPromptBytes ?? (reasoning ? AI_COMMITTEE_REVIEW_MAX_PROMPT_BYTES : undefined);
  if (Number.isFinite(configuredPromptLimit)) {
    const maximumPromptBytes = Math.max(1_000, Math.min(reasoning ? AI_COMMITTEE_REVIEW_MAX_PROMPT_BYTES : Infinity, Math.floor(Number(configuredPromptLimit))));
    // A schema is also model input. Keep it inside the existing reserved input
    // ceiling, rather than silently consuming the request-framing allowance.
    const promptBytes = new TextEncoder().encode(JSON.stringify(messages)
      + (options.responseSchema ? JSON.stringify(responseFormat) : "")).byteLength;
    if (promptBytes > maximumPromptBytes) {
      const failure: AiCommitteeProviderFailure = { category: "input_limit", stopRemainingAgents: true, promptBytes, maximumPromptBytes };
      return { ok: false as const, status: "prompt_too_large" as const, failure, modelTier: options.tier, providerStatus: status };
    }
  }

  const outputLimit = committeeModelOutputLimit(model, options.maxTokens ?? 700);
  if (reasoning) {
    compatibilityRead ??= probeOpenAiCommitteeProviderAccess(options.signal).then(result => {
      console.info("AI Committee compatibility read", result);
      return result;
    });
    await compatibilityRead;
    console.info("AI Committee model policy", modelDiagnostic(options.tier, model, true));
  }
  console.info("AI Committee OpenAI provider run", { modelTier: options.tier, model });

  let response: Response;
  let data: {
    model?: string;
    service_tier?: string;
    choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
      prompt_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number };
      completion_tokens_details?: { reasoning_tokens?: number };
    };
  };
  try {
    const timeoutSignal = AbortSignal.timeout(reasoning ? 60_000 : status.requestTimeoutMs);
    const signal = options.signal
      ? AbortSignal.any([options.signal, timeoutSignal])
      : timeoutSignal;
    response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY?.trim()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model, messages, response_format: responseFormat, service_tier: "default", store: false, n: 1,
        ...(reasoning ? { max_completion_tokens: outputLimit, reasoning_effort: committeeReasoningEffort(model), verbosity: "low" }
          : { max_tokens: outputLimit, temperature: 0.2 }) }),
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
    .every(value => typeof value === "number" && Number.isInteger(value) && value >= 0)
    && Number(data.usage.total_tokens) >= Number(data.usage.prompt_tokens) + Number(data.usage.completion_tokens);
  const tokenUsage: AiCommitteeTokenUsage | undefined = validUsage && data.usage ? {
    promptTokens: count(data.usage.prompt_tokens),
    completionTokens: count(data.usage.completion_tokens),
    totalTokens: count(data.usage.total_tokens),
    cachedPromptTokens: count(data.usage.prompt_tokens_details?.cached_tokens),
    ...(reasoning ? {
      ...(typeof data.usage.prompt_tokens_details?.cached_tokens === "number" && typeof data.usage.prompt_tokens_details?.cache_write_tokens === "number"
        ? { cacheWritePromptTokens: data.usage.prompt_tokens_details.cache_write_tokens } : {}),
      cacheReadUsageReported: data.usage.prompt_tokens_details?.cached_tokens !== undefined,
      ...(typeof data.usage.completion_tokens_details?.reasoning_tokens === "number" ? { reasoningTokens: data.usage.completion_tokens_details.reasoning_tokens } : {}),
      pricingVerified: data.model === model && data.service_tier === "default"
        && (data.usage.prompt_tokens_details?.cached_tokens === undefined
          || (Number.isInteger(data.usage.prompt_tokens_details.cached_tokens) && data.usage.prompt_tokens_details.cached_tokens >= 0))
        && (data.usage.prompt_tokens_details?.cache_write_tokens === undefined
          || (Number.isInteger(data.usage.prompt_tokens_details.cache_write_tokens)
            && data.usage.prompt_tokens_details.cache_write_tokens >= 0))
        && Number(data.usage.prompt_tokens_details?.cached_tokens ?? 0) + Number(data.usage.prompt_tokens_details?.cache_write_tokens ?? 0) <= Number(data.usage.prompt_tokens),
    } : {}),
  } : undefined;
  if (reasoning && tokenUsage?.pricingVerified !== true) {
    const failure: AiCommitteeProviderFailure = { category: "invalid_response", stopRemainingAgents: true };
    console.info("AI Committee unverified pricing receipt", { policyVersion: AI_COMMITTEE_MODEL_POLICY_VERSION,
      model, modelMatches: data?.model === model, standardTierConfirmed: data?.service_tier === "default", usageReported: Boolean(tokenUsage) });
    return { ok: false as const, status: "provider_error" as const, modelTier: options.tier, model, tokenUsage, failure, providerStatus: status };
  }
  if (!data || typeof data !== "object" || !Array.isArray(data.choices)) {
    const failure: AiCommitteeProviderFailure = { category: "invalid_response", stopRemainingAgents: false };
    return { ok: false as const, status: "provider_error" as const, modelTier: options.tier, model, tokenUsage, failure, providerStatus: status };
  }
  const rawContent = data.choices?.[0]?.message?.content;
  const rawFinishReason = data.choices?.[0]?.finish_reason;
  const finishReason = rawFinishReason && ["stop", "length", "content_filter", "tool_calls", "function_call"].includes(rawFinishReason) ? rawFinishReason : undefined;
  return { ok: true as const, status: "completed" as const, modelTier: options.tier, model, content: typeof rawContent === "string" ? rawContent : "", tokenUsage, finishReason, providerStatus: status };
}
