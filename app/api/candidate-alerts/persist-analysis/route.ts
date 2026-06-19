import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { buildPatternMatchPreview, type PatternCandidateSignal } from "@/lib/pattern-matcher";
import { buildMarketSentimentImpact, loadLatestMarketSentimentSnapshot, scoreSwingUpAlert, type HistoricalPatternMatch, type ScorePreviewInput } from "@/lib/scoring-engine";

const EVENT_LIMIT = 200;
const CANDIDATE_STATUSES = new Set(["candidate", "needs_more_data", "draft", "queued", "review", "ready_for_review", "rejected"]);


function text(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function numberFromDecimal(value: unknown) {
  if (value === null || value === undefined) return null;
  const parsed = Number(value instanceof Prisma.Decimal ? value.toString() : value);
  return Number.isFinite(parsed) ? parsed : null;
}

function patternLabel(score: number | null): HistoricalPatternMatch {
  if (score === null) return "no_clear_match";
  if (score >= 75) return "strong";
  if (score >= 50) return "moderate";
  if (score >= 25) return "weak";
  return "no_clear_match";
}

function sourceQuality(receiptsCount: number): ScorePreviewInput["sourceQuality"] {
  if (receiptsCount >= 4) return "high";
  if (receiptsCount >= 2) return "medium";
  if (receiptsCount === 1) return "low";
  return "low";
}

function sourceReceiptObjects(sources: { sourceType: string; receiptUrl: string | null; summary: string | null; collectedAt: Date }[]) {
  return sources.map((source) => ({
    source: source.sourceType,
    url: source.receiptUrl,
    label: source.summary ?? source.sourceType,
    capturedAt: source.collectedAt.toISOString(),
  }));
}

function candidateFromAlert(alert: { ticker: string; company: string; event: string; sources: { sourceType: string; receiptUrl: string | null; summary: string | null; collectedAt: Date }[] }): PatternCandidateSignal {
  return {
    ticker: alert.ticker,
    company: alert.company,
    title: alert.event,
    summary: alert.event,
    eventType: alert.event,
    signalType: alert.event,
    source: alert.sources[0]?.sourceType,
    sourceReceipts: sourceReceiptObjects(alert.sources),
    sourceStrength: alert.sources.length >= 2 ? "medium" : "low",
  };
}

function bestExistingMatch(matches: { id: string; historicalEventId: string | null; similarity: Prisma.Decimal; matchScore: Prisma.Decimal | null; confidenceLabel: string }[]) {
  return matches
    .map((match) => ({ match, score: numberFromDecimal(match.matchScore ?? match.similarity) }))
    .filter((entry): entry is { match: (typeof matches)[number]; score: number } => entry.score !== null)
    .sort((left, right) => right.score - left.score)[0] ?? null;
}

function scoreInputFromAlert(alert: { ticker: string; company: string; event: string; sources: unknown[] }, historicalPatternMatch: HistoricalPatternMatch, sentimentMacroSupport: number): ScorePreviewInput {
  const receiptsCount = alert.sources.length;
  const hasReceipts = receiptsCount > 0;
  return {
    ticker: alert.ticker,
    company: alert.company,
    expectedUpsidePercent: historicalPatternMatch === "strong" ? 14 : historicalPatternMatch === "moderate" ? 10 : 7,
    expectedDownsidePercent: historicalPatternMatch === "no_clear_match" ? 10 : 8,
    historicalPatternMatch,
    valuationSupportScore: 50,
    catalystStrengthScore: text(alert.event).length > 80 ? 62 : 52,
    sectorSupportScore: 50,
    macroSupportScore: sentimentMacroSupport,
    sourceQuality: sourceQuality(receiptsCount),
    independentReceipts: receiptsCount,
    hasConfirmedFilingOrExchangeSource: hasReceipts,
    priceVolumeConfirmationScore: 45,
    financialSupportScore: 45,
    verifiedRippleLinks: Math.min(receiptsCount, 3),
    contradictionCount: 0,
    isRumour: !hasReceipts,
    sourceRiskScore: hasReceipts ? 30 : 55,
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { candidateAlertId?: unknown; candidate_alert_id?: unknown };
    const candidateAlertId = text(body.candidateAlertId ?? body.candidate_alert_id);
    if (!candidateAlertId) return NextResponse.json({ ok: false, error: "candidateAlertId is required." }, { status: 400 });

    const alert = await prisma.alert.findUnique({
      where: { id: candidateAlertId },
      include: {
        scores: { orderBy: { createdAt: "desc" }, take: 1 },
        sources: { orderBy: { collectedAt: "desc" } },
        patternMatches: { orderBy: [{ matchScore: "desc" }, { similarity: "desc" }, { createdAt: "desc" }], take: 5 },
      },
    });
    if (!alert) return NextResponse.json({ ok: false, error: "Candidate alert not found." }, { status: 404 });

    const warnings: string[] = [];
    if (!CANDIDATE_STATUSES.has(alert.status.toLowerCase())) warnings.push(`Alert status is '${alert.status}', so analysis was persisted without changing review/publish state.`);
    if (!alert.sources.length) warnings.push("No alert sources are attached; scoring used low source-quality assumptions.");

    let selectedPattern = bestExistingMatch(alert.patternMatches);
    let createdOrUpdatedPatternMatchId = selectedPattern?.match.id ?? null;

    if (!selectedPattern) {
      const events = await prisma.historicalEvent.findMany({ orderBy: [{ eventDate: "desc" }, { createdAt: "desc" }], take: EVENT_LIMIT });
      if (!events.length) {
        warnings.push("No historical events are available; Historical Pattern Match was saved as no_clear_match.");
      } else {
        const preview = buildPatternMatchPreview(candidateFromAlert(alert), events, 1);
        const best = preview.matchedEvents[0];
        if (best?.historicalEventId && best.similarityScore > 0) {
          const data = {
            alertId: alert.id,
            historicalEventId: best.historicalEventId,
            ticker: alert.ticker,
            similarity: new Prisma.Decimal(best.similarityScore),
            matchScore: new Prisma.Decimal(best.similarityScore),
            confidenceLabel: best.similarityScore >= 75 ? "strong" : best.similarityScore >= 50 ? "moderate" : best.similarityScore >= 25 ? "weak" : "none",
            matchReason: best.reasonForMatch,
            matchedFeatures: [best.reasonForMatch],
            notes: "Persisted by candidate-alert analysis worker from preview matching logic.",
          };
          const existing = await prisma.patternMatch.findFirst({ where: { alertId: alert.id, historicalEventId: best.historicalEventId }, select: { id: true } });
          const patternMatch = existing ? await prisma.patternMatch.update({ where: { id: existing.id }, data }) : await prisma.patternMatch.create({ data });
          createdOrUpdatedPatternMatchId = patternMatch.id;
          selectedPattern = { match: { id: patternMatch.id, historicalEventId: patternMatch.historicalEventId, similarity: patternMatch.similarity, matchScore: patternMatch.matchScore, confidenceLabel: patternMatch.confidenceLabel }, score: best.similarityScore };
        } else {
          warnings.push("Historical events exist, but no comparable pattern match was strong enough to attach.");
        }
      }
    }

    const historicalPatternMatch = selectedPattern ? patternLabel(selectedPattern.score) : "no_clear_match";
    const sentiment = buildMarketSentimentImpact(await loadLatestMarketSentimentSnapshot());
    if (sentiment.sentimentDataStatus === "missing") warnings.push("Market sentiment snapshot is missing; neutral sentiment assumptions were used and no sentiment source row was attached.");

    const score = scoreSwingUpAlert(scoreInputFromAlert(alert, historicalPatternMatch, sentiment.macroSupportScore), sentiment);

    const savedScore = alert.scores[0]
      ? await prisma.alertScore.update({ where: { id: alert.scores[0].id }, data: { profitPotential: score.profitPotentialScore, evidenceConfidence: score.evidenceConfidenceScore, riskLevel: score.riskLevel, pricedInCheck: score.pricedInCheck } })
      : await prisma.alertScore.create({ data: { alertId: alert.id, profitPotential: score.profitPotentialScore, evidenceConfidence: score.evidenceConfidenceScore, riskLevel: score.riskLevel, pricedInCheck: score.pricedInCheck } });

    return NextResponse.json({
      ok: true,
      candidateAlertId: alert.id,
      saved: {
        alertScoreId: savedScore.id,
        profitPotentialScore: score.profitPotentialScore,
        evidenceConfidenceScore: score.evidenceConfidenceScore,
        riskLevel: score.riskLevel,
        historicalPatternMatch,
        patternMatchId: createdOrUpdatedPatternMatchId,
        marketSentimentImpact: sentiment.sentimentDataStatus === "available" ? score.marketSentimentImpact : null,
      },
      warnings: [...warnings, ...score.warnings],
      compatibility: { publishesRealAlert: false, createsPublicLedgerRecord: false, callsPaidAiModel: false },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2023") return NextResponse.json({ ok: false, error: "candidateAlertId must be a valid id." }, { status: 400 });
    return NextResponse.json({ ok: false, error: "Unable to persist candidate alert analysis." }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ ok: true, message: "POST { candidateAlertId } to calculate and persist candidate alert score and historical pattern match analysis without publishing." });
}
