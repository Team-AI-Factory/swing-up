export type BranchNewsChannel =
  | "sec_current_filings"
  | "sec_press_release"
  | "google_news_rss"
  | "gdelt"
  | "marketaux"
  | "alpha_vantage"
  | "fmp_stock_news"
  | "benzinga"
  | "federal_reserve"
  | "white_house"
  | "treasury"
  | "federal_register"
  | "bls"
  | "bea"
  | "openfda";

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
const COMPANY_SUFFIXES = /\b(?:incorporated|inc|corporation|corp|company|co|limited|ltd|plc|holdings?|group|class [a-z])\b/gi;
const AMBIGUOUS_EQUITY_TICKERS = new Set(["A", "AI", "ALL", "ARE", "ARM", "CAN", "CAT", "CAR", "COST", "FOR", "IT", "LIFE", "LOVE", "ON", "OPEN", "OR", "SEE", "SO", "T", "UP", "W"]);
const AMBIGUOUS_COMPANY_NAMES = new Set(["american", "capital", "digital", "energy", "financial", "first", "freedom", "general", "global", "health", "international", "national", "new", "resources", "royal", "services", "systems", "technology", "technologies", "trust", "united", "world"]);

function escaped(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizedCompanyName(value: string) {
  return value
    .toLowerCase()
    .replace(COMPANY_SUFFIXES, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function canonicalHeadline(receipt: BalancedReceipt) {
  const publisher = receipt.publisher.toLowerCase().replace(/\s+/g, " ").trim();
  const title = receipt.title.toLowerCase().replace(/\s+/g, " ").trim();
  const publisherSuffix = ` - ${publisher}`;
  return (title.endsWith(publisherSuffix) ? title.slice(0, -publisherSuffix.length) : title).replace(/[^a-z0-9]+/g, " ").trim();
}

export function normalizeEquitySymbol(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase().replace(/^\$/, "").replace(/\//g, ".");
  return /^[A-Z][A-Z0-9.-]{0,9}$/.test(normalized) ? normalized : null;
}

export function matchesEquityText(text: string, equity: { name: string; ticker: string; aliases?: string[] }) {
  const ticker = normalizeEquitySymbol(equity.ticker);
  if (!ticker) return false;
  const padded = ` ${text.replace(/[^A-Za-z0-9$.-]+/g, " ")} `;
  const lower = padded.toLowerCase();
  const names = [equity.name, ...(equity.aliases ?? [])]
    .map(normalizedCompanyName)
    .filter((name) => name.length >= 5 && !/^(?:the|group|holdings?|company)$/.test(name) && !AMBIGUOUS_COMPANY_NAMES.has(name));
  if (names.some((name) => lower.includes(` ${name} `))) return true;
  const escapedTicker = escaped(ticker);
  if (new RegExp(`\\$${escapedTicker}(?:\\b|(?=[.-]))`).test(padded)) return true;
  if (AMBIGUOUS_EQUITY_TICKERS.has(ticker) || ticker.length < 2) return false;
  const uppercaseTicker = new RegExp(`(?:^|[^A-Z0-9])${escapedTicker}(?:$|[^A-Z0-9])`);
  const equityContext = /\b(?:shares?|stock|equity|ticker|nasdaq|nyse|earnings|guidance|investors?|filing|company)\b/i;
  return uppercaseTicker.test(text) && equityContext.test(text);
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
  return union > 0 && intersection / union >= 0.78;
}

export function selectBalancedReceipts<T extends BalancedReceipt>(receipts: T[], limit = 30) {
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

export function computeEventFirstStrength(input: {
  eventTruth: number;
  mappingConfidence: number;
  materiality: number;
  transmissionConfidence: number;
  historicalSupport: number;
  evidenceIndependence: number;
  contradictionPenalty: number;
  pricedInPenalty: number;
  rumour: boolean;
}) {
  const weighted =
    input.eventTruth * 0.24
    + input.mappingConfidence * 0.17
    + input.materiality * 0.16
    + input.transmissionConfidence * 0.18
    + input.historicalSupport * 0.1
    + input.evidenceIndependence * 0.15
    - input.contradictionPenalty * 0.18
    - input.pricedInPenalty * 0.08;
  let score = clamp(weighted);
  if (input.rumour || input.eventTruth < 65 || input.mappingConfidence < 70 || input.materiality < 50 || input.transmissionConfidence < 55) score = Math.min(score, 59);
  return score;
}

export function eventFirstGate(input: {
  eventTruth: number;
  mappingConfidence: number;
  materiality: number;
  transmissionConfidence: number;
  fresh: boolean;
  primarySource: boolean;
  independentPublishers: number;
  unresolvedSevereContradiction: boolean;
  rumour: boolean;
}) {
  const checks = {
    verifiedEventTruth: input.eventTruth >= 80,
    reliableTickerMapping: input.mappingConfidence >= 95,
    materialEvent: input.materiality >= 65,
    causalTransmission: input.transmissionConfidence >= 70,
    freshEvidence: input.fresh,
    primaryOrIndependentProof: input.primarySource || input.independentPublishers >= 2,
    noSevereContradiction: !input.unresolvedSevereContradiction,
    notRumour: !input.rumour,
  };
  return { checks, passed: Object.values(checks).every(Boolean) };
}

export function candidateFingerprintInput(input: { ticker: string; direction: "upside" | "downside"; eventFamily: string; eventIdentity: string }) {
  return `${input.ticker.toUpperCase()}|${input.direction}|${input.eventFamily.trim().toLowerCase()}|${input.eventIdentity}`;
}

export function providerFailurePolicy(input: { httpStatus?: number; bodyText?: string; transportFailure?: boolean; malformedPayload?: boolean }) {
  const throttled = input.httpStatus === 429 || /limit requests|rate.?limit|too many requests|please wait|quota|calls per day|call frequency/i.test(input.bodyText ?? "");
  if (throttled) return { status: "rate_limited" as const, failureScope: "external_provider" as const, repairEligible: false, minimumCooldownMs: 15 * 60 * 1000 };
  if ([401, 402, 403].includes(input.httpStatus ?? 0)) return { status: "not_entitled" as const, failureScope: "configuration" as const, repairEligible: false, minimumCooldownMs: 24 * 60 * 60 * 1000 };
  if (input.transportFailure || input.malformedPayload || (input.httpStatus ?? 0) >= 500) return { status: "temporarily_unavailable" as const, failureScope: "external_provider" as const, repairEligible: false, minimumCooldownMs: 15 * 60 * 1000 };
  return { status: "failed" as const, failureScope: "external_provider" as const, repairEligible: false, minimumCooldownMs: 15 * 60 * 1000 };
}

export function providerCooldownMs(input: { failureCount: number; refreshMs: number; minimumCooldownMs?: number; maximumCooldownMs: number }) {
  return Math.min(input.maximumCooldownMs, Math.max(input.minimumCooldownMs ?? 0, input.refreshMs * 2 ** Math.min(4, Math.max(0, input.failureCount - 1))));
}

export type ProviderBudgetReservation = { quotaKey: string; cadenceKey: string; reservedAt: string };
export type ProviderBudgetRequest = { quotaKey: string; cadenceKey: string; rollingWindowMs: number; maximumCallsInWindow: number; minimumIntervalMs: number };

function canonicalQuotaKey(value: string) {
  if (value === "marketaux_free") return "marketaux_free_100_daily";
  return value;
}

export function providerCallBudgetDecision(reservations: ProviderBudgetReservation[], request: ProviderBudgetRequest, now: number) {
  const requestedQuotaKey = canonicalQuotaKey(request.quotaKey);
  const callsInWindow = reservations.filter((reservation) => canonicalQuotaKey(reservation.quotaKey) === requestedQuotaKey && now - Date.parse(reservation.reservedAt) >= 0 && now - Date.parse(reservation.reservedAt) < request.rollingWindowMs);
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

const EXTERNAL_FAILURE_SCOPES = new Set(["external", "external_provider", "provider", "upstream", "external_storage"]);
const EXTERNAL_FAILURE_STATUSES = new Set(["provider_unavailable", "rate_limited", "source_rate_limit_cooldown", "source_temporarily_unavailable", "upstream_unavailable", "state_storage_unavailable"]);
const LIVE_PROVIDER_NAMES = ["google_news", "gdelt", "fred", "frankfurter", "marketaux", "alpha_vantage", "fmp", "sec_edgar", "openfda", "federal_register", "federal_reserve", "white_house", "treasury", "bls", "bea", "polygon", "benzinga"];

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
