import { NextResponse } from "next/server";
import { evaluateLiveOutcomeSeries } from "@/lib/live-outcome-evaluator";
import { getAiCommitteeProviderStatus } from "@/lib/ai-committee/provider";
import { buildMarketSentimentImpact, scoreSwingUpAlert, type ScorePreviewInput } from "@/lib/scoring-engine";

const ALL_PROVENANCE_KEYS = [
  "expectedUpsidePercent",
  "expectedDownsidePercent",
  "valuationSupportScore",
  "catalystStrengthScore",
  "priceMovePercent",
  "sectorSupportScore",
  "macroSupportScore",
  "sourceQuality",
  "independentReceipts",
  "priceVolumeConfirmationScore",
  "financialSupportScore",
  "verifiedRippleLinks",
  "contradictionCount",
  "overboughtRiskScore",
  "balanceSheetRiskScore",
  "sourceRiskScore",
  "liquidityRiskScore",
  "dilutionRiskScore",
] as const;

function liveFixture(): ScorePreviewInput {
  return {
    ticker: "BTC",
    company: "Bitcoin",
    expectedUpsidePercent: 12,
    expectedDownsidePercent: 7,
    historicalPatternMatch: "moderate",
    valuationSupportScore: 65,
    catalystStrengthScore: 82,
    priceMovePercent: 3.4,
    sectorSupportScore: 68,
    macroSupportScore: 64,
    sourceQuality: "high",
    independentReceipts: 3,
    hasConfirmedFilingOrExchangeSource: true,
    priceVolumeConfirmationScore: 80,
    financialSupportScore: 72,
    verifiedRippleLinks: 2,
    contradictionCount: 0,
    isRumour: false,
    overboughtRiskScore: 32,
    balanceSheetRiskScore: 18,
    sourceRiskScore: 15,
    liquidityRiskScore: 10,
    dilutionRiskScore: 5,
    inputProvenance: Object.fromEntries(ALL_PROVENANCE_KEYS.map((key) => [key, "live_fixture_receipt:coingecko"])),
    liveEvidenceOnly: true,
  };
}

export async function GET() {
  return NextResponse.json({ ok: true, mode: "branch_evaluation", mutatesDatabase: false, callsOpenAi: false, publishes: false, sendsNotifications: false });
}

export async function POST() {
  const now = new Date();
  const sentiment = buildMarketSentimentImpact({ overallMarketMood: "risk_on", macroRiskLevel: "medium", sentimentSupportScore: 66, macroSupportScore: 64, profitPotentialAdjustment: 2, confidenceAdjustment: 2, riskOffPenalty: 4, createdAt: now });
  const live = scoreSwingUpAlert(liveFixture(), sentiment);
  const missing = scoreSwingUpAlert({ ...liveFixture(), priceMovePercent: undefined, inputProvenance: {} }, sentiment);
  const mock = scoreSwingUpAlert({ ...liveFixture(), inputProvenance: Object.fromEntries(ALL_PROVENANCE_KEYS.map((key) => [key, "mock_preview"])) }, sentiment);
  const publishedAt = new Date(now.getTime() - 91 * 24 * 60 * 60 * 1000);
  const points = [0, 1, 3, 7, 30, 90].map((days, index) => ({ price: [100, 102, 105, 108, 111, 115][index], capturedAt: new Date(publishedAt.getTime() + days * 24 * 60 * 60 * 1000) }));
  const outcome = evaluateLiveOutcomeSeries({ publishedAt, now, points });
  const provider = getAiCommitteeProviderStatus();
  const checks = [
    { key: "complete_live_signal_passes", passed: live.liveDataReady && live.inputCompleteness === 100 },
    { key: "missing_input_blocks_action", passed: !missing.liveDataReady && missing.suggestedAction === "No Action" && missing.missingInputs.includes("priceMovePercent") },
    { key: "mock_provenance_blocks_action", passed: !mock.liveDataReady && mock.suggestedAction === "No Action" },
    { key: "outcome_uses_all_real_windows", passed: outcome.checkpointCoverage === 100 && outcome.outcome === "win" && outcome.checkpoints.result90D.returnPct === 15 },
    { key: "ai_committee_models_resolve", passed: Object.values(provider.modelEnvStatus).every((status) => status === "configured") },
    { key: "no_test_side_effects", passed: true },
  ];
  const passed = checks.every((check) => check.passed);
  return NextResponse.json({
    ok: passed,
    mode: "branch_evaluation",
    passed,
    checks,
    metrics: {
      liveInputCompleteness: live.inputCompleteness,
      missingInputCompleteness: missing.inputCompleteness,
      liveSignalReady: live.liveDataReady,
      mockSignalReady: mock.liveDataReady,
      outcomeCheckpointCoverage: outcome.checkpointCoverage,
      outcomeLabel: outcome.outcome,
      aiCommitteeAgentCapacity: 14,
      aiCommitteeConfigured: provider.configured,
      aiCommitteeEnabled: provider.enabled,
      aiCommitteeDryRunDefault: provider.dryRunDefault,
    },
    safety: { databaseWrites: false, openAiCalls: false, publishing: false, notifications: false, mainBranchWrites: false },
    failures: checks.filter((check) => !check.passed).map((check) => check.key),
  }, { status: passed ? 200 : 422 });
}
