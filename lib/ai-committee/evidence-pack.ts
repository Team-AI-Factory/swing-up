import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { buildProofBundleForRawSignal, type ProofItem, type ProofType } from "@/lib/proof/proof-bundle-builder";

export type EvidenceStrength = "missing" | "weak" | "medium" | "strong";

type JsonRecord = Record<string, unknown>;

type EvidenceSection = {
  available: boolean;
  strength: EvidenceStrength;
  summary: string | null;
  items: Array<Record<string, unknown>>;
};

export type AiCommitteeEvidencePack = {
  candidateAlertId: string;
  rawSignalIds: string[];
  ticker: string | null;
  company: string | null;
  actionLabel: string | null;
  eventHeadline: string | null;
  whatHappened: string | null;
  sourceNames: string[];
  sourceLinks: string[];
  sourceFreshness: Array<{ source: string; collectedAt: string | null; ageHours: number | null; freshness: "fresh" | "stale" | "old" | "unknown" }>;
  sourceHealth: Array<{ source: string; status: string; checkedAt: string | null; lastSuccessAt: string | null; responseTimeMs: number | null; problem: string | null; notes: string | null }>;
  proofBundleSummary: Record<string, unknown> | null;
  filingEvidence: EvidenceSection;
  newsEvidence: EvidenceSection;
  priceVolumeEvidence: EvidenceSection;
  fundamentalsEvidence: EvidenceSection;
  macroEvidence: EvidenceSection;
  fdaRegulatoryEvidence: EvidenceSection;
  cryptoFxEvidence: EvidenceSection;
  finraShortPressureEvidence: EvidenceSection;
  wikidataRippleRelationships: EvidenceSection;
  historicalPatternMatch: EvidenceSection;
  previousSimilarOutcomes: EvidenceSection;
  score: Record<string, unknown> | null;
  currentRiskLabels: string[];
  missingEvidence: string[];
  dataFreshnessWarnings: string[];
  compatibility: { callsOpenAi: false; publishes: false; sendsTelegram: false; writesDatabase: false };
};

export type EvidencePackResult = {
  ok: boolean;
  dryRun: true;
  candidateAlertId: string | null;
  evidencePack: AiCommitteeEvidencePack | null;
  missingRequiredEvidence: string[];
  warnings: string[];
  readyForCommittee: boolean;
  error?: string;
};

const REQUIRED_EVIDENCE = ["raw signal linkage", "source links", "source health", "proof bundle", "score"];
const FRESH_HOURS = 48;
const STALE_HOURS = 168;

function text(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function objectValue(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}


function iso(value: Date | null | undefined) {
  return value ? value.toISOString() : null;
}

function ageHours(value: Date | null | undefined) {
  if (!value) return null;
  return Math.max(0, Math.round((Date.now() - value.getTime()) / 36_000) / 100);
}

function freshness(value: Date | null | undefined): "fresh" | "stale" | "old" | "unknown" {
  const age = ageHours(value);
  if (age === null) return "unknown";
  if (age <= FRESH_HOURS) return "fresh";
  if (age <= STALE_HOURS) return "stale";
  return "old";
}

function unique(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.map((value) => text(value)).filter(Boolean)));
}

function decimal(value: Prisma.Decimal | null | undefined) {
  return value == null ? null : Number(value.toString());
}

function sectionFromProofs(proofs: ProofItem[], types: ProofType[], missingSummary: string): EvidenceSection {
  const items = proofs
    .filter((proof) => types.includes(proof.type))
    .map((proof) => ({ type: proof.type, strength: proof.strength, label: proof.label, source: proof.source, summary: proof.summary, url: proof.url ?? null, observedAt: proof.observedAt ?? null, metadata: proof.metadata ?? {} }));
  const strongest = items.some((item) => item.strength === "strong") ? "strong" : items.some((item) => item.strength === "medium") ? "medium" : items.length ? "weak" : "missing";
  return { available: items.length > 0, strength: strongest, summary: items.length ? `${items.length} ${types.join("/")} proof item(s) available.` : missingSummary, items };
}

function sectionFromPayload(rawSignals: Array<{ id: string; source: string; sourceUrl: string | null; title: string; summary: string; payload: Prisma.JsonValue; receivedAt: Date }>, keys: string[], label: string): EvidenceSection {
  const items = rawSignals.flatMap((signal) => {
    const payload = objectValue(signal.payload);
    return keys.flatMap((key) => {
      const value = payload[key];
      if (value === undefined || value === null || text(value) === "") return [];
      return [{ rawSignalId: signal.id, key, source: signal.source, url: signal.sourceUrl, observedAt: signal.receivedAt.toISOString(), value }];
    });
  });
  return { available: items.length > 0, strength: items.length ? "weak" : "missing", summary: items.length ? `${label} context found in raw signal payload; labelled weak until independently verified.` : `${label} evidence not available.`, items };
}

export async function buildAiCommitteeEvidencePack(candidateAlertId: string): Promise<EvidencePackResult> {
  const id = text(candidateAlertId);
  if (!id) return { ok: false, dryRun: true, candidateAlertId: null, evidencePack: null, missingRequiredEvidence: ["candidateAlertId"], warnings: ["candidateAlertId is required."], readyForCommittee: false, error: "candidateAlertId is required." };

  const alert = await prisma.alert.findUnique({
    where: { id },
    include: {
      sources: { orderBy: { collectedAt: "desc" } },
      scores: { orderBy: { createdAt: "desc" }, take: 1 },
      dcfModels: { orderBy: { createdAt: "desc" }, take: 1 },
      targetPrices: true,
      patternMatches: { orderBy: [{ matchScore: "desc" }, { similarity: "desc" }, { createdAt: "desc" }], take: 5, include: { historicalEvent: true } },
      publicLedger: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });

  if (!alert) return { ok: false, dryRun: true, candidateAlertId: id, evidencePack: null, missingRequiredEvidence: ["candidate alert"], warnings: ["Candidate alert was not found."], readyForCommittee: false, error: "candidate_alert_not_found" };

  const patternRawIds = alert.patternMatches.map((match) => match.rawSignalId).filter((value): value is string => Boolean(value));
  const sourceUrls = alert.sources.map((source) => source.receiptUrl).filter((value): value is string => Boolean(value));
  const rawSignals = await prisma.rawSignal.findMany({
    where: { OR: [{ id: { in: patternRawIds.length ? patternRawIds : ["00000000-0000-0000-0000-000000000000"] } }, ...(sourceUrls.length ? [{ sourceUrl: { in: sourceUrls } }] : []), { ticker: { equals: alert.ticker, mode: "insensitive" }, processedStatus: { equals: "promoted", mode: "insensitive" } }] },
    orderBy: { receivedAt: "desc" },
    take: 10,
  });
  const rawSignalIds = unique([...patternRawIds, ...rawSignals.map((signal) => signal.id)]);
  const proofBundles = await Promise.all(rawSignalIds.map((rawSignalId) => buildProofBundleForRawSignal(rawSignalId).catch(() => null)));
  const proofs = proofBundles.flatMap((bundle) => bundle?.proofs ?? []);
  const sourceNames = unique([...alert.sources.map((source) => source.sourceType), ...rawSignals.map((signal) => signal.source), ...proofs.map((proof) => proof.source)]);
  const sourceHealthRows = sourceNames.length ? await prisma.sourceHealth.findMany({ where: { source: { in: sourceNames } } }) : [];
  const latestMacro = await prisma.macroSentimentSnapshot.findFirst({ orderBy: { createdAt: "desc" } }).catch(() => null);

  const latestScore = alert.scores[0];
  const sourceHealth = sourceHealthRows.map((health) => ({ source: health.source, status: health.status, checkedAt: iso(health.checkedAt), lastSuccessAt: iso(health.lastSuccessAt), responseTimeMs: health.responseTimeMs, problem: /ok|healthy|connected|available/i.test(health.status) ? null : health.errorMessage || `Source health status is ${health.status}.`, notes: health.notes }));
  const dataFreshnessWarnings = [
    ...alert.sources.filter((source) => freshness(source.collectedAt) !== "fresh").map((source) => `Source ${source.sourceType} is ${freshness(source.collectedAt)}.`),
    ...(latestMacro && freshness(latestMacro.createdAt) !== "fresh" ? [`Macro snapshot is ${freshness(latestMacro.createdAt)}.`] : []),
  ];

  const historicalItems = alert.patternMatches.map((match) => ({ patternMatchId: match.id, strength: Number(match.matchScore ?? match.similarity) >= 75 ? "strong" : Number(match.matchScore ?? match.similarity) >= 50 ? "medium" : "weak", similarity: decimal(match.similarity), matchScore: decimal(match.matchScore), confidenceLabel: match.confidenceLabel, reason: match.matchReason, createdAt: match.createdAt.toISOString(), historicalEventId: match.historicalEventId }));
  const outcomeItems = alert.patternMatches.flatMap((match) => match.historicalEvent ? [{ historicalEventId: match.historicalEvent.id, ticker: match.historicalEvent.ticker, eventDate: match.historicalEvent.eventDate.toISOString(), outcomeLabel: match.historicalEvent.outcomeLabel, maxGain: decimal(match.historicalEvent.maxGain), maxDrawdown: decimal(match.historicalEvent.maxDrawdown), forwardReturns: match.historicalEvent.forwardReturns }] : []);

  const evidencePack: AiCommitteeEvidencePack = {
    candidateAlertId: alert.id,
    rawSignalIds,
    ticker: alert.ticker || null,
    company: alert.company || null,
    actionLabel: alert.action || null,
    eventHeadline: alert.event || null,
    whatHappened: alert.event || null,
    sourceNames,
    sourceLinks: unique([...sourceUrls, ...rawSignals.map((signal) => signal.sourceUrl), ...proofs.map((proof) => proof.url)]),
    sourceFreshness: alert.sources.map((source) => ({ source: source.sourceType, collectedAt: iso(source.collectedAt), ageHours: ageHours(source.collectedAt), freshness: freshness(source.collectedAt) })),
    sourceHealth,
    proofBundleSummary: proofBundles.some(Boolean) ? { rawSignalIds, proofCount: proofs.length, proofTypes: unique(proofs.map((proof) => proof.type)), strongestProof: proofBundles.find((bundle) => bundle?.strongestProof)?.strongestProof ?? null, missingProof: unique(proofBundles.flatMap((bundle) => bundle?.missingProof ?? [])), confidenceScores: proofBundles.filter(Boolean).map((bundle) => ({ rawSignalId: bundle!.rawSignalId, confidenceHint: bundle!.confidenceHint, confidenceScore: bundle!.confidenceScore, safeToPromote: bundle!.safeToPromote, reasons: bundle!.reasons })) } : null,
    filingEvidence: sectionFromProofs(proofs, ["filing"], "Filing evidence not available."),
    newsEvidence: sectionFromProofs(proofs, ["news"], "News evidence not available."),
    priceVolumeEvidence: sectionFromProofs(proofs, ["price_volume"], "Price/volume evidence not available."),
    fundamentalsEvidence: (() => {
      const proofSection = sectionFromProofs(proofs, ["fundamentals"], "Fundamentals evidence not available.");
      const modelItems = alert.dcfModels.map((model) => ({ type: "dcf_model", strength: "weak", createdAt: model.createdAt.toISOString(), assumptions: model.assumptions, output: model.output }));
      const targetItems = alert.targetPrices.map((target) => ({ type: "target_price", strength: "weak", lowPrice: decimal(target.lowPrice), highPrice: decimal(target.highPrice), horizonDays: target.horizonDays }));
      const items = [...proofSection.items, ...modelItems, ...targetItems];
      return { available: items.length > 0, strength: proofSection.available ? proofSection.strength : items.length ? "weak" : "missing", summary: items.length ? `${items.length} fundamentals item(s) available; model/target-only entries are labelled weak.` : proofSection.summary, items };
    })(),
    macroEvidence: latestMacro ? { available: true, strength: freshness(latestMacro.createdAt) === "fresh" ? "medium" : "weak", summary: latestMacro.summary || "Latest macro sentiment snapshot is available.", items: [{ snapshotType: latestMacro.snapshotType, status: latestMacro.status, macroRiskLevel: latestMacro.macroRiskLevel, macroSupportScore: latestMacro.macroSupportScore, sentimentSupportScore: latestMacro.sentimentSupportScore, createdAt: latestMacro.createdAt.toISOString(), dataFreshness: latestMacro.dataFreshness, sourceReceipts: latestMacro.sourceReceipts }] } : { available: false, strength: "missing", summary: "Macro evidence not available.", items: [] },
    fdaRegulatoryEvidence: sectionFromPayload(rawSignals, ["fda", "openfda", "regulatory", "clinicalTrials", "clinicaltrials"], "FDA/regulatory"),
    cryptoFxEvidence: sectionFromPayload(rawSignals, ["crypto", "coingecko", "fx", "currency", "exchangeRate"], "Crypto/FX"),
    finraShortPressureEvidence: sectionFromPayload(rawSignals, ["finra", "shortInterest", "shortVolume", "shortPressure"], "FINRA/short pressure"),
    wikidataRippleRelationships: sectionFromPayload(rawSignals, ["wikidata", "ripple", "relationships", "relatedEntities"], "Wikidata/ripple relationship"),
    historicalPatternMatch: { available: historicalItems.length > 0, strength: historicalItems.some((item) => item.strength === "strong") ? "strong" : historicalItems.some((item) => item.strength === "medium") ? "medium" : historicalItems.length ? "weak" : "missing", summary: historicalItems.length ? `${historicalItems.length} stored historical pattern match(es) available.` : "Historical pattern match not available.", items: historicalItems },
    previousSimilarOutcomes: { available: outcomeItems.length > 0, strength: outcomeItems.length ? "medium" : "missing", summary: outcomeItems.length ? `${outcomeItems.length} previous similar outcome(s) available.` : "Previous similar outcomes not available.", items: outcomeItems },
    score: latestScore ? { profitPotential: latestScore.profitPotential, evidenceConfidence: latestScore.evidenceConfidence, riskLevel: latestScore.riskLevel, pricedInCheck: latestScore.pricedInCheck, createdAt: latestScore.createdAt.toISOString(), persisted: true } : null,
    currentRiskLabels: unique([latestScore?.riskLevel ? `risk:${latestScore.riskLevel}` : null, latestScore?.pricedInCheck ? `priced_in:${latestScore.pricedInCheck}` : null, ...sourceHealth.filter((health) => health.problem).map((health) => `source_health:${health.source}:${health.status}`), ...dataFreshnessWarnings.map((warning) => `freshness:${warning}`)]),
    missingEvidence: [],
    dataFreshnessWarnings,
    compatibility: { callsOpenAi: false, publishes: false, sendsTelegram: false, writesDatabase: false },
  };

  const missingEvidence = [
    ...(!rawSignalIds.length ? ["raw signal linkage"] : []),
    ...(!evidencePack.sourceLinks.length ? ["source links"] : []),
    ...(!sourceHealth.length ? ["source health"] : []),
    ...(!evidencePack.proofBundleSummary ? ["proof bundle"] : []),
    ...(!latestScore ? ["score"] : []),
    ...(["filingEvidence", "newsEvidence", "priceVolumeEvidence", "fundamentalsEvidence", "macroEvidence", "fdaRegulatoryEvidence", "cryptoFxEvidence", "finraShortPressureEvidence", "wikidataRippleRelationships", "historicalPatternMatch", "previousSimilarOutcomes"] as const).filter((key) => !evidencePack[key].available),
  ];
  evidencePack.missingEvidence = missingEvidence;
  const missingRequiredEvidence = REQUIRED_EVIDENCE.filter((required) => missingEvidence.includes(required));
  const warnings = unique([...dataFreshnessWarnings, ...sourceHealth.filter((health) => health.problem).map((health) => health.problem), ...proofs.filter((proof) => proof.strength === "weak").map((proof) => `Weak evidence: ${proof.type} from ${proof.source}.`)]);

  return { ok: true, dryRun: true, candidateAlertId: id, evidencePack, missingRequiredEvidence, warnings, readyForCommittee: missingRequiredEvidence.length === 0 && !sourceHealth.some((health) => health.problem) };
}
