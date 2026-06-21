import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { buildProofBundleForRawSignal, type ProofBundle } from "@/lib/proof/proof-bundle-builder";
import { evaluateRawSignalQualityGate, receiptsFromRawSignal, ruleInputFromRawSignal } from "@/lib/raw-signal-quality-gate";
import { buildMarketSentimentImpact, loadLatestMarketSentimentSnapshot, scoreSwingUpAlert, type HistoricalPatternMatch, type ScorePreviewInput, type SwingUpScore } from "@/lib/scoring-engine";

const CANDIDATE_STATUSES = ["candidate", "needs_more_data", "draft", "queued", "review", "ready_for_review"];
const SAFE_ACTIONS = new Set(["Buy Candidate", "Speculative Buy Candidate", "Watch", "Sell Review", "Avoid", "No Action"]);
const BANNED_WORDING = [/buy\s+now/i, /guaranteed/i, /risk[-\s]?free/i, /strong\s+buy/i, /sure\s+thing/i, /can'?t\s+miss/i, /to\s+the\s+moon/i, /100x/i];

type JsonRecord = Record<string, unknown>;

function text(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function objectValue(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function dryRunValue(value: unknown) {
  return value === false ? false : true;
}

function hasUnsafeWording(...values: string[]) {
  const joined = values.join(" \n ");
  return BANNED_WORDING.some((pattern) => pattern.test(joined));
}

function sourceHealthAcceptable(proofBundle: ProofBundle) {
  const health = proofBundle.proofs.find((proof) => proof.type === "source_health");
  return !health || health.strength === "medium" || health.strength === "strong";
}

function proofSummary(proofBundle: ProofBundle | null) {
  if (!proofBundle) return null;
  return {
    proofCount: proofBundle.proofCount,
    proofTypes: proofBundle.proofTypes,
    strongestProof: proofBundle.strongestProof ? { type: proofBundle.strongestProof.type, strength: proofBundle.strongestProof.strength, label: proofBundle.strongestProof.label, source: proofBundle.strongestProof.source, url: proofBundle.strongestProof.url ?? null } : null,
    missingProof: proofBundle.missingProof,
    confidenceHint: proofBundle.confidenceHint,
    confidenceScore: proofBundle.confidenceScore,
    safeToPromote: proofBundle.safeToPromote,
    reasons: proofBundle.reasons,
  };
}

function scoreSummary(score: SwingUpScore | null) {
  if (!score) return null;
  return { profitPotentialScore: score.profitPotentialScore, evidenceConfidenceScore: score.evidenceConfidenceScore, riskLevel: score.riskLevel, pricedInCheck: score.pricedInCheck, suggestedAction: score.suggestedAction, warnings: score.warnings };
}

function patternMatchLabel(score: number | null): HistoricalPatternMatch {
  if (score === null) return "no_clear_match";
  if (score >= 75) return "strong";
  if (score >= 50) return "moderate";
  if (score >= 25) return "weak";
  return "no_clear_match";
}

async function latestPatternScore(rawSignalId: string) {
  const match = await prisma.patternMatch.findFirst({ where: { rawSignalId }, orderBy: [{ matchScore: "desc" }, { similarity: "desc" }, { createdAt: "desc" }], select: { id: true, matchScore: true, similarity: true } });
  const score = Number(match?.matchScore ?? match?.similarity ?? Number.NaN);
  return { match, score: Number.isFinite(score) ? score : null };
}

async function duplicateCandidate(ticker: string, event: string) {
  return prisma.alert.findFirst({ where: { ticker, event, OR: CANDIDATE_STATUSES.map((status) => ({ status: { equals: status, mode: "insensitive" as const } })) }, select: { id: true, status: true } });
}

function sourceQuality(reliability: string): ScorePreviewInput["sourceQuality"] {
  if (reliability === "strong") return "high";
  if (reliability === "medium") return "medium";
  if (reliability === "weak") return "low";
  return "low";
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as { rawSignalId?: unknown; raw_signal_id?: unknown; dryRun?: unknown; dry_run?: unknown };
    const rawSignalId = text(body.rawSignalId ?? body.raw_signal_id);
    const dryRun = dryRunValue(body.dryRun ?? body.dry_run);
    if (!rawSignalId) return NextResponse.json({ ok: false, dryRun, rawSignalId: null, wouldPromote: false, blockedReasons: ["rawSignalId is required"], proofSummary: null, scoreSummary: null, nextRecommendedAction: "Provide a rawSignalId and retry." }, { status: 400 });

    const rawSignal = await prisma.rawSignal.findUnique({ where: { id: rawSignalId } });
    if (!rawSignal) return NextResponse.json({ ok: false, dryRun, rawSignalId, wouldPromote: false, blockedReasons: ["raw_signal_not_found"], proofSummary: null, scoreSummary: null, nextRecommendedAction: "Confirm the raw signal id exists." }, { status: 404 });

    const ruleInput = ruleInputFromRawSignal(rawSignal);
    const qualityGate = await evaluateRawSignalQualityGate(ruleInput, rawSignal.id);
    const proofBundle = await buildProofBundleForRawSignal(rawSignal.id);
    const payload = objectValue(rawSignal.payload);
    const ticker = text(qualityGate.ruleFilterResult.detectedTicker ?? rawSignal.ticker).toUpperCase();
    const company = text(qualityGate.ruleFilterResult.detectedCompany ?? payload.company ?? payload.companyName, ticker || "Unknown company");
    const event = text(rawSignal.summary, rawSignal.title);
    const receipts = receiptsFromRawSignal(rawSignal);
    const duplicate = ticker && event ? await duplicateCandidate(ticker, event) : null;
    const { match, score: patternScore } = await latestPatternScore(rawSignal.id);
    const sentiment = buildMarketSentimentImpact(await loadLatestMarketSentimentSnapshot());
    const score = ticker || company ? scoreSwingUpAlert({
      ticker: ticker || company,
      company,
      expectedUpsidePercent: Math.max(4, numberValue(payload.expectedUpsidePercent) ?? Math.round(qualityGate.qualityScore / 6)),
      expectedDownsidePercent: numberValue(payload.expectedDownsidePercent) ?? 8,
      historicalPatternMatch: patternMatchLabel(patternScore),
      valuationSupportScore: numberValue(payload.valuationSupportScore) ?? qualityGate.qualityScore,
      catalystStrengthScore: numberValue(payload.catalystStrengthScore) ?? qualityGate.qualityScore,
      sectorSupportScore: 50,
      macroSupportScore: sentiment.macroSupportScore,
      sourceQuality: sourceQuality(qualityGate.ruleFilterResult.sourceReliability),
      independentReceipts: receipts.length,
      hasConfirmedFilingOrExchangeSource: qualityGate.ruleFilterResult.sourceReliability === "strong",
      priceVolumeConfirmationScore: proofBundle?.proofTypes.includes("price_volume") ? 70 : 40,
      financialSupportScore: proofBundle?.proofTypes.includes("fundamentals") ? 70 : 40,
      verifiedRippleLinks: Math.min(receipts.length, 3),
      contradictionCount: 0,
      isRumour: qualityGate.ruleFilterResult.sourceReliability === "weak",
      sourceRiskScore: qualityGate.ruleFilterResult.sourceReliability === "strong" ? 15 : 35,
      payload: rawSignal.payload,
    }, sentiment) : null;
    const action = score && SAFE_ACTIONS.has(score.suggestedAction) ? score.suggestedAction : "No Action";

    const blockedReasons = [
      ...(!ticker && !company ? ["ticker_or_company_not_resolved"] : []),
      ...(!proofBundle || (proofBundle.safeToPromote !== "yes" && receipts.length === 0) ? ["missing_clear_proof_source"] : []),
      ...(proofBundle && !sourceHealthAcceptable(proofBundle) ? ["source_health_not_acceptable"] : []),
      ...(duplicate ? ["duplicate_candidate_exists"] : []),
      ...(qualityGate.ruleFilterResult.rejectionReasons.includes("unsafe_wording") || hasUnsafeWording(rawSignal.title, rawSignal.summary, action) ? ["unsafe_wording"] : []),
      ...(!SAFE_ACTIONS.has(action) ? ["unsafe_action_label"] : []),
      ...(!score?.riskLevel ? ["risk_missing"] : []),
      ...(!qualityGate.eligibleForCandidateAlert ? qualityGate.rejectionReasons : []),
      ...(proofBundle?.safeToPromote === "no" ? proofBundle.reasons : []),
    ];
    const uniqueBlockedReasons = Array.from(new Set(blockedReasons));
    const wouldPromote = uniqueBlockedReasons.length === 0;

    if (dryRun || !wouldPromote) {
      return NextResponse.json({ ok: true, dryRun, rawSignalId, wouldPromote, candidateAlertId: null, blockedReasons: uniqueBlockedReasons, proofSummary: proofSummary(proofBundle), scoreSummary: scoreSummary(score), nextRecommendedAction: wouldPromote ? "Run again with dryRun=false to create an internal candidate alert." : qualityGate.ruleFilterResult.nextRecommendedStage });
    }

    const created = await prisma.$transaction(async (tx) => {
      const alert = await tx.alert.create({ data: { ticker: ticker || company, company, action, event, status: "candidate", publishedAt: null } });
      if (score) await tx.alertScore.create({ data: { alertId: alert.id, profitPotential: score.profitPotentialScore, evidenceConfidence: score.evidenceConfidenceScore, riskLevel: score.riskLevel, pricedInCheck: score.pricedInCheck } });
      for (const proof of proofBundle?.proofs ?? []) await tx.alertSource.create({ data: { alertId: alert.id, sourceType: proof.source || proof.type, receiptUrl: text(proof.url) || null, summary: proof.summary } });
      if (match) await tx.patternMatch.update({ where: { id: match.id }, data: { alertId: alert.id } }).catch(() => undefined);
      await tx.rawSignal.update({ where: { id: rawSignal.id }, data: { processedStatus: "promoted" } });
      return alert;
    });

    return NextResponse.json({ ok: true, dryRun, rawSignalId, wouldPromote: true, candidateAlertId: created.id, blockedReasons: [], proofSummary: proofSummary(proofBundle), scoreSummary: scoreSummary(score), nextRecommendedAction: "Review the candidate alert internally; do not publish or notify without state-machine approval." });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2023") return NextResponse.json({ ok: false, dryRun: true, rawSignalId: null, wouldPromote: false, blockedReasons: ["rawSignalId must be a valid UUID"], proofSummary: null, scoreSummary: null, nextRecommendedAction: "Provide a valid rawSignalId." }, { status: 400 });
    return NextResponse.json({ ok: false, dryRun: true, rawSignalId: null, wouldPromote: false, blockedReasons: ["promotion_failed"], proofSummary: null, scoreSummary: null, nextRecommendedAction: "Inspect server logs and retry after fixing the raw signal or database issue." }, { status: 500 });
  }
}
