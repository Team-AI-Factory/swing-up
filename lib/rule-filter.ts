export type RuleFilterDecision = "pass" | "reject" | "needs_more_data";

export type RejectionReasonLabel =
  | "missing_title"
  | "missing_url"
  | "missing_source"
  | "duplicate"
  | "no_company_match"
  | "weak_source"
  | "stale_event"
  | "low_impact"
  | "unsupported_asset"
  | "missing_receipts"
  | "unsafe_wording"
  | "needs_more_data";

export type RuleFilterInput = {
  title?: unknown;
  url?: unknown;
  source?: unknown;
  summary?: unknown;
  ticker?: unknown;
  company?: unknown;
  eventType?: unknown;
  assetType?: unknown;
  sourceReliability?: unknown;
  receipts?: unknown;
  receiptUrls?: unknown;
  publishedAt?: unknown;
  eventAt?: unknown;
  occurredAt?: unknown;
  importanceHint?: unknown;
  impactScore?: unknown;
  duplicateKey?: unknown;
  previousSignalKeys?: unknown;
  alreadyPricedIn?: unknown;
  pricedInWarning?: unknown;
  marketSentimentRisk?: unknown;
  marketSentimentWarning?: unknown;
};

export type RuleFilterResult = {
  ok: true;
  passed: boolean;
  decision: RuleFilterDecision;
  rejectionReasons: RejectionReasonLabel[];
  warningReasons: string[];
  detectedTicker: string | null;
  detectedCompany: string | null;
  detectedEventType: string | null;
  sourceReliability: "strong" | "medium" | "weak" | "unknown";
  receiptStatus: "verified" | "partial" | "missing";
  nextRecommendedStage: "ai_committee_queue" | "receipt_collection" | "manual_review" | "stop";
  simpleExplanation: string;
};

const STRONG_SOURCES = ["sec", "edgar", "nasdaq", "nyse", "globenewswire", "businesswire", "prnewswire", "fda", "clinicaltrials", "coingecko", "fred"];
const WEAK_SOURCES = ["reddit", "stocktwits", "x.com", "twitter", "tiktok", "discord", "telegram", "rumor", "rumour", "blog", "forum"];
const SUPPORTED_ASSETS = ["equity", "stock", "etf", "crypto", "fx", "forex", "macro", "commodity"];
const LOW_IMPACT_TERMS = ["newsletter", "podcast", "recap", "roundup", "minor", "routine", "reminder", "opinion"];
const HIGH_IMPACT_TERMS = ["guidance", "earnings", "fda", "approval", "contract", "acquisition", "merger", "bankruptcy", "sec", "filing", "partnership", "launch", "recall", "rate cut", "rate hike"];
const UNSAFE_WORDING = ["guaranteed", "can't lose", "cannot lose", "sure thing", "moonshot", "to the moon", "100x", "get rich", "insider tip", "secret leak"];
const TICKER_PATTERN = /(?:^|[\s($])([A-Z]{1,5})(?:[)\s.,:;!?]|$)/g;

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function lower(value: unknown) {
  return text(value).toLowerCase();
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function includesAny(value: string, terms: string[]) {
  return terms.some((term) => value.includes(term));
}

function uniqueReasons(reasons: RejectionReasonLabel[]) {
  return Array.from(new Set(reasons));
}

function receiptCount(input: RuleFilterInput) {
  if (Array.isArray(input.receipts)) return input.receipts.length;
  if (Array.isArray(input.receiptUrls)) return input.receiptUrls.length;
  if (typeof input.receipts === "number" && Number.isFinite(input.receipts)) return input.receipts;
  return 0;
}

function detectTicker(input: RuleFilterInput) {
  const explicit = text(input.ticker).toUpperCase();
  if (explicit) return explicit;

  const combined = `${text(input.title)} ${text(input.summary)}`;
  const ignored = new Set(["CEO", "CFO", "FDA", "SEC", "ETF", "USA", "USD", "AI"]);
  for (const match of combined.matchAll(TICKER_PATTERN)) {
    const candidate = match[1];
    if (!ignored.has(candidate)) return candidate;
  }

  return null;
}

function detectCompany(input: RuleFilterInput) {
  const explicit = text(input.company);
  if (explicit) return explicit;

  const title = text(input.title);
  const match = title.match(/([A-Z][A-Za-z0-9.&'-]+(?:\s+[A-Z][A-Za-z0-9.&'-]+){0,3})\s+(?:announces|reports|raises|cuts|receives|wins|files|launches|beats|misses)/);
  return match?.[1] ?? null;
}

function detectEventType(input: RuleFilterInput) {
  const explicit = text(input.eventType);
  if (explicit) return explicit;

  const combined = `${lower(input.title)} ${lower(input.summary)}`;
  if (combined.includes("earnings") || combined.includes("revenue")) return "earnings";
  if (combined.includes("fda") || combined.includes("approval")) return "regulatory";
  if (combined.includes("merger") || combined.includes("acquisition")) return "m_and_a";
  if (combined.includes("contract") || combined.includes("partnership")) return "commercial_deal";
  if (combined.includes("sec") || combined.includes("filing")) return "filing";
  return null;
}

function sourceReliability(input: RuleFilterInput): RuleFilterResult["sourceReliability"] {
  const explicit = lower(input.sourceReliability);
  if (["strong", "high", "confirmed", "verified"].includes(explicit)) return "strong";
  if (["medium", "moderate"].includes(explicit)) return "medium";
  if (["weak", "low", "rumor", "rumour"].includes(explicit)) return "weak";

  const source = lower(input.source);
  if (!source) return "unknown";
  if (includesAny(source, STRONG_SOURCES)) return "strong";
  if (includesAny(source, WEAK_SOURCES)) return "weak";
  return "medium";
}

function isDuplicate(input: RuleFilterInput) {
  const key = text(input.duplicateKey).toLowerCase();
  if (!key || !Array.isArray(input.previousSignalKeys)) return false;
  return input.previousSignalKeys.map((item) => text(item).toLowerCase()).includes(key);
}

function isStale(input: RuleFilterInput, now = new Date()) {
  const dateText = text(input.eventAt) || text(input.occurredAt) || text(input.publishedAt);
  if (!dateText) return false;
  const time = Date.parse(dateText);
  if (Number.isNaN(time)) return false;
  return now.getTime() - time > 1000 * 60 * 60 * 24 * 14;
}

function impactIsLow(input: RuleFilterInput) {
  const score = numberValue(input.impactScore);
  if (score !== null) return score < 35;
  const importance = lower(input.importanceHint);
  if (["low", "minor"].includes(importance)) return true;
  const combined = `${lower(input.title)} ${lower(input.summary)}`;
  return includesAny(combined, LOW_IMPACT_TERMS) && !includesAny(combined, HIGH_IMPACT_TERMS);
}

export const mockRuleFilterInput: RuleFilterInput = {
  title: "Shopify reports stronger enterprise demand after verified partner checks",
  url: "https://example.com/shopify-enterprise-demand",
  source: "BusinessWire",
  summary: "Multiple receipts point to improved commerce software demand, with no approval or publishing action taken by this preview.",
  ticker: "SHOP",
  company: "Shopify Inc.",
  eventType: "earnings_context",
  assetType: "equity",
  receipts: ["company release", "partner check"],
  impactScore: 68,
  publishedAt: new Date().toISOString(),
  duplicateKey: "businesswire::shop::enterprise-demand",
  previousSignalKeys: [],
  alreadyPricedIn: false,
  marketSentimentRisk: "neutral",
};

export function evaluateRuleFilter(input: RuleFilterInput = {}): RuleFilterResult {
  const rejectionReasons: RejectionReasonLabel[] = [];
  const warningReasons: string[] = [];
  const title = text(input.title);
  const url = text(input.url);
  const source = text(input.source);
  const detectedTicker = detectTicker(input);
  const detectedCompany = detectCompany(input);
  const detectedEventType = detectEventType(input);
  const reliability = sourceReliability(input);
  const receipts = receiptCount(input);
  const receiptStatus = receipts >= 2 ? "verified" : receipts === 1 ? "partial" : "missing";

  if (!title) rejectionReasons.push("missing_title");
  if (!url) rejectionReasons.push("missing_url");
  if (!source) rejectionReasons.push("missing_source");
  if (isDuplicate(input)) rejectionReasons.push("duplicate");
  if (!detectedTicker && !detectedCompany) rejectionReasons.push("no_company_match");
  if (reliability === "weak") rejectionReasons.push("weak_source");
  if (isStale(input)) rejectionReasons.push("stale_event");
  if (impactIsLow(input)) rejectionReasons.push("low_impact");
  if (text(input.assetType) && !SUPPORTED_ASSETS.includes(lower(input.assetType))) rejectionReasons.push("unsupported_asset");
  if (receiptStatus === "missing") rejectionReasons.push("missing_receipts");

  const combined = `${lower(input.title)} ${lower(input.summary)}`;
  if (includesAny(combined, UNSAFE_WORDING)) rejectionReasons.push("unsafe_wording");

  if (receiptStatus === "partial") warningReasons.push("Only one receipt is present; collect another independent receipt before expensive review.");
  if (input.alreadyPricedIn === true || text(input.pricedInWarning)) warningReasons.push(text(input.pricedInWarning) || "Already priced-in risk is present and should be reviewed before escalation.");
  if (text(input.marketSentimentRisk) && lower(input.marketSentimentRisk) !== "neutral") warningReasons.push(`Market sentiment risk noted: ${text(input.marketSentimentRisk)}.`);
  if (text(input.marketSentimentWarning)) warningReasons.push(text(input.marketSentimentWarning));

  const unique = uniqueReasons(rejectionReasons);
  const needsMoreData = unique.length === 0 && (!detectedEventType || reliability === "unknown" || receiptStatus === "partial");
  if (needsMoreData) unique.push("needs_more_data");

  const decision: RuleFilterDecision = unique.length > 0 ? (needsMoreData && unique.length === 1 ? "needs_more_data" : "reject") : "pass";
  const passed = decision === "pass";
  const nextRecommendedStage = passed ? "ai_committee_queue" : decision === "needs_more_data" ? "receipt_collection" : unique.includes("needs_more_data") ? "manual_review" : "stop";

  return {
    ok: true,
    passed,
    decision,
    rejectionReasons: unique,
    warningReasons,
    detectedTicker,
    detectedCompany,
    detectedEventType,
    sourceReliability: reliability,
    receiptStatus,
    nextRecommendedStage,
    simpleExplanation: passed
      ? "The signal passed the cheap rule filter and may move to the next internal review stage. This is not a profit prediction or publishing approval."
      : `The signal did not pass the cheap rule filter because: ${unique.join(", ")}. No alert was published or approved.`,
  };
}
