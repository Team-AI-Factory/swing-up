import type { AiCommitteeModelTier } from "@/lib/ai-committee/agents";

export type AiCommitteeProviderStatus = {
  provider: "openai";
  configured: boolean;
  enabled: boolean;
  dryRunDefault: boolean;
  modelEnvStatus: Record<"fast" | "deep" | "final", "configured" | "missing">;
  maxCostUsdPerRunConfigured: boolean;
  autonomousEnabled: boolean;
};

export type AiCommitteeRunOptions = {
  tier: AiCommitteeModelTier;
  confirmRun?: boolean;
  dryRun?: boolean;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  maxTokens?: number;
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

function dryRunDefault(configured: boolean, enabled: boolean) {
  return envFlag("AI_COMMITTEE_DRY_RUN_DEFAULT", !(configured && enabled));
}

export function getAiCommitteeProviderStatus(): AiCommitteeProviderStatus {
  const configured = Boolean(process.env.OPENAI_API_KEY);
  const enabled = envFlag("AI_COMMITTEE_ENABLED", configured);
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
    maxCostUsdPerRunConfigured: true,
    autonomousEnabled: envFlag("AI_COMMITTEE_AUTONOMOUS", true),
  };
}

function modelForTier(tier: AiCommitteeModelTier) {
  return configuredModel(tier);
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

  console.info("AI Committee OpenAI provider run", { modelTier: options.tier, model });

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, messages: options.messages, max_tokens: options.maxTokens ?? 700, temperature: 0.2 }),
  });

  if (!response.ok) {
    return { ok: false as const, status: "provider_error" as const, httpStatus: response.status, providerStatus: status };
  }

  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return { ok: true as const, status: "completed" as const, modelTier: options.tier, model, content: data.choices?.[0]?.message?.content ?? "", providerStatus: status };
}
