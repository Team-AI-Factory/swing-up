import type { RawSignal } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { receiptsFromRawSignal } from "@/lib/raw-signal-quality-gate";
import { buildProofBundleForRawSignal, type ProofBundle, type ProofItem, type ProofType } from "@/lib/proof/proof-bundle-builder";

type JsonRecord = Record<string, unknown>;

type EnrichmentAttempt = { source: string; status: "added" | "missing" | "skipped" | "error"; detail: string; proofType?: ProofType };

export type ProofEnrichmentResult = {
  proofCount: number;
  proofTypes: ProofType[];
  receipts: string[];
  urls: string[];
  strongestProof: ProofItem | null;
  missingProof: ProofType[];
  confidenceScore: number;
  safeToPromote: boolean;
  enrichmentProofs: ProofItem[];
  enrichmentAttempts: EnrichmentAttempt[];
  enrichmentWarnings: string[];
  enrichmentErrors: string[];
  proofBundle: ProofBundle | null;
};

const SOURCE_TO_PROOF: Array<{ pattern: RegExp; type: ProofType; label: string }> = [
  { pattern: /sec|edgar|filing|10-[qk]|8-k/i, type: "filing", label: "Related SEC filing receipt" },
  { pattern: /gdelt|google news|rss|news|article|headline/i, type: "news", label: "Related news receipt" },
  { pattern: /coingecko|price|market|volume|crypto/i, type: "price_volume", label: "Related market movement receipt" },
  { pattern: /fred|frankfurter|fx|macro/i, type: "fundamentals", label: "Related macro context receipt" },
  { pattern: /openfda|fda|enforcement|recall/i, type: "news", label: "Related openFDA receipt" },
];

function text(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function objectValue(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function proofTypeFor(source: string, url: string, title: string): ProofType | null {
  const haystack = `${source} ${url} ${title}`;
  return SOURCE_TO_PROOF.find((entry) => entry.pattern.test(haystack))?.type ?? null;
}

function proofStrengthFor(type: ProofType, source: string): ProofItem["strength"] {
  if (type === "filing") return "strong";
  if (/gdelt|google news|openfda|coingecko/i.test(source)) return "medium";
  return "weak";
}

function proofFromRelatedSignal(signal: RawSignal, target: RawSignal): ProofItem | null {
  const receipts = receiptsFromRawSignal(signal);
  const url = text(signal.sourceUrl) || text(receipts.find((receipt) => text(receipt.url))?.url);
  if (!url) return null;
  const type = proofTypeFor(signal.source, url, signal.title);
  if (!type) return null;
  return {
    type,
    strength: proofStrengthFor(type, signal.source),
    label: SOURCE_TO_PROOF.find((entry) => entry.type === type && entry.pattern.test(`${signal.source} ${url} ${signal.title}`))?.label ?? "Related source receipt",
    source: signal.source,
    summary: signal.summary || signal.title,
    url,
    observedAt: signal.receivedAt.toISOString(),
    metadata: { enrichment: true, relatedRawSignalId: signal.id, targetRawSignalId: target.id },
  };
}

function shouldSkipReferenceUpdate(signal: RawSignal) {
  const payload = objectValue(signal.payload);
  const body = `${signal.title} ${signal.summary}`.toLowerCase();
  return signal.source === "Frankfurter FX" && (signal.importanceHint === "low" || body.includes("reference update") || payload.usefulContext === "reference_update");
}

export async function enrichProofForRawSignal(rawSignal: RawSignal): Promise<ProofEnrichmentResult> {
  const attempts: EnrichmentAttempt[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];
  const base = await buildProofBundleForRawSignal(rawSignal.id);
  if (!base) throw new Error("raw_signal_not_found");

  const payload = objectValue(rawSignal.payload);
  const company = text(payload.company ?? payload.companyName);
  const queryTerms = unique([rawSignal.ticker ?? "", company, rawSignal.title.split(/\s+/).slice(0, 4).join(" ")]).filter((term) => term.length >= 2);
  const enrichmentProofs: ProofItem[] = [];

  if (shouldSkipReferenceUpdate(rawSignal)) {
    attempts.push({ source: rawSignal.source, status: "skipped", detail: "Low-impact reference update skipped unless unusual movement is present." });
  } else {
    for (const source of ["SEC EDGAR", "GDELT", "Google News RSS", "openFDA", "CoinGecko", "FRED Macro", "Frankfurter FX"]) {
      try {
        const related = await prisma.rawSignal.findFirst({
          where: {
            id: { not: rawSignal.id },
            source,
            sourceUrl: { not: null },
            OR: [
              ...(rawSignal.ticker ? [{ ticker: { equals: rawSignal.ticker, mode: "insensitive" as const } }] : []),
              ...queryTerms.map((term) => ({ OR: [{ title: { contains: term, mode: "insensitive" as const } }, { summary: { contains: term, mode: "insensitive" as const } }] })),
            ],
          },
          orderBy: [{ receivedAt: "desc" }, { createdAt: "desc" }],
        });
        const proof = related ? proofFromRelatedSignal(related, rawSignal) : null;
        if (proof && !base.proofTypes.includes(proof.type) && !enrichmentProofs.some((item) => item.type === proof.type && item.url === proof.url)) {
          enrichmentProofs.push(proof);
          attempts.push({ source, status: "added", detail: `Added ${proof.type} proof from related raw signal ${related?.id}.`, proofType: proof.type });
        } else {
          attempts.push({ source, status: "missing", detail: related ? "Related signal did not provide a new real URL/proof type." : "No related stored raw signal with a real URL was available." });
        }
      } catch (error) {
        errors.push(`${source}: ${error instanceof Error ? error.message : "unknown_error"}`);
        attempts.push({ source, status: "error", detail: "Proof enrichment lookup failed." });
      }
    }
  }

  const enriched = await buildProofBundleForRawSignal(rawSignal.id, enrichmentProofs);
  if (!enrichmentProofs.length) warnings.push("No additional real supporting proof was found; candidate remains blocked if proof gates fail.");
  return {
    proofCount: enriched?.proofCount ?? base.proofCount,
    proofTypes: enriched?.proofTypes ?? base.proofTypes,
    receipts: unique([...(enriched?.proofs ?? base.proofs).map((proof) => proof.source)]),
    urls: unique((enriched?.proofs ?? base.proofs).map((proof) => text(proof.url))),
    strongestProof: enriched?.strongestProof ?? base.strongestProof,
    missingProof: enriched?.missingProof ?? base.missingProof,
    confidenceScore: enriched?.confidenceScore ?? base.confidenceScore,
    safeToPromote: enriched?.safeToPromote === "yes",
    enrichmentProofs,
    enrichmentAttempts: attempts,
    enrichmentWarnings: warnings,
    enrichmentErrors: errors,
    proofBundle: enriched,
  };
}
