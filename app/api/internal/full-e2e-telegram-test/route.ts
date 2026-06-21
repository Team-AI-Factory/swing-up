import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { runSources } from "@/lib/ops/source-runner";
import {
  buildProofBundleForRawSignal,
  type ProofBundle,
} from "@/lib/proof/proof-bundle-builder";
import {
  evaluateRawSignalQualityGate,
  receiptsFromRawSignal,
  ruleInputFromRawSignal,
} from "@/lib/raw-signal-quality-gate";
import {
  buildMarketSentimentImpact,
  loadLatestMarketSentimentSnapshot,
  scoreSwingUpAlert,
  type HistoricalPatternMatch,
  type ScorePreviewInput,
  type SwingUpScore,
} from "@/lib/scoring-engine";
import {
  sendTelegramInternalTestMessage,
  telegramTestConfigStatus,
} from "@/lib/notifications/telegram-test-sender";

const SAFE_ACTIONS = new Set([
  "Buy Candidate",
  "Speculative Buy Candidate",
  "Watch",
  "Sell Review",
  "Avoid",
  "No Action",
]);
const BANNED_WORDING = [
  /buy\s+now/i,
  /guaranteed/i,
  /risk[-\s]?free/i,
  /strong\s+buy/i,
  /sure\s+thing/i,
  /can'?t\s+miss/i,
  /to\s+the\s+moon/i,
  /100x/i,
];

type JsonRecord = Record<string, unknown>;

function text(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function objectValue(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function booleanValue(value: unknown) {
  return value === true;
}

function dryRunValue(value: unknown) {
  return value === false ? false : true;
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

function sourceQuality(
  reliability: string,
): ScorePreviewInput["sourceQuality"] {
  if (reliability === "strong") return "high";
  if (reliability === "medium") return "medium";
  return "low";
}

function sourceHealthAcceptable(proofBundle: ProofBundle | null) {
  const health = proofBundle?.proofs.find(
    (proof) => proof.type === "source_health",
  );
  return (
    !health || health.strength === "medium" || health.strength === "strong"
  );
}

function summarizeProof(proofBundle: ProofBundle | null) {
  if (!proofBundle) return null;
  return {
    proofCount: proofBundle.proofCount,
    proofTypes: proofBundle.proofTypes,
    strongestProof: proofBundle.strongestProof
      ? {
          type: proofBundle.strongestProof.type,
          strength: proofBundle.strongestProof.strength,
          label: proofBundle.strongestProof.label,
          source: proofBundle.strongestProof.source,
          url: proofBundle.strongestProof.url ?? null,
        }
      : null,
    missingProof: proofBundle.missingProof,
    confidenceHint: proofBundle.confidenceHint,
    confidenceScore: proofBundle.confidenceScore,
    safeToPromote: proofBundle.safeToPromote,
    reasons: proofBundle.reasons,
  };
}

function summarizeScore(
  score: SwingUpScore | null,
  persistedScore: {
    id: string;
    profitPotential: number;
    evidenceConfidence: number;
    riskLevel: string;
    pricedInCheck: string | null;
  } | null,
) {
  if (persistedScore)
    return {
      source: "persisted",
      scoreId: persistedScore.id,
      profitPotentialScore: Number(persistedScore.profitPotential ?? 0),
      evidenceConfidenceScore: Number(persistedScore.evidenceConfidence ?? 0),
      riskLevel: persistedScore.riskLevel,
      pricedInCheck: persistedScore.pricedInCheck,
      suggestedAction: null,
      warnings: [],
    };
  if (!score) return null;
  return {
    source: "preview",
    profitPotentialScore: score.profitPotentialScore,
    evidenceConfidenceScore: score.evidenceConfidenceScore,
    riskLevel: score.riskLevel,
    pricedInCheck: score.pricedInCheck,
    suggestedAction: score.suggestedAction,
    warnings: score.warnings,
  };
}

function formatTelegramMessage(input: {
  action: string;
  ticker: string;
  company: string;
  event: string;
  proofCount: number;
  proofTypes: string[];
  proofSource?: string | null;
  score: ReturnType<typeof summarizeScore>;
  wouldPromote: boolean;
  publicTrackingLink?: string | null;
}) {
  const scoreLine = input.score
    ? `Profit Potential: ${input.score.profitPotentialScore}/100\nEvidence Confidence: ${input.score.evidenceConfidenceScore}/100\nRisk Level: ${input.score.riskLevel}`
    : "Profit Potential: unavailable\nEvidence Confidence: unavailable\nRisk Level: unavailable";
  return [
    "Swing Up Test Alert",
    "",
    `${input.action} — ${input.ticker || "UNKNOWN"} / ${input.company || "Unknown company"}`,
    "",
    "What happened:",
    input.event || "No plain-English event summary is available yet.",
    "",
    "Why it matters:",
    `This signal is being checked because it may affect demand, margins, valuation, sentiment, or timing. Promotion preview is ${input.wouldPromote ? "eligible" : "blocked"}.`,
    "",
    "How we checked it:",
    `${input.proofCount} receipt(s) reviewed: ${input.proofTypes.join(", ") || "none"}${input.proofSource ? `; strongest source: ${input.proofSource}` : ""}. Missing proof lowers confidence.`,
    "",
    "Pattern/history:",
    "No strong historical pattern match found yet.",
    "",
    "Ripple effect:",
    "No proven related-company ripple is attached to this Telegram test preview; treat any weak link as watchlist only.",
    "",
    "Risk:",
    `${input.score?.riskLevel ?? "unknown"}; the signal can be stale, already priced in, contradicted by later evidence, or hurt by broader market pressure.`,
    "",
    "Swing Up view:",
    `This is a ${input.action} because the evidence is ${input.wouldPromote ? "strong enough for internal promotion review" : "not strong enough for promotion yet"}, but final review still depends on proof quality, price action, risk, and tracking readiness.`,
    "",
    "Scores:",
    scoreLine,
    "",
    "Tracking:",
    input.publicTrackingLink || "pending",
    "",
    "Internal test only. No user broadcast.",
  ].join("\n");
}

async function latestUsefulRawSignal() {
  return prisma.rawSignal.findFirst({
    where: {
      OR: [
        { ticker: { not: null } },
        { sourceUrl: { not: null } },
        { importanceHint: { in: ["high", "urgent"] } },
        { processedStatus: { in: ["new", "queued", "promoted"] } },
      ],
    },
    orderBy: [{ receivedAt: "desc" }, { createdAt: "desc" }],
  });
}

async function latestPatternScore(rawSignalId: string) {
  const match = await prisma.patternMatch.findFirst({
    where: { rawSignalId },
    orderBy: [
      { matchScore: "desc" },
      { similarity: "desc" },
      { createdAt: "desc" },
    ],
    select: { matchScore: true, similarity: true },
  });
  const score = Number(match?.matchScore ?? match?.similarity ?? Number.NaN);
  return Number.isFinite(score) ? score : null;
}

async function persistedScoreForRawSignal(rawSignalId: string) {
  const alert = await prisma.alert
    .findFirst({
      where: { sources: { some: { receiptUrl: { contains: rawSignalId } } } },
      select: {
        scores: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: {
            id: true,
            profitPotential: true,
            evidenceConfidence: true,
            riskLevel: true,
            pricedInCheck: true,
          },
        },
      },
    })
    .catch(() => null);
  return alert?.scores[0] ?? null;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const dryRun = dryRunValue(body.dryRun ?? body.dry_run);
    const confirmRun = booleanValue(body.confirmRun ?? body.confirm_run);
    const confirmSend = booleanValue(body.confirmSend ?? body.confirm_send);
    const requestedRawSignalId = text(body.rawSignalId ?? body.raw_signal_id);
    const requestedCandidateAlertId = text(
      body.candidateAlertId ?? body.candidate_alert_id,
    );
    const requestedSource = text(body.source);
    const warnings: string[] = [
      "Internal full E2E test runner only; no paid AI calls, payment logic, or real user broadcast.",
    ];
    let sourceRunSummary: Awaited<ReturnType<typeof runSources>> | null = null;
    const runBlocks =
      dryRun || confirmRun ? [] : ["confirmRun_required_for_non_dry_run"];

    if (!process.env.DATABASE_URL) {
      const telegramConfig = telegramTestConfigStatus();
      return NextResponse.json({
        ok: true,
        dryRun,
        selectedRawSignalId: requestedRawSignalId || null,
        ticker: null,
        company: null,
        proofSummary: null,
        scoreSummary: null,
        promotionSummary: {
          wouldPromote: false,
          wouldPersistCandidateAlert: false,
          status: "blocked",
          suggestedAction: "No Action",
          nextRecommendedAction:
            "Configure DATABASE_URL and provide at least one real raw signal before running the full internal pipeline test.",
        },
        telegramMessagePreview:
          "Swing Up Test Alert\n\nNo raw signal selected because DATABASE_URL is not configured.\n\nTracking:\npending\n\nInternal test only. No user broadcast.",
        sentToTelegram: false,
        telegramStatus:
          telegramConfig.botTokenConfigured && telegramConfig.chatIdConfigured
            ? "dry_run"
            : "not_configured",
        blockedReasons: unique([
          ...runBlocks,
          "raw_signal_store_not_configured",
        ]),
        warnings: unique([
          ...warnings,
          "database_not_configured",
          ...(!telegramConfig.botTokenConfigured ||
          !telegramConfig.chatIdConfigured
            ? ["telegram_not_configured"]
            : []),
        ]),
      });
    }

    let rawSignal = requestedRawSignalId
      ? await prisma.rawSignal.findUnique({
          where: { id: requestedRawSignalId },
        })
      : await latestUsefulRawSignal();
    if (!rawSignal && !requestedRawSignalId) {
      sourceRunSummary = await runSources({
        dryRun: true,
        sources: requestedSource ? [requestedSource] : ["GDELT"],
        limit: 1,
        force: false,
      });
      rawSignal = await latestUsefulRawSignal();
    }
    if (!rawSignal)
      return NextResponse.json({
        ok: false,
        dryRun,
        selectedRawSignalId: requestedRawSignalId || null,
        ticker: null,
        company: null,
        proofSummary: null,
        scoreSummary: null,
        promotionSummary: null,
        telegramMessagePreview: null,
        sentToTelegram: false,
        blockedReasons: unique([...runBlocks, "raw_signal_not_found"]),
        warnings,
      });

    const qualityGate = await evaluateRawSignalQualityGate(
      ruleInputFromRawSignal(rawSignal),
      rawSignal.id,
    );
    const proofBundle = await buildProofBundleForRawSignal(rawSignal.id);
    const payload = objectValue(rawSignal.payload);
    const ticker = text(
      qualityGate.ruleFilterResult.detectedTicker ?? rawSignal.ticker,
    ).toUpperCase();
    const company = text(
      qualityGate.ruleFilterResult.detectedCompany ??
        payload.company ??
        payload.companyName,
      ticker || "Unknown company",
    );
    const receipts = receiptsFromRawSignal(rawSignal);
    const persistedScore = await persistedScoreForRawSignal(rawSignal.id);
    const sentiment = buildMarketSentimentImpact(
      await loadLatestMarketSentimentSnapshot(),
    );
    const patternScore = await latestPatternScore(rawSignal.id);
    const previewScore = persistedScore
      ? null
      : scoreSwingUpAlert(
          {
            ticker: ticker || company,
            company,
            expectedUpsidePercent: Math.max(
              4,
              numberValue(payload.expectedUpsidePercent) ??
                Math.round(qualityGate.qualityScore / 6),
            ),
            expectedDownsidePercent:
              numberValue(payload.expectedDownsidePercent) ?? 8,
            historicalPatternMatch: patternMatchLabel(patternScore),
            valuationSupportScore:
              numberValue(payload.valuationSupportScore) ??
              qualityGate.qualityScore,
            catalystStrengthScore:
              numberValue(payload.catalystStrengthScore) ??
              qualityGate.qualityScore,
            sectorSupportScore: 50,
            macroSupportScore: sentiment.macroSupportScore,
            sourceQuality: sourceQuality(
              qualityGate.ruleFilterResult.sourceReliability,
            ),
            independentReceipts: receipts.length,
            hasConfirmedFilingOrExchangeSource:
              qualityGate.ruleFilterResult.sourceReliability === "strong",
            priceVolumeConfirmationScore: proofBundle?.proofTypes.includes(
              "price_volume",
            )
              ? 70
              : 40,
            financialSupportScore: proofBundle?.proofTypes.includes(
              "fundamentals",
            )
              ? 70
              : 40,
            verifiedRippleLinks: Math.min(receipts.length, 3),
            contradictionCount: 0,
            isRumour: qualityGate.ruleFilterResult.sourceReliability === "weak",
            sourceRiskScore:
              qualityGate.ruleFilterResult.sourceReliability === "strong"
                ? 15
                : 35,
            payload: rawSignal.payload,
          },
          sentiment,
        );
    const scoreSummary = summarizeScore(previewScore, persistedScore);
    const action =
      previewScore && SAFE_ACTIONS.has(previewScore.suggestedAction)
        ? previewScore.suggestedAction
        : "No Action";
    const blockedReasons = unique([
      ...runBlocks,
      ...(!ticker && !company ? ["ticker_or_company_not_resolved"] : []),
      ...(!proofBundle ||
      (proofBundle.safeToPromote !== "yes" && receipts.length === 0)
        ? ["missing_clear_proof_source"]
        : []),
      ...(!sourceHealthAcceptable(proofBundle)
        ? ["source_health_not_acceptable"]
        : []),
      ...(hasUnsafeWording(rawSignal.title, rawSignal.summary, action)
        ? ["unsafe_wording"]
        : []),
      ...(!qualityGate.eligibleForCandidateAlert
        ? qualityGate.rejectionReasons
        : []),
      ...(proofBundle?.safeToPromote === "no" ? proofBundle.reasons : []),
    ]);
    const wouldPromote = blockedReasons.length === 0;
    let candidateAlertId = requestedCandidateAlertId || null;
    let publicLedgerSlug: string | null = null;
    let publicAlertUrl: string | null = null;
    let publicLedgerUrl: string | null = null;
    const willCreate = !dryRun && confirmRun && wouldPromote;
    const promotionSummary = {
      wouldPromote,
      wouldPersistCandidateAlert: willCreate && !candidateAlertId,
      candidateAlertId,
      status: wouldPromote ? "candidate" : "blocked",
      suggestedAction: action,
      nextRecommendedAction: wouldPromote
        ? "Candidate alert can be saved for internal review; dry-run does not write."
        : qualityGate.ruleFilterResult.nextRecommendedStage,
    };
    const publishLedgerSummary: Record<string, unknown> = {
      wouldPublishPreview: wouldPromote,
      wouldCreateLedgerPreview: wouldPromote,
      candidateAlertId,
      createdLedger: false,
      publicSlug: null,
      status: willCreate ? "ready_to_create" : "preview_only",
    };

    if (willCreate) {
      const created = await prisma.$transaction(async (tx) => {
        const alert = candidateAlertId
          ? await tx.alert.findUnique({ where: { id: candidateAlertId } })
          : await tx.alert.create({
              data: {
                ticker: ticker || company,
                company,
                action,
                event: text(rawSignal.summary, rawSignal.title),
                status: "candidate",
                publishedAt: null,
              },
            });
        if (!alert) throw new Error("candidate_alert_not_found");
        if (!candidateAlertId && scoreSummary)
          await tx.alertScore.create({
            data: {
              alertId: alert.id,
              profitPotential: scoreSummary.profitPotentialScore,
              evidenceConfidence: scoreSummary.evidenceConfidenceScore,
              riskLevel: scoreSummary.riskLevel ?? "unknown",
              pricedInCheck: scoreSummary.pricedInCheck,
            },
          });
        if (!candidateAlertId)
          for (const proof of proofBundle?.proofs ?? [])
            await tx.alertSource.create({
              data: {
                alertId: alert.id,
                sourceType: proof.source || proof.type,
                receiptUrl: text(proof.url) || null,
                summary: proof.summary,
              },
            });
        await tx.rawSignal
          .update({
            where: { id: rawSignal.id },
            data: { processedStatus: "promoted" },
          })
          .catch(() => undefined);
        const slug = `${
          (ticker || "alert")
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "") || "alert"
        }-${alert.id.slice(0, 8)}`;
        const ledger = await tx.publicLedger.upsert({
          where: { publicSlug: slug },
          update: {},
          create: {
            alertId: alert.id,
            publicSlug: slug,
            entry: {
              alertId: alert.id,
              ticker: ticker || company,
              company,
              action,
              event: text(rawSignal.summary, rawSignal.title),
              outcome: "tracking",
              result:
                "Tracking started; no performance outcome has been classified yet.",
              sourceMode: "internal_e2e_test",
              createdFrom: "api/internal/full-e2e-telegram-test",
              profitPotentialScore: scoreSummary?.profitPotentialScore ?? null,
              evidenceConfidenceScore:
                scoreSummary?.evidenceConfidenceScore ?? null,
              riskLevel: scoreSummary?.riskLevel ?? null,
              receiptsCount: proofBundle?.proofCount ?? 0,
            },
          },
        });
        return { alert, ledger };
      });
      candidateAlertId = created.alert.id;
      publicLedgerSlug = created.ledger.publicSlug;
      publicAlertUrl = `/alerts/${created.alert.id}`;
      publicLedgerUrl = `/public-ledger/${publicLedgerSlug}`;
      promotionSummary.candidateAlertId = candidateAlertId;
      Object.assign(publishLedgerSummary, {
        candidateAlertId,
        createdLedger: true,
        publicSlug: publicLedgerSlug,
        status: "created",
      });
    }

    const strongest = proofBundle?.strongestProof;
    const telegramMessagePreview = formatTelegramMessage({
      action,
      ticker,
      company,
      event: text(rawSignal.summary, rawSignal.title),
      proofCount: proofBundle?.proofCount ?? 0,
      proofTypes: proofBundle?.proofTypes ?? [],
      proofSource: strongest?.url ?? strongest?.source ?? null,
      score: scoreSummary,
      wouldPromote,
      publicTrackingLink: publicLedgerUrl,
    });
    const telegramConfig = telegramTestConfigStatus();
    if (!telegramConfig.botTokenConfigured || !telegramConfig.chatIdConfigured)
      warnings.push("telegram_not_configured");
    const telegramResult = await sendTelegramInternalTestMessage({
      message: telegramMessagePreview,
      dryRun: dryRun || !confirmRun || !willCreate,
      confirmSend,
    });

    return NextResponse.json({
      ok: true,
      dryRun,
      readiness: {
        databaseConfigured: true,
        telegram: telegramConfig,
        sourceRunSummary,
      },
      selectedSource: rawSignal.source,
      selectedRawSignalId: rawSignal.id,
      proofSummary: summarizeProof(proofBundle),
      scoreSummary,
      promotionSummary,
      publishLedgerSummary,
      telegramMessagePreview,
      sentToTelegram: telegramResult.sent,
      telegramStatus: telegramResult.status,
      blockedReasons,
      warnings,
      publicAlertUrl,
      publicLedgerUrl,
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2023"
    )
      return NextResponse.json(
        {
          ok: false,
          dryRun: true,
          selectedRawSignalId: null,
          ticker: null,
          company: null,
          proofSummary: null,
          scoreSummary: null,
          promotionSummary: null,
          telegramMessagePreview: null,
          sentToTelegram: false,
          blockedReasons: ["rawSignalId must be a valid UUID"],
          warnings: [],
        },
        { status: 400 },
      );
    return NextResponse.json(
      {
        ok: false,
        dryRun: true,
        selectedRawSignalId: null,
        ticker: null,
        company: null,
        proofSummary: null,
        scoreSummary: null,
        promotionSummary: null,
        telegramMessagePreview: null,
        sentToTelegram: false,
        blockedReasons: ["e2e_alert_test_failed"],
        warnings: [error instanceof Error ? error.message : "unknown_error"],
      },
      { status: 500 },
    );
  }
}
