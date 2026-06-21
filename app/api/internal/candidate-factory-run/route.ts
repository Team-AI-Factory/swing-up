import { NextRequest, NextResponse } from "next/server";
import { Prisma, type RawSignal } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { resolveTickerEntity } from "@/lib/entities/ticker-resolver";
import { buildProofBundleForRawSignal, type ProofBundle } from "@/lib/proof/proof-bundle-builder";
import { evaluateRawSignalQualityGate, receiptsFromRawSignal, ruleInputFromRawSignal } from "@/lib/raw-signal-quality-gate";
import { buildMarketSentimentImpact, loadLatestMarketSentimentSnapshot, scoreSwingUpAlert, type HistoricalPatternMatch, type ScorePreviewInput, type SwingUpScore } from "@/lib/scoring-engine";

const SAFE_ACTIONS = new Set(["Buy Candidate", "Speculative Buy Candidate", "Watch", "Sell Review", "Avoid", "No Action"]);
const CANDIDATE_STATUSES = ["candidate", "needs_more_data", "rejected", "draft", "queued", "review", "ready_for_review"];
const BANNED_WORDING = [/buy\s+now/i, /guaranteed/i, /risk[-\s]?free/i, /strong\s+buy/i, /sure\s+thing/i, /can'?t\s+miss/i, /to\s+the\s+moon/i, /100x/i, /rocket/i];
const DEFAULT_LIMIT = 5;
const DEFAULT_MIN_QUALITY_SCORE = 65;

type JsonRecord = Record<string, unknown>;

type CandidateEvaluation = {
  rawSignalId: string;
  ticker: string;
  company: string;
  eventSummary: string;
  action: string;
  blockedReasons: string[];
  proofSummary: ReturnType<typeof summarizeProof>;
  scoreSummary: ReturnType<typeof summarizeScore>;
  qualityScore: number;
  duplicateCandidateId: string | null;
  candidateAlertId?: string;
};

function text(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function booleanValue(value: unknown, fallback: boolean) {
  if (value === true) return true;
  if (value === false) return false;
  return fallback;
}

function positiveInt(value: unknown, fallback: number) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number.parseInt(value, 10) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(Math.floor(parsed), 25) : fallback;
}

function objectValue(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function hasUnsafeWording(...values: string[]) {
  return BANNED_WORDING.some((pattern) => pattern.test(values.join(" \n ")));
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
  return "low";
}

function sourceHealthAcceptable(proofBundle: ProofBundle | null) {
  const health = proofBundle?.proofs.find((proof) => proof.type === "source_health");
  return !health || health.strength === "medium" || health.strength === "strong";
}

function summarizeProof(proofBundle: ProofBundle | null) {
  if (!proofBundle) return null;
  return {
    rawSignalId: proofBundle.rawSignalId,
    proofCount: proofBundle.proofCount,
    proofTypes: proofBundle.proofTypes,
    strongestProof: proofBundle.strongestProof ? { type: proofBundle.strongestProof.type, strength: proofBundle.strongestProof.strength, source: proofBundle.strongestProof.source, url: proofBundle.strongestProof.url ?? null } : null,
    missingProof: proofBundle.missingProof,
    confidenceHint: proofBundle.confidenceHint,
    confidenceScore: proofBundle.confidenceScore,
    safeToPromote: proofBundle.safeToPromote,
    reasons: proofBundle.reasons,
  };
}

function summarizeScore(score: SwingUpScore | null) {
  if (!score) return null;
  return { source: "preview", profitPotentialScore: score.profitPotentialScore, evidenceConfidenceScore: score.evidenceConfidenceScore, riskLevel: score.riskLevel ?? "missing", pricedInCheck: score.pricedInCheck, suggestedAction: score.suggestedAction, warnings: score.warnings };
}

async function latestUsefulRawSignals(limit: number) {
  return prisma.rawSignal.findMany({
    where: { OR: [{ ticker: { not: null } }, { sourceUrl: { not: null } }, { importanceHint: { in: ["high", "urgent"] } }, { processedStatus: { in: ["new", "queued"] } }] },
    orderBy: [{ receivedAt: "desc" }, { createdAt: "desc" }],
    take: limit,
  });
}

async function latestPatternScore(rawSignalId: string) {
  const match = await prisma.patternMatch.findFirst({ where: { rawSignalId }, orderBy: [{ matchScore: "desc" }, { similarity: "desc" }, { createdAt: "desc" }], select: { id: true, matchScore: true, similarity: true } });
  const score = Number(match?.matchScore ?? match?.similarity ?? Number.NaN);
  return { patternMatchId: match?.id ?? null, score: Number.isFinite(score) ? score : null };
}

async function findDuplicateCandidate(ticker: string, event: string) {
  if (!ticker || !event) return null;
  return prisma.alert.findFirst({ where: { ticker, event, OR: CANDIDATE_STATUSES.map((status) => ({ status: { equals: status, mode: "insensitive" as const } })) }, select: { id: true } });
}

async function evaluateSignal(rawSignal: RawSignal, minQualityScore: number, requireProof: boolean): Promise<CandidateEvaluation> {
  const payload = objectValue(rawSignal.payload);
  const receipts = receiptsFromRawSignal(rawSignal);
  const qualityGate = await evaluateRawSignalQualityGate(ruleInputFromRawSignal(rawSignal), rawSignal.id);
  const proofBundle = await buildProofBundleForRawSignal(rawSignal.id);
  const pattern = await latestPatternScore(rawSignal.id);
  const sentiment = buildMarketSentimentImpact(await loadLatestMarketSentimentSnapshot());
  const resolver = resolveTickerEntity({ ticker: qualityGate.ruleFilterResult.detectedTicker ?? rawSignal.ticker, companyName: qualityGate.ruleFilterResult.detectedCompany ?? payload.company ?? payload.companyName, sourceTitle: rawSignal.title, sourceSummary: rawSignal.summary, sourceProvider: rawSignal.source, rawPayload: rawSignal.payload });
  const ticker = text(resolver.ticker ?? qualityGate.ruleFilterResult.detectedTicker ?? rawSignal.ticker).toUpperCase();
  const company = text(resolver.companyName ?? qualityGate.ruleFilterResult.detectedCompany ?? payload.company ?? payload.companyName, ticker || "Unknown company");
  const eventSummary = text(rawSignal.summary, rawSignal.title);
  const score = scoreSwingUpAlert({ ticker: ticker || company, company, expectedUpsidePercent: Math.max(4, numberValue(payload.expectedUpsidePercent) ?? Math.round(qualityGate.qualityScore / 6)), expectedDownsidePercent: numberValue(payload.expectedDownsidePercent) ?? 8, historicalPatternMatch: patternMatchLabel(pattern.score), valuationSupportScore: numberValue(payload.valuationSupportScore) ?? qualityGate.qualityScore, catalystStrengthScore: numberValue(payload.catalystStrengthScore) ?? qualityGate.qualityScore, sectorSupportScore: 50, macroSupportScore: sentiment.macroSupportScore, sourceQuality: sourceQuality(qualityGate.ruleFilterResult.sourceReliability), independentReceipts: receipts.length, hasConfirmedFilingOrExchangeSource: qualityGate.ruleFilterResult.sourceReliability === "strong", priceVolumeConfirmationScore: proofBundle?.proofTypes.includes("price_volume") ? 70 : 40, financialSupportScore: proofBundle?.proofTypes.includes("fundamentals") ? 70 : 40, verifiedRippleLinks: Math.min(receipts.length, 3), contradictionCount: 0, isRumour: qualityGate.ruleFilterResult.sourceReliability === "weak", sourceRiskScore: qualityGate.ruleFilterResult.sourceReliability === "strong" ? 15 : 35, payload: rawSignal.payload }, sentiment);
  const action = SAFE_ACTIONS.has(score.suggestedAction) ? score.suggestedAction : "No Action";
  const duplicate = await findDuplicateCandidate(ticker, eventSummary);
  const proofBlocked = requireProof && (!proofBundle || proofBundle.safeToPromote !== "yes");
  const blockedReasons = unique([
    ...(!ticker && (!company || company === "Unknown company") ? ["ticker_or_company_not_resolved"] : []),
    ...(resolver.confidence === "none" && !ticker ? ["entity_resolver_no_safe_match"] : []),
    ...(qualityGate.qualityScore < minQualityScore ? ["quality_score_below_minimum"] : []),
    ...(!qualityGate.eligibleForCandidateAlert ? qualityGate.rejectionReasons : []),
    ...(duplicate ? ["duplicate_candidate_exists"] : []),
    ...(proofBlocked ? ["missing_or_insufficient_proof"] : []),
    ...(!sourceHealthAcceptable(proofBundle) ? ["source_health_not_acceptable"] : []),
    ...(!score.riskLevel ? ["risk_missing"] : []),
    ...(!SAFE_ACTIONS.has(score.suggestedAction) ? ["unsafe_action_label"] : []),
    ...(hasUnsafeWording(rawSignal.title, rawSignal.summary, action) ? ["hype_or_unsafe_wording"] : []),
    ...(proofBundle?.safeToPromote === "no" ? proofBundle.reasons : []),
  ]);

  return { rawSignalId: rawSignal.id, ticker, company, eventSummary, action, blockedReasons, proofSummary: summarizeProof(proofBundle), scoreSummary: summarizeScore(score), qualityScore: qualityGate.qualityScore, duplicateCandidateId: duplicate?.id ?? null };
}

async function createCandidate(rawSignal: RawSignal, evaluation: CandidateEvaluation) {
  const score = evaluation.scoreSummary;
  if (!score) throw new Error("score_missing");
  return prisma.$transaction(async (tx) => {
    const alert = await tx.alert.create({ data: { ticker: evaluation.ticker || evaluation.company, company: evaluation.company, action: evaluation.action, event: evaluation.eventSummary, status: "candidate", publishedAt: null } });
    await tx.alertScore.create({ data: { alertId: alert.id, profitPotential: score.profitPotentialScore, evidenceConfidence: score.evidenceConfidenceScore, riskLevel: score.riskLevel, pricedInCheck: score.pricedInCheck } });
    for (const receipt of receiptsFromRawSignal(rawSignal)) {
      await tx.alertSource.create({ data: { alertId: alert.id, sourceType: text(receipt.source, rawSignal.source), receiptUrl: text(receipt.url) || null, summary: text(receipt.label, rawSignal.title) } });
    }
    await tx.patternMatch.updateMany({ where: { rawSignalId: rawSignal.id, alertId: null }, data: { alertId: alert.id } });
    await tx.rawSignal.update({ where: { id: rawSignal.id }, data: { processedStatus: "promoted" } });
    return alert.id;
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const dryRun = booleanValue(body.dryRun ?? body.dry_run, true);
    const rawSignalId = text(body.rawSignalId ?? body.raw_signal_id);
    const limit = positiveInt(body.limit, DEFAULT_LIMIT);
    const minQualityScore = positiveInt(body.minQualityScore ?? body.min_quality_score, DEFAULT_MIN_QUALITY_SCORE);
    const requireProof = booleanValue(body.requireProof ?? body.require_proof, true);
    const warnings = ["Research-only internal runner: no alert publishing, no notification sending, and no paid AI calls."];

    if (!process.env.DATABASE_URL) return NextResponse.json({ ok: true, dryRun, rawSignalsChecked: 0, candidatesCreated: 0, blockedCount: 1, blockedReasons: { runner: ["database_not_configured"] }, proofSummary: [], scoreSummary: [], createdCandidateIds: [], warnings: unique([...warnings, "database_not_configured"]), nextRecommendedAction: "Configure DATABASE_URL before running the candidate factory." });

    const rawSignals = rawSignalId ? await prisma.rawSignal.findMany({ where: { id: rawSignalId }, take: 1 }) : await latestUsefulRawSignals(limit);
    if (rawSignalId && rawSignals.length === 0) return NextResponse.json({ ok: false, dryRun, rawSignalsChecked: 0, candidatesCreated: 0, blockedCount: 1, blockedReasons: { [rawSignalId]: ["raw_signal_not_found"] }, proofSummary: [], scoreSummary: [], createdCandidateIds: [], warnings, nextRecommendedAction: "Provide a valid rawSignalId or omit it to scan latest useful raw signals." }, { status: 404 });

    const evaluations: CandidateEvaluation[] = [];
    const createdCandidateIds: string[] = [];
    for (const rawSignal of rawSignals) {
      const evaluation = await evaluateSignal(rawSignal, minQualityScore, requireProof);
      if (!dryRun && evaluation.blockedReasons.length === 0) {
        evaluation.candidateAlertId = await createCandidate(rawSignal, evaluation);
        createdCandidateIds.push(evaluation.candidateAlertId);
      }
      evaluations.push(evaluation);
    }

    const blocked = evaluations.filter((evaluation) => evaluation.blockedReasons.length > 0);
    const eligible = evaluations.filter((evaluation) => evaluation.blockedReasons.length === 0);
    return NextResponse.json({
      ok: true,
      dryRun,
      rawSignalsChecked: evaluations.length,
      candidatesCreated: createdCandidateIds.length,
      blockedCount: blocked.length,
      blockedReasons: Object.fromEntries(blocked.map((evaluation) => [evaluation.rawSignalId, evaluation.blockedReasons])),
      proofSummary: evaluations.map((evaluation) => ({ rawSignalId: evaluation.rawSignalId, ...evaluation.proofSummary })),
      scoreSummary: evaluations.map((evaluation) => ({ rawSignalId: evaluation.rawSignalId, ...evaluation.scoreSummary, qualityScore: evaluation.qualityScore })),
      createdCandidateIds,
      warnings,
      nextRecommendedAction: dryRun
        ? eligible.length
          ? "Re-run with dryRun=false to create eligible candidate alerts for internal review only."
          : "Improve proof, source health, entity resolution, or quality score before creating candidate alerts."
        : createdCandidateIds.length
          ? "Review created candidate alerts in /admin/candidate-alerts."
          : "No candidate alerts were created; inspect blockedReasons.",
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2023") return NextResponse.json({ ok: false, dryRun: true, rawSignalsChecked: 0, candidatesCreated: 0, blockedCount: 1, blockedReasons: { runner: ["rawSignalId must be a valid UUID"] }, proofSummary: [], scoreSummary: [], createdCandidateIds: [], warnings: [], nextRecommendedAction: "Provide a valid rawSignalId." }, { status: 400 });
    return NextResponse.json({ ok: false, dryRun: true, rawSignalsChecked: 0, candidatesCreated: 0, blockedCount: 1, blockedReasons: { runner: ["candidate_factory_run_failed"] }, proofSummary: [], scoreSummary: [], createdCandidateIds: [], warnings: [error instanceof Error ? error.message : "unknown_error"], nextRecommendedAction: "Check server logs and rerun in dryRun mode." }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ ok: true, message: "POST with { dryRun=true, rawSignalId?, limit?, minQualityScore?, requireProof=true } to score raw signals into internal candidate alert decisions without publishing or notifications." });
}
