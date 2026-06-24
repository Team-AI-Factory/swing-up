import type { Prisma, RawSignal } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { receiptsFromRawSignal } from "@/lib/raw-signal-quality-gate";
import { normalizeReceipts } from "@/lib/receipt-normalizer";

export type ProofType =
  | "raw_signal_source"
  | "filing"
  | "news"
  | "price_volume"
  | "fundamentals"
  | "pattern_match"
  | "source_health"
  | "insider"
  | "regulatory"
  | "contract"
  | "legal_risk";
export type ProofStrength = "weak" | "medium" | "strong";

export type ProofItem = {
  type: ProofType;
  strength: ProofStrength;
  label: string;
  source: string;
  summary: string;
  url?: string | null;
  observedAt?: string | null;
  metadata?: Record<string, unknown>;
};

export type ProofBundle = {
  ok: true;
  rawSignalId: string;
  dryRun: true;
  proofCount: number;
  proofTypes: ProofType[];
  proofs: ProofItem[];
  strongestProof: ProofItem | null;
  missingProof: ProofType[];
  confidenceHint: "low" | "medium" | "high";
  confidenceScore: number;
  safeToPromote: "yes" | "no";
  reasons: string[];
  compatibility: {
    callsPaidAiModel: false;
    publishesAlert: false;
    sendsTelegram: false;
    writesDatabase: false;
  };
};

type JsonRecord = Record<string, unknown>;
const ALL_SUPPORTING_PROOF: ProofType[] = [
  "filing",
  "news",
  "price_volume",
  "fundamentals",
  "pattern_match",
  "insider",
  "regulatory",
  "contract",
  "legal_risk",
];
const VALID_CANDIDATE_PROOF_TYPES = new Set<ProofType>([
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

const STRENGTH_SCORE: Record<ProofStrength, number> = {
  weak: 1,
  medium: 2,
  strong: 3,
};

function text(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function objectValue(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function hasAny(object: JsonRecord, keys: string[]) {
  return keys.some(
    (key) =>
      object[key] !== undefined &&
      object[key] !== null &&
      text(object[key]) !== "",
  );
}

function receiptType(receipt: {
  sourceType?: string;
  sourceName?: string;
  sourceUrl?: string | null;
  title?: string;
}) {
  const haystack =
    `${receipt.sourceType ?? ""} ${receipt.sourceName ?? ""} ${receipt.sourceUrl ?? ""} ${receipt.title ?? ""}`.toLowerCase();
  if (
    haystack.includes("sec") ||
    haystack.includes("edgar") ||
    haystack.includes("filing") ||
    haystack.includes("10-q") ||
    haystack.includes("10-k") ||
    haystack.includes("8-k")
  )
    return "filing" as const;
  if (
    haystack.includes("news") ||
    haystack.includes("gdelt") ||
    haystack.includes("article") ||
    haystack.includes("headline") ||
    haystack.includes("rss")
  )
    return "news" as const;
  return null;
}

function strengthFromReliability(score: number): ProofStrength {
  if (score >= 78) return "strong";
  if (score >= 55) return "medium";
  return "weak";
}

function confidenceHint(score: number): ProofBundle["confidenceHint"] {
  if (score >= 75) return "high";
  if (score >= 50) return "medium";
  return "low";
}

export async function buildProofBundleForRawSignal(
  rawSignalId: string,
  extraProofs: ProofItem[] = [],
): Promise<ProofBundle | null> {
  const rawSignal = await prisma.rawSignal.findUnique({
    where: { id: rawSignalId },
    include: {
      patternMatches: {
        orderBy: [
          { matchScore: "desc" },
          { similarity: "desc" },
          { createdAt: "desc" },
        ],
        take: 1,
      },
    },
  });
  if (!rawSignal) return null;

  const signal = rawSignal as RawSignal & {
    patternMatches: Array<{
      id: string;
      matchScore: Prisma.Decimal | null;
      similarity: Prisma.Decimal;
      confidenceLabel: string;
      matchReason: string | null;
      createdAt: Date;
    }>;
  };
  const payload = objectValue(signal.payload);
  const receipts = receiptsFromRawSignal(signal);
  const normalized = normalizeReceipts(
    receipts.map((receipt) => ({
      sourceName: receipt.source,
      sourceUrl: receipt.url,
      title: receipt.label,
      summary: receipt.label,
      capturedAt: receipt.capturedAt,
      linkedTicker: signal.ticker,
    })),
  );
  const proofs: ProofItem[] = [];

  proofs.push({
    type: "raw_signal_source",
    strength: receipts.length || signal.sourceUrl ? "medium" : "weak",
    label: signal.title,
    source: signal.source,
    summary: signal.summary || signal.title,
    url: signal.sourceUrl,
    observedAt: signal.receivedAt.toISOString(),
    metadata: {
      signalType: signal.signalType,
      importanceHint: signal.importanceHint,
    },
  });

  for (const receipt of normalized.normalizedReceipts) {
    const type = receiptType(receipt);
    if (!type) continue;
    proofs.push({
      type,
      strength: strengthFromReliability(receipt.reliabilityScore),
      label: receipt.title,
      source: receipt.sourceName,
      summary: receipt.capturedSummary,
      url: receipt.sourceUrl,
      observedAt: receipt.capturedAt,
      metadata: {
        reliabilityScore: receipt.reliabilityScore,
        warnings: receipt.warnings,
      },
    });
  }

  const priceContext = objectValue(
    payload.priceContext ??
      payload.marketData ??
      payload.priceVolume ??
      payload.price_volume,
  );
  if (
    hasAny(priceContext, [
      "price",
      "volume",
      "relativeVolume",
      "volumeChange",
      "priceChangePercent",
    ]) ||
    hasAny(payload, ["price", "volume", "volumeMovement", "priceChangePercent"])
  ) {
    proofs.push({
      type: "price_volume",
      strength:
        hasAny(priceContext, ["volume", "relativeVolume", "volumeChange"]) ||
        hasAny(payload, ["volume", "volumeMovement"])
          ? "medium"
          : "weak",
      label: "Price/volume context",
      source: text(priceContext.source, signal.source),
      summary:
        "Structured price or volume context was present on the raw signal payload.",
      metadata: {
        priceContext: Object.keys(priceContext).length
          ? priceContext
          : undefined,
      },
    });
  } else if (signal.ticker) {
    const snapshot = await prisma.priceSnapshot.findFirst({
      where: { ticker: { equals: signal.ticker, mode: "insensitive" } },
      orderBy: { capturedAt: "desc" },
    });
    if (snapshot)
      proofs.push({
        type: "price_volume",
        strength: "weak",
        label: "Latest stored price snapshot",
        source: "price_snapshots",
        summary:
          "A stored price snapshot exists, but no volume confirmation was available.",
        observedAt: snapshot.capturedAt.toISOString(),
        metadata: { ticker: snapshot.ticker, price: snapshot.price.toString() },
      });
  }

  const fundamentals = objectValue(
    payload.fundamentals ?? payload.financials ?? payload.companyFundamentals,
  );
  if (
    hasAny(fundamentals, [
      "revenueGrowth",
      "margin",
      "marginTrend",
      "cashFlow",
      "debt",
      "valuation",
      "peRatio",
    ]) ||
    hasAny(payload, [
      "revenueGrowth",
      "marginTrend",
      "cashFlowTrend",
      "debtLevel",
      "valuationAtTime",
    ])
  ) {
    proofs.push({
      type: "fundamentals",
      strength: "medium",
      label: "Fundamentals context",
      source: text(fundamentals.source, signal.source),
      summary:
        "Structured fundamentals context was present on the raw signal payload.",
      metadata: {
        fields: Object.keys(fundamentals).length
          ? Object.keys(fundamentals)
          : ["payload"],
      },
    });
  }

  const match = signal.patternMatches[0];
  if (match) {
    const score = Number(match.matchScore ?? match.similarity);
    proofs.push({
      type: "pattern_match",
      strength: score >= 75 ? "strong" : score >= 50 ? "medium" : "weak",
      label: `Historical pattern match: ${match.confidenceLabel}`,
      source: "pattern_matches",
      summary:
        match.matchReason ?? "Stored historical pattern match is available.",
      observedAt: match.createdAt.toISOString(),
      metadata: { patternMatchId: match.id, score },
    });
  }

  proofs.push(...extraProofs);

  const proofTypes = Array.from(new Set(proofs.map((proof) => proof.type)));
  const candidateProofs = proofs.filter((proof) =>
    VALID_CANDIDATE_PROOF_TYPES.has(proof.type),
  );
  const missingProof = ALL_SUPPORTING_PROOF.filter(
    (type) => !proofTypes.includes(type),
  );
  const strongestProof =
    [...candidateProofs].sort(
      (a, b) => STRENGTH_SCORE[b.strength] - STRENGTH_SCORE[a.strength],
    )[0] ?? null;
  const independentSupportingTypes = proofTypes.filter((type) =>
    VALID_CANDIDATE_PROOF_TYPES.has(type),
  );
  const weakOnly =
    candidateProofs.length === 0 ||
    candidateProofs.every((proof) => proof.strength === "weak");
  const score = Math.max(
    0,
    Math.min(
      100,
      20 +
        proofs.reduce(
          (total, proof) => total + STRENGTH_SCORE[proof.strength] * 8,
          0,
        ) +
        independentSupportingTypes.length * 7 -
        (weakOnly ? 20 : 0),
    ),
  );
  const enoughProof = independentSupportingTypes.length >= 2 && !weakOnly;
  const reasons = [
    ...(independentSupportingTypes.length < 2
      ? [
          "At least two supporting proof types beyond the raw source are required before promotion.",
        ]
      : []),
    ...(weakOnly
      ? [
          "Only weak proof is available, so the bundle is not enough for a serious candidate alert.",
        ]
      : []),
  ];

  return {
    ok: true,
    rawSignalId,
    dryRun: true,
    proofCount: candidateProofs.length,
    proofTypes: proofTypes.filter((type) => type !== "source_health"),
    proofs: proofs.filter((proof) => proof.type !== "source_health"),
    strongestProof,
    missingProof,
    confidenceHint: confidenceHint(score),
    confidenceScore: score,
    safeToPromote: enoughProof ? "yes" : "no",
    reasons,
    compatibility: {
      callsPaidAiModel: false,
      publishesAlert: false,
      sendsTelegram: false,
      writesDatabase: false,
    },
  };
}
