import { NextRequest, NextResponse } from "next/server";
import { Prisma, type RawSignal } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { previewMiniAiScan, type MiniAiSourceReceipt } from "@/lib/mini-ai-scan";
import { evaluateRawSignalQualityGate } from "@/lib/raw-signal-quality-gate";
import { evaluateRuleFilter, type RuleFilterInput } from "@/lib/rule-filter";
import { buildMarketSentimentImpact, loadLatestMarketSentimentSnapshot, scoreSwingUpAlert, type HistoricalPatternMatch, type ScorePreviewInput } from "@/lib/scoring-engine";
import { buildLiveScoreInput } from "@/lib/live-score-evidence";

const CANDIDATE_STATUSES = ["candidate", "needs_more_data", "rejected"];
const SAFE_ACTIONS = new Set(["Buy Candidate", "Speculative Buy Candidate", "Watch", "Sell Review", "Avoid", "No Action"]);

type JsonRecord = Record<string, unknown>;

function text(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function objectValue(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function arrayValue(value: unknown) {
  return Array.isArray(value) ? value : [];
}


function safeDateText(value: Date | string | null | undefined) {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function sourceReceiptsFromSignal(signal: RawSignal): MiniAiSourceReceipt[] {
  const payload = objectValue(signal.payload);
  const explicitReceipts = arrayValue(payload.receipts ?? payload.sourceReceipts ?? payload.receipt_urls ?? payload.receiptUrls);
  const receipts = explicitReceipts
    .map((item) => {
      if (typeof item === "string") return { url: item, source: signal.source, label: signal.source };
      const receipt = objectValue(item);
      return {
        label: text(receipt.label ?? receipt.title ?? receipt.summary, signal.source),
        url: text(receipt.url ?? receipt.receiptUrl ?? receipt.sourceUrl),
        source: text(receipt.source ?? receipt.sourceType, signal.source),
        capturedAt: receipt.capturedAt ?? receipt.publishedAt ?? receipt.date,
      };
    })
    .filter((receipt) => text(receipt.url) || text(receipt.label) || text(receipt.source));

  if (signal.sourceUrl && !receipts.some((receipt) => text(receipt.url) === signal.sourceUrl)) {
    receipts.unshift({ label: signal.title, url: signal.sourceUrl, source: signal.source, capturedAt: signal.receivedAt.toISOString() });
  }

  return receipts;
}

function ruleInputFromSignal(signal: RawSignal, receipts: MiniAiSourceReceipt[]): RuleFilterInput {
  const payload = objectValue(signal.payload);
  return {
    title: signal.title,
    url: signal.sourceUrl ?? text(payload.url ?? payload.link ?? payload.receiptUrl),
    source: signal.source,
    summary: signal.summary,
    ticker: signal.ticker ?? payload.ticker,
    company: payload.company ?? payload.companyName,
    eventType: payload.eventType ?? signal.signalType,
    assetType: payload.assetType ?? (signal.ticker ? "equity" : undefined),
    sourceReliability: payload.sourceReliability,
    receipts,
    receiptUrls: receipts.map((receipt) => receipt.url).filter(Boolean),
    publishedAt: safeDateText(signal.receivedAt),
    importanceHint: signal.importanceHint,
    impactScore: numberValue(payload.impactScore ?? payload.rule_score ?? payload.ruleScore) ?? undefined,
    duplicateKey: `${signal.source.toLowerCase()}::${(signal.ticker ?? "").toLowerCase()}::${signal.title.toLowerCase()}`,
    previousSignalKeys: [],
    alreadyPricedIn: payload.alreadyPricedIn,
    pricedInWarning: payload.pricedInWarning,
    marketSentimentRisk: payload.marketSentimentRisk,
    marketSentimentWarning: payload.marketSentimentWarning,
  };
}

function patternMatchLabel(score: number | null): HistoricalPatternMatch {
  if (score === null) return "no_clear_match";
  if (score >= 75) return "strong";
  if (score >= 50) return "moderate";
  if (score >= 25) return "weak";
  return "no_clear_match";
}

function sourceQuality(reliability: string): ScorePreviewInput["sourceQuality"] {
  if (reliability === "strong") return "high";
  if (reliability === "medium") return "medium";
  if (reliability === "weak") return "low";
  return "low";
}

async function latestPatternScore(rawSignalId: string) {
  const match = await prisma.patternMatch.findFirst({
    where: { rawSignalId },
    orderBy: [{ matchScore: "desc" }, { similarity: "desc" }, { createdAt: "desc" }],
    select: { id: true, matchScore: true, similarity: true, confidenceLabel: true },
  });
  const score = Number(match?.matchScore ?? match?.similarity ?? Number.NaN);
  return { match, score: Number.isFinite(score) ? score : null };
}

function candidateStatus(ruleDecision: string, miniDecision: string) {
  if (ruleDecision === "reject" || miniDecision === "reject") return "rejected";
  if (ruleDecision === "needs_more_data" || miniDecision === "needs_more_data") return "needs_more_data";
  return "candidate";
}

function buildExplanation(status: string, ticker: string, receiptsCount: number) {
  if (status === "candidate") return `${ticker} passed deterministic rule filtering and local Mini AI Scan checks with ${receiptsCount} receipt reference(s). It is saved for internal review only and is not published.`;
  if (status === "needs_more_data") return `${ticker} was saved as needs_more_data because receipts, source quality, or event detail are not yet strong enough for candidate review.`;
  return `${ticker} was evaluated and rejected by local gates. No public alert, ledger entry, notification, or paid AI call was made.`;
}

async function findDuplicate(ticker: string, event: string) {
  return prisma.alert.findFirst({
    where: {
      ticker,
      event,
      OR: CANDIDATE_STATUSES.map((status) => ({ status: { equals: status, mode: "insensitive" } })),
    },
    include: { scores: { orderBy: { createdAt: "desc" }, take: 1 }, sources: true },
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { rawSignalId?: unknown };
    const rawSignalId = text(body.rawSignalId ?? (body as { raw_signal_id?: unknown }).raw_signal_id);
    if (!rawSignalId) return NextResponse.json({ ok: false, error: "rawSignalId is required." }, { status: 400 });

    const rawSignal = await prisma.rawSignal.findUnique({ where: { id: rawSignalId } });
    if (!rawSignal) return NextResponse.json({ ok: false, error: "Raw signal not found." }, { status: 404 });

    const receipts = sourceReceiptsFromSignal(rawSignal);
    const ruleInput = ruleInputFromSignal(rawSignal, receipts);
    const qualityGateResult = await evaluateRawSignalQualityGate(ruleInput, rawSignal.id);
    const ruleFilterResult = evaluateRuleFilter(ruleInput);

    if (!qualityGateResult.eligibleForCandidateAlert) {
      const processedStatus = qualityGateResult.needsMoreData && !qualityGateResult.duplicate ? "queued" : "rejected";
      await prisma.rawSignal.update({ where: { id: rawSignal.id }, data: { processedStatus } });
      return NextResponse.json({
        ok: true,
        created: false,
        updated: false,
        duplicateAvoided: qualityGateResult.duplicate,
        rawSignalId,
        candidateAlert: null,
        qualityGateResult,
        ruleFilterResult: qualityGateResult.ruleFilterResult,
        compatibility: { callsPaidAiModel: false, publishesRealAlert: false, createsPublicLedgerRecord: false },
      });
    }
    const miniAiScanResult = previewMiniAiScan({
      rawSignalId,
      ticker: ruleFilterResult.detectedTicker ?? rawSignal.ticker,
      company: ruleFilterResult.detectedCompany ?? objectValue(rawSignal.payload).company ?? objectValue(rawSignal.payload).companyName,
      eventSummary: rawSignal.summary || rawSignal.title,
      sourceReceipts: receipts,
      sourceReliability: ruleFilterResult.sourceReliability,
      ruleFilterDecision: ruleFilterResult.decision,
      ruleFilterReasons: ruleFilterResult.rejectionReasons,
      priceContext: objectValue(rawSignal.payload).priceContext,
      marketSentimentSnapshot: objectValue(rawSignal.payload).marketSentimentSnapshot,
      historicalPatternSummary: objectValue(rawSignal.payload).historicalPatternSummary,
    });

    const { match, score: patternScore } = await latestPatternScore(rawSignalId);
    const sentiment = buildMarketSentimentImpact(await loadLatestMarketSentimentSnapshot());
    const receiptsCount = receipts.length;
    const ticker = text(ruleFilterResult.detectedTicker ?? rawSignal.ticker, "UNKNOWN").toUpperCase();
    const company = text(ruleFilterResult.detectedCompany ?? miniAiScanResult.company, ticker === "UNKNOWN" ? "Unknown company" : ticker);
    const eventSummary = text(rawSignal.summary, rawSignal.title);
    const initialStatus = candidateStatus(ruleFilterResult.decision, miniAiScanResult.scanDecision);
    const score = scoreSwingUpAlert(buildLiveScoreInput({
      ticker,
      company,
      source: rawSignal.source,
      payload: rawSignal.payload,
      receivedAt: rawSignal.receivedAt,
      sourceQuality: sourceQuality(ruleFilterResult.sourceReliability),
      qualityScore: Math.max(qualityGateResult.qualityScore, miniAiScanResult.seriousnessScore),
      receiptsCount,
      proofTypes: [],
      historicalPatternMatch: patternMatchLabel(patternScore),
      sentiment,
    }), sentiment);
    const status = initialStatus === "candidate" && !score.liveDataReady ? "needs_more_data" : initialStatus;
    const rejectionReasons = [
      ...ruleFilterResult.rejectionReasons,
      ...(miniAiScanResult.scanDecision === "reject" ? ["mini_ai_scan_reject"] : []),
      ...(miniAiScanResult.scanDecision === "needs_more_data" ? ["mini_ai_scan_needs_more_data"] : []),
      ...(!score.liveDataReady ? ["live_score_inputs_incomplete", ...score.missingInputs.map((item) => `missing_live_input:${item}`)] : []),
    ];
    const action = SAFE_ACTIONS.has(score.suggestedAction) ? score.suggestedAction : "No Action";
    const simpleExplanation = buildExplanation(status, ticker, receiptsCount);
    const existing = await findDuplicate(ticker, eventSummary);

    const result = await prisma.$transaction(async (tx) => {
      const alert = existing
        ? await tx.alert.update({ where: { id: existing.id }, data: { company, action, event: eventSummary, status, publishedAt: null } })
        : await tx.alert.create({ data: { ticker, company, action, event: eventSummary, status, publishedAt: null } });

      await tx.alertScore.create({
        data: {
          alertId: alert.id,
          profitPotential: score.profitPotentialScore,
          evidenceConfidence: score.evidenceConfidenceScore,
          riskLevel: score.riskLevel,
          pricedInCheck: score.pricedInCheck,
          inputCompleteness: score.inputCompleteness,
          liveDataReady: score.liveDataReady,
          missingInputs: score.missingInputs,
          inputProvenance: score.inputProvenance,
        },
      });

      for (const receipt of receipts) {
        const receiptUrl = text(receipt.url) || null;
        const sourceType = text(receipt.source, rawSignal.source) || rawSignal.source;
        const duplicateSource = existing?.sources.some((source) => source.receiptUrl === receiptUrl && source.sourceType === sourceType);
        if (!duplicateSource) await tx.alertSource.create({ data: { alertId: alert.id, sourceType, receiptUrl, summary: text(receipt.label, rawSignal.title) } });
      }

      if (match) await tx.patternMatch.update({ where: { id: match.id }, data: { alertId: alert.id } }).catch(() => undefined);
      await tx.rawSignal.update({ where: { id: rawSignal.id }, data: { processedStatus: status === "candidate" ? "promoted" : status === "rejected" ? "rejected" : "queued" } });
      return alert;
    });

    return NextResponse.json({
      ok: true,
      created: !existing,
      updated: Boolean(existing),
      duplicateAvoided: Boolean(existing),
      rawSignalId,
      candidateAlert: { id: result.id, ticker, company, eventSummary, action, status, profitPotentialScore: score.profitPotentialScore, evidenceConfidenceScore: score.evidenceConfidenceScore, riskLevel: score.riskLevel, marketSentimentImpact: score.marketSentimentImpact, receiptsCount, rejectionReasons, simpleExplanation },
      qualityGateResult,
      ruleFilterResult,
      miniAiScanResult,
      compatibility: { callsPaidAiModel: false, publishesRealAlert: false, createsPublicLedgerRecord: false },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2023") return NextResponse.json({ ok: false, error: "rawSignalId must be a valid id." }, { status: 400 });
    return NextResponse.json({ ok: false, error: "Unable to persist candidate alert from raw signal." }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ ok: true, message: "POST { rawSignalId } to persist an internal candidate alert from a raw signal without publishing or paid AI calls." });
}
