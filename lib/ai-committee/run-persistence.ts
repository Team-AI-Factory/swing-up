import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import type { AiCommitteeAgentResult, AiCommitteeMode, AiCommitteeOutput, RunAiCommitteeInput } from "@/lib/ai-committee/orchestrator";

export type PersistAiCommitteeRunInput = {
  candidateAlertId: string;
  alertId?: string | null;
  status: string;
  mode: AiCommitteeMode;
  dryRun: boolean;
  selectedAgents: string[];
  agentResults: AiCommitteeAgentResult[];
  committeeOutput?: AiCommitteeOutput | null;
  providerStatus?: Record<string, unknown> | null;
  startedAt: Date;
  finishedAt: Date;
  error?: string | null;
  request?: RunAiCommitteeInput;
};

function uniqueStrings(values: unknown[]) {
  return [...new Set(values.filter((value): value is string => typeof value === "string" && value.trim().length > 0).map((value) => value.trim()))];
}

function modelProvider(providerStatus: Record<string, unknown> | null | undefined) {
  if (!providerStatus) return "unknown";
  if (providerStatus.configured || providerStatus.enabled) return "openai";
  return "stub";
}

function jsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? {})) as Prisma.InputJsonValue;
}

function estimatedCostCents(output: AiCommitteeOutput | null | undefined) {
  const cost = output?.estimatedCost;
  return typeof cost === "number" && Number.isFinite(cost) ? Math.max(0, Math.round(cost * 100)) : 0;
}

export async function persistAiCommitteeRun(input: PersistAiCommitteeRunInput) {
  const modelNames = uniqueStrings(input.agentResults.map((result) => result.model));
  const provider = modelProvider(input.providerStatus);
  const run = await prisma.aiCommitteeRun.create({
    data: {
      candidateAlertId: input.candidateAlertId,
      alertId: input.alertId ?? input.candidateAlertId,
      status: input.status,
      runMode: input.mode,
      dryRun: input.dryRun,
      agentIds: jsonValue(input.selectedAgents),
      finalRecommendation: input.committeeOutput?.overallRecommendation ?? null,
      selectedActionLabel: input.committeeOutput?.suggestedActionLabel ?? null,
      scoreOutputs: jsonValue({
        profitPotentialScore: input.committeeOutput?.profitPotentialScore ?? null,
        evidenceConfidenceScore: input.committeeOutput?.evidenceConfidenceScore ?? null,
        pricedInCheck: input.committeeOutput?.pricedInCheck ?? null,
      }),
      riskLevel: input.committeeOutput?.riskLevel ?? null,
      complianceWarnings: jsonValue(input.committeeOutput?.complianceWarnings ?? []),
      missingData: jsonValue(input.committeeOutput?.missingEvidence ?? []),
      modelProvider: provider,
      modelNames: jsonValue(modelNames),
      tokenEstimate: null,
      estimatedCostCents: estimatedCostCents(input.committeeOutput),
      output: jsonValue(input.committeeOutput ?? {}),
      request: jsonValue(input.request ?? {}),
      startedAt: input.startedAt,
      finishedAt: input.finishedAt,
      error: input.error ?? null,
      agentResults: {
        create: input.agentResults.map((result) => ({
          agentId: result.agentId,
          status: result.status,
          verdict: result.verdict,
          confidence: result.confidence,
          missingData: jsonValue(result.missingData),
          keyFindings: jsonValue(result.keyFindings),
          concerns: jsonValue(result.concerns),
          suggestedActionLabel: result.suggestedActionLabel,
          modelProvider: provider,
          modelName: result.model ?? null,
          tokenEstimate: null,
          estimatedCostCents: 0,
          output: jsonValue(result),
          error: result.error ?? null,
        })),
      },
    },
    include: { agentResults: true },
  });

  return run;
}
