import type { RawSignal } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { receiptsFromRawSignal } from "@/lib/raw-signal-quality-gate";
import {
  buildProofBundleForRawSignal,
  type ProofBundle,
  type ProofItem,
  type ProofType,
} from "@/lib/proof/proof-bundle-builder";

type JsonRecord = Record<string, unknown>;

export type EnrichmentAttempt = {
  source: string;
  status: "added" | "missing" | "skipped" | "error";
  detail: string;
  proofType?: ProofType;
};

export type ProofMatchReport = {
  proofType: ProofType | "unknown";
  source: string;
  title: string;
  url: string | null;
  proofMatchScore: number;
  matchedTicker: boolean;
  matchedCompany: boolean;
  matchedTopic: boolean;
  freshWithin72h: boolean;
  urlIsSpecific: boolean;
  reasons: string[];
};

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
  acceptedProofItems: ProofMatchReport[];
  rejectedProofItems: ProofMatchReport[];
  rejectedProofReasons: string[];
  enrichmentAttempts: EnrichmentAttempt[];
  enrichmentWarnings: string[];
  enrichmentErrors: string[];
  proofBundle: ProofBundle | null;
  cleanNewsReceiptAttached: boolean;
  cleanNewsReceiptReason: string | null;
  rejectedNewsReceiptReason: string | null;
};

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

const SOURCE_TO_PROOF: Array<{
  pattern: RegExp;
  type: ProofType;
  label: string;
}> = [
  {
    pattern: /sec|edgar|filing|10-[qk]|8-k/i,
    type: "filing",
    label: "Related SEC filing receipt",
  },
  {
    pattern:
      /fmp catalyst|marketaux catalyst|alpha vantage catalyst|gdelt|google news|rss|news|article|headline|press release|transcript/i,
    type: "news",
    label: "Related news/catalyst receipt",
  },
  {
    pattern: /coingecko|price|market|volume|crypto/i,
    type: "price_volume",
    label: "Related market movement receipt",
  },
  {
    pattern: /fred|frankfurter|fx|macro/i,
    type: "fundamentals",
    label: "Related macro context receipt",
  },
  {
    pattern: /openfda|fda|enforcement|recall/i,
    type: "news",
    label: "Related openFDA receipt",
  },
];

function text(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function objectValue(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function proofTypeFor(
  source: string,
  url: string,
  title: string,
): ProofType | null {
  const haystack = `${source} ${url} ${title}`;
  return (
    SOURCE_TO_PROOF.find((entry) => entry.pattern.test(haystack))?.type ?? null
  );
}

function proofStrengthFor(
  type: ProofType,
  source: string,
  url: string,
): ProofItem["strength"] {
  if (type === "filing") return isSpecificUrl(url) ? "strong" : "weak";
  if (
    /fmp catalyst|marketaux catalyst|alpha vantage catalyst|gdelt|google news|openfda|coingecko/i.test(
      source,
    )
  )
    return "medium";
  return "weak";
}

const GENERIC_URL_PATTERNS = [
  /^https?:\/\/(www\.)?sec\.gov\/edgar\/?$/i,
  /^https?:\/\/(www\.)?sec\.gov\/?$/i,
  /^https?:\/\/(www\.)?marketaux\.com\/?$/i,
  /^https?:\/\/(www\.)?alphavantage\.co\/?$/i,
  /^https?:\/\/(www\.)?financialmodelingprep\.com\/?$/i,
  /^https?:\/\/(www\.)?fmpcloud\.io\/?$/i,
];

function isSpecificUrl(url: string) {
  if (!/^https?:\/\//i.test(url)) return false;
  if (GENERIC_URL_PATTERNS.some((pattern) => pattern.test(url.trim())))
    return false;
  try {
    const parsed = new URL(url);
    if (parsed.pathname === "/" || parsed.pathname === "") return false;
    if (
      /query|api|v3|v4/i.test(parsed.pathname) &&
      parsed.search &&
      !/article|filing|accession|document|news|press|ticker|symbol/i.test(
        parsed.pathname + parsed.search,
      )
    )
      return false;
    if (/sec\.gov$/i.test(parsed.hostname))
      return /Archives\/edgar\/data|ixviewer\/doc\/action|getcompany|browse-edgar/i.test(
        parsed.pathname + parsed.search,
      );
    return true;
  } catch {
    return false;
  }
}

const TOPIC_KEYWORDS = [
  "earnings",
  "guidance",
  "filing",
  "8-k",
  "10-q",
  "10-k",
  "partnership",
  "customer",
  "contract",
  "approval",
  "recall",
  "demand",
  "margin",
  "price target",
  "estimate",
  "dividend",
  "buyback",
  "merger",
  "acquisition",
  "semiconductor",
  "ai",
  "gpu",
  "memory",
  "hbm",
  "revenue",
  "profit",
];

function companyTerms(rawSignal: RawSignal) {
  const payload = objectValue(rawSignal.payload);
  return unique([
    text(payload.company),
    text(payload.companyName),
    text(payload.entityName),
  ]).filter((term) => term.length >= 3);
}

function topicTerms(...texts: string[]) {
  const haystack = texts.join(" ").toLowerCase();
  return TOPIC_KEYWORDS.filter((term) => haystack.includes(term));
}

function proofMatchReport(
  signal: RawSignal,
  proofSignal: RawSignal,
  type: ProofType | null,
  url: string,
): ProofMatchReport {
  const targetTicker = text(signal.ticker).toUpperCase();
  const proofTicker = text(proofSignal.ticker).toUpperCase();
  const proofHaystack =
    `${proofSignal.title} ${proofSignal.summary} ${proofTicker}`.toLowerCase();
  const signalHaystack =
    `${signal.title} ${signal.summary} ${targetTicker}`.toLowerCase();
  const companies = companyTerms(signal);
  const proofCompanies = companyTerms(proofSignal);
  const matchedTicker = Boolean(
    targetTicker &&
    (proofTicker === targetTicker ||
      proofHaystack.includes(targetTicker.toLowerCase())),
  );
  const matchedCompany =
    companies.some((company) =>
      proofHaystack.includes(company.toLowerCase()),
    ) ||
    proofCompanies.some((company) =>
      signalHaystack.includes(company.toLowerCase()),
    );
  const targetTopics = topicTerms(signal.title, signal.summary);
  const proofTopics = topicTerms(proofSignal.title, proofSignal.summary);
  const matchedTopic = targetTopics.some((topic) =>
    proofTopics.includes(topic),
  );
  const freshWithin72h =
    Date.now() - proofSignal.receivedAt.getTime() <= 72 * 60 * 60 * 1000;
  const urlIsSpecific = isSpecificUrl(url);
  const differentEntity = Boolean(
    (targetTicker && proofTicker && targetTicker !== proofTicker) ||
    (companies.length &&
      proofCompanies.length &&
      !matchedCompany &&
      !matchedTicker),
  );
  let proofMatchScore = 0;
  const reasons: string[] = [];
  if (matchedTicker) {
    proofMatchScore += 35;
    reasons.push("same_ticker");
  }
  if (matchedCompany) {
    proofMatchScore += 25;
    reasons.push("same_company");
  }
  if (matchedTopic) {
    proofMatchScore += 20;
    reasons.push("same_or_related_topic");
  }
  if (freshWithin72h) {
    proofMatchScore += 10;
    reasons.push("fresh_within_72h");
  } else {
    proofMatchScore -= 20;
    reasons.push("stale_evidence");
  }
  if (urlIsSpecific) {
    proofMatchScore += 10;
    reasons.push("specific_receipt_url");
  } else {
    proofMatchScore -= 30;
    reasons.push("generic_or_api_url");
  }
  if (differentEntity) {
    proofMatchScore -= 50;
    reasons.push("different_ticker_or_company");
  }
  if (!matchedTopic) {
    proofMatchScore -= 30;
    reasons.push("unrelated_topic");
  }
  if (type === "source_health") {
    proofMatchScore = 0;
    reasons.push("source_health_is_diagnostic_not_proof");
  }
  proofMatchScore = Math.max(0, Math.min(100, proofMatchScore));
  return {
    proofType: type ?? "unknown",
    source: proofSignal.source,
    title: proofSignal.title,
    url: url || null,
    proofMatchScore,
    matchedTicker,
    matchedCompany,
    matchedTopic,
    freshWithin72h,
    urlIsSpecific,
    reasons,
  };
}

function proofFromRelatedSignal(
  signal: RawSignal,
  target: RawSignal,
): ProofItem | null {
  const receipts = receiptsFromRawSignal(signal);
  const url =
    text(signal.sourceUrl) ||
    text(receipts.find((receipt) => text(receipt.url))?.url);
  if (!url) return null;
  const type = proofTypeFor(signal.source, url, signal.title);
  if (!type) return null;
  return {
    type,
    strength: proofStrengthFor(type, signal.source, url),
    label:
      SOURCE_TO_PROOF.find(
        (entry) =>
          entry.type === type &&
          entry.pattern.test(`${signal.source} ${url} ${signal.title}`),
      )?.label ?? "Related source receipt",
    source: signal.source,
    summary: signal.summary || signal.title,
    url,
    observedAt: signal.receivedAt.toISOString(),
    metadata: {
      enrichment: true,
      relatedRawSignalId: signal.id,
      targetRawSignalId: target.id,
    },
  };
}

function rawSignalReceiptUrl(rawSignal: RawSignal) {
  const receipts = receiptsFromRawSignal(rawSignal);
  return (
    text(rawSignal.sourceUrl) ||
    text(receipts.find((receipt) => text(receipt.url))?.url)
  );
}

function isOpinionOrNoiseArticle(rawSignal: RawSignal) {
  const body =
    `${rawSignal.source} ${rawSignal.title} ${rawSignal.summary}`.toLowerCase();
  if (
    /\b(opinion|commentary|rumou?r|why i think|could be|might be)\b/.test(body)
  )
    return "opinion_only_content";
  if (
    /\b(moon|rocket|guaranteed|can't miss|explosive upside|hype)\b/.test(body)
  )
    return "hype_only_article";
  if (
    /\b(markets today|stock market today|generic market update|what to watch)\b/.test(
      body,
    ) &&
    !rawSignal.ticker
  )
    return "generic_market_commentary";
  return null;
}

function cleanNewsReceiptFromRawSignal(
  rawSignal: RawSignal,
):
  | { proof: ProofItem; match: ProofMatchReport; reason: string }
  | { rejected: string } {
  const url = rawSignalReceiptUrl(rawSignal);
  if (!text(rawSignal.source)) return { rejected: "missing_source" };
  if (!text(rawSignal.title)) return { rejected: "missing_title" };
  if (!url || !isSpecificUrl(url))
    return { rejected: "missing_specific_source_url_or_receipt_url" };
  if (!rawSignal.receivedAt) return { rejected: "missing_received_at" };
  const noise = isOpinionOrNoiseArticle(rawSignal);
  if (noise) return { rejected: noise };
  const topics = topicTerms(rawSignal.title, rawSignal.summary);
  if (!topics.length) return { rejected: "missing_topic_match" };
  const ticker = text(rawSignal.ticker).toUpperCase();
  const companies = companyTerms(rawSignal);
  if (!ticker && !companies.length)
    return { rejected: "missing_ticker_or_company_match" };
  const match = proofMatchReport(rawSignal, rawSignal, "news", url);
  if (!(match.matchedTicker || match.matchedCompany))
    return { rejected: "unrelated_ticker_mention" };
  if (!match.matchedTopic) return { rejected: "missing_topic_match" };
  return {
    proof: {
      type: "news",
      strength: "medium",
      label: "Clean raw news receipt",
      source: rawSignal.source,
      summary: rawSignal.summary || rawSignal.title,
      url,
      observedAt: rawSignal.receivedAt.toISOString(),
      metadata: {
        cleanNewsReceiptAttached: true,
        rawSignalId: rawSignal.id,
        ticker: ticker || null,
        company: companies[0] ?? null,
        topics,
      },
    },
    match: {
      ...match,
      reasons: unique([...match.reasons, "raw_candidate_clean_news_receipt"]),
    },
    reason:
      "Raw candidate has source, title, ticker/company match, specific receipt URL, receivedAt, and topic match.",
  };
}

function shouldSkipReferenceUpdate(signal: RawSignal) {
  const payload = objectValue(signal.payload);
  const body = `${signal.title} ${signal.summary}`.toLowerCase();
  return (
    signal.source === "Frankfurter FX" &&
    (signal.importanceHint === "low" ||
      body.includes("reference update") ||
      payload.usefulContext === "reference_update")
  );
}

export async function enrichProofForRawSignal(
  rawSignal: RawSignal,
): Promise<ProofEnrichmentResult> {
  const attempts: EnrichmentAttempt[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];
  const base = await buildProofBundleForRawSignal(rawSignal.id);
  if (!base) throw new Error("raw_signal_not_found");

  const payload = objectValue(rawSignal.payload);
  const company = text(payload.company ?? payload.companyName);
  const queryTerms = unique([
    rawSignal.ticker ?? "",
    company,
    rawSignal.title.split(/\s+/).slice(0, 4).join(" "),
  ]).filter((term) => term.length >= 2);
  const enrichmentProofs: ProofItem[] = [];
  const acceptedProofItems: ProofMatchReport[] = [];
  const rejectedProofItems: ProofMatchReport[] = [];
  const rawNewsReceipt = cleanNewsReceiptFromRawSignal(rawSignal);
  const cleanNewsReceiptAttached = "proof" in rawNewsReceipt;
  const cleanNewsReceiptReason =
    "reason" in rawNewsReceipt ? rawNewsReceipt.reason : null;
  const rejectedNewsReceiptReason =
    "rejected" in rawNewsReceipt ? rawNewsReceipt.rejected : null;
  if ("proof" in rawNewsReceipt) {
    enrichmentProofs.push(rawNewsReceipt.proof);
    acceptedProofItems.push(rawNewsReceipt.match);
    attempts.push({
      source: rawSignal.source,
      status: "added",
      detail: rawNewsReceipt.reason,
      proofType: "news",
    });
  } else {
    attempts.push({
      source: rawSignal.source,
      status: "missing",
      detail: `Raw candidate news receipt rejected: ${rawNewsReceipt.rejected}.`,
    });
  }

  for (const proof of base.proofs.filter(
    (item) => item.type === "source_health",
  )) {
    rejectedProofItems.push({
      proofType: "source_health",
      source: proof.source,
      title: proof.label,
      url: proof.url ?? null,
      proofMatchScore: 0,
      matchedTicker: false,
      matchedCompany: false,
      matchedTopic: false,
      freshWithin72h: false,
      urlIsSpecific: false,
      reasons: ["source_health_is_diagnostic_not_proof"],
    });
  }

  if (shouldSkipReferenceUpdate(rawSignal)) {
    attempts.push({
      source: rawSignal.source,
      status: "skipped",
      detail:
        "Low-impact reference update skipped unless unusual movement is present.",
    });
  } else {
    for (const source of [
      "FMP Catalyst",
      "Marketaux Catalyst",
      "Alpha Vantage Catalyst",
      "Google News RSS",
      "GDELT",
      "SEC EDGAR",
      "openFDA",
      "CoinGecko",
      "FRED Macro",
      "Frankfurter FX",
    ]) {
      try {
        const related = await prisma.rawSignal.findFirst({
          where: {
            id: { not: rawSignal.id },
            source,
            sourceUrl: { not: null },
            OR: [
              ...(rawSignal.ticker
                ? [
                    {
                      ticker: {
                        equals: rawSignal.ticker,
                        mode: "insensitive" as const,
                      },
                    },
                  ]
                : []),
              ...queryTerms.map((term) => ({
                OR: [
                  { title: { contains: term, mode: "insensitive" as const } },
                  { summary: { contains: term, mode: "insensitive" as const } },
                ],
              })),
            ],
          },
          orderBy: [{ receivedAt: "desc" }, { createdAt: "desc" }],
        });
        const proof = related
          ? proofFromRelatedSignal(related, rawSignal)
          : null;
        const match =
          related && proof?.url
            ? proofMatchReport(rawSignal, related, proof.type, proof.url)
            : null;
        if (match && match.proofMatchScore < 70) rejectedProofItems.push(match);
        if (
          proof &&
          match &&
          match.proofMatchScore >= 70 &&
          !base.proofTypes.includes(proof.type) &&
          !enrichmentProofs.some(
            (item) => item.type === proof.type && item.url === proof.url,
          )
        ) {
          enrichmentProofs.push(proof);
          acceptedProofItems.push(match);
          attempts.push({
            source,
            status: "added",
            detail: `Added ${proof.type} proof from related raw signal ${related?.id} with proofMatchScore ${match.proofMatchScore}.`,
            proofType: proof.type,
          });
        } else {
          attempts.push({
            source,
            status: "missing",
            detail: related
              ? match
                ? `Related signal rejected or duplicate; proofMatchScore ${match.proofMatchScore}; reasons: ${match.reasons.join(", ")}.`
                : "Related signal did not provide a new real URL/proof type."
              : "No related stored raw signal with a real URL was available.",
          });
        }
      } catch (error) {
        errors.push(
          `${source}: ${error instanceof Error ? error.message : "unknown_error"}`,
        );
        attempts.push({
          source,
          status: "error",
          detail: "Proof enrichment lookup failed.",
        });
      }
    }
  }

  const enriched = await buildProofBundleForRawSignal(
    rawSignal.id,
    enrichmentProofs,
  );
  if (!enrichmentProofs.length)
    warnings.push(
      "No additional real supporting proof was found; candidate remains blocked if proof gates fail.",
    );
  return {
    proofCount: (enriched?.proofs ?? base.proofs).filter((proof) =>
      VALID_CANDIDATE_PROOF_TYPES.has(proof.type),
    ).length,
    proofTypes: (enriched?.proofTypes ?? base.proofTypes).filter((type) =>
      VALID_CANDIDATE_PROOF_TYPES.has(type),
    ),
    receipts: unique([
      ...(enriched?.proofs ?? base.proofs).map((proof) => proof.source),
    ]),
    urls: unique(
      (enriched?.proofs ?? base.proofs).map((proof) => text(proof.url)),
    ),
    strongestProof:
      (enriched?.proofs ?? base.proofs)
        .filter((proof) => VALID_CANDIDATE_PROOF_TYPES.has(proof.type))
        .sort(
          (a, b) =>
            ({ weak: 1, medium: 2, strong: 3 })[b.strength] -
            { weak: 1, medium: 2, strong: 3 }[a.strength],
        )[0] ?? null,
    missingProof: (enriched?.missingProof ?? base.missingProof).filter((type) =>
      VALID_CANDIDATE_PROOF_TYPES.has(type),
    ),
    confidenceScore: enriched?.confidenceScore ?? base.confidenceScore,
    safeToPromote:
      enriched?.safeToPromote === "yes" &&
      (enriched.proofTypes ?? []).filter((type) =>
        VALID_CANDIDATE_PROOF_TYPES.has(type),
      ).length >= 2,
    enrichmentProofs,
    acceptedProofItems,
    rejectedProofItems,
    rejectedProofReasons: unique(
      rejectedProofItems.flatMap((item) => item.reasons),
    ),
    enrichmentAttempts: attempts,
    enrichmentWarnings: [
      ...warnings,
      ...((enriched?.proofs ?? base.proofs).some((proof) =>
        VALID_CANDIDATE_PROOF_TYPES.has(proof.type),
      )
        ? []
        : ["No valid supporting proof found."]),
    ],
    enrichmentErrors: errors,
    proofBundle: enriched,
    cleanNewsReceiptAttached,
    cleanNewsReceiptReason,
    rejectedNewsReceiptReason,
  };
}
