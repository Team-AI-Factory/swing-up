import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { Prisma, type RawSignal } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { getEngineStartReadiness } from "@/lib/engine-start-readiness";
import { buildAiCommitteeEvidencePack } from "@/lib/ai-committee/evidence-pack";
import { getAiCommitteeProviderStatus } from "@/lib/ai-committee/provider";
import { runAiCommittee } from "@/lib/ai-committee/orchestrator";
import { runFinalJudge } from "@/lib/ai-committee/final-judge";
import { runApprovalGate } from "@/lib/approval-gate/approval-gate";
import { POST as candidateFactoryPOST } from "@/app/api/internal/candidate-factory-run/route";
import { POST as publishApprovedAlertPOST } from "@/app/api/internal/publish-approved-alert/route";
import { runSources } from "@/lib/ops/source-runner";
import { enrichProofForRawSignal } from "@/lib/proof-enrichment";
import { getR2OperationalStatus, saveJsonToR2 } from "@/lib/r2-warehouse";
import { earRegistrySummary } from "@/lib/ear-registry";
import { scoreSevenLayerEvidence } from "@/lib/catalyst-impact-scoring";
import { withRedactionMetadata } from "@/lib/redact-secrets";
import {
  buildGlobalSchedulerPlan,
  MEANINGFUL_METRIC_REGISTRY,
} from "@/lib/global-ear-scheduler";
import { runGenericNewsTriage } from "@/lib/generic-news-triage";

export const dynamic = "force-dynamic";

function redactedJson(payload: Record<string, unknown>, init?: ResponseInit) {
  return NextResponse.json(withRedactionMetadata(payload), init);
}

type JsonRecord = Record<string, unknown>;
type SignalGrade = "A" | "B" | "C" | "D" | "F";

type GreatSignalScorecard = {
  catalystStrengthScore: number;
  directAssetMatchScore: number;
  proofQualityScore: number;
  proofDiversityScore: number;
  businessImpactScore: number;
  timingScore: number;
  priceVolumeContextScore: number;
  fundamentalsSupportScore: number;
  officialProofScore: number;
  historicalMemoryScore: number;
  riskClarityScore: number;
  noisePenalty: number;
  hypePenalty: number;
  unsafeProofPenalty: number;
  missingProofPenalty: number;
  finalGreatSignalScore: number;
  signalGrade: SignalGrade;
  whyItCouldBeGreat: string[];
  whyItIsBlocked: string[];
  nextBestProofToFetch: string;
};

type DiscoveryRow = {
  rawSignalId: string;
  ticker: string | null;
  source: string;
  title: string;
  receivedAt: string;
  passed: boolean;
  blockedReasons: string[];
  qualityScore: number;
  evidenceConfidenceScore: number;
  suggestedAction: string | null;
  beforeProofCount: number;
  afterProofCount: number;
  beforeConfidenceScore: number;
  afterConfidenceScore: number;
  passedAfterEnrichment: boolean;
  proofAddedTypes: string[];
  stillMissingProof: string[];
  catalystImpactScore: number | null;
  stockSpecificityScore: number | null;
  directTickerMatch: boolean | null;
  directCompanyMatch: boolean | null;
  hasReceiptUrl: boolean | null;
  freshWithin72h: boolean | null;
  promotionScore: number | null;
  bestFailureReason: string | null;
  unsafeProofMismatchWarning: boolean;
  proofMatchQuality: number;
  proofDiversity: number;
  eligibleForBest: boolean;
  reasonNotPromoted: string | null;
  sevenLayerEvidence: ReturnType<typeof scoreSevenLayerEvidence>;
  greatSignalScorecard: GreatSignalScorecard;
  finalGreatSignalScore: number;
  signalGrade: SignalGrade;
  whyItCouldBeGreat: string[];
  whyItIsBlocked: string[];
  nextBestProofToFetch: string;
};

const MIN_STOCK_SPECIFICITY_SCORE = 55;
const MIN_CATALYST_IMPACT_SCORE = 55;
const MIN_PROMOTION_SCORE = 55;
const CORE_PROOF_TYPES = new Set([
  "price_volume",
  "fundamentals",
  "pattern_match",
]);

const VALID_CANDIDATE_PROOF_TYPES = new Set([
  "filing",
  "news",
  "price_volume",
  "fundamentals",
  "pattern_match",
  "insider",
  "regulatory",
  "contract",
  "legal_risk",
]);

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function nextBestProof(missingProof: string[]) {
  const priority = [
    "filing",
    "price_volume",
    "fundamentals",
    "pattern_match",
    "regulatory",
    "insider",
    "contract",
    "legal_risk",
    "news",
  ];
  return priority.find((type) => missingProof.includes(type)) ?? "none";
}

function gradeFromScore(
  score: number,
  blocked: string[],
  proofTypes: string[],
) {
  const cleanProofTypes = proofTypes.filter((type) =>
    VALID_CANDIDATE_PROOF_TYPES.has(type),
  );
  const newsOnly =
    cleanProofTypes.length === 1 && cleanProofTypes[0] === "news";
  const opinionOnly = blocked.some((reason) => /opinion/i.test(reason));
  if (blocked.includes("source_health_is_diagnostic_not_proof") || score < 20)
    return "F" as const;
  if (score >= 82 && blocked.length === 0 && !newsOnly && !opinionOnly)
    return "A" as const;
  if (score >= 62 && !opinionOnly && !newsOnly) return "B" as const;
  if (score >= 42) return "C" as const;
  if (score >= 20) return "D" as const;
  return "F" as const;
}

function buildGreatSignalScorecard(input: {
  signal: RawSignal;
  blockedReasons: string[];
  enrichment: Awaited<ReturnType<typeof enrichProofForRawSignal>>;
  impact: ReturnType<typeof payloadImpact>;
}): GreatSignalScorecard {
  const { signal, blockedReasons, enrichment, impact } = input;
  const proofTypes = enrichment.proofTypes.filter((type) =>
    VALID_CANDIDATE_PROOF_TYPES.has(type),
  );
  const proofSet = new Set(proofTypes);
  const missingProof = enrichment.missingProof.filter((type) =>
    VALID_CANDIDATE_PROOF_TYPES.has(type),
  );
  const title = `${signal.title} ${signal.summary}`.toLowerCase();
  const genericNoise = isBroadMarketNoise({
    directTickerMatch: impact.directTickerMatch,
    directCompanyMatch: impact.directCompanyMatch,
    stockSpecificityScore: impact.stockSpecificityScore,
    title: signal.title,
  });
  const opinionOnly =
    /opinion|commentary|why i think|could be|might be|rumor/.test(title);
  const hype =
    /moon|rocket|explosive|massive upside|guaranteed|can't miss|game.?changer/i.test(
      title,
    );
  const sourceHealthRejected = enrichment.rejectedProofReasons.includes(
    "source_health_is_diagnostic_not_proof",
  );
  const catalystStrengthScore = clampScore(impact.catalystImpactScore ?? 0);
  const directAssetMatchScore = impact.directTickerMatch
    ? 100
    : impact.directCompanyMatch
      ? 75
      : 15;
  const proofQualityScore = enrichment.acceptedProofItems.length
    ? Math.max(
        ...enrichment.acceptedProofItems.map((item) => item.proofMatchScore),
      )
    : 0;
  const proofDiversityScore = clampScore((new Set(proofTypes).size / 4) * 100);
  const businessImpactScore = clampScore(
    impact.promotionScore ?? catalystStrengthScore,
  );
  const timingScore = impact.freshWithin72h ? 100 : 35;
  const priceVolumeContextScore = proofSet.has("price_volume") ? 100 : 0;
  const fundamentalsSupportScore = proofSet.has("fundamentals") ? 100 : 0;
  const officialProofScore =
    proofSet.has("filing") || proofSet.has("regulatory")
      ? 100
      : proofSet.has("contract") ||
          proofSet.has("legal_risk") ||
          proofSet.has("insider")
        ? 75
        : 0;
  const historicalMemoryScore = proofSet.has("pattern_match") ? 100 : 0;
  const riskClarityScore = enrichment.rejectedProofItems.length ? 35 : 80;
  const noisePenalty = genericNoise ? 25 : 0;
  const hypePenalty = hype || opinionOnly ? 20 : 0;
  const unsafeProofPenalty =
    input.enrichment.rejectedProofItems.length &&
    !input.enrichment.acceptedProofItems.length
      ? 30
      : 0;
  const missingProofPenalty = Math.min(35, missingProof.length * 7);
  const positive =
    catalystStrengthScore * 0.16 +
    directAssetMatchScore * 0.14 +
    proofQualityScore * 0.18 +
    proofDiversityScore * 0.12 +
    businessImpactScore * 0.12 +
    timingScore * 0.08 +
    priceVolumeContextScore * 0.06 +
    fundamentalsSupportScore * 0.06 +
    officialProofScore * 0.04 +
    historicalMemoryScore * 0.02 +
    riskClarityScore * 0.02;
  const finalGreatSignalScore = clampScore(
    positive -
      noisePenalty -
      hypePenalty -
      unsafeProofPenalty -
      missingProofPenalty -
      (sourceHealthRejected ? 20 : 0),
  );
  const whyItCouldBeGreat = [
    ...(catalystStrengthScore >= 55 ? ["Real catalyst detected."] : []),
    ...(impact.directTickerMatch
      ? ["Direct ticker match found."]
      : impact.directCompanyMatch
        ? ["Direct company match found."]
        : []),
    ...(impact.hasReceiptUrl ? ["Specific receipt URL exists."] : []),
    ...(proofSet.has("filing") ? ["Official filing proof is present."] : []),
    ...(proofSet.has("price_volume")
      ? ["Price/volume context is present."]
      : []),
    ...(proofSet.has("fundamentals")
      ? ["Fundamentals support is present."]
      : []),
    ...(proofSet.has("pattern_match")
      ? ["Historical pattern support is present."]
      : []),
  ];
  const whyItIsBlocked = [
    ...blockedReasons,
    ...(proofTypes.length < 2
      ? ["Needs at least two clean proof types beyond the raw source."]
      : []),
    ...(opinionOnly
      ? ["Opinion-only content cannot receive an A or B grade."]
      : []),
    ...(genericNoise
      ? ["Generic market/news noise is not specific enough yet."]
      : []),
    ...(sourceHealthRejected ? ["source_health_is_diagnostic_not_proof"] : []),
    ...(missingProof.length
      ? [`Missing proof: ${missingProof.join(", ")}.`]
      : []),
  ];
  const signalGrade = gradeFromScore(
    finalGreatSignalScore,
    whyItIsBlocked,
    proofTypes,
  );
  return {
    catalystStrengthScore,
    directAssetMatchScore,
    proofQualityScore,
    proofDiversityScore,
    businessImpactScore,
    timingScore,
    priceVolumeContextScore,
    fundamentalsSupportScore,
    officialProofScore,
    historicalMemoryScore,
    riskClarityScore,
    noisePenalty,
    hypePenalty,
    unsafeProofPenalty,
    missingProofPenalty,
    finalGreatSignalScore,
    signalGrade,
    whyItCouldBeGreat,
    whyItIsBlocked,
    nextBestProofToFetch: nextBestProof(missingProof),
  };
}

function truthyRank(value: boolean | null | undefined) {
  return value === true ? 1 : 0;
}
function numericRank(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : -1;
}
function arrayIncludes(values: string[], item: string) {
  return values.includes(item);
}

function isBroadMarketNoise(
  row: Pick<
    DiscoveryRow,
    | "directTickerMatch"
    | "directCompanyMatch"
    | "stockSpecificityScore"
    | "title"
  >,
) {
  const title = row.title.toLowerCase();
  return (
    row.directTickerMatch !== true &&
    row.directCompanyMatch !== true &&
    (row.stockSpecificityScore === null ||
      row.stockSpecificityScore < MIN_STOCK_SPECIFICITY_SCORE ||
      /market cap|markets?|index|sector|economy|stocks?\b|overtakes/i.test(
        title,
      ))
  );
}

function bestEligibilityFailure(row: DiscoveryRow) {
  const failures = [
    ...(row.unsafeProofMismatchWarning
      ? ["unsafe_proof_mismatch_warning"]
      : []),
    ...(row.directTickerMatch !== true ? ["direct_ticker_match_required"] : []),
    ...(numericRank(row.stockSpecificityScore) < MIN_STOCK_SPECIFICITY_SCORE
      ? ["stock_specificity_below_threshold"]
      : []),
    ...(numericRank(row.catalystImpactScore) < MIN_CATALYST_IMPACT_SCORE
      ? ["catalyst_impact_below_threshold"]
      : []),
    ...(numericRank(row.promotionScore) < MIN_PROMOTION_SCORE
      ? ["promotion_score_below_threshold"]
      : []),
    ...(row.hasReceiptUrl !== true ? ["specific_receipt_url_required"] : []),
    ...(isBroadMarketNoise(row) ? ["broad_market_or_news_noise"] : []),
    ...(row.blockedReasons.includes("low_impact") &&
    !row.proofAddedTypes.some((type) => CORE_PROOF_TYPES.has(type))
      ? ["low_impact_without_price_fundamental_or_pattern_support"]
      : []),
    ...(row.passed !== true ? ["candidate_factory_gates_not_passed"] : []),
  ];
  return failures;
}

function sortDiscoveryRows(rows: DiscoveryRow[]) {
  return rows.sort(
    (a, b) =>
      truthyRank(b.directTickerMatch) - truthyRank(a.directTickerMatch) ||
      truthyRank(!b.unsafeProofMismatchWarning) -
        truthyRank(!a.unsafeProofMismatchWarning) ||
      numericRank(b.promotionScore) - numericRank(a.promotionScore) ||
      numericRank(b.catalystImpactScore) - numericRank(a.catalystImpactScore) ||
      numericRank(b.stockSpecificityScore) -
        numericRank(a.stockSpecificityScore) ||
      b.proofMatchQuality - a.proofMatchQuality ||
      truthyRank(b.freshWithin72h) - truthyRank(a.freshWithin72h) ||
      b.proofDiversity - a.proofDiversity ||
      Number(b.qualityScore ?? 0) - Number(a.qualityScore ?? 0),
  );
}

const DEFAULT_PAYLOAD = {
  dryRun: true,
  confirmRun: false,
  confirmPublish: false,
  confirmSend: false,
  maxAlertsToPublish: 1,
  allowTelegram: false,
  maxRawSignalsToInspect: 50,
  maxFreshPullPerSource: 3,
  freshnessWindowHours: 72,
  excludeLowImpactReferenceUpdates: true,
};

const PUBLIC_DRY_RUN_EXAMPLE_BODY = {
  dryRun: true,
  confirmRun: false,
  confirmPublish: false,
  confirmSend: false,
  maxAlertsToPublish: 1,
  allowTelegram: false,
  maxRawSignalsToInspect: 50,
  maxFreshPullPerSource: 3,
  freshnessWindowHours: 72,
};

export async function GET() {
  return redactedJson({
    ok: false,
    route: "/api/internal/run-live-alert-cycle",
    methodRequired: "POST",
    message:
      "Use POST with a dry-run payload, or use the Stage 1 Dry Run button on /ops/engine-control.",
    engineControlUrl:
      "https://swing-up-production.up.railway.app/ops/engine-control",
    exampleBody: PUBLIC_DRY_RUN_EXAMPLE_BODY,
  });
}

function bool(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function int(value: unknown, fallback: number) {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseInt(value, 10)
        : Number.NaN;
  return Number.isFinite(parsed) ? Math.floor(parsed) : fallback;
}

function arrayText(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => String(item)).filter(Boolean)
    : [];
}

function payloadImpact(signal: Pick<RawSignal, "payload">) {
  const payload = obj(signal.payload);
  const impact = obj(payload.catalystImpact);
  return {
    catalystImpactScore:
      typeof impact.promotionScore === "number" ? impact.promotionScore : null,
    stockSpecificityScore:
      typeof impact.stockSpecificityScore === "number"
        ? impact.stockSpecificityScore
        : null,
    directTickerMatch:
      typeof impact.directTickerMatch === "boolean"
        ? impact.directTickerMatch
        : null,
    directCompanyMatch:
      typeof impact.directCompanyMatch === "boolean"
        ? impact.directCompanyMatch
        : null,
    hasReceiptUrl:
      typeof impact.hasReceiptUrl === "boolean" ? impact.hasReceiptUrl : null,
    freshWithin72h:
      typeof impact.freshWithin72h === "boolean" ? impact.freshWithin72h : null,
    promotionScore:
      typeof impact.promotionScore === "number" ? impact.promotionScore : null,
    likelyMarketImpact: text(impact.likelyMarketImpact) || null,
    catalystType: text(impact.catalystType) || null,
  };
}

function obj(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function isApproved(value: unknown) {
  const record = obj(value);
  return (
    record.approvalRecommendation === "approve" &&
    arrayText(record.failedChecks).length === 0
  );
}

const DISCOVERY_SOURCE_PRIORITY = [
  "FMP Catalyst",
  "Marketaux Catalyst",
  "Alpha Vantage Catalyst",
  "SEC EDGAR",
  "GDELT",
  "Google News RSS",
  "openFDA",
  "CoinGecko",
  "FRED Macro",
  "Frankfurter FX",
] as const;
type DiscoverySource = (typeof DISCOVERY_SOURCE_PRIORITY)[number];

function discoverySources(preferredSources: string[]) {
  const known = new Set<string>(DISCOVERY_SOURCE_PRIORITY);
  const preferred = preferredSources.filter((source) => known.has(source));
  return (
    preferred.length ? preferred : [...DISCOVERY_SOURCE_PRIORITY]
  ) as DiscoverySource[];
}

function sourceRank(
  source: string,
  sources = DISCOVERY_SOURCE_PRIORITY as readonly string[],
) {
  const index = sources.indexOf(source);
  return index === -1 ? sources.length + 1 : index;
}

function isLowImpactReferenceUpdate(
  signal: Pick<
    RawSignal,
    "source" | "importanceHint" | "title" | "summary" | "payload"
  >,
) {
  if (signal.source !== "Frankfurter FX") return false;
  const textBlob = `${signal.title} ${signal.summary}`.toLowerCase();
  const payload = obj(signal.payload);
  return (
    signal.importanceHint === "low" ||
    textBlob.includes("reference update") ||
    payload.usefulContext === "reference_update"
  );
}

async function latestUsefulRawSignals(
  limit: number,
  sources: string[],
  excludeLowImpactReferenceUpdates: boolean,
  freshnessWindowHours?: number,
) {
  const candidates = await prisma.rawSignal.findMany({
    where: {
      source: { in: sources },
      ...(freshnessWindowHours
        ? {
            receivedAt: {
              gte: new Date(Date.now() - freshnessWindowHours * 60 * 60 * 1000),
            },
          }
        : {}),
      OR: [
        { ticker: { not: null } },
        { sourceUrl: { not: null } },
        { importanceHint: { in: ["high", "urgent"] } },
        { processedStatus: { in: ["new", "queued", "promoted"] } },
      ],
    },
    orderBy: [{ receivedAt: "desc" }, { createdAt: "desc" }],
    take: Math.max(limit * 3, limit),
  });
  return candidates
    .filter(
      (signal) =>
        !excludeLowImpactReferenceUpdates ||
        !isLowImpactReferenceUpdate(signal),
    )
    .sort(
      (a, b) =>
        sourceRank(a.source, sources) - sourceRank(b.source, sources) ||
        b.receivedAt.getTime() - a.receivedAt.getTime() ||
        b.createdAt.getTime() - a.createdAt.getTime(),
    )
    .slice(0, limit);
}

async function jsonFromRoute(response: Response) {
  return (await response.json().catch(() => ({}))) as JsonRecord;
}

function baseResponse(input: {
  dryRun: boolean;
  readiness: unknown;
  warnings?: string[];
}) {
  return {
    ok: true,
    dryRun: input.dryRun,
    stage: "initialized",
    readiness: input.readiness,
    rawWarehouseAvailable: false,
    rawWarehouseWriteUnavailable: true,
    rawDataStored: false,
    storageMode: "postgresql_summary_only",
    reasonStorageFallback: "R2 write/delete health has not been checked yet.",
    rawWarehouseStatus: {},
    earRegistrySummary: earRegistrySummary(),
    sourceSummary: {},
    selectedRawSignalId: null as string | null,
    rawSignalSummary: {},
    candidateDiscoverySummary: {},
    greatSignalSummary: {},
    catalystSummary: {},
    proofEnrichmentSummary: {},
    candidateSummary: {},
    evidencePackSummary: {},
    aiCommitteeSummary: {},
    finalJudgeSummary: {},
    approvalGateSummary: {},
    publishLedgerSummary: {},
    genericNewsScanned: 0,
    seriousGenericSignalsFound: 0,
    rippleCandidatesCreated: 0,
    genericSignalsRejectedAsNoise: 0,
    topGenericSignal: null as unknown,
    affectedTickersFromGenericNews: [] as string[],
    deepChecksTriggeredByGenericNews: [] as unknown[],
    callsSavedByGenericTriage: 0,
    genericNewsDidNotBypassProofGate: true,
    seriousSignalsFound: 0,
    genericRippleCandidates: [] as unknown[],
    directCompanyCatalysts: [] as unknown[],
    opinionOnlyRejected: [] as unknown[],
    proofFillingAttempts: [] as unknown[],
    proofFilledBySource: {} as Record<string, unknown>,
    remainingProofGaps: [] as string[],
    bestSeriousCandidate: null as unknown,
    topRejectedButInterestingSignals: [] as unknown[],
    nextBestEarToImprove: null as string | null,
    recommendedDeepProofCalls: [] as unknown[],
    signalFound: false,
    aiCommitteeRan: false,
    approved: false,
    publishable: false,
    published: false,
    publicAlertUrl: null as string | null,
    publicLedgerUrl: null as string | null,
    sentToTelegram: false,
    blockers: [] as string[],
    warnings: input.warnings ?? [],
    nextRecommendedAction:
      "Run the live alert cycle only with explicit confirmations.",
  };
}

function stage1DateKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function safeSourceSlug(source: string) {
  return (
    (source || "unknown")
      .toLowerCase()
      .replace(/[^a-z0-9._=-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "unknown"
  );
}

async function saveStage1RawObject(
  output: JsonRecord,
  r2WriteAvailable: boolean,
  key: string,
  payload: unknown,
  metadata: Record<string, unknown>,
) {
  if (!r2WriteAvailable) return null;
  try {
    const row = await saveJsonToR2(key, payload, {
      ...metadata,
      source: String(metadata.source ?? "stage1"),
      assetType: String(metadata.assetType ?? "stage1"),
      dataType: String(metadata.dataType ?? "run-payload"),
    });
    output.rawDataStored = true;
    const existing = Array.isArray(output.rawDataObjectKeys)
      ? output.rawDataObjectKeys
      : [];
    output.rawDataObjectKeys = [...existing, row?.r2Key ?? key];
    return row?.r2Key ?? key;
  } catch (error) {
    output.rawDataStored = false;
    output.storageMode = "postgresql_summary_only";
    output.rawWarehouseWriteUnavailable = true;
    output.reasonStorageFallback =
      "R2 raw object save failed; Stage 1 continued with PostgreSQL summary-only fallback.";
    output.rawStorageErrorCategory =
      error instanceof Error && /status (\d+)/i.test(error.message)
        ? `r2_save_http_${error.message.match(/status (\d+)/i)?.[1]}`
        : "r2_save_failed";
    return null;
  }
}

export async function POST(request: NextRequest) {
  const body: JsonRecord = {
    ...DEFAULT_PAYLOAD,
    ...((await request.json().catch(() => ({}))) as JsonRecord),
  };
  const dryRun = bool(body.dryRun, true);
  const confirmRun = bool(body.confirmRun, false);
  const confirmPublish = bool(body.confirmPublish, false);
  const confirmSend = bool(body.confirmSend, false);
  const allowTelegram = bool(body.allowTelegram, false);
  const maxAlertsToPublish = Math.min(
    Math.max(int(body.maxAlertsToPublish, 1), 0),
    1,
  );
  const rawSignalId = text(body.rawSignalId);
  let candidateAlertId = text(body.candidateAlertId);
  const source = text(body.source);
  const preferredSources = discoverySources(
    arrayText(body.preferredSources).length
      ? arrayText(body.preferredSources)
      : source
        ? [source]
        : [],
  );
  const maxRawSignalsToInspect = Math.min(
    Math.max(int(body.maxRawSignalsToInspect, 50), 1),
    100,
  );
  const maxFreshPullPerSource = Math.min(
    Math.max(int(body.maxFreshPullPerSource, 3), 1),
    3,
  );
  const freshnessWindowHours = Math.min(
    Math.max(int(body.freshnessWindowHours, 72), 1),
    24 * 14,
  );
  const excludeLowImpactReferenceUpdates = bool(
    body.excludeLowImpactReferenceUpdates,
    true,
  );
  const universeMode = text(body.universeMode) || "watchlist";
  const maxAssetsToPlan = Math.min(
    Math.max(int(body.maxAssetsToPlan, 1000), 1),
    10000,
  );
  const maxAssetsToScanNow = Math.min(
    Math.max(int(body.maxAssetsToScanNow, 50), 1),
    maxAssetsToPlan,
  );
  const maxDeepScans = Math.min(
    Math.max(int(body.maxDeepScans, 5), 0),
    maxAssetsToScanNow,
  );
  const warnings = [
    "Telegram is disabled for this founder website test; this route never sends Telegram.",
    ...(confirmSend || allowTelegram
      ? ["confirmSend/allowTelegram were ignored by this route."]
      : []),
  ];

  try {
    const [readiness, r2Health] = await Promise.all([
      getEngineStartReadiness(),
      getR2OperationalStatus({
        allowRuntimeWriteCheck: bool(body.allowRuntimeR2WriteCheck, false),
      }),
    ]);
    const r2WriteAvailable = r2Health.writeAvailable;
    const storageMode = r2Health.storageMode;
    const reasonStorageFallback = r2WriteAvailable
      ? null
      : r2Health.configured
        ? `R2 read health is ${r2Health.canRead ? "available" : "unavailable"}, but write/delete is unavailable; Stage 1 is continuing with PostgreSQL summaries and rawDataStored=false.`
        : `R2 is not fully configured (${r2Health.rawHealth.missingEnvVars.join(", ") || "missing configuration"}); Stage 1 is continuing with PostgreSQL summaries and rawDataStored=false.`;
    const globalSchedulerPlan = buildGlobalSchedulerPlan({
      dryRun,
      universeMode,
      maxAssetsToPlan,
      maxAssetsToScanNow,
      maxDeepScans,
      respectProviderLimits: true,
      confirmRun,
      r2RawStorageReady: r2WriteAvailable,
    });
    const genericTriage = await runGenericNewsTriage({
      maxGenericItemsToScan: Math.min(maxRawSignalsToInspect, 50),
      maxRippleCandidates: Math.min(maxDeepScans || 10, 10),
      maxDeepChecks: confirmRun ? maxDeepScans : 0,
      confirmRun,
      freshnessWindowHours,
    });
    const output = {
      ...baseResponse({ dryRun, readiness, warnings }),
      universeMode,
      assetsConsidered: globalSchedulerPlan.assetsConsidered,
      globalCoveragePercent: universeMode === "global" ? 100 : 0,
      sourcesConsideredPerAsset: globalSchedulerPlan.sourcesConsideredPerAsset,
      sourcesConsidered: globalSchedulerPlan.sourcesConsidered,
      wideScanCount: globalSchedulerPlan.wideScansPlanned,
      deepScanCount: globalSchedulerPlan.deepScansPlanned,
      meaningfulMetricsCalculated: MEANINGFUL_METRIC_REGISTRY.map(
        (metric) => metric.name,
      ),
      highestValueCallsUsed: confirmRun
        ? globalSchedulerPlan.highestValueNextCalls
        : [],
      genericNewsScanned: genericTriage.genericItemsScannedToday,
      seriousGenericSignalsFound: genericTriage.seriousGenericSignalsFound,
      rippleCandidatesCreated: genericTriage.rippleCandidatesCreated,
      genericSignalsRejectedAsNoise:
        genericTriage.genericSignalsRejectedAsNoise,
      topGenericSignal: genericTriage.topGenericSignal,
      affectedTickersFromGenericNews:
        genericTriage.affectedTickersFromGenericNews,
      deepChecksTriggeredByGenericNews:
        genericTriage.deepChecksTriggeredByGenericNews,
      callsSavedByGenericTriage: genericTriage.callsSavedByGenericTriage,
      genericNewsDidNotBypassProofGate: true,
      seriousSignalsFound: genericTriage.seriousGenericSignalsFound,
      genericRippleCandidates: Array.isArray(genericTriage.classifications)
        ? (genericTriage.classifications
            .filter((item) => obj(item).rippleCandidate === true)
            .slice(0, 10) as unknown[])
        : ([] as unknown[]),
      directCompanyCatalysts: [] as unknown[],
      opinionOnlyRejected: Array.isArray(genericTriage.classifications)
        ? (genericTriage.classifications
            .filter((item) =>
              text(obj(item).rejectedReason).includes("opinion"),
            )
            .slice(0, 10) as unknown[])
        : ([] as unknown[]),
      proofFillingAttempts: [] as unknown[],
      proofFilledBySource: {} as Record<string, unknown>,
      remainingProofGaps: [
        "at least 2 clean proof types beyond raw source",
        "clean direct ticker/company/topic match",
      ],
      bestSeriousCandidate: (genericTriage.topGenericSignal ?? null) as unknown,
      topRejectedButInterestingSignals: Array.isArray(
        genericTriage.classifications,
      )
        ? (genericTriage.classifications
            .filter(
              (item) =>
                obj(item).rippleCandidate !== true &&
                numericRank(obj(item).seriousnessScore as number | null) >= 55,
            )
            .slice(0, 5) as unknown[])
        : ([] as unknown[]),
      nextBestEarToImprove: null as string | null,
      recommendedDeepProofCalls:
        genericTriage.deepChecksTriggeredByGenericNews as unknown[],
      genericNewsTriageSummary: {
        enabled: genericTriage.enabled,
        broadSourcesUsed: genericTriage.broadSourcesUsed,
        topGenericSignalTypes: genericTriage.topGenericSignalTypes,
        topAffectedSectors: genericTriage.topAffectedSectors,
        topAffectedTickers: genericTriage.topAffectedTickers,
        exampleRejectedAsNoise: genericTriage.exampleRejectedAsNoise,
        examplePromotedIntoRippleCandidate:
          genericTriage.examplePromotedIntoRippleCandidate,
        noOpenAIWhenConfirmRunFalse: confirmRun !== true,
        noPublish: true,
        noTelegram: true,
      },
      callsSkippedToAvoidWaste: [
        `${genericTriage.callsSavedByGenericTriage} generic-news deep checks saved by triage`,
        "generic broad market articles",
        "ticker-only comparisons",
        "stale proof",
        "unrelated topics",
        "Alpha Vantage backup call skipped unless a proof gap remains",
      ],
      proofGapsRemaining: [
        "at least 2 clean proof types beyond raw source",
        "clean direct ticker/company/topic match",
      ],
      rawWarehouseAvailable: r2Health.connected || r2Health.canRead,
      rawWarehouseWriteUnavailable: !r2WriteAvailable,
      rawDataStored: false,
      storageMode,
      reasonStorageFallback,
      runId: crypto.randomUUID(),
      rawDataObjectKeys: [] as string[],
      rawWarehouseStatus: {
        configured: r2Health.configured,
        connected: r2Health.connected,
        bucket: r2Health.rawHealth.bucket,
        canRead: r2Health.canRead,
        canWrite: r2Health.canWrite,
        canDelete: r2Health.canDelete,
        writeAvailable: r2WriteAvailable,
        mode: storageMode,
        storageMode,
        lastConfirmedWriteAt: r2Health.lastConfirmedWriteAt,
        lastConfirmedDeleteAt: r2Health.lastConfirmedDeleteAt,
        sourceOfTruth: r2Health.sourceOfTruth,
        missingEnvVars: r2Health.rawHealth.missingEnvVars,
        errorCategory: r2Health.rawHealth.errorCategory,
        errorMessageSafe: r2Health.rawHealth.errorMessageSafe,
        suspectedCause: r2Health.rawHealth.suspectedCause,
        nextAction: r2Health.rawHealth.nextAction,
      },
    };
    if (!confirmRun && !dryRun) {
      return redactedJson({
        ...output,
        stage: "dry_run_confirm_required",
        blockers: dryRun ? [] : ["confirmRun_required"],
        nextRecommendedAction:
          "Set confirmRun=true only when you intend to inspect real source data. No OpenAI, publish, or Telegram actions ran.",
      });
    }
    if (!readiness.readyForFirstPublicAlert) {
      return redactedJson(
        {
          ...output,
          ok: false,
          stage: "readiness_blocked",
          blockers: readiness.blockers,
          nextRecommendedAction:
            readiness.exactNextFixes?.[0] ??
            "Resolve engine-start readiness blockers before running a live alert cycle.",
        },
        { status: 503 },
      );
    }
    if (!process.env.DATABASE_URL) {
      return redactedJson(
        {
          ...output,
          ok: false,
          stage: "database_blocked",
          blockers: ["database_not_configured"],
          nextRecommendedAction:
            "Configure DATABASE_URL before selecting a real raw signal.",
        },
        { status: 503 },
      );
    }

    const catalystSources = [
      "FMP Catalyst",
      "Marketaux Catalyst",
      "Alpha Vantage Catalyst",
    ];
    let sourceSummary: unknown = null;
    if (!rawSignalId) {
      const catalystToAttempt = catalystSources.filter((provider) =>
        provider === "FMP Catalyst"
          ? Boolean(process.env.FMP_API_KEY)
          : provider === "Marketaux Catalyst"
            ? Boolean(process.env.MARKETAUX_API_KEY)
            : Boolean(process.env.ALPHA_VANTAGE_API_KEY),
      );
      sourceSummary = catalystToAttempt.length
        ? await runSources({
            dryRun: false,
            sources: catalystToAttempt,
            limit: maxFreshPullPerSource,
            tickers: [
              "NVDA",
              "AAPL",
              "MSFT",
              "TSLA",
              "AMZN",
              "META",
              "GOOGL",
              "AMD",
              "SHOP",
              "PLTR",
            ],
            force: true,
          }).catch((error: unknown) => ({
            ok: false,
            error:
              error instanceof Error
                ? error.message
                : "catalyst_source_run_unavailable",
            table: [],
          }))
        : { ok: true, dryRun: false, sourcesRequested: [], table: [] };
    }
    let rawSignals: RawSignal[] = rawSignalId
      ? await prisma.rawSignal.findMany({ where: { id: rawSignalId }, take: 1 })
      : await latestUsefulRawSignals(
          maxRawSignalsToInspect,
          preferredSources,
          excludeLowImpactReferenceUpdates,
          freshnessWindowHours,
        );
    if (
      rawSignals.length < Math.min(3, maxRawSignalsToInspect) &&
      !rawSignalId
    ) {
      const fallbackSummary = await runSources({
        dryRun: false,
        sources: preferredSources
          .filter((source) => !catalystSources.includes(source))
          .slice(0, 4),
        limit: maxFreshPullPerSource,
        force: false,
      }).catch((error: unknown) => ({
        ok: false,
        error:
          error instanceof Error ? error.message : "source_run_unavailable",
        table: [],
      }));
      sourceSummary = {
        ...obj(sourceSummary),
        fallbackSummary,
        table: [
          ...(Array.isArray(obj(sourceSummary).table)
            ? (obj(sourceSummary).table as unknown[])
            : []),
          ...(Array.isArray(obj(fallbackSummary).table)
            ? (obj(fallbackSummary).table as unknown[])
            : []),
        ],
      };
      rawSignals = await latestUsefulRawSignals(
        maxRawSignalsToInspect,
        preferredSources,
        excludeLowImpactReferenceUpdates,
        freshnessWindowHours,
      );
    }
    const catalystRawSignals = rawSignals.filter((signal) =>
      catalystSources.includes(signal.source),
    );
    const catalystSummaryBase = {
      configuredProviders: catalystSources.filter((provider) =>
        provider === "FMP Catalyst"
          ? Boolean(process.env.FMP_API_KEY)
          : provider === "Marketaux Catalyst"
            ? Boolean(process.env.MARKETAUX_API_KEY)
            : Boolean(process.env.ALPHA_VANTAGE_API_KEY),
      ),
      attemptedProviders: Array.isArray(obj(sourceSummary).table)
        ? (obj(sourceSummary).table as unknown[])
            .map((row) => text(obj(row).sourceName))
            .filter((name) => catalystSources.includes(name))
        : [],
      catalystSignalsFound: catalystRawSignals.length,
      catalystSignalsSaved:
        typeof obj(sourceSummary).table === "object" &&
        Array.isArray(obj(sourceSummary).table)
          ? (obj(sourceSummary).table as unknown[])
              .filter((row) =>
                catalystSources.includes(text(obj(row).sourceName)),
              )
              .reduce(
                (sum: number, row) =>
                  sum +
                  (typeof obj(row).signalsCreated === "number"
                    ? (obj(row).signalsCreated as number)
                    : 0),
                0,
              )
          : 0,
      catalystSignalsInspected: 0,
      topCatalystCandidates: catalystRawSignals.slice(0, 5).map((signal) => ({
        id: signal.id,
        source: signal.source,
        ticker: signal.ticker,
        title: signal.title,
        receivedAt: signal.receivedAt.toISOString(),
        catalystImpact: payloadImpact(signal),
      })),
      missingCatalystKeys: [
        ["FMP_API_KEY", process.env.FMP_API_KEY],
        ["MARKETAUX_API_KEY", process.env.MARKETAUX_API_KEY],
        ["ALPHA_VANTAGE_API_KEY", process.env.ALPHA_VANTAGE_API_KEY],
      ]
        .filter(([, value]) => !value)
        .map(([key]) => key),
      degradedCatalystProviders: Array.isArray(obj(sourceSummary).table)
        ? (obj(sourceSummary).table as unknown[])
            .filter(
              (row) =>
                catalystSources.includes(text(obj(row).sourceName)) &&
                text(obj(row).status) === "degraded",
            )
            .map((row) => text(obj(row).sourceName))
        : [],
      failedCatalystProviders: Array.isArray(obj(sourceSummary).table)
        ? (obj(sourceSummary).table as unknown[])
            .filter(
              (row) =>
                catalystSources.includes(text(obj(row).sourceName)) &&
                text(obj(row).status) === "error",
            )
            .map((row) => text(obj(row).sourceName))
        : [],
      providerDiagnostics: Array.isArray(obj(sourceSummary).table)
        ? (obj(sourceSummary).table as unknown[])
            .filter((row) =>
              catalystSources.includes(text(obj(row).sourceName)),
            )
            .map((row) => ({
              source: text(obj(row).sourceName),
              status: text(obj(row).status),
              sourceHealthStatus: text(obj(row).sourceHealthStatus),
              errors: Array.isArray(obj(row).errors) ? obj(row).errors : [],
              diagnosis: text(obj(row).diagnosis) || null,
            }))
        : [],
    };
    const fmpBlocked = catalystSummaryBase.providerDiagnostics.some(
      (diagnostic) =>
        diagnostic.source === "FMP Catalyst" &&
        /403|plan_key_blocked|plan restricted|check fmp key/i.test(
          JSON.stringify(diagnostic),
        ),
    );
    const providerSkippedReasons = fmpBlocked
      ? {
          "FMP Catalyst":
            "plan_key_blocked; Check FMP key, account activation, or plan access.",
        }
      : {};
    output.catalystSummary = {
      ...catalystSummaryBase,
      fmpProvider403: fmpBlocked,
      providerSkippedReasons,
      nextAction: fmpBlocked
        ? "Check FMP key, account activation, or plan access."
        : null,
    };
    if (!rawSignals.length && !candidateAlertId) {
      const summary = {
        rawSignalsInspected: 0,
        sourcesInspected: preferredSources,
        passCount: 0,
        blockedCount: 0,
        bestCandidateRawSignalId: null,
        rankedCandidates: [],
        blockedReasonsBySignal: {},
        recommendedNextSource: preferredSources[0] ?? "SEC EDGAR",
        recommendedNextAction: catalystSummaryBase.attemptedProviders.length
          ? "No useful real raw signal was available after attempting configured catalyst providers. Check degraded/failed catalyst provider reasons, then try SEC EDGAR, GDELT, or Google News RSS; do not create a fake alert."
          : "No useful real raw signal was available because no catalyst providers were attempted. Check missing API keys/source runner configuration before trying SEC EDGAR; do not create a fake alert.",
      };
      return redactedJson({
        ...output,
        ok: true,
        stage: "no_signal",
        sourceSummary: sourceSummary ?? {},
        candidateDiscoverySummary: summary,
        signalFound: false,
        approved: false,
        published: false,
        blockers: [],
        stage2Unlocked: false,
        reasonStage2Locked: "No raw signal passed Stage 1 proof inspection.",
        proofGapsRemaining: ["No raw signal passed Stage 1 proof inspection."],
        finalRecommendation: "Continue testing",
        nextRecommendedAction: summary.recommendedNextAction,
      });
    }

    output.stage = "source_selected";
    output.sourceSummary = sourceSummary
      ? obj(sourceSummary)
      : { selectedSources: preferredSources };
    output.signalFound = Boolean(rawSignals.length || candidateAlertId);
    const runId = String(output.runId);
    const dateKey = stage1DateKey();
    if (sourceSummary) {
      const rows = Array.isArray(obj(sourceSummary).table)
        ? (obj(sourceSummary).table as unknown[])
        : [];
      const sourcesToStore = rows.length
        ? Array.from(
            new Set(
              rows.map((row) => text(obj(row).sourceName) || "source-run"),
            ),
          )
        : preferredSources;
      for (const sourceName of sourcesToStore) {
        const sourceSlug = safeSourceSlug(sourceName);
        await saveStage1RawObject(
          output,
          r2WriteAvailable,
          `raw/stage1/source-runs/${sourceSlug}/${dateKey}/${runId}.json`,
          { sourceName, sourceSummary },
          {
            source: sourceName,
            assetType: "stage1",
            dataType: "source-run",
            recordCount: rows.length,
          },
        );
        await saveStage1RawObject(
          output,
          r2WriteAvailable,
          `logs/source-runs/${sourceSlug}/${dateKey}/${runId}.json`,
          { sourceName, sourceSummary },
          {
            source: sourceName,
            assetType: "logs",
            dataType: "source-run-log",
            recordCount: rows.length,
          },
        );
      }
    }
    await saveStage1RawObject(
      output,
      r2WriteAvailable,
      `raw/stage1/candidates/${dateKey}/${runId}.json`,
      {
        rawSignals: rawSignals.map((signal) => ({
          id: signal.id,
          source: signal.source,
          ticker: signal.ticker,
          title: signal.title,
          summary: signal.summary,
          sourceUrl: signal.sourceUrl,
          receivedAt: signal.receivedAt,
          payload: signal.payload,
        })),
      },
      {
        source: "stage1",
        assetType: "candidates",
        dataType: "candidate-raw-signals",
        recordCount: rawSignals.length,
      },
    );

    if (!candidateAlertId && rawSignals.length) {
      const discoveryRows: DiscoveryRow[] = [];
      const blockedReasonsBySignal: Record<string, string[]> = {};
      const enrichedProofsBySignal: Record<string, unknown[]> = {};
      const enrichmentSummaries = [] as JsonRecord[];
      for (const signal of rawSignals) {
        const beforeResponse = await candidateFactoryPOST(
          new NextRequest(
            "http://internal/api/internal/candidate-factory-run",
            {
              method: "POST",
              body: JSON.stringify({
                dryRun: true,
                rawSignalId: signal.id,
                limit: 1,
                requireProof: true,
              }),
            },
          ),
        );
        const beforeJson = await jsonFromRoute(beforeResponse);
        const beforeProof = obj(
          (Array.isArray(beforeJson.proofSummary)
            ? beforeJson.proofSummary
            : [])[0],
        );
        const enrichment = await enrichProofForRawSignal(signal);
        enrichedProofsBySignal[signal.id] = enrichment.enrichmentProofs;
        enrichmentSummaries.push({
          rawSignalId: signal.id,
          proofAddedCount: enrichment.enrichmentProofs.length,
          proofAddedTypes: enrichment.enrichmentProofs.map(
            (proof) => proof.type,
          ),
          receiptsAdded: enrichment.enrichmentProofs.map(
            (proof) => proof.source,
          ),
          urlsAdded: enrichment.enrichmentProofs
            .map((proof) => proof.url)
            .filter(Boolean),
          stillMissingProof: enrichment.missingProof,
          safeToPromote: enrichment.safeToPromote,
          acceptedProofItems: enrichment.acceptedProofItems,
          rejectedProofItems: enrichment.rejectedProofItems,
          rejectedProofReasons: enrichment.rejectedProofReasons,
          proofMatchScore: enrichment.acceptedProofItems.length
            ? Math.max(
                ...enrichment.acceptedProofItems.map(
                  (item) => item.proofMatchScore,
                ),
              )
            : 0,
          strongestProof: enrichment.strongestProof,
          warnings: enrichment.enrichmentWarnings,
          errors: enrichment.enrichmentErrors,
          attempts: enrichment.enrichmentAttempts,
        });
        const candidateResponse = await candidateFactoryPOST(
          new NextRequest(
            "http://internal/api/internal/candidate-factory-run",
            {
              method: "POST",
              body: JSON.stringify({
                dryRun: true,
                rawSignalId: signal.id,
                limit: 1,
                requireProof: true,
                extraProofsBySignal: {
                  [signal.id]: enrichment.enrichmentProofs,
                },
              }),
            },
          ),
        );
        const candidateJson = await jsonFromRoute(candidateResponse);
        const blocked = obj(candidateJson.blockedReasons)[signal.id];
        const reasons = arrayText(blocked);
        if (reasons.length) blockedReasonsBySignal[signal.id] = reasons;
        const scores = Array.isArray(candidateJson.scoreSummary)
          ? candidateJson.scoreSummary
          : [];
        const score = obj(scores[0]);
        const impact = payloadImpact(signal);
        const greatSignalScorecard = buildGreatSignalScorecard({
          signal,
          blockedReasons: reasons,
          enrichment,
          impact,
        });
        discoveryRows.push({
          rawSignalId: signal.id,
          ticker: signal.ticker,
          source: signal.source,
          title: signal.title,
          receivedAt: signal.receivedAt.toISOString(),
          passed: reasons.length === 0,
          blockedReasons: reasons,
          qualityScore:
            typeof score.qualityScore === "number" ? score.qualityScore : 0,
          evidenceConfidenceScore:
            typeof score.evidenceConfidenceScore === "number"
              ? score.evidenceConfidenceScore
              : 0,
          suggestedAction: text(score.suggestedAction) || null,
          beforeProofCount:
            typeof beforeProof.proofCount === "number"
              ? beforeProof.proofCount
              : 0,
          afterProofCount: enrichment.proofCount,
          beforeConfidenceScore:
            typeof beforeProof.confidenceScore === "number"
              ? beforeProof.confidenceScore
              : 0,
          afterConfidenceScore: enrichment.confidenceScore,
          passedAfterEnrichment: reasons.length === 0,
          proofAddedTypes: enrichment.enrichmentProofs.map(
            (proof) => proof.type,
          ),
          stillMissingProof: enrichment.missingProof,
          catalystImpactScore: impact.catalystImpactScore,
          stockSpecificityScore: impact.stockSpecificityScore,
          directTickerMatch: impact.directTickerMatch,
          directCompanyMatch: impact.directCompanyMatch,
          hasReceiptUrl: impact.hasReceiptUrl,
          freshWithin72h: impact.freshWithin72h,
          promotionScore: impact.promotionScore,
          bestFailureReason: reasons[0] ?? null,
          unsafeProofMismatchWarning:
            enrichment.rejectedProofItems.length > 0 &&
            enrichment.acceptedProofItems.length === 0,
          proofMatchQuality: enrichment.acceptedProofItems.length
            ? Math.max(
                ...enrichment.acceptedProofItems.map(
                  (item) => item.proofMatchScore,
                ),
              )
            : 0,
          proofDiversity: new Set(
            enrichment.proofTypes.filter(
              (type) =>
                type !== "raw_signal_source" && type !== "source_health",
            ),
          ).size,
          eligibleForBest: false,
          reasonNotPromoted: null,
          sevenLayerEvidence: scoreSevenLayerEvidence({
            source: signal.source,
            title: signal.title,
            summary: signal.summary,
            proofTypes: enrichment.proofTypes,
            promotionScore: impact.promotionScore,
          }),
          greatSignalScorecard,
          finalGreatSignalScore: greatSignalScorecard.finalGreatSignalScore,
          signalGrade: greatSignalScorecard.signalGrade,
          whyItCouldBeGreat: greatSignalScorecard.whyItCouldBeGreat,
          whyItIsBlocked: greatSignalScorecard.whyItIsBlocked,
          nextBestProofToFetch: greatSignalScorecard.nextBestProofToFetch,
        });
      }
      for (const row of discoveryRows) {
        const failures = bestEligibilityFailure(row);
        row.eligibleForBest = failures.length === 0;
        const layerFailures = row.sevenLayerEvidence.reasonNotPromoted
          ? [row.sevenLayerEvidence.reasonNotPromoted]
          : [];
        row.reasonNotPromoted =
          failures.length || layerFailures.length
            ? [...failures, ...layerFailures].join("; ")
            : null;
      }
      const rankedCandidates = sortDiscoveryRows(discoveryRows);
      const topDirectCandidates = rankedCandidates
        .filter((row) => row.directTickerMatch === true)
        .slice(0, 5);
      const best = rankedCandidates.find((row) => row.eligibleForBest === true);
      const bestDirectTickerCandidate = topDirectCandidates[0] ?? null;
      const bestFailed =
        bestDirectTickerCandidate ?? rankedCandidates[0] ?? null;
      const recommendedNextSource = String(
        rankedCandidates.find((row) => row.passed !== true)?.source ??
          preferredSources[0] ??
          "SEC EDGAR",
      );
      const gradeCounts = rankedCandidates.reduce<Record<SignalGrade, number>>(
        (acc, row) => {
          acc[row.signalGrade] += 1;
          return acc;
        },
        { A: 0, B: 0, C: 0, D: 0, F: 0 },
      );
      const missingProofCounts = rankedCandidates
        .flatMap((row) => row.stillMissingProof)
        .filter((type) => VALID_CANDIDATE_PROOF_TYPES.has(type))
        .reduce<Record<string, number>>((acc, type) => {
          acc[type] = (acc[type] ?? 0) + 1;
          return acc;
        }, {});
      const mostCommonMissingProof =
        Object.entries(missingProofCounts).sort(
          (a, b) => b[1] - a[1],
        )[0]?.[0] ?? null;
      const bestGreatSignalCandidate =
        rankedCandidates.find((row) => row.signalGrade === "A") ??
        rankedCandidates.find((row) => row.signalGrade === "B") ??
        null;
      const bestWatchOnlyCandidate =
        rankedCandidates.find((row) => row.signalGrade === "C") ??
        rankedCandidates.find((row) => row.signalGrade === "D") ??
        null;
      const greatSignalSummary = {
        candidatesScored: rankedCandidates.length,
        gradeCounts,
        bestGreatSignalCandidate,
        bestWatchOnlyCandidate,
        rejectedAsNoiseCount: rankedCandidates.filter((row) =>
          row.whyItIsBlocked.some((reason) => /noise|generic/i.test(reason)),
        ).length,
        blockedByMissingProofCount: rankedCandidates.filter((row) =>
          row.whyItIsBlocked.some((reason) =>
            /Missing proof|two clean proof/i.test(reason),
          ),
        ).length,
        blockedByUnsafeProofCount: rankedCandidates.filter(
          (row) => row.unsafeProofMismatchWarning,
        ).length,
        mostCommonMissingProof,
        nextBestSystemFix: mostCommonMissingProof
          ? `Improve ${mostCommonMissingProof} proof fetching for top direct ticker candidates.`
          : "Keep proof gates strict and expand clean proof coverage only when specific URLs exist.",
      };
      const proofCompletionSummary = {
        attemptedCandidates: topDirectCandidates.map((row) => row.rawSignalId),
        priceVolumeAttempted: topDirectCandidates
          .filter((row) => arrayIncludes(row.stillMissingProof, "price_volume"))
          .map((row) => row.rawSignalId),
        fundamentalsAttempted: topDirectCandidates
          .filter((row) => arrayIncludes(row.stillMissingProof, "fundamentals"))
          .map((row) => row.rawSignalId),
        patternMatchAttempted: topDirectCandidates
          .filter((row) =>
            arrayIncludes(row.stillMissingProof, "pattern_match"),
          )
          .map((row) => row.rawSignalId),
        proofAdded: topDirectCandidates.flatMap((row) =>
          row.proofAddedTypes.map((type) => ({
            rawSignalId: row.rawSignalId,
            type,
          })),
        ),
        proofStillMissing: Object.fromEntries(
          topDirectCandidates.map((row) => [
            row.rawSignalId,
            row.stillMissingProof,
          ]),
        ),
        providerSkippedReasons,
      };
      const proofEnrichmentSummary = {
        attempted: true,
        signalsEnriched: enrichmentSummaries.filter(
          (item) => Number(item.proofAddedCount ?? 0) > 0,
        ).length,
        proofAddedCount: enrichmentSummaries.reduce(
          (total, item) => total + Number(item.proofAddedCount ?? 0),
          0,
        ),
        receiptsAdded: enrichmentSummaries.flatMap((item) =>
          Array.isArray(item.receiptsAdded) ? item.receiptsAdded : [],
        ),
        urlsAdded: enrichmentSummaries.flatMap((item) =>
          Array.isArray(item.urlsAdded) ? item.urlsAdded : [],
        ),
        stillMissingProof: Array.from(
          new Set(
            enrichmentSummaries.flatMap((item) =>
              Array.isArray(item.stillMissingProof)
                ? item.stillMissingProof.map(String)
                : [],
            ),
          ),
        ),
        bestProofBundle:
          enrichmentSummaries.find(
            (item) => item.rawSignalId === best?.rawSignalId,
          ) ??
          enrichmentSummaries[0] ??
          null,
        acceptedProofItems: enrichmentSummaries.flatMap((item) =>
          Array.isArray(item.acceptedProofItems) ? item.acceptedProofItems : [],
        ),
        rejectedProofItems: enrichmentSummaries.flatMap((item) =>
          Array.isArray(item.rejectedProofItems) ? item.rejectedProofItems : [],
        ),
        rejectedProofReasons: Array.from(
          new Set(
            enrichmentSummaries.flatMap((item) =>
              Array.isArray(item.rejectedProofReasons)
                ? item.rejectedProofReasons.map(String)
                : [],
            ),
          ),
        ),
        proofMatchScore: enrichmentSummaries.reduce(
          (max, item) =>
            Math.max(
              max,
              typeof item.proofMatchScore === "number"
                ? item.proofMatchScore
                : 0,
            ),
          0,
        ),
        proofMatchingClean: !enrichmentSummaries.some(
          (item) =>
            Array.isArray(item.rejectedProofItems) &&
            item.rejectedProofItems.length > 0 &&
            (!Array.isArray(item.acceptedProofItems) ||
              item.acceptedProofItems.length === 0),
        ),
        enrichmentBlockedReasons: blockedReasonsBySignal,
        proofCompletionSummary,
      };
      output.proofEnrichmentSummary = proofEnrichmentSummary;
      output.proofFillingAttempts = enrichmentSummaries.map((item) => ({
        rawSignalId: item.rawSignalId,
        attempts: item.attempts,
        proofAddedTypes: item.proofAddedTypes,
        stillMissingProof: item.stillMissingProof,
      }));
      output.proofFilledBySource = enrichmentSummaries.reduce<
        Record<string, unknown>
      >((acc, item) => {
        const key = String(item.rawSignalId ?? "unknown");
        acc[key] = {
          receiptsAdded: item.receiptsAdded,
          urlsAdded: item.urlsAdded,
          proofAddedCount: item.proofAddedCount,
        };
        return acc;
      }, {});
      output.remainingProofGaps = proofEnrichmentSummary.stillMissingProof;
      await saveStage1RawObject(
        output,
        r2WriteAvailable,
        `raw/stage1/proof-enrichment/${stage1DateKey()}/${String(output.runId)}.json`,
        { proofEnrichmentSummary, enrichmentSummaries },
        {
          source: "stage1",
          assetType: "proof",
          dataType: "proof-enrichment",
          recordCount: enrichmentSummaries.length,
        },
      );
      const summary = {
        rawSignalsInspected: discoveryRows.length,
        sourcesInspected: Array.from(
          new Set([
            ...(catalystSummaryBase.attemptedProviders as string[]),
            ...discoveryRows.map((row) => row.source),
          ]),
        ),
        catalystSignalsFound: catalystSummaryBase.catalystSignalsFound,
        catalystSignalsInspected: discoveryRows.filter((row) =>
          catalystSources.includes(row.source),
        ).length,
        topCatalystCandidates: discoveryRows
          .filter((row) => catalystSources.includes(row.source))
          .slice(0, 5),
        passCount: rankedCandidates.filter((row) => row.passed).length,
        blockedCount: rankedCandidates.filter((row) => !row.passed).length,
        bestCandidateRawSignalId: best?.rawSignalId ?? null,
        bestDirectTickerCandidate: bestDirectTickerCandidate
          ? {
              rawSignalId: bestDirectTickerCandidate.rawSignalId,
              ticker: bestDirectTickerCandidate.ticker,
              title: bestDirectTickerCandidate.title,
              source: bestDirectTickerCandidate.source,
              promotionScore: bestDirectTickerCandidate.promotionScore,
              catalystImpactScore:
                bestDirectTickerCandidate.catalystImpactScore,
              stockSpecificityScore:
                bestDirectTickerCandidate.stockSpecificityScore,
              proofTypesFound: bestDirectTickerCandidate.proofAddedTypes,
              proofTypesMissing: bestDirectTickerCandidate.stillMissingProof,
              reasonNotPromoted: bestDirectTickerCandidate.reasonNotPromoted,
              layersSupportingCandidate:
                bestDirectTickerCandidate.sevenLayerEvidence
                  .layersSupportingCandidate,
              layersMissing:
                bestDirectTickerCandidate.sevenLayerEvidence.layersMissing,
              strongestLayer:
                bestDirectTickerCandidate.sevenLayerEvidence.strongestLayer,
              weakestLayer:
                bestDirectTickerCandidate.sevenLayerEvidence.weakestLayer,
              earlySignalPossible:
                bestDirectTickerCandidate.sevenLayerEvidence
                  .earlySignalPossible,
              marketReactionStatus:
                bestDirectTickerCandidate.sevenLayerEvidence
                  .marketReactionStatus,
            }
          : null,
        proofCompletionSummary,
        greatSignalSummary,
        rankedCandidates,
        blockedReasonsBySignal,
        recommendedNextSource,
        bestCandidateFailureReason: bestFailed
          ? `${bestFailed.title}: ${(bestFailed.blockedReasons.length ? bestFailed.blockedReasons : [bestFailed.bestFailureReason ?? "missing_matching_independent_proof"]).join("; ")}`
          : null,
        sevenLayerEvidenceModel: {
          marketReactionRule: "bonus_only_never_required",
          bestEarlySignalCandidate:
            (best ?? bestDirectTickerCandidate ?? rankedCandidates[0] ?? null)
              ?.sevenLayerEvidence ?? null,
        },
        recommendedNextAction: best
          ? "Stage 1 found a candidate strong enough for Stage 2 AI review. Re-run with dryRun=false and confirmRun=true to create/review exactly one candidate."
          : bestFailed
            ? `No inspected signal passed safety gates. Best candidate "${bestFailed.title}" failed because ${(bestFailed.blockedReasons.length ? bestFailed.blockedReasons : ["matching proof is still required"]).join("; ")}. Missing: ${(bestFailed.stillMissingProof.length ? bestFailed.stillMissingProof : ["at least 2 independent matching proof types, a specific receipt URL, price/volume or fundamentals/pattern confirmation"]).join(", ")}. Use ${recommendedNextSource} next; FMP plan/key block ${catalystSummaryBase.failedCatalystProviders.includes("FMP Catalyst") ? "may be blocking useful FMP proof but must not be retried in this run" : "is not the active blocker"}. Marketaux/Alpha data is useful only when ticker/company/topic-specific proof matches.`
            : `No inspected signal passed safety gates and catalyst providers were not attempted. Fix catalyst provider execution before trying ${recommendedNextSource}.`,
      };
      output.catalystSummary = {
        ...catalystSummaryBase,
        fmpProvider403: fmpBlocked,
        providerSkippedReasons,
        nextAction: fmpBlocked
          ? "Check FMP key, account activation, or plan access."
          : null,
        catalystSignalsInspected: discoveryRows.filter((row) =>
          catalystSources.includes(row.source),
        ).length,
        topCatalystCandidates: discoveryRows
          .filter((row) => catalystSources.includes(row.source))
          .slice(0, 5),
      };
      output.greatSignalSummary = greatSignalSummary;
      output.candidateDiscoverySummary = summary;
      output.directCompanyCatalysts = rankedCandidates
        .filter(
          (row) =>
            row.directTickerMatch === true || row.directCompanyMatch === true,
        )
        .slice(0, 10) as unknown[];
      output.bestSeriousCandidate = (best ??
        bestDirectTickerCandidate ??
        obj(output.bestSeriousCandidate)) as unknown;
      output.topRejectedButInterestingSignals = rankedCandidates
        .filter((row) => row.eligibleForBest !== true)
        .slice(0, 5) as unknown[];
      output.nextBestEarToImprove = recommendedNextSource;
      output.recommendedDeepProofCalls = [
        ...((Array.isArray(output.recommendedDeepProofCalls)
          ? output.recommendedDeepProofCalls
          : []) as unknown[]),
        ...topDirectCandidates.flatMap((row) =>
          row.stillMissingProof.map((proofType) => ({
            rawSignalId: row.rawSignalId,
            proofType,
            source: recommendedNextSource,
          })),
        ),
      ] as unknown[];
      const rawSignal = best
        ? (rawSignals.find((signal) => signal.id === best.rawSignalId) ?? null)
        : bestFailed
          ? (rawSignals.find(
              (signal) => signal.id === bestFailed.rawSignalId,
            ) ?? null)
          : (rawSignals[0] ?? null);
      output.selectedRawSignalId = rawSignal?.id ?? null;
      output.rawSignalSummary = rawSignal
        ? {
            id: rawSignal.id,
            source: rawSignal.source,
            ticker: rawSignal.ticker,
            title: rawSignal.title,
            receivedAt: rawSignal.receivedAt,
          }
        : {};
      if (!best)
        return redactedJson({
          ...output,
          stage: "no_publish",
          approved: false,
          publishable: false,
          published: false,
          blockers: [],
          stage2Unlocked: false,
          reasonStage2Locked:
            summary.bestCandidateFailureReason ??
            "No candidate passed strict proof gates.",
          proofGapsRemaining: bestFailed?.stillMissingProof ?? [
            "No candidate passed strict proof gates.",
          ],
          finalRecommendation: r2WriteAvailable
            ? "Do not run Stage 2"
            : "Fix R2 before large history backfill; do not run Stage 2",
          nextRecommendedAction: summary.recommendedNextAction,
        });
      if (dryRun)
        return redactedJson({
          ...output,
          stage: "dry_run_planned",
          approved: false,
          publishable: false,
          published: false,
          stage2Allowed:
            confirmRun === true &&
            best.eligibleForBest === true &&
            best.proofDiversity >= 2 &&
            proofEnrichmentSummary.proofMatchingClean === true &&
            !best.unsafeProofMismatchWarning,
          stage2Unlocked:
            confirmRun === true &&
            best.eligibleForBest === true &&
            best.proofDiversity >= 2 &&
            proofEnrichmentSummary.proofMatchingClean === true &&
            !best.unsafeProofMismatchWarning,
          reasonStage2Locked:
            confirmRun !== true
              ? "confirmRun=false; Stage 2 AI Committee stayed locked and OpenAI was not called."
              : best.eligibleForBest === true &&
                  best.proofDiversity >= 2 &&
                  proofEnrichmentSummary.proofMatchingClean === true &&
                  !best.unsafeProofMismatchWarning
                ? null
                : (best.reasonNotPromoted ??
                  "Strict proof gates did not pass cleanly."),
          finalRecommendation:
            confirmRun === true &&
            best.eligibleForBest === true &&
            best.proofDiversity >= 2 &&
            proofEnrichmentSummary.proofMatchingClean === true &&
            !best.unsafeProofMismatchWarning
              ? "Stage 2 allowed"
              : r2WriteAvailable
                ? "Do not run Stage 2"
                : "Fix R2 before large history backfill; do not run Stage 2",
          approvedForAiReview:
            confirmRun === true &&
            best.eligibleForBest === true &&
            best.proofDiversity >= 2 &&
            proofEnrichmentSummary.proofMatchingClean === true &&
            !best.unsafeProofMismatchWarning,
          nextRecommendedAction: summary.recommendedNextAction,
        });
      const createResponse = await candidateFactoryPOST(
        new NextRequest("http://internal/api/internal/candidate-factory-run", {
          method: "POST",
          body: JSON.stringify({
            dryRun: false,
            rawSignalId: String(best.rawSignalId),
            limit: 1,
            requireProof: true,
            extraProofsBySignal: {
              [String(best.rawSignalId)]:
                enrichedProofsBySignal[String(best.rawSignalId)] ?? [],
            },
          }),
        }),
      );
      const candidateJson = await jsonFromRoute(createResponse);
      const created = Array.isArray(candidateJson.createdCandidateIds)
        ? candidateJson.createdCandidateIds.map(String)
        : [];
      candidateAlertId = created[0] ?? "";
      output.candidateSummary = {
        ...candidateJson,
        createdCandidateIds: created.slice(0, 1),
      };
      if (!candidateAlertId)
        return redactedJson({
          ...output,
          stage: "candidate_blocked",
          approved: false,
          publishable: false,
          blockers: [],
          nextRecommendedAction:
            candidateJson.nextRecommendedAction ??
            "Candidate factory did not create a candidate; inspect blocked reasons.",
        });
    }

    output.stage = "candidate_ready";
    output.candidateSummary = {
      ...obj(output.candidateSummary),
      candidateAlertId,
    };
    const evidence = await buildAiCommitteeEvidencePack(candidateAlertId);
    output.evidencePackSummary = {
      ok: evidence.ok,
      readyForCommittee: evidence.readyForCommittee,
      missingRequiredEvidence: evidence.missingRequiredEvidence,
    };

    const provider = getAiCommitteeProviderStatus();
    if (!confirmRun || !provider.enabled || !provider.configured) {
      return redactedJson({
        ...output,
        stage: "ai_committee_planned",
        aiCommitteeSummary: {
          ok: true,
          status: "planned",
          provider: {
            enabled: provider.enabled,
            configured: provider.configured,
          },
          reason: !confirmRun
            ? "confirmRun=false"
            : "AI Committee provider not enabled/configured",
        },
        nextRecommendedAction:
          "Run Stage 2 with confirmRun=true and configured AI Committee to get a real approval review. Nothing was published.",
      });
    }

    const committee = await runAiCommittee({
      candidateAlertId,
      dryRun: false,
      confirmRun: true,
      mode: "preview",
    });
    const committeeRunId = text((committee as JsonRecord).persistedRunId);
    output.aiCommitteeRan = true;
    output.aiCommitteeSummary = {
      ok: committee.ok,
      status: committee.status,
      committeeRunId,
      providerStatus: committee.providerStatus,
    };

    const finalJudge = await runFinalJudge({
      candidateAlertId,
      committeeRunId,
      dryRun: true,
    });
    output.finalJudgeSummary = {
      ok: finalJudge.ok,
      finalDecision: finalJudge.finalDecision,
      publishAllowed: finalJudge.publishAllowed,
      requiredFixes: finalJudge.requiredFixes,
    };
    if (
      finalJudge.finalDecision === "reject" ||
      finalJudge.publishAllowed === false
    )
      warnings.push(
        "Final judge did not allow publish; approval gate must block publication.",
      );

    const gate = await runApprovalGate({
      candidateAlertId,
      committeeRunId,
      dryRun: !confirmPublish,
      reviewerNote: confirmPublish
        ? "Founder confirmed Stage 3 website publish from live alert cycle route."
        : "Stage 2 review only; no publish.",
    });
    const approved =
      isApproved(gate) &&
      finalJudge.finalDecision === "approve" &&
      finalJudge.publishAllowed === true;
    output.approvalGateSummary = {
      ok: gate.ok,
      approvalRecommendation: gate.approvalRecommendation,
      failedChecks: gate.failedChecks,
      warnings: gate.warnings,
    };
    output.approved = approved;
    output.publishable = approved;

    if (!approved || dryRun || !confirmPublish || maxAlertsToPublish < 1) {
      return redactedJson({
        ...output,
        stage: approved ? "approved_not_published" : "approval_blocked",
        blockers: approved ? [] : ["approval_gate_or_final_judge_not_approved"],
        nextRecommendedAction: approved
          ? "Stage 2 produced one real approved/publishable signal. Stage 3 may publish at most one alert after confirmation."
          : "Resolve final judge/approval gate failed checks before publishing. Nothing was published.",
      });
    }

    const publishResponse = await publishApprovedAlertPOST(
      new NextRequest("http://internal/api/internal/publish-approved-alert", {
        method: "POST",
        body: JSON.stringify({
          candidateAlertId,
          dryRun: false,
          confirmPublish: true,
        }),
      }),
    );
    const publishJson = await jsonFromRoute(publishResponse);
    return redactedJson(
      {
        ...output,
        stage: publishJson.published ? "published" : "publish_blocked",
        publishLedgerSummary: publishJson,
        published: publishJson.published === true,
        publicAlertUrl: text(publishJson.publicAlertUrl) || null,
        publicLedgerUrl: text(publishJson.publicLedgerUrl) || null,
        blockers: arrayText(publishJson.blockedReasons),
        warnings: [...warnings, ...arrayText(publishJson.warnings)],
        nextRecommendedAction:
          text(publishJson.nextRecommendedAction) ||
          "Publish attempted; inspect publishLedgerSummary.",
      },
      { status: publishResponse.status },
    );
  } catch (error) {
    const status =
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2023"
        ? 400
        : 500;
    return redactedJson(
      {
        ...baseResponse({ dryRun, readiness: {}, warnings }),
        ok: false,
        stage: "live_alert_cycle_failed",
        blockers: [error instanceof Error ? error.message : "unknown_error"],
        nextRecommendedAction:
          "Check server logs and rerun safely; no Telegram send was attempted.",
      },
      { status },
    );
  }
}
