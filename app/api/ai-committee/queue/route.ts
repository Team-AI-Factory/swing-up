import { NextRequest, NextResponse } from "next/server";
import { buildCommitteeQueue, mockCommitteeCandidate, type AiCommitteeCandidateInput, type AiCommitteeReviewStage } from "@/lib/ai-committee-queue";
import { prisma } from "@/lib/db/client";
import { buildMarketSentimentImpact, loadLatestMarketSentimentSnapshot, type HistoricalPatternMatch } from "@/lib/scoring-engine";

const candidateStatuses = ["candidate", "draft", "queued", "review", "ready_for_review"];

function stageFromStatus(status: string | null | undefined): AiCommitteeReviewStage {
  const normalized = (status ?? "").toLowerCase();
  if (normalized === "ready_for_review") return "committee_ready";
  if (normalized === "review") return "committee_reviewing";
  if (normalized === "queued" || normalized === "candidate") return "rule_filter_passed";
  return "raw_signal_received";
}

function riskInputFromScore(riskLevel: string | null | undefined) {
  const normalized = (riskLevel ?? "").toLowerCase();
  if (normalized === "low") return { expectedDownsidePercent: 4, overboughtRiskScore: 15, balanceSheetRiskScore: 15, sourceRiskScore: 12 };
  if (normalized === "high") return { expectedDownsidePercent: 13, overboughtRiskScore: 55, balanceSheetRiskScore: 48, sourceRiskScore: 36 };
  if (normalized === "extreme") return { expectedDownsidePercent: 20, overboughtRiskScore: 78, balanceSheetRiskScore: 70, sourceRiskScore: 55 };
  return { expectedDownsidePercent: 8, overboughtRiskScore: 30, balanceSheetRiskScore: 30, sourceRiskScore: 24 };
}

function patternFromReceipts(receiptsCount: number): HistoricalPatternMatch {
  if (receiptsCount >= 4) return "strong";
  if (receiptsCount >= 2) return "moderate";
  if (receiptsCount === 1) return "weak";
  return "no_clear_match";
}

function safeScore(value: number | null | undefined, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : fallback;
}

async function loadCandidateQueueItems(limit: number): Promise<AiCommitteeCandidateInput[]> {
  const alerts = await prisma.alert.findMany({
    where: {
      OR: candidateStatuses.map((status) => ({ status: { equals: status, mode: "insensitive" } })),
    },
    orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
    take: limit,
    include: {
      scores: { orderBy: { createdAt: "desc" }, take: 1 },
      sources: { orderBy: { collectedAt: "desc" }, take: 10 },
    },
  });

  return alerts.map((alert) => {
    const latestScore = alert.scores[0];
    const receiptsCount = alert.sources.length;
    const profitPotentialScore = safeScore(latestScore?.profitPotential, 50);
    const evidenceConfidenceScore = safeScore(latestScore?.evidenceConfidence, receiptsCount > 0 ? 55 : 40);
    const riskFields = riskInputFromScore(latestScore?.riskLevel);
    const warnings = latestScore?.pricedInCheck ? [`Priced-in check from persisted score: ${latestScore.pricedInCheck}.`] : [];

    return {
      candidateId: alert.id,
      ticker: alert.ticker,
      company: alert.company,
      eventSummary: alert.event,
      currentStage: stageFromStatus(alert.status),
      expectedUpsidePercent: Math.max(4, Math.round(profitPotentialScore / 4)),
      historicalPatternMatch: patternFromReceipts(receiptsCount),
      valuationSupportScore: profitPotentialScore,
      catalystStrengthScore: profitPotentialScore,
      sectorSupportScore: 50,
      macroSupportScore: 50,
      sourceQuality: receiptsCount >= 3 ? "high" : receiptsCount > 0 ? "medium" : "low",
      independentReceipts: receiptsCount,
      receiptsCount,
      hasConfirmedFilingOrExchangeSource: alert.sources.some((source) => /filing|exchange|sec|press/i.test(`${source.sourceType} ${source.receiptUrl ?? ""}`)),
      priceVolumeConfirmationScore: evidenceConfidenceScore,
      financialSupportScore: evidenceConfidenceScore,
      verifiedRippleLinks: Math.min(receiptsCount, 3),
      contradictionCount: 0,
      isRumour: false,
      ...riskFields,
      warnings,
      simpleExplanation: "This persisted candidate alert is queued for internal committee review only; it is not an investment recommendation and does not publish or approve an alert.",
    };
  });
}

export async function GET(request: NextRequest) {
  const limitParam = Number(request.nextUrl.searchParams.get("limit") ?? 20);
  const safeLimit = Math.max(0, Math.min(100, Number.isFinite(limitParam) ? Math.floor(limitParam) : 20));

  try {
    const sentiment = buildMarketSentimentImpact(await loadLatestMarketSentimentSnapshot());
    const candidates = await loadCandidateQueueItems(safeLimit);
    const sourceMode = candidates.length > 0 ? "live" : "empty";
    return NextResponse.json(buildCommitteeQueue(candidates, safeLimit, { sourceMode, sentiment }));
  } catch {
    return NextResponse.json(buildCommitteeQueue([mockCommitteeCandidate()], safeLimit, { sourceMode: "mock_fallback" }));
  }
}
