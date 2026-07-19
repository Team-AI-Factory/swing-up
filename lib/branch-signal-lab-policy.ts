export type BranchNewsChannel = "google_news_rss" | "gdelt" | "marketaux" | "alpha_vantage" | "fmp_crypto_news";

export type BalancedReceipt = {
  title: string;
  publisher: string;
  publishedAt: string;
  channel: BranchNewsChannel;
  url?: string;
};

function clamp(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

const HEADLINE_STOP_WORDS = new Set(["a", "an", "and", "as", "at", "by", "for", "from", "in", "is", "of", "on", "or", "the", "to", "with"]);

function canonicalHeadline(receipt: BalancedReceipt) {
  const publisher = receipt.publisher.toLowerCase().replace(/\s+/g, " ").trim();
  const title = receipt.title.toLowerCase().replace(/\s+/g, " ").trim();
  const publisherSuffix = ` - ${publisher}`;
  return (title.endsWith(publisherSuffix) ? title.slice(0, -publisherSuffix.length) : title).replace(/[^a-z0-9]+/g, " ").trim();
}

function escaped(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function normalizeProviderCryptoSymbol(value: unknown) {
  if (typeof value !== "string") return null;
  let symbol = value.trim().toUpperCase().replace(/^CRYPTO:/, "").replace(/[^A-Z0-9]/g, "");
  for (const quote of ["USDT", "USDC", "BUSD", "USD", "EUR", "GBP"]) {
    if (symbol.length > quote.length && symbol.endsWith(quote)) {
      symbol = symbol.slice(0, -quote.length);
      break;
    }
  }
  return symbol || null;
}

export function matchesAssetText(text: string, asset: { name: string; ticker: string; aliases?: string[] }) {
  const lower = text.toLowerCase();
  const ticker = asset.ticker.toLowerCase();
  const names = [asset.name, ...(asset.aliases ?? [])].map((value) => value.trim().toLowerCase()).filter((value) => value && value !== ticker);
  if (names.some((name) => new RegExp(`(^|[^a-z0-9])${escaped(name)}([^a-z0-9]|$)`, "i").test(lower))) return true;
  const tickerPattern = escaped(ticker);
  if (new RegExp(`(?:\\$${tickerPattern}\\b|\\bcrypto:${tickerPattern}\\b|\\b${tickerPattern}(?:[-/]?(?:usd|usdt|usdc|busd|eur|gbp))\\b)`, "i").test(lower)) return true;
  const ambiguousTicker = new Set(["ada", "arb", "atom", "link", "near", "op", "sei", "sol", "sui", "uni"]).has(ticker);
  if (ambiguousTicker) {
    const uppercaseTicker = escaped(asset.ticker.toUpperCase());
    const assetSpecificContext = "(?:token|coin|network|protocol|ecosystem|price|market)";
    return new RegExp(`(?:${assetSpecificContext}.{0,20}\\b${uppercaseTicker}\\b|\\b${uppercaseTicker}\\b.{0,20}${assetSpecificContext})`).test(text);
  }
  const cryptoContext = "(?:crypto(?:currency)?|token|coin|blockchain|network|protocol|ecosystem|price|market)";
  return new RegExp(`(?:${cryptoContext}.{0,32}\\b${tickerPattern}\\b|\\b${tickerPattern}\\b.{0,32}${cryptoContext})`, "i").test(lower);
}

export function canonicalEventIdentity(receipt: BalancedReceipt) {
  let canonicalUrl = "";
  if (receipt.url) {
    try {
      const parsed = new URL(receipt.url);
      canonicalUrl = `${parsed.hostname.replace(/^www\./, "")}${parsed.pathname.replace(/\/$/, "")}`.toLowerCase();
    } catch {}
  }
  const publishedHour = Number.isFinite(Date.parse(receipt.publishedAt)) ? new Date(receipt.publishedAt).toISOString().slice(0, 13) : "unknown";
  return `${canonicalHeadline(receipt)}|${receipt.publisher.toLowerCase().trim()}|${canonicalUrl}|${publishedHour}`;
}

function headlineTokens(value: string) {
  return new Set(value.split(" ").filter((token) => token.length > 1 && !HEADLINE_STOP_WORDS.has(token)));
}

function nearDuplicateHeadline(left: string, right: string) {
  if (left === right) return true;
  const leftTokens = headlineTokens(left);
  const rightTokens = headlineTokens(right);
  if (Math.min(leftTokens.size, rightTokens.size) < 5) return false;
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const union = new Set([...leftTokens, ...rightTokens]).size;
  return union > 0 && intersection / union >= 0.8;
}

export function selectBalancedReceipts<T extends BalancedReceipt>(receipts: T[], limit = 20) {
  const unique: Array<{ key: string; receipt: T }> = [];
  for (const receipt of receipts) {
    const key = canonicalHeadline(receipt);
    if (!unique.some((item) => nearDuplicateHeadline(item.key, key))) unique.push({ key, receipt });
  }
  const groups = new Map<BranchNewsChannel, T[]>();
  for (const receipt of unique.map((item) => item.receipt).sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))) {
    groups.set(receipt.channel, [...(groups.get(receipt.channel) ?? []), receipt]);
  }
  const channels = [...groups.keys()].sort((a, b) => (groups.get(b)?.length ?? 0) - (groups.get(a)?.length ?? 0));
  const selected: T[] = [];
  for (let index = 0; selected.length < limit; index += 1) {
    let added = false;
    for (const channel of channels) {
      const receipt = groups.get(channel)?.[index];
      if (receipt && selected.length < limit) {
        selected.push(receipt);
        added = true;
      }
    }
    if (!added) break;
  }
  return selected;
}

export function computeActionStrength(input: {
  catalystStrength: number;
  priceVolumeConfirmation: number;
  evidenceConfidence: number;
  absoluteMovePercent: number;
  alignedChannelCount: number;
  alignedPublisherCount: number;
  alignedKeywordCount: number;
}) {
  const moveConfirmation = clamp(input.absoluteMovePercent * 18);
  const channelConfirmation = clamp(input.alignedChannelCount * 32);
  const publisherConfirmation = clamp(input.alignedPublisherCount * 24);
  let score = clamp(input.catalystStrength * 0.25 + input.priceVolumeConfirmation * 0.2 + moveConfirmation * 0.15 + channelConfirmation * 0.2 + publisherConfirmation * 0.2);
  score = clamp(score * 0.72 + input.evidenceConfidence * 0.28);
  if (input.absoluteMovePercent < 2 || input.alignedChannelCount < 2 || input.alignedPublisherCount < 2 || input.alignedKeywordCount < 1) score = Math.min(score, 59);
  return score;
}

export function candidateFingerprintInput(input: { ticker: string; direction: "upside" | "downside"; alignedKeywords: string[]; eventIdentity: string }) {
  const eventSignature = [...new Set(input.alignedKeywords.map((keyword) => keyword.trim().toLowerCase()).filter(Boolean))].sort().join("|");
  return `${input.ticker.toUpperCase()}|${input.direction}|${eventSignature}|${input.eventIdentity}`;
}

export function providerFailurePolicy(input: { httpStatus?: number; bodyText?: string; transportFailure?: boolean; malformedPayload?: boolean }) {
  const throttled = input.httpStatus === 429 || /limit requests|rate.?limit|too many requests|please wait|quota|calls per day/i.test(input.bodyText ?? "");
  if (throttled) return { status: "rate_limited" as const, failureScope: "external_provider" as const, repairEligible: false, minimumCooldownMs: 15 * 60 * 1000 };
  if ([401, 402, 403].includes(input.httpStatus ?? 0)) return { status: "not_entitled" as const, failureScope: "configuration" as const, repairEligible: false, minimumCooldownMs: 6 * 60 * 60 * 1000 };
  if (input.transportFailure || input.malformedPayload || (input.httpStatus ?? 0) >= 500) return { status: "temporarily_unavailable" as const, failureScope: "external_provider" as const, repairEligible: false, minimumCooldownMs: 15 * 60 * 1000 };
  return { status: "failed" as const, failureScope: "external_provider" as const, repairEligible: false, minimumCooldownMs: 15 * 60 * 1000 };
}

export function providerCooldownMs(input: { failureCount: number; refreshMs: number; minimumCooldownMs?: number; maximumCooldownMs: number }) {
  return Math.min(input.maximumCooldownMs, Math.max(input.minimumCooldownMs ?? 0, input.refreshMs * 2 ** Math.min(4, Math.max(0, input.failureCount - 1))));
}

export type ProviderBudgetReservation = { quotaKey: string; cadenceKey: string; reservedAt: string };
export type ProviderBudgetRequest = { quotaKey: string; cadenceKey: string; rollingWindowMs: number; maximumCallsInWindow: number; minimumIntervalMs: number };

export function providerCallBudgetDecision(reservations: ProviderBudgetReservation[], request: ProviderBudgetRequest, now: number) {
  const callsInWindow = reservations.filter((reservation) => reservation.quotaKey === request.quotaKey && now - Date.parse(reservation.reservedAt) >= 0 && now - Date.parse(reservation.reservedAt) < request.rollingWindowMs);
  if (callsInWindow.length >= request.maximumCallsInWindow) {
    const oldest = callsInWindow.map((reservation) => Date.parse(reservation.reservedAt)).filter(Number.isFinite).sort((left, right) => left - right)[0] ?? now;
    return { allowed: false as const, nextRetryAt: new Date(oldest + request.rollingWindowMs).toISOString(), reason: "rolling_quota_guard" as const };
  }
  const latestCadenceAt = reservations
    .filter((reservation) => reservation.cadenceKey === request.cadenceKey)
    .map((reservation) => Date.parse(reservation.reservedAt))
    .filter(Number.isFinite)
    .sort((left, right) => right - left)[0];
  if (latestCadenceAt !== undefined && now - latestCadenceAt >= 0 && now - latestCadenceAt < request.minimumIntervalMs) {
    return { allowed: false as const, nextRetryAt: new Date(latestCadenceAt + request.minimumIntervalMs).toISOString(), reason: "cadence_guard" as const };
  }
  return { allowed: true as const, nextRetryAt: null, reason: "reserved" as const };
}

type BranchLabRun = Record<string, unknown>;
export type RepairFailure = { fingerprint: string; scope: "application" | "code" };

const EXTERNAL_FAILURE_SCOPES = new Set(["external", "external_provider", "provider", "upstream"]);
const EXTERNAL_FAILURE_STATUSES = new Set(["provider_unavailable", "rate_limited", "source_rate_limit_cooldown", "source_temporarily_unavailable", "upstream_unavailable"]);
const LIVE_PROVIDER_NAMES = ["coingecko", "google_news", "gdelt", "fred", "frankfurter", "marketaux", "alpha_vantage", "fmp", "sec_edgar", "openfda"];

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function isLegacyExternalStopReason(value: unknown) {
  const reason = stringValue(value)?.toLowerCase();
  return Boolean(reason && (reason.includes("required_live_sources_") || reason.includes("external_provider_") || reason.includes("source_rate_limit") || reason.includes("rate_limit_cooldown")));
}

function failureScope(run: BranchLabRun) {
  return stringValue(run.failureScope)?.toLowerCase() ?? null;
}

export function isExternalProviderFailure(run: BranchLabRun) {
  const scope = failureScope(run);
  const status = stringValue(run.status)?.toLowerCase();
  if (scope && EXTERNAL_FAILURE_SCOPES.has(scope)) return true;
  if (status && EXTERNAL_FAILURE_STATUSES.has(status)) return true;
  if (run.externalProviderFailure === true || run.providerCooldown === true) return true;
  if (scope) return false;
  const fingerprint = stringValue(run.technicalFailureFingerprint)?.toLowerCase();
  return Boolean(fingerprint && (
    fingerprint.startsWith("required_live_sources_")
    || fingerprint.startsWith("external_provider_")
    || fingerprint.startsWith("upstream_")
    || fingerprint.includes("rate_limit")
    || fingerprint.includes("cooldown")
    || (LIVE_PROVIDER_NAMES.some((provider) => fingerprint.includes(provider)) && ["http", "timeout", "unavailable", "upstream", "failed"].some((indicator) => fingerprint.includes(indicator)))
  ));
}

export function repairEligibleFailure(run: BranchLabRun): RepairFailure | null {
  if (isExternalProviderFailure(run) || run.repairEligible === false) return null;
  const fingerprint = stringValue(run.technicalFailureFingerprint);
  if (!fingerprint) return null;
  const scope = failureScope(run);
  const eligible = run.repairEligible === true || scope === "application" || scope === "code";
  if (!eligible || (scope && scope !== "application" && scope !== "code")) return null;
  return { fingerprint, scope: scope === "code" ? "code" : "application" };
}

function reportsMeasurableGain(run: BranchLabRun) {
  const result = stringValue(run.repairResult)?.toLowerCase();
  return run.measurableGain === true || run.repairMadeProgress === true || result === "improved" || result === "resolved";
}

export function noGainRepairAttempts(previousRuns: BranchLabRun[], report: BranchLabRun) {
  const current = repairEligibleFailure(report);
  if (!current || reportsMeasurableGain(report)) return 0;
  let attempts = 1;
  for (const previous of [...previousRuns].reverse()) {
    if (isExternalProviderFailure(previous)) continue;
    if (reportsMeasurableGain(previous)) break;
    const failure = repairEligibleFailure(previous);
    if (!failure || failure.fingerprint !== current.fingerprint || failure.scope !== current.scope) break;
    attempts += 1;
  }
  return attempts;
}
