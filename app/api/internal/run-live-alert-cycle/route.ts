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

export const dynamic = "force-dynamic";

type JsonRecord = Record<string, unknown>;
type DiscoveryRow = {
  rawSignalId: string;
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
};

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
    catalystImpactScore: typeof impact.promotionScore === "number" ? impact.promotionScore : null,
    stockSpecificityScore: typeof impact.stockSpecificityScore === "number" ? impact.stockSpecificityScore : null,
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
    sourceSummary: {},
    selectedRawSignalId: null as string | null,
    rawSignalSummary: {},
    candidateDiscoverySummary: {},
    catalystSummary: {},
    proofEnrichmentSummary: {},
    candidateSummary: {},
    evidencePackSummary: {},
    aiCommitteeSummary: {},
    finalJudgeSummary: {},
    approvalGateSummary: {},
    publishLedgerSummary: {},
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
  const warnings = [
    "Telegram is disabled for this founder website test; this route never sends Telegram.",
    ...(confirmSend || allowTelegram
      ? ["confirmSend/allowTelegram were ignored by this route."]
      : []),
  ];

  try {
    const readiness = await getEngineStartReadiness();
    const output = baseResponse({ dryRun, readiness, warnings });
    if (!readiness.readyForFirstPublicAlert) {
      return NextResponse.json(
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
      return NextResponse.json(
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
            .filter((row) => catalystSources.includes(text(obj(row).sourceName)))
            .map((row) => ({ source: text(obj(row).sourceName), status: text(obj(row).status), sourceHealthStatus: text(obj(row).sourceHealthStatus), errors: Array.isArray(obj(row).errors) ? obj(row).errors : [] }))
        : [],
    };
    output.catalystSummary = catalystSummaryBase;
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
      return NextResponse.json({
        ...output,
        ok: true,
        stage: "no_signal",
        sourceSummary: sourceSummary ?? {},
        candidateDiscoverySummary: summary,
        signalFound: false,
        approved: false,
        published: false,
        blockers: [],
        nextRecommendedAction: summary.recommendedNextAction,
      });
    }

    output.stage = "source_selected";
    output.sourceSummary = sourceSummary
      ? obj(sourceSummary)
      : { selectedSources: preferredSources };
    output.signalFound = Boolean(rawSignals.length || candidateAlertId);

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
        discoveryRows.push({
          rawSignalId: signal.id,
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
          catalystImpactScore: payloadImpact(signal).catalystImpactScore,
          stockSpecificityScore: payloadImpact(signal).stockSpecificityScore,
        });
      }
      const rankedCandidates = discoveryRows.sort(
        (a, b) =>
          (a.passed === b.passed ? 0 : a.passed ? -1 : 1) ||
          Number(b.qualityScore ?? 0) - Number(a.qualityScore ?? 0) ||
          sourceRank(String(a.source), preferredSources) -
            sourceRank(String(b.source), preferredSources),
      );
      const best = rankedCandidates.find((row) => row.passed === true);
      const recommendedNextSource = String(
        rankedCandidates.find((row) => row.passed !== true)?.source ??
          preferredSources[0] ??
          "SEC EDGAR",
      );
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
        enrichmentBlockedReasons: blockedReasonsBySignal,
      };
      output.proofEnrichmentSummary = proofEnrichmentSummary;
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
        rankedCandidates,
        blockedReasonsBySignal,
        recommendedNextSource,
        recommendedNextAction: best
          ? "Stage 1 found a candidate strong enough for Stage 2 AI review. Re-run with dryRun=false and confirmRun=true to create/review exactly one candidate."
          : catalystSummaryBase.attemptedProviders.length
            ? `No inspected signal passed safety gates. Review catalyst provider output and add independent proof before Stage 2; next source: ${recommendedNextSource}.`
            : `No inspected signal passed safety gates and catalyst providers were not attempted. Fix catalyst provider execution before trying ${recommendedNextSource}.`,
      };
      output.catalystSummary = {
        ...catalystSummaryBase,
        catalystSignalsInspected: discoveryRows.filter((row) =>
          catalystSources.includes(row.source),
        ).length,
        topCatalystCandidates: discoveryRows
          .filter((row) => catalystSources.includes(row.source))
          .slice(0, 5),
      };
      output.candidateDiscoverySummary = summary;
      const rawSignal = best
        ? (rawSignals.find((signal) => signal.id === best.rawSignalId) ?? null)
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
        return NextResponse.json({
          ...output,
          stage: "no_publish",
          approved: false,
          publishable: false,
          published: false,
          blockers: [],
          nextRecommendedAction: summary.recommendedNextAction,
        });
      if (dryRun)
        return NextResponse.json({
          ...output,
          stage: "dry_run_planned",
          approved: false,
          publishable: false,
          published: false,
          stage2Allowed: best.passed === true && best.afterProofCount > 0,
          approvedForAiReview: best.passed === true && best.afterProofCount > 0,
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
        return NextResponse.json({
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
      return NextResponse.json({
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
      return NextResponse.json({
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
    return NextResponse.json(
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
    return NextResponse.json(
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
