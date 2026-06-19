import { buildCommitteeQueue, type AiCommitteeCandidateInput, type AiCommitteeQueueItem } from "@/lib/ai-committee-queue";
import { previewMiniAiScan, type MiniAiScanInput, type MiniAiScanOutput } from "@/lib/mini-ai-scan";
import { evaluateRuleFilter, mockRuleFilterInput, type RuleFilterInput, type RuleFilterResult } from "@/lib/rule-filter";

export type PipelineMode = "mock" | "supplied_payload" | "live_candidate_if_available";
export type FinalPipelineDecision = "reject" | "needs_more_data" | "committee_ready";

type SkippedStage = {
  ok: true;
  skipped: true;
  reason: string;
};

export type PipelinePreviewOutput = {
  ok: true;
  pipelineMode: PipelineMode;
  rawSignalSummary: {
    rawSignalId: string | null;
    title: string | null;
    ticker: string | null;
    company: string | null;
    source: string | null;
    url: string | null;
    eventType: string | null;
    receiptsCount: number;
  };
  ruleFilterResult: RuleFilterResult;
  miniAiScanResult: MiniAiScanOutput | SkippedStage;
  committeeQueueReadiness: AiCommitteeQueueItem | SkippedStage;
  finalPipelineDecision: FinalPipelineDecision;
  rejectionReasons: string[];
  warnings: string[];
  simpleExplanation: string;
};

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function receiptItems(input: RuleFilterInput) {
  if (Array.isArray(input.receipts)) return input.receipts;
  if (Array.isArray(input.receiptUrls)) return input.receiptUrls.map((url) => ({ url }));
  const count = numberValue(input.receipts) ?? 0;
  return Array.from({ length: Math.max(0, Math.round(count)) }, (_, index) => ({ label: `Receipt ${index + 1}` }));
}

function summarizeRawSignal(input: RuleFilterInput, ruleFilterResult: RuleFilterResult): PipelinePreviewOutput["rawSignalSummary"] {
  const receipts = receiptItems(input);
  return {
    rawSignalId: text((input as { rawSignalId?: unknown }).rawSignalId) || null,
    title: text(input.title) || null,
    ticker: ruleFilterResult.detectedTicker,
    company: ruleFilterResult.detectedCompany,
    source: text(input.source) || null,
    url: text(input.url) || null,
    eventType: ruleFilterResult.detectedEventType,
    receiptsCount: receipts.length,
  };
}

function miniInputFromRawSignal(input: RuleFilterInput, ruleFilterResult: RuleFilterResult): MiniAiScanInput {
  return {
    rawSignalId: text((input as { rawSignalId?: unknown }).rawSignalId) || text(input.duplicateKey) || undefined,
    ticker: ruleFilterResult.detectedTicker ?? input.ticker,
    company: ruleFilterResult.detectedCompany ?? input.company,
    eventSummary: text(input.summary) || text(input.title) || "Raw signal preview with limited event detail.",
    sourceReceipts: receiptItems(input),
    sourceReliability: ruleFilterResult.sourceReliability,
    ruleFilterDecision: ruleFilterResult.decision,
    ruleFilterReasons: ruleFilterResult.rejectionReasons,
    priceContext: (input as { priceContext?: unknown }).priceContext,
    marketSentimentSnapshot: (input as { marketSentimentSnapshot?: unknown }).marketSentimentSnapshot ?? (text(input.marketSentimentRisk) ? { status: text(input.marketSentimentRisk) } : undefined),
    historicalPatternSummary: (input as { historicalPatternSummary?: unknown }).historicalPatternSummary,
  };
}

function sourceQuality(reliability: RuleFilterResult["sourceReliability"]): AiCommitteeCandidateInput["sourceQuality"] {
  if (reliability === "strong") return "high";
  if (reliability === "medium") return "medium";
  if (reliability === "weak") return "low";
  return "low";
}

function committeeInputFromPipeline(input: RuleFilterInput, ruleFilterResult: RuleFilterResult, miniAiScanResult: MiniAiScanOutput): AiCommitteeCandidateInput {
  const receiptsCount = receiptItems(input).length;
  return {
    candidateId: text((input as { candidateId?: unknown }).candidateId) || text((input as { rawSignalId?: unknown }).rawSignalId) || "pipeline_preview_candidate",
    ticker: miniAiScanResult.ticker,
    company: miniAiScanResult.company,
    eventSummary: text(input.summary) || text(input.title) || miniAiScanResult.whyItMatters,
    currentStage: "committee_ready",
    expectedUpsidePercent: Math.max(4, Math.round(miniAiScanResult.marketRelevanceScore / 5)),
    expectedDownsidePercent: 8,
    historicalPatternMatch: miniAiScanResult.noveltyScore >= 55 ? "moderate" : "weak",
    valuationSupportScore: miniAiScanResult.marketRelevanceScore,
    catalystStrengthScore: miniAiScanResult.seriousnessScore,
    sectorSupportScore: 50,
    macroSupportScore: 50,
    sourceQuality: sourceQuality(ruleFilterResult.sourceReliability),
    independentReceipts: receiptsCount,
    receiptsCount,
    hasConfirmedFilingOrExchangeSource: ruleFilterResult.sourceReliability === "strong",
    priceVolumeConfirmationScore: miniAiScanResult.marketRelevanceScore,
    financialSupportScore: miniAiScanResult.evidenceStrength,
    verifiedRippleLinks: Math.min(receiptsCount, 3),
    contradictionCount: 0,
    isRumour: false,
    overboughtRiskScore: 30,
    balanceSheetRiskScore: 30,
    sourceRiskScore: ruleFilterResult.sourceReliability === "strong" ? 15 : 35,
    warnings: [...ruleFilterResult.warningReasons, ...miniAiScanResult.warnings],
    simpleExplanation: "This preview candidate is ready for internal committee queue review only. It is not a final investment recommendation and does not publish an alert.",
  };
}

export function buildPipelinePreview(input: RuleFilterInput = mockRuleFilterInput, pipelineMode: PipelineMode = "mock"): PipelinePreviewOutput {
  const warnings = [
    "Pipeline preview only: no paid AI model is called, no alert is published, and no final investment advice is produced.",
  ];
  const ruleFilterResult = evaluateRuleFilter(input);
  const rawSignalSummary = summarizeRawSignal(input, ruleFilterResult);

  if (ruleFilterResult.decision === "reject") {
    return {
      ok: true,
      pipelineMode,
      rawSignalSummary,
      ruleFilterResult,
      miniAiScanResult: { ok: true, skipped: true, reason: "Rule Filter rejected the signal, so Mini AI Scan was not run." },
      committeeQueueReadiness: { ok: true, skipped: true, reason: "Rule Filter rejected the signal, so AI Committee queue readiness was not evaluated." },
      finalPipelineDecision: "reject",
      rejectionReasons: ruleFilterResult.rejectionReasons,
      warnings: [...warnings, ...ruleFilterResult.warningReasons],
      simpleExplanation: "The signal stopped at the Rule Filter gate. No Mini AI Scan, committee review, publishing, or approval action was taken.",
    };
  }

  if (ruleFilterResult.decision === "needs_more_data") {
    return {
      ok: true,
      pipelineMode,
      rawSignalSummary,
      ruleFilterResult,
      miniAiScanResult: { ok: true, skipped: true, reason: "Rule Filter needs more data, so Mini AI Scan was not run." },
      committeeQueueReadiness: { ok: true, skipped: true, reason: "Rule Filter needs more data, so AI Committee queue readiness was not evaluated." },
      finalPipelineDecision: "needs_more_data",
      rejectionReasons: ruleFilterResult.rejectionReasons,
      warnings: [...warnings, ...ruleFilterResult.warningReasons],
      simpleExplanation: "The pipeline needs more data before escalation. No alert was published or approved.",
    };
  }

  const miniAiScanResult = previewMiniAiScan(miniInputFromRawSignal(input, ruleFilterResult));
  if (miniAiScanResult.scanDecision !== "pass") {
    return {
      ok: true,
      pipelineMode,
      rawSignalSummary,
      ruleFilterResult,
      miniAiScanResult,
      committeeQueueReadiness: { ok: true, skipped: true, reason: `Mini AI Scan returned ${miniAiScanResult.scanDecision}, so committee queue readiness was not evaluated.` },
      finalPipelineDecision: miniAiScanResult.scanDecision === "reject" ? "reject" : "needs_more_data",
      rejectionReasons: miniAiScanResult.scanDecision === "reject" ? ["mini_ai_scan_reject"] : ["mini_ai_scan_needs_more_data"],
      warnings: [...warnings, ...ruleFilterResult.warningReasons, ...miniAiScanResult.warnings],
      simpleExplanation: "The signal passed the Rule Filter but is not ready for committee queue review yet. No alert was published or approved.",
    };
  }

  const committeeQueueReadiness = buildCommitteeQueue([committeeInputFromPipeline(input, ruleFilterResult, miniAiScanResult)], 1, { sourceMode: "mock_fallback" }).queueItems[0];
  return {
    ok: true,
    pipelineMode,
    rawSignalSummary,
    ruleFilterResult,
    miniAiScanResult,
    committeeQueueReadiness,
    finalPipelineDecision: "committee_ready",
    rejectionReasons: [],
    warnings: [...warnings, ...ruleFilterResult.warningReasons, ...miniAiScanResult.warnings, ...committeeQueueReadiness.warnings],
    simpleExplanation: "The signal passed the preview gates and is ready for internal committee queue review only. This is not a final investment recommendation and does not publish or approve an alert.",
  };
}
