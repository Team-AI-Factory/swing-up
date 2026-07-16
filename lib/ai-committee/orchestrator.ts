import { AI_COMMITTEE_AGENTS, type AiCommitteeAgentDefinition } from "@/lib/ai-committee/agents";
import { buildAiCommitteeEvidencePack, type AiCommitteeEvidencePack } from "@/lib/ai-committee/evidence-pack";
import { getAiCommitteeProviderStatus, runOpenAiCommitteeProvider } from "@/lib/ai-committee/provider";
import { persistAiCommitteeRun } from "@/lib/ai-committee/run-persistence";

export type AiCommitteeMode = "preview" | "full";
export type AgentVerdict = "positive" | "negative" | "mixed" | "needs_more_data";
export type OverallRecommendation = "approve" | "reject" | "needs_more_data";

export type RunAiCommitteeInput = {
  candidateAlertId?: string;
  alertId?: string;
  dryRun?: boolean;
  confirmRun?: boolean;
  selectedAgents?: string[];
  maxAgents?: number;
  maxCostUsd?: number;
  mode?: AiCommitteeMode;
};

export type AiCommitteeAgentResult = {
  agentId: string;
  status: "planned" | "completed" | "failed" | "blocked";
  verdict: AgentVerdict;
  confidence: number;
  keyFindings: string[];
  supportingEvidence: string[];
  concerns: string[];
  missingData: string[];
  suggestedActionLabel: string;
  riskNotes: string[];
  followUpChecks: string[];
  promptSummary?: string;
  model?: string;
  error?: string;
};

export type AiCommitteeOutput = {
  overallRecommendation: OverallRecommendation;
  suggestedActionLabel: string;
  profitPotentialScore: number | null;
  evidenceConfidenceScore: number | null;
  riskLevel: string;
  pricedInCheck: string;
  historicalPatternSummary: string;
  rippleEffectSummary: string;
  whatCouldGoWrong: string[];
  whatWouldChangeTheView: string[];
  SwingUpView: string;
  explanationDraft: string;
  complianceWarnings: string[];
  missingEvidence: string[];
  modelUsageSummary?: Record<string, unknown>;
  estimatedCost?: number;
};

const UNSAFE_WORDS = ["guaranteed", "risk-free", "can't lose", "cannot lose", "sure thing", "buy now", "get rich"];
const DEFAULT_MAX_AGENTS = 13;
const DEFAULT_MAX_COST_USD = 2;

function clampScore(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : fallback;
}

function text(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function strings(value: unknown) {
  return Array.isArray(value) ? value.map((item) => text(item)).filter(Boolean) : [];
}

function scoreValue(score: Record<string, unknown> | null | undefined, key: string) {
  const value = score?.[key];
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseJsonObject(content: string) {
  const trimmed = content.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      const parsed = JSON.parse(match[0]) as unknown;
      return isRecord(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
}

function containsUnsafeWording(output: unknown) {
  const haystack = JSON.stringify(output).toLowerCase();
  return UNSAFE_WORDS.filter((word) => haystack.includes(word));
}

function estimateAgentCost(agentCount: number, mode: AiCommitteeMode) {
  return Math.round((agentCount * (mode === "full" ? 0.08 : 0.03) + 0.05) * 100) / 100;
}

function selectAgents(input: RunAiCommitteeInput) {
  const requested = new Set((input.selectedAgents ?? []).filter((id) => id !== "final_judge"));
  const required = AI_COMMITTEE_AGENTS.filter((agent) => agent.required && agent.id !== "final_judge");
  const optional = AI_COMMITTEE_AGENTS.filter((agent) => !agent.required && agent.id !== "final_judge");
  const base = requested.size
    ? AI_COMMITTEE_AGENTS.filter((agent) => requested.has(agent.id) && agent.id !== "final_judge")
    : [...required, ...optional];
  const withRequired = [...required, ...base].filter((agent, index, all) => all.findIndex((item) => item.id === agent.id) === index);
  const compliance = AI_COMMITTEE_AGENTS.find((agent) => agent.id === "compliance_agent");
  const maxAgents = Math.max(1, Math.min(13, Math.floor(input.maxAgents ?? DEFAULT_MAX_AGENTS)));
  const limited = withRequired.slice(0, maxAgents);
  if (compliance && !limited.some((agent) => agent.id === compliance.id)) limited.push(compliance);
  return limited;
}

function summarizeEvidence(pack: AiCommitteeEvidencePack) {
  return {
    candidateAlertId: pack.candidateAlertId,
    ticker: pack.ticker,
    company: pack.company,
    eventHeadline: pack.eventHeadline,
    sourceNames: pack.sourceNames,
    sourceLinks: pack.sourceLinks.slice(0, 8),
    score: pack.score,
    missingEvidence: pack.missingEvidence,
    strengths: {
      filing: pack.filingEvidence.strength,
      news: pack.newsEvidence.strength,
      priceVolume: pack.priceVolumeEvidence.strength,
      fundamentals: pack.fundamentalsEvidence.strength,
      macro: pack.macroEvidence.strength,
      historicalPattern: pack.historicalPatternMatch.strength,
      ripple: pack.wikidataRippleRelationships.strength,
    },
  };
}

function buildAgentPrompt(agent: AiCommitteeAgentDefinition, evidencePack: AiCommitteeEvidencePack, previousResults: AiCommitteeAgentResult[], mode: AiCommitteeMode) {
  return {
    system: `You are ${agent.displayName} for Swing Up's internal AI Committee. Use only supplied evidence. No investment advice, no publishing, no hype, no fake proof. Return strict JSON only.`,
    user: JSON.stringify({ mode, agent: { id: agent.id, purpose: agent.purpose, requiredInputs: agent.inputRequirements }, expectedSchema: { agentId: agent.id, verdict: "positive|negative|mixed|needs_more_data", confidence: "0-100", keyFindings: [], supportingEvidence: [], concerns: [], missingData: [], suggestedActionLabel: "safe plain-English label", riskNotes: [], followUpChecks: [] }, evidencePack: summarizeEvidence(evidencePack), previousResults }, null, 2),
  };
}

function plannedResult(agent: AiCommitteeAgentDefinition, evidencePack: AiCommitteeEvidencePack, mode: AiCommitteeMode): AiCommitteeAgentResult {
  return { agentId: agent.id, status: "planned", verdict: evidencePack.missingEvidence.length ? "needs_more_data" : "mixed", confidence: 0, keyFindings: [`Would review ${agent.purpose}`], supportingEvidence: evidencePack.sourceLinks.slice(0, 3), concerns: evidencePack.currentRiskLabels, missingData: evidencePack.missingEvidence, suggestedActionLabel: evidencePack.actionLabel ?? "Internal review only", riskNotes: evidencePack.dataFreshnessWarnings, followUpChecks: agent.inputRequirements, promptSummary: `${agent.displayName}: ${agent.purpose} Mode=${mode}. Uses candidate ${evidencePack.candidateAlertId} evidence pack; no OpenAI call in dry run.` };
}

function normalizeAgentResult(agent: AiCommitteeAgentDefinition, parsed: Record<string, unknown>): AiCommitteeAgentResult {
  const verdict = ["positive", "negative", "mixed", "needs_more_data"].includes(text(parsed.verdict)) ? (text(parsed.verdict) as AgentVerdict) : "needs_more_data";
  return { agentId: agent.id, status: "completed", verdict, confidence: clampScore(parsed.confidence), keyFindings: strings(parsed.keyFindings), supportingEvidence: strings(parsed.supportingEvidence), concerns: strings(parsed.concerns), missingData: strings(parsed.missingData), suggestedActionLabel: text(parsed.suggestedActionLabel, "Internal review only"), riskNotes: strings(parsed.riskNotes), followUpChecks: strings(parsed.followUpChecks) };
}

function synthesizeCommitteeOutput(evidencePack: AiCommitteeEvidencePack, agentResults: AiCommitteeAgentResult[], estimatedCost: number): AiCommitteeOutput {
  const failures = agentResults.filter((result) => result.status === "failed");
  const negatives = agentResults.filter((result) => result.verdict === "negative");
  const needsData = agentResults.filter((result) => result.verdict === "needs_more_data" || result.missingData.length);
  const unsafe = containsUnsafeWording(agentResults);
  const overallRecommendation: OverallRecommendation = unsafe.length || negatives.length ? "reject" : needsData.length || failures.length || evidencePack.missingEvidence.length ? "needs_more_data" : "approve";
  return {
    overallRecommendation,
    suggestedActionLabel: evidencePack.actionLabel ?? "Internal review only",
    profitPotentialScore: scoreValue(evidencePack.score, "profitPotential"),
    evidenceConfidenceScore: scoreValue(evidencePack.score, "evidenceConfidence"),
    riskLevel: text(evidencePack.score?.riskLevel, "unknown"),
    pricedInCheck: text(evidencePack.score?.pricedInCheck, "unknown"),
    historicalPatternSummary: evidencePack.historicalPatternMatch.summary ?? "No historical pattern summary available.",
    rippleEffectSummary: evidencePack.wikidataRippleRelationships.summary ?? "No verified ripple relationship summary available.",
    whatCouldGoWrong: [...new Set(agentResults.flatMap((result) => result.concerns).concat(evidencePack.currentRiskLabels))],
    whatWouldChangeTheView: [...new Set(agentResults.flatMap((result) => result.followUpChecks))],
    SwingUpView: overallRecommendation === "approve" ? "Evidence supports continuing internal review; this is not a published recommendation." : "Do not publish; more evidence or safer wording is required.",
    explanationDraft: `Internal AI Committee draft for ${evidencePack.ticker ?? evidencePack.company ?? evidencePack.candidateAlertId}: ${evidencePack.eventHeadline ?? "candidate alert under review"}.`,
    complianceWarnings: unsafe.length ? unsafe.map((word) => `Unsafe wording blocked: ${word}`) : agentResults.find((result) => result.agentId === "compliance_agent")?.concerns ?? [],
    missingEvidence: [...new Set(evidencePack.missingEvidence.concat(agentResults.flatMap((result) => result.missingData)))],
    estimatedCost,
  };
}

export async function runAiCommittee(input: RunAiCommitteeInput) {
  const startedAt = new Date();
  const providerStatus = getAiCommitteeProviderStatus();
  const dryRun = input.dryRun ?? providerStatus.dryRunDefault;
  const mode = input.mode === "full" ? "full" : "preview";
  const candidateAlertId = text(input.candidateAlertId ?? input.alertId);
  if (!candidateAlertId) return { ok: false, status: "missing_candidate_alert_id", dryRun, error: "candidateAlertId or alertId is required." };

  if (!dryRun) {
    if (!providerStatus.configured) return { ok: false, status: "not_configured", dryRun, providerStatus };
    if (!providerStatus.enabled) return { ok: false, status: "disabled", dryRun, providerStatus };
    if (!input.confirmRun) return { ok: false, status: "confirmation_required", dryRun, providerStatus };
  }

  const evidence = await buildAiCommitteeEvidencePack(candidateAlertId).catch((error: unknown) => ({
    ok: false as const,
    dryRun: true as const,
    candidateAlertId,
    evidencePack: null,
    missingRequiredEvidence: ["evidence pack"],
    warnings: [error instanceof Error ? error.message : "Evidence pack could not be loaded."],
    readyForCommittee: false,
    error: "evidence_pack_unavailable",
  }));
  if (!evidence.ok || !evidence.evidencePack) {
    const status = evidence.error ?? "evidence_pack_missing";
    await persistAiCommitteeRun({ candidateAlertId, alertId: input.alertId ?? candidateAlertId, status, mode, dryRun, selectedAgents: [], agentResults: [], committeeOutput: null, providerStatus, startedAt, finishedAt: new Date(), error: status, request: input }).catch(() => null);
    return { ok: false, status, dryRun, evidence };
  }
  if (!dryRun && evidence.missingRequiredEvidence.length) {
    await persistAiCommitteeRun({ candidateAlertId, alertId: input.alertId ?? candidateAlertId, status: "evidence_pack_incomplete", mode, dryRun, selectedAgents: [], agentResults: [], committeeOutput: null, providerStatus, startedAt, finishedAt: new Date(), error: "evidence_pack_incomplete", request: input }).catch(() => null);
    return { ok: false, status: "evidence_pack_incomplete", dryRun, missingRequiredEvidence: evidence.missingRequiredEvidence, evidence };
  }

  const agents = selectAgents(input);
  const finalJudge = AI_COMMITTEE_AGENTS.find((agent) => agent.id === "final_judge");
  const estimatedCost = estimateAgentCost(agents.length + (finalJudge ? 1 : 0), mode);
  const maxCostUsd = input.maxCostUsd ?? Number(process.env.AI_COMMITTEE_MAX_COST_USD_PER_RUN ?? DEFAULT_MAX_COST_USD);
  if (!dryRun && estimatedCost > maxCostUsd) {
    await persistAiCommitteeRun({ candidateAlertId, alertId: input.alertId ?? candidateAlertId, status: "cost_limit_exceeded", mode, dryRun, selectedAgents: agents.map((agent) => agent.id).concat(finalJudge ? [finalJudge.id] : []), agentResults: [], committeeOutput: null, providerStatus, startedAt, finishedAt: new Date(), error: "cost_limit_exceeded", request: input }).catch(() => null);
    return { ok: false, status: "cost_limit_exceeded", dryRun, estimatedCost, maxCostUsd };
  }

  const agentResults: AiCommitteeAgentResult[] = [];
  if (dryRun) {
    agentResults.push(...agents.map((agent) => plannedResult(agent, evidence.evidencePack!, mode)));
  } else {
    for (const agent of agents) {
      const prompt = buildAgentPrompt(agent, evidence.evidencePack, agentResults, mode);
      const response = await runOpenAiCommitteeProvider({ tier: agent.modelTierPreference, confirmRun: input.confirmRun, dryRun: false, maxTokens: agent.maxOutputTokens, messages: [{ role: "system", content: prompt.system }, { role: "user", content: prompt.user }] });
      if (!response.ok) {
        agentResults.push({ ...plannedResult(agent, evidence.evidencePack, mode), status: "failed", error: response.status });
        continue;
      }
      const parsed = parseJsonObject(response.content ?? "");
      agentResults.push(parsed ? { ...normalizeAgentResult(agent, parsed), model: response.model } : { ...plannedResult(agent, evidence.evidencePack, mode), status: "failed", error: "invalid_json_response" });
    }
  }

  if (finalJudge) {
    if (dryRun) {
      agentResults.push(plannedResult(finalJudge, evidence.evidencePack, mode));
    } else {
      const prompt = buildAgentPrompt(finalJudge, evidence.evidencePack, agentResults, mode);
      const response = await runOpenAiCommitteeProvider({ tier: finalJudge.modelTierPreference, confirmRun: input.confirmRun, dryRun: false, maxTokens: finalJudge.maxOutputTokens, messages: [{ role: "system", content: prompt.system }, { role: "user", content: prompt.user }] });
      if (!response.ok) {
        agentResults.push({ ...plannedResult(finalJudge, evidence.evidencePack, mode), status: "failed", error: response.status });
      } else {
        const parsed = parseJsonObject(response.content ?? "");
        agentResults.push(parsed ? { ...normalizeAgentResult(finalJudge, parsed), model: response.model } : { ...plannedResult(finalJudge, evidence.evidencePack, mode), status: "failed", error: "invalid_json_response" });
      }
    }
  }
  const committeeOutput = synthesizeCommitteeOutput(evidence.evidencePack, agentResults, estimatedCost);
  const status = dryRun ? "dry_run" : "completed";
  const effectiveProviderStatus = dryRun ? { ...providerStatus, openAiCalled: false } : providerStatus;
  const plannedAgents = agents.map((agent) => agent.id).concat(finalJudge ? [finalJudge.id] : []);
  const persistedRun = await persistAiCommitteeRun({ candidateAlertId, alertId: input.alertId ?? candidateAlertId, status, mode, dryRun, selectedAgents: plannedAgents, agentResults, committeeOutput, providerStatus: effectiveProviderStatus, startedAt, finishedAt: new Date(), request: input }).catch(() => null);
  return { ok: true, status, dryRun, mode, providerStatus: effectiveProviderStatus, plannedAgents, evidence, agentResults, committeeOutput, persistedRunId: persistedRun?.id ?? null, compatibility: { callsOpenAi: !dryRun, publishes: false, sendsTelegram: false, writesDatabase: true } };
}
