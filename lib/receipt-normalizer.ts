export type ReceiptSourceType =
  | "sec"
  | "fmp"
  | "gdelt"
  | "fred"
  | "coingecko"
  | "frankfurter"
  | "google_news_rss"
  | "openfda"
  | "clinicaltrials"
  | "manual"
  | "mock"
  | "unknown";

export type RawReceiptInput = Record<string, unknown>;

export type NormalizedReceipt = {
  sourceName: string;
  sourceType: ReceiptSourceType;
  sourceUrl: string | null;
  title: string;
  capturedSummary: string;
  capturedAt: string | null;
  reliabilityScore: number;
  publicReceipt: boolean;
  linkedTicker: string | null;
  linkedCompany: string | null;
  linkedSignalId: string | null;
  linkedAlertId: string | null;
  linkedHistoricalEventId: string | null;
  warnings: string[];
};

export type NormalizeReceiptsResult = {
  ok: boolean;
  normalizedReceipts: NormalizedReceipt[];
  warnings: string[];
};

const OFFICIAL_SOURCES: ReceiptSourceType[] = ["sec", "fred", "openfda", "clinicaltrials"];
const KNOWN_DATA_PROVIDERS: ReceiptSourceType[] = ["fmp", "gdelt", "coingecko", "frankfurter", "google_news_rss"];

export const mockReceiptInputs: RawReceiptInput[] = [
  {
    sourceName: "SEC EDGAR",
    sourceType: "SEC",
    sourceUrl: "https://www.sec.gov/Archives/edgar/data/789019/000095017026000000/msft-20260630.htm",
    title: "Microsoft files annual report",
    summary: "Annual filing receipt captured from SEC EDGAR for evidence review.",
    capturedAt: "2026-06-18T10:15:00.000Z",
    linkedTicker: "MSFT",
    linkedCompany: "Microsoft Corporation",
    linkedSignalId: "mock-signal-sec-001",
    publicReceipt: true,
  },
  {
    provider: "GDELT",
    url: "https://example.com/business-news/cloud-demand-context",
    headline: "Business coverage notes cloud infrastructure demand",
    description: "Third-party news coverage is useful context, but not equivalent to a filing or regulator source.",
    publishedAt: "2026-06-18T09:45:00.000Z",
    ticker: "MSFT",
    companyName: "Microsoft Corporation",
  },
  {
    source: "manual analyst note",
    type: "manual",
    title: "Operator note: customer channel checks need verification",
    capturedSummary: "Manual receipts are retained for review, with clear warnings when a public URL or timestamp is missing.",
    linkedHistoricalEventId: "mock-historical-2019-cloud",
    publicReceipt: false,
  },
];

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function firstString(input: RawReceiptInput, keys: string[]): string | null {
  for (const key of keys) {
    const value = asString(input[key]);
    if (value) return value;
  }
  return null;
}

function inferSourceType(input: RawReceiptInput, sourceName: string, sourceUrl: string | null): ReceiptSourceType {
  const explicit = firstString(input, ["sourceType", "type", "providerType"]);
  const haystack = `${explicit ?? ""} ${sourceName} ${sourceUrl ?? ""}`.toLowerCase();
  if (haystack.includes("sec") || haystack.includes("edgar")) return "sec";
  if (haystack.includes("fmp") || haystack.includes("financialmodelingprep")) return "fmp";
  if (haystack.includes("gdelt")) return "gdelt";
  if (haystack.includes("fred") || haystack.includes("stlouisfed")) return "fred";
  if (haystack.includes("coingecko")) return "coingecko";
  if (haystack.includes("frankfurter")) return "frankfurter";
  if (haystack.includes("google news") || haystack.includes("news.google")) return "google_news_rss";
  if (haystack.includes("openfda") || haystack.includes("fda.gov")) return "openfda";
  if (haystack.includes("clinicaltrials")) return "clinicaltrials";
  if (haystack.includes("mock")) return "mock";
  if (haystack.includes("manual")) return "manual";
  return "unknown";
}

function normalizeTimestamp(value: string | null, warnings: string[]): string | null {
  if (!value) {
    warnings.push("Missing timestamp; receipt is still shown but reliability is reduced.");
    return null;
  }
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    warnings.push("Timestamp could not be parsed; receipt is still shown but reliability is reduced.");
    return null;
  }
  return new Date(timestamp).toISOString();
}

function scoreReceipt(sourceType: ReceiptSourceType, input: RawReceiptInput, warnings: string[], duplicate: boolean): number {
  let score = 35;
  const sourceName = firstString(input, ["sourceName", "source", "provider", "publisher"]) ?? "";
  const sourceUrl = firstString(input, ["sourceUrl", "url", "link", "filingUrl", "articleUrl"]);
  const linkedCompany = firstString(input, ["linkedCompany", "company", "companyName", "issuerName"]);

  if (OFFICIAL_SOURCES.includes(sourceType)) score += 35;
  if (sourceType === "sec") score += 10;
  if (KNOWN_DATA_PROVIDERS.includes(sourceType)) score += 22;
  if (linkedCompany && sourceName.toLowerCase().includes(linkedCompany.toLowerCase())) score += 8;
  if (sourceUrl?.includes("sec.gov") || sourceUrl?.includes("fda.gov") || sourceUrl?.includes("clinicaltrials.gov")) score += 8;
  if (sourceType === "google_news_rss" || sourceType === "gdelt") score -= 5;
  if (!sourceUrl) score -= 18;
  if (!firstString(input, ["capturedAt", "publishedAt", "timestamp", "date", "filedAt"])) score -= 14;
  if (duplicate) score -= 15;
  if (sourceType === "unknown") score -= 16;
  if (sourceType === "manual" || sourceType === "mock") score -= 8;

  if (!sourceUrl) warnings.push("Missing source URL; evidence should be treated as weak until verified.");
  if (duplicate) warnings.push("Possible duplicate receipt in this normalization batch.");
  if (sourceType === "unknown") warnings.push("Unclear source type; reliability is reduced.");
  if (sourceType === "manual" || sourceType === "mock") warnings.push("Manual or mock receipt; useful for preview but not strong public evidence.");

  return Math.max(0, Math.min(100, Math.round(score)));
}

export function normalizeReceipts(receipts: unknown): NormalizeReceiptsResult {
  const rawReceipts = Array.isArray(receipts) ? receipts : receipts ? [receipts] : [];
  const seen = new Set<string>();
  const warnings: string[] = [];

  const normalizedReceipts = rawReceipts.map((raw): NormalizedReceipt => {
    const input = raw && typeof raw === "object" ? (raw as RawReceiptInput) : {};
    const receiptWarnings: string[] = [];
    const sourceName = firstString(input, ["sourceName", "source", "provider", "publisher"]) ?? "Unknown source";
    const sourceUrl = firstString(input, ["sourceUrl", "url", "link", "filingUrl", "articleUrl"]);
    const sourceType = inferSourceType(input, sourceName, sourceUrl);
    const title = firstString(input, ["title", "headline", "name", "eventTitle"]) ?? "Untitled receipt";
    const capturedSummary = firstString(input, ["capturedSummary", "summary", "description", "snippet", "notes"]) ?? "No receipt summary was provided.";
    const capturedAt = normalizeTimestamp(firstString(input, ["capturedAt", "publishedAt", "timestamp", "date", "filedAt"]), receiptWarnings);
    const duplicateKey = `${sourceType}|${sourceUrl ?? "no-url"}|${title}`.toLowerCase();
    const duplicate = seen.has(duplicateKey);
    seen.add(duplicateKey);
    const reliabilityScore = scoreReceipt(sourceType, input, receiptWarnings, duplicate);

    return {
      sourceName,
      sourceType,
      sourceUrl,
      title,
      capturedSummary,
      capturedAt,
      reliabilityScore,
      publicReceipt: Boolean(input.publicReceipt ?? sourceUrl),
      linkedTicker: firstString(input, ["linkedTicker", "ticker", "symbol"]),
      linkedCompany: firstString(input, ["linkedCompany", "company", "companyName", "issuerName"]),
      linkedSignalId: firstString(input, ["linkedSignalId", "signalId", "rawSignalId"]),
      linkedAlertId: firstString(input, ["linkedAlertId", "alertId"]),
      linkedHistoricalEventId: firstString(input, ["linkedHistoricalEventId", "historicalEventId"]),
      warnings: receiptWarnings,
    };
  });

  if (!normalizedReceipts.length) warnings.push("No receipts were provided to normalize.");
  return { ok: true, normalizedReceipts, warnings };
}
