import { AI_COMMITTEE_AGENTS, type AiCommitteeAgentDefinition } from "@/lib/ai-committee/agents";
import { buildAiCommitteeEvidencePack, type AiCommitteeEvidencePack } from "@/lib/ai-committee/evidence-pack";
import { getAiCommitteeProviderStatus, runOpenAiCommitteeProvider, type AiCommitteeTokenUsage } from "@/lib/ai-committee/provider";
import { persistAiCommitteeRun } from "@/lib/ai-committee/run-persistence";

export type AiCommitteeMode = "preview" | "full";
export type AgentVerdict = "positive" | "negative" | "mixed" | "needs_more_data";
export type OverallRecommendation = "approve" | "reject" | "needs_more_data";
export const TRUSTED_IN_MEMORY_EVIDENCE = Symbol("trusted-in-memory-ai-committee-evidence");

export type RunAiCommitteeInput = {
  candidateAlertId?: string;
  alertId?: string;
  dryRun?: boolean;
  confirmRun?: boolean;
  selectedAgents?: string[];
  maxAgents?: number;
  maxCostUsd?: number;
  mode?: AiCommitteeMode;
  persistResult?: boolean;
  [TRUSTED_IN_MEMORY_EVIDENCE]?: AiCommitteeEvidencePack;
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
  tokenUsage?: AiCommitteeTokenUsage;
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

const DIGITAL_ASSET_TICKERS = new Set(["BTC", "ETH", "USDT", "BNB", "SOL", "USDC", "XRP", "DOGE", "ADA", "AVAX", "LINK", "DOT", "MATIC", "LTC", "BCH"]);
const DIGITAL_ASSET_MARKERS = /\b(crypto|cryptocurrency|digital asset|token|blockchain|coinbase|coingecko|bitcoin|ethereum|stablecoin|defi|web3)\b/i;
const OPTIONAL_FOLLOW_UP_MARKERS = /\b(optional|nice[- ]to[- ]have|if available|when available|follow[- ]?up|non[- ]blocking|not required|not applicable|n\/?a)\b/i;
const OPTIONAL_DISCOVERY_PROVIDER_MARKERS: Array<[string, RegExp]> = [
  ["gdelt", /\bgdelt\b/i],
  ["marketaux", /\bmarketaux\b/i],
  ["alpha_vantage", /\balpha[ _-]?vantage\b/i],
  ["fmp_crypto_news", /\b(?:fmp|financial modeling prep)(?: crypto news)?\b/i],
];
const PROVIDER_UNAVAILABLE_MARKERS = /\b(unavailable|missing|failed|failure|timeout|timed out|rate[- ]?limit(?:ed)?|cooldown|not responding|not connected)\b/i;

type CommitteeEvidencePolicy = {
  assetClass: "digital_asset" | "company_or_other";
  blockingMissingEvidence: string[];
  nonBlockingFollowUps: string[];
  nonApplicableAgentIds: Set<string>;
  newsDiscoveryChannels: number;
  newsPublishers: number;
  newsDiscoveryQuorumMet: boolean;
};

function newsEvidenceDiversity(pack: AiCommitteeEvidencePack) {
  const channels = new Set(pack.newsEvidence.items.map((item) => text(item.discoveryChannel ?? item.channel)).filter(Boolean));
  const publishers = new Set(pack.newsEvidence.items.map((item) => text(item.publisher ?? item.source)).filter(Boolean));
  return { channels: channels.size, publishers: publishers.size, quorumMet: channels.size >= 2 && publishers.size >= 3 };
}

function optionalDiscoveryProviderName(item: string) {
  if (!PROVIDER_UNAVAILABLE_MARKERS.test(item)) return null;
  return OPTIONAL_DISCOVERY_PROVIDER_MARKERS.find(([, pattern]) => pattern.test(item))?.[0] ?? null;
}

function oneOptionalProviderGapCanBeNonBlocking(items: string[], diversity: { quorumMet: boolean }) {
  const gaps = new Set(items.map(optionalDiscoveryProviderName).filter((value): value is string => Boolean(value)));
  return diversity.quorumMet && gaps.size === 1;
}

function eventText(pack: AiCommitteeEvidencePack) {
  return [pack.ticker, pack.company, pack.eventHeadline, pack.whatHappened, ...pack.sourceNames].filter(Boolean).join(" ");
}

function isDigitalAssetEvidence(pack: AiCommitteeEvidencePack) {
  const ticker = text(pack.ticker).toUpperCase().replace(/[^A-Z0-9]/g, "");
  const baseTicker = ticker.replace(/(?:USD|USDT|USDC|EUR|GBP)$/, "");
  const cryptoSectionText = pack.cryptoFxEvidence.available ? `${pack.cryptoFxEvidence.summary ?? ""} ${JSON.stringify(pack.cryptoFxEvidence.items)}` : "";
  return DIGITAL_ASSET_TICKERS.has(ticker) || DIGITAL_ASSET_TICKERS.has(baseTicker) || DIGITAL_ASSET_MARKERS.test(eventText(pack)) || DIGITAL_ASSET_MARKERS.test(cryptoSectionText);
}

function committeeEvidencePolicy(pack: AiCommitteeEvidencePack): CommitteeEvidencePolicy {
  const diversity = newsEvidenceDiversity(pack);
  if (!isDigitalAssetEvidence(pack)) {
    return { assetClass: "company_or_other", blockingMissingEvidence: pack.missingEvidence, nonBlockingFollowUps: [], nonApplicableAgentIds: new Set(), newsDiscoveryChannels: diversity.channels, newsPublishers: diversity.publishers, newsDiscoveryQuorumMet: diversity.quorumMet };
  }

  const context = [pack.eventHeadline, pack.whatHappened, pack.newsEvidence.summary, ...pack.newsEvidence.items.map((item) => text(item.summary ?? item.title))].filter(Boolean).join(" ");
  const filingEvent = /\b(filing|form (?:4|8-k|10-k|10-q|13[df]|s-[13])|prospectus|issuer disclosure|corporate disclosure)\b/i.test(context);
  const companyFundamentalsEvent = /\b(earnings|revenue|margin|guidance|balance sheet|cash flow|corporate debt|company valuation|issuer valuation|dcf|shares? outstanding)\b/i.test(context);
  const medicalEvent = /\b(fda|food and drug administration|drug|device|clinical trial|biotech|pharma)\b/i.test(context);
  const shortPressureEvent = /\b(finra|short interest|short volume|short squeeze|securities lending)\b/i.test(context);
  const macroEvent = /\b(federal reserve|central bank|interest rates?|rate cut|rate hike|inflation|cpi|pce|liquidity|foreign exchange|fx|dollar index|dxy)\b/i.test(context);
  const nonApplicableEvidence = new Set<string>([
    ...(!filingEvent ? ["filingEvidence"] : []),
    ...(!companyFundamentalsEvent ? ["fundamentalsEvidence"] : []),
    ...(!medicalEvent ? ["fdaRegulatoryEvidence"] : []),
    ...(!shortPressureEvent ? ["finraShortPressureEvidence"] : []),
  ]);
  const alwaysNonBlocking = new Set([...(!macroEvent ? ["macroEvidence"] : []), "wikidataRippleRelationships", "historicalPatternMatch", "previousSimilarOutcomes"]);
  const allowOptionalProviderGap = oneOptionalProviderGapCanBeNonBlocking(pack.missingEvidence, diversity);
  const nonBlocking = pack.missingEvidence.filter((item) => nonApplicableEvidence.has(item) || alwaysNonBlocking.has(item) || (allowOptionalProviderGap && Boolean(optionalDiscoveryProviderName(item))));
  const nonApplicableAgentIds = new Set<string>([
    ...(!filingEvent ? ["filing_agent"] : []),
    ...(!companyFundamentalsEvent ? ["accountant_agent", "valuation_dcf_agent"] : []),
  ]);
  return {
    assetClass: "digital_asset",
    blockingMissingEvidence: pack.missingEvidence.filter((item) => !nonApplicableEvidence.has(item) && !alwaysNonBlocking.has(item) && !(allowOptionalProviderGap && Boolean(optionalDiscoveryProviderName(item)))),
    nonBlockingFollowUps: nonBlocking,
    nonApplicableAgentIds,
    newsDiscoveryChannels: diversity.channels,
    newsPublishers: diversity.publishers,
    newsDiscoveryQuorumMet: diversity.quorumMet,
  };
}

function isNonBlockingMissingItem(item: string, policy: CommitteeEvidencePolicy, allowOptionalProviderGap = false) {
  if (optionalDiscoveryProviderName(item)) return allowOptionalProviderGap && policy.newsDiscoveryQuorumMet;
  if (OPTIONAL_FOLLOW_UP_MARKERS.test(item)) return true;
  const matchers: Record<string, RegExp> = {
    filingEvidence: /\b(corporate filing|issuer filing|form (?:4|8-k|10-k|10-q|13[df]|s-[13])|prospectus)\b/i,
    fundamentalsEvidence: /\b(accounting|earnings|revenue|margin|guidance|balance sheet|cash flow|dcf|company fundamentals?|company valuation)\b/i,
    fdaRegulatoryEvidence: /\b(fda|food and drug administration|clinical trial|drug|medical device)\b/i,
    finraShortPressureEvidence: /\b(finra|short interest|short volume|securities lending)\b/i,
    macroEvidence: /\b(macro|interest rates?|inflation|cpi|pce|fred|foreign exchange|fx context|dollar index|dxy)\b/i,
    wikidataRippleRelationships: /\b(wikidata|ripple relationship|entity relationship)\b/i,
    historicalPatternMatch: /\b(historical pattern|pattern match|backtest)\b/i,
    previousSimilarOutcomes: /\b(previous outcome|prior outcome|similar outcome|outcome history)\b/i,
  };
  return policy.nonBlockingFollowUps.some((label) => label === item || matchers[label]?.test(item));
}

function isExplicitlyAlignedNewsItem(item: Record<string, unknown>) {
  return item.alignedWithMarketDirection === true;
}

function isExplicitlyContradictoryNewsItem(item: Record<string, unknown>) {
  const catalystDirection = text(item.catalystDirection);
  return item.contradiction === true || item.contradictsMarketDirection === true || (item.alignedWithMarketDirection === false && (catalystDirection === "upside" || catalystDirection === "downside"));
}

function prioritizedNewsEvidence(items: Array<Record<string, unknown>>) {
  const aligned = items.filter(isExplicitlyAlignedNewsItem);
  const contradictions = items.filter((item) => !isExplicitlyAlignedNewsItem(item) && isExplicitlyContradictoryNewsItem(item));
  const context = items.filter((item) => !aligned.includes(item) && !contradictions.includes(item));
  return { aligned, contradictions, ordered: [...aligned, ...contradictions, ...context] };
}

function summarizeEvidence(pack: AiCommitteeEvidencePack) {
  const policy = committeeEvidencePolicy(pack);
  const prioritizedNews = prioritizedNewsEvidence(pack.newsEvidence.items);
  return {
    candidateAlertId: pack.candidateAlertId,
    ticker: pack.ticker,
    company: pack.company,
    eventHeadline: pack.eventHeadline,
    whatHappened: pack.whatHappened,
    sourceNames: pack.sourceNames,
    sourceLinks: pack.sourceLinks.slice(0, 8),
    score: pack.score,
    assetContext: {
      assetClass: policy.assetClass,
      primaryAnalysis: policy.assetClass === "digital_asset" ? ["verified event evidence", "token market structure", "price/volume reaction", "liquidity and supply structure", "macro/FX context when relevant"] : ["verified event evidence", "company fundamentals", "price/volume reaction"],
      nonApplicableUnlessEventSpecific: policy.assetClass === "digital_asset" ? ["corporate filings", "accounting metrics", "DCF", "FDA", "FINRA short data"] : [],
    },
    evidenceDiversity: { discoveryChannels: policy.newsDiscoveryChannels, uniquePublishers: policy.newsPublishers, multiChannelPublisherQuorumMet: policy.newsDiscoveryQuorumMet },
    evidencePriority: {
      proposedDirection: text(pack.score?.direction, pack.actionLabel ?? "unknown"),
      alignedCatalystReceipts: prioritizedNews.aligned.slice(0, 5),
      contradictoryCatalystReceipts: prioritizedNews.contradictions.slice(0, 5),
      marketConfirmation: pack.priceVolumeEvidence.items.slice(0, 3),
      instruction: "Judge only the supplied receipts and market facts; an empty list is not evidence.",
    },
    missingEvidence: policy.blockingMissingEvidence,
    nonBlockingFollowUps: policy.nonBlockingFollowUps,
    strengths: {
      filing: pack.filingEvidence.strength,
      news: pack.newsEvidence.strength,
      priceVolume: pack.priceVolumeEvidence.strength,
      fundamentals: pack.fundamentalsEvidence.strength,
      macro: pack.macroEvidence.strength,
      historicalPattern: pack.historicalPatternMatch.strength,
      ripple: pack.wikidataRippleRelationships.strength,
    },
    evidenceSections: {
      filing: { summary: pack.filingEvidence.summary, items: pack.filingEvidence.items.slice(0, 3) },
      news: { summary: pack.newsEvidence.summary, items: prioritizedNews.ordered.slice(0, 8) },
      priceVolume: { summary: pack.priceVolumeEvidence.summary, items: pack.priceVolumeEvidence.items.slice(0, 3) },
      fundamentals: { summary: pack.fundamentalsEvidence.summary, items: pack.fundamentalsEvidence.items.slice(0, 3) },
      macro: { summary: pack.macroEvidence.summary, items: pack.macroEvidence.items.slice(0, 3) },
      cryptoFx: { summary: pack.cryptoFxEvidence.summary, items: pack.cryptoFxEvidence.items.slice(0, 3) },
      historical: { summary: pack.historicalPatternMatch.summary, items: pack.historicalPatternMatch.items.slice(0, 3) },
    },
  };
}

function buildAgentPrompt(agent: AiCommitteeAgentDefinition, evidencePack: AiCommitteeEvidencePack, previousResults: AiCommitteeAgentResult[], mode: AiCommitteeMode) {
  const policy = committeeEvidencePolicy(evidencePack);
  const digitalAssetInstructions = policy.assetClass === "digital_asset"
    ? "This candidate is a digital asset. Treat verified event receipts, token market structure, price/volume reaction, liquidity, circulating/max supply, dilution/FDV, volatility and macro/FX context as the primary evidence. Corporate filings, accounting metrics, DCF, FDA evidence and FINRA short data are N/A unless the supplied event is specifically about one of them. Never penalize the candidate or request data merely because an N/A corporate section is absent."
    : "Apply the supplied company/asset evidence according to the agent role.";
  const discoveryProviderInstructions = policy.newsDiscoveryQuorumMet
    ? `The supplied evidence already contains receipts from ${policy.newsDiscoveryChannels} discovery channels and ${policy.newsPublishers} unique publishers. One unavailable optional discovery provider (GDELT, Marketaux, Alpha Vantage, or FMP Crypto News) is a non-blocking follow-up; two or more unavailable providers, or missing receipt diversity itself, may still be blocking.`
    : "Do not waive missing discovery evidence: the supplied receipts do not yet prove a two-channel, three-publisher quorum.";
  const finalJudgeInstructions = agent.id === "final_judge"
    ? "As Final Judge, explicitly confirm that whatHappened, the proposed direction, direction-aligned catalyst receipts, and price/volume reaction tell a consistent story. Prioritize supplied aligned evidence and explicit contradictions. Return positive only when that direction and catalyst context are supported; mixed votes, silence, provider connectivity, and absent contradictions are not proof."
    : "Evaluate the proposed direction against the supplied aligned evidence and explicit contradictions that apply to your role.";
  return {
    system: `You are ${agent.displayName} for Swing Up's internal AI Committee. Use only supplied evidence. No investment advice, no publishing, no hype, no fake proof. ${digitalAssetInstructions} ${discoveryProviderInstructions} ${finalJudgeInstructions} Put only evidence that is truly required to validate or reject this candidate in missingData. Put optional, nice-to-have, N/A, or future confirmation work in followUpChecks; those items must not cause needs_more_data. A negative verdict must be based on an actual adverse or contradictory finding in the supplied evidence, never on an irrelevant section being absent. Return strict JSON only.`,
    user: JSON.stringify({ mode, agent: { id: agent.id, purpose: agent.purpose, requiredInputs: agent.inputRequirements, applicability: policy.nonApplicableAgentIds.has(agent.id) ? "n/a_unless_event_specific" : "applicable" }, decisionRules: { directionAndCatalyst: "Confirm the proposed direction against whatHappened, aligned catalyst receipts, price/volume confirmation, and explicit contradictions. Never infer proof from an empty list.", discoveryProviderGap: "Exactly one unavailable optional discovery provider is non-blocking only when the supplied evidence itself proves at least two discovery channels and three unique publishers.", missingData: "Only truly blocking evidence absent from the current candidate. Use [] for N/A or optional evidence.", followUpChecks: "Non-blocking checks that may improve confidence later.", needsMoreData: "Use only when missingData contains at least one genuinely blocking item.", negative: "Use only for an actual adverse or contradictory finding supported by supplied evidence." }, expectedSchema: { agentId: agent.id, verdict: "positive|negative|mixed|needs_more_data", confidence: "0-100", keyFindings: [], supportingEvidence: [], concerns: [], missingData: [], suggestedActionLabel: "safe plain-English label", riskNotes: [], followUpChecks: [] }, evidencePack: summarizeEvidence(evidencePack), previousResults }, null, 2),
  };
}

function plannedResult(agent: AiCommitteeAgentDefinition, evidencePack: AiCommitteeEvidencePack, mode: AiCommitteeMode): AiCommitteeAgentResult {
  const policy = committeeEvidencePolicy(evidencePack);
  const nonApplicable = policy.nonApplicableAgentIds.has(agent.id);
  return { agentId: agent.id, status: "planned", verdict: policy.blockingMissingEvidence.length && !nonApplicable ? "needs_more_data" : "mixed", confidence: 0, keyFindings: [nonApplicable ? `${agent.purpose} N/A for this digital-asset event unless event-specific evidence appears.` : `Would review ${agent.purpose}`], supportingEvidence: evidencePack.sourceLinks.slice(0, 3), concerns: evidencePack.currentRiskLabels, missingData: nonApplicable ? [] : policy.blockingMissingEvidence, suggestedActionLabel: evidencePack.actionLabel ?? "Internal review only", riskNotes: evidencePack.dataFreshnessWarnings, followUpChecks: [...agent.inputRequirements, ...policy.nonBlockingFollowUps], promptSummary: `${agent.displayName}: ${agent.purpose} Mode=${mode}. Asset class=${policy.assetClass}. Uses candidate ${evidencePack.candidateAlertId} evidence pack; no OpenAI call in dry run.` };
}

function normalizeAgentResult(agent: AiCommitteeAgentDefinition, parsed: Record<string, unknown>, evidencePack: AiCommitteeEvidencePack): AiCommitteeAgentResult {
  const policy = committeeEvidencePolicy(evidencePack);
  const verdictValue = text(parsed.verdict);
  const recognizedVerdict = ["positive", "negative", "mixed", "needs_more_data"].includes(verdictValue);
  const parsedVerdict = recognizedVerdict ? (verdictValue as AgentVerdict) : "needs_more_data";
  const rawMissingData = strings(parsed.missingData);
  const allowOptionalProviderGap = oneOptionalProviderGapCanBeNonBlocking(rawMissingData, { quorumMet: policy.newsDiscoveryQuorumMet });
  const explicitlyOptional = rawMissingData.filter((item) => isNonBlockingMissingItem(item, policy, allowOptionalProviderGap));
  const nonApplicable = policy.nonApplicableAgentIds.has(agent.id);
  const missingData = nonApplicable ? [] : rawMissingData.filter((item) => !isNonBlockingMissingItem(item, policy, allowOptionalProviderGap));
  const verdict = parsedVerdict === "negative" ? "negative" : recognizedVerdict && parsedVerdict === "needs_more_data" && !missingData.length ? "mixed" : parsedVerdict;
  return { agentId: agent.id, status: "completed", verdict, confidence: clampScore(parsed.confidence), keyFindings: strings(parsed.keyFindings), supportingEvidence: strings(parsed.supportingEvidence), concerns: strings(parsed.concerns), missingData, suggestedActionLabel: text(parsed.suggestedActionLabel, "Internal review only"), riskNotes: strings(parsed.riskNotes), followUpChecks: [...new Set(strings(parsed.followUpChecks).concat(explicitlyOptional, nonApplicable ? rawMissingData : []))] };
}

export type CommitteeConsensusDecision = {
  overallRecommendation: OverallRecommendation;
  reasons: string[];
  finalJudgePositive: boolean;
  finalJudgeConfidence: number;
  positiveConsensusCount: number;
  applicableCompletedCount: number;
  requiredPositiveCount: number;
  unsafeWords: string[];
};

export function committeeConsensusDecision(
  agentResults: AiCommitteeAgentResult[],
  options: { blockingMissingEvidence?: string[]; nonApplicableAgentIds?: ReadonlySet<string> } = {},
): CommitteeConsensusDecision {
  const blockingMissingEvidence = options.blockingMissingEvidence ?? [];
  const nonApplicableAgentIds = options.nonApplicableAgentIds ?? new Set<string>();
  const unsafeWords = containsUnsafeWording(agentResults);
  const negatives = agentResults.filter((result) => result.verdict === "negative");
  const failedOrBlocked = agentResults.filter((result) => result.status === "failed" || result.status === "blocked");
  const needsData = agentResults.filter((result) => result.verdict === "needs_more_data" || result.missingData.length > 0);
  const finalJudge = agentResults.find((result) => result.agentId === "final_judge");
  const finalJudgeConfidence = finalJudge?.confidence ?? 0;
  const finalJudgePositive = finalJudge?.status === "completed" && finalJudge.verdict === "positive" && finalJudgeConfidence >= 70;
  const applicableCompleted = agentResults.filter((result) => result.agentId !== "final_judge" && result.status === "completed" && !nonApplicableAgentIds.has(result.agentId));
  const positiveConsensusCount = applicableCompleted.filter((result) => result.verdict === "positive" && result.confidence >= 60).length;
  const requiredPositiveCount = Math.max(4, Math.ceil(applicableCompleted.length * 0.4));
  const meaningfulPositiveConsensus = applicableCompleted.length >= 4 && positiveConsensusCount >= requiredPositiveCount;
  const reasons: string[] = [];

  if (unsafeWords.length) reasons.push("unsafe_wording");
  if (negatives.length) reasons.push("negative_finding");
  if (failedOrBlocked.length) reasons.push("agent_failed_or_blocked");
  if (needsData.length) reasons.push("blocking_agent_missing_data");
  if (blockingMissingEvidence.length) reasons.push("blocking_pack_missing_evidence");
  if (!finalJudgePositive) reasons.push("final_judge_not_positive_at_70");
  if (!meaningfulPositiveConsensus) reasons.push("insufficient_positive_consensus");

  const overallRecommendation: OverallRecommendation = unsafeWords.length || negatives.length
    ? "reject"
    : failedOrBlocked.length || needsData.length || blockingMissingEvidence.length || !finalJudgePositive || !meaningfulPositiveConsensus
      ? "needs_more_data"
      : "approve";
  return { overallRecommendation, reasons, finalJudgePositive, finalJudgeConfidence, positiveConsensusCount, applicableCompletedCount: applicableCompleted.length, requiredPositiveCount, unsafeWords };
}

function synthesizeCommitteeOutput(evidencePack: AiCommitteeEvidencePack, agentResults: AiCommitteeAgentResult[], estimatedCost: number): AiCommitteeOutput {
  const policy = committeeEvidencePolicy(evidencePack);
  const consensus = committeeConsensusDecision(agentResults, { blockingMissingEvidence: policy.blockingMissingEvidence, nonApplicableAgentIds: policy.nonApplicableAgentIds });
  const overallRecommendation = consensus.overallRecommendation;
  const usageResults = agentResults.filter((result) => result.tokenUsage);
  const actualTokens = usageResults.reduce((total, result) => ({
    promptTokens: total.promptTokens + (result.tokenUsage?.promptTokens ?? 0),
    completionTokens: total.completionTokens + (result.tokenUsage?.completionTokens ?? 0),
    totalTokens: total.totalTokens + (result.tokenUsage?.totalTokens ?? 0),
    cachedPromptTokens: total.cachedPromptTokens + (result.tokenUsage?.cachedPromptTokens ?? 0),
  }), { promptTokens: 0, completionTokens: 0, totalTokens: 0, cachedPromptTokens: 0 });
  const usageByModel = usageResults.reduce<Record<string, AiCommitteeTokenUsage & { responses: number }>>((summary, result) => {
    const model = result.model ?? "unknown";
    const current = summary[model] ?? { promptTokens: 0, completionTokens: 0, totalTokens: 0, cachedPromptTokens: 0, responses: 0 };
    const usage = result.tokenUsage!;
    summary[model] = {
      promptTokens: current.promptTokens + usage.promptTokens,
      completionTokens: current.completionTokens + usage.completionTokens,
      totalTokens: current.totalTokens + usage.totalTokens,
      cachedPromptTokens: current.cachedPromptTokens + usage.cachedPromptTokens,
      responses: current.responses + 1,
    };
    return summary;
  }, {});
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
    whatWouldChangeTheView: [...new Set(agentResults.flatMap((result) => result.followUpChecks).concat(policy.nonBlockingFollowUps))],
    SwingUpView: overallRecommendation === "approve" ? "Evidence supports continuing internal review; this is not a published recommendation." : "Do not publish; more evidence or safer wording is required.",
    explanationDraft: `Internal AI Committee draft for ${evidencePack.ticker ?? evidencePack.company ?? evidencePack.candidateAlertId}: ${evidencePack.eventHeadline ?? "candidate alert under review"}.`,
    complianceWarnings: consensus.unsafeWords.length ? consensus.unsafeWords.map((word) => `Unsafe wording blocked: ${word}`) : agentResults.find((result) => result.agentId === "compliance_agent")?.concerns ?? [],
    missingEvidence: [...new Set(policy.blockingMissingEvidence.concat(agentResults.flatMap((result) => result.missingData)))],
    modelUsageSummary: {
      actualOpenAiUsage: { responsesWithUsage: usageResults.length, tokens: actualTokens, byModel: usageByModel },
      consensus: { reasons: consensus.reasons, finalJudgePositive: consensus.finalJudgePositive, finalJudgeConfidence: consensus.finalJudgeConfidence, positiveConsensusCount: consensus.positiveConsensusCount, applicableCompletedCount: consensus.applicableCompletedCount, requiredPositiveCount: consensus.requiredPositiveCount },
    },
    estimatedCost,
  };
}

export async function runAiCommittee(input: RunAiCommitteeInput) {
  const startedAt = new Date();
  const persistResult = input.persistResult !== false;
  const trustedEvidencePack = input[TRUSTED_IN_MEMORY_EVIDENCE];
  const providerStatus = getAiCommitteeProviderStatus();
  const dryRun = input.dryRun ?? providerStatus.dryRunDefault;
  const mode = input.mode === "full" ? "full" : "preview";
  const candidateAlertId = text(input.candidateAlertId ?? input.alertId ?? trustedEvidencePack?.candidateAlertId);
  if (!candidateAlertId) return { ok: false, status: "missing_candidate_alert_id", dryRun, error: "candidateAlertId or alertId is required." };

  const evidence = trustedEvidencePack ? {
    ok: true as const,
    dryRun: true as const,
    candidateAlertId,
    evidencePack: trustedEvidencePack,
    missingRequiredEvidence: committeeEvidencePolicy(trustedEvidencePack).blockingMissingEvidence,
    warnings: trustedEvidencePack.dataFreshnessWarnings,
    readyForCommittee: committeeEvidencePolicy(trustedEvidencePack).blockingMissingEvidence.length === 0,
  } : await buildAiCommitteeEvidencePack(candidateAlertId).catch((error: unknown) => ({
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
    if (persistResult) await persistAiCommitteeRun({ candidateAlertId, alertId: input.alertId ?? candidateAlertId, status, mode, dryRun, selectedAgents: [], agentResults: [], committeeOutput: null, providerStatus, startedAt, finishedAt: new Date(), error: status, request: input }).catch(() => null);
    return { ok: false, status, dryRun, evidence };
  }
  if (!dryRun) {
    if (!providerStatus.configured) return { ok: false, status: "not_configured", dryRun, providerStatus };
    if (!providerStatus.enabled) return { ok: false, status: "disabled", dryRun, providerStatus };
    if (!input.confirmRun) return { ok: false, status: "confirmation_required", dryRun, providerStatus };
  }
  if (!dryRun && evidence.missingRequiredEvidence.length) {
    if (persistResult) await persistAiCommitteeRun({ candidateAlertId, alertId: input.alertId ?? candidateAlertId, status: "evidence_pack_incomplete", mode, dryRun, selectedAgents: [], agentResults: [], committeeOutput: null, providerStatus, startedAt, finishedAt: new Date(), error: "evidence_pack_incomplete", request: input }).catch(() => null);
    return { ok: false, status: "evidence_pack_incomplete", dryRun, missingRequiredEvidence: evidence.missingRequiredEvidence, evidence };
  }

  const agents = selectAgents(input);
  const finalJudge = AI_COMMITTEE_AGENTS.find((agent) => agent.id === "final_judge");
  const estimatedCost = estimateAgentCost(agents.length + (finalJudge ? 1 : 0), mode);
  const maxCostUsd = input.maxCostUsd ?? Number(process.env.AI_COMMITTEE_MAX_COST_USD_PER_RUN ?? DEFAULT_MAX_COST_USD);
  if (!dryRun && estimatedCost > maxCostUsd) {
    if (persistResult) await persistAiCommitteeRun({ candidateAlertId, alertId: input.alertId ?? candidateAlertId, status: "cost_limit_exceeded", mode, dryRun, selectedAgents: agents.map((agent) => agent.id).concat(finalJudge ? [finalJudge.id] : []), agentResults: [], committeeOutput: null, providerStatus, startedAt, finishedAt: new Date(), error: "cost_limit_exceeded", request: input }).catch(() => null);
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
      agentResults.push(parsed
        ? { ...normalizeAgentResult(agent, parsed, evidence.evidencePack), model: response.model, tokenUsage: response.tokenUsage }
        : { ...plannedResult(agent, evidence.evidencePack, mode), status: "failed", model: response.model, tokenUsage: response.tokenUsage, error: "invalid_json_response" });
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
        agentResults.push(parsed
          ? { ...normalizeAgentResult(finalJudge, parsed, evidence.evidencePack), model: response.model, tokenUsage: response.tokenUsage }
          : { ...plannedResult(finalJudge, evidence.evidencePack, mode), status: "failed", model: response.model, tokenUsage: response.tokenUsage, error: "invalid_json_response" });
      }
    }
  }
  const committeeOutput = synthesizeCommitteeOutput(evidence.evidencePack, agentResults, estimatedCost);
  const status = dryRun ? "dry_run" : "completed";
  const effectiveProviderStatus = dryRun ? { ...providerStatus, openAiCalled: false } : providerStatus;
  const plannedAgents = agents.map((agent) => agent.id).concat(finalJudge ? [finalJudge.id] : []);
  const persistedRun = persistResult ? await persistAiCommitteeRun({ candidateAlertId, alertId: input.alertId ?? candidateAlertId, status, mode, dryRun, selectedAgents: plannedAgents, agentResults, committeeOutput, providerStatus: effectiveProviderStatus, startedAt, finishedAt: new Date(), request: input }).catch(() => null) : null;
  return { ok: true, status, dryRun, mode, providerStatus: effectiveProviderStatus, plannedAgents, evidence, agentResults, committeeOutput, persistedRunId: persistedRun?.id ?? null, compatibility: { callsOpenAi: !dryRun, publishes: false, sendsTelegram: false, writesDatabase: persistResult } };
}
