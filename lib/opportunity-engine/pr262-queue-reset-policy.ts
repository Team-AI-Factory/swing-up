export const PR262_QUEUE_STALE_COMPANY_NEWS_MS = 6 * 60 * 60_000;
export const PR262_QUEUE_LOW_VALUE_PRIORITY = 80;

export type Pr262QueueSourceBucket =
  | "sec"
  | "official"
  | "direct_issuer"
  | "company_news"
  | "market_price"
  | "unknown";

export type Pr262QueueSourceCounts = Record<Pr262QueueSourceBucket, number>;

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function normalizedText(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function explicitTrue(item: JsonRecord, keys: string[]) {
  return keys.some((key) => item[key] === true);
}

function authorityLabel(value: unknown) {
  return /^(?:official|authoritative|primary(?:_source)?|direct_(?:issuer|company)|issuer_ir|company_ir)$/i
    .test(normalizedText(value).replace(/[\s-]+/g, "_"));
}

function authorityRecord(value: unknown) {
  const item = record(value);
  return Boolean(item && (
    explicitTrue(item, ["official", "primarySource", "primary_source", "authoritative", "isOfficial", "isPrimarySource"])
    || ["authority", "sourceAuthority", "source_authority", "reliability", "sourceType", "source_type"]
      .some((key) => authorityLabel(item[key]))
  ));
}

function hasExplicitAuthority(item: JsonRecord) {
  if (explicitTrue(item, ["official", "primarySource", "primary_source", "authoritative", "isOfficial", "isPrimarySource"])) {
    return true;
  }
  if (["authority", "sourceAuthority", "source_authority", "reliability", "sourceType", "source_type"]
    .some((key) => authorityLabel(item[key]))) {
    return true;
  }
  if (authorityRecord(item.receipt)) return true;
  return Array.isArray(item.receipts) && item.receipts.some(authorityRecord);
}

function hasSecIdentity(item: JsonRecord) {
  const source = normalizedText(item.source);
  const provider = normalizedText(item.sourceProvider ?? item.source_provider);
  const id = normalizedText(item.id);
  const identityMethod = normalizedText(item.identityMethod ?? item.identity_method);
  return source === "sec"
    || id.startsWith("sec:")
    || /^sec(?:_|-|$)/.test(provider)
    || provider.includes("sec_edgar")
    || identityMethod === "official_sec_archive_link"
    || typeof item.canonicalSecIndexUrl === "string"
    || typeof item.canonical_sec_index_url === "string";
}

function hasOfficialIdentity(item: JsonRecord) {
  const source = normalizedText(item.source);
  const provider = normalizedText(item.sourceProvider ?? item.source_provider);
  const channel = normalizedText(item.channel);
  return source === "official"
    || /^official(?:_|-|$)/.test(provider)
    || /^official(?:_|-|$)/.test(channel)
    || hasExplicitAuthority(item);
}

export function isPr262DirectIssuerQueueEvent(value: unknown) {
  const item = record(value);
  if (!item) return false;
  const marker = [
    item.source,
    item.sourceProvider,
    item.source_provider,
    item.channel,
    item.kind,
    item.mappingMethod,
    item.mapping_method,
    item.authority,
    item.sourceAuthority,
    item.source_authority,
    item.sourceType,
    item.source_type,
  ].map(normalizedText).join(" ").replace(/[\s-]+/g, "_");
  const id = normalizedText(item.id).replace(/[\s-]+/g, "_");
  return /(?:^|_)(?:direct_(?:issuer|company)|issuer_ir|issuer_sec|company_ir|official_company)(?:_|$)/.test(marker)
    || /^(?:issuer|direct_(?:issuer|company)):/.test(id)
    || marker.includes("issuer_announcement");
}

export function isPr262ProtectedQueueEvent(value: unknown) {
  const item = record(value);
  if (!item) return true;
  return hasSecIdentity(item)
    || hasOfficialIdentity(item)
    || isPr262DirectIssuerQueueEvent(item);
}

export function pr262QueueSourceBucket(value: unknown): Pr262QueueSourceBucket {
  const item = record(value);
  if (!item) return "unknown";
  if (hasSecIdentity(item)) return "sec";
  if (isPr262DirectIssuerQueueEvent(item)) return "direct_issuer";
  if (hasOfficialIdentity(item)) return "official";
  if (normalizedText(item.source) === "company_news") return "company_news";
  if (normalizedText(item.source) === "market_price") return "market_price";
  return "unknown";
}

function emptySourceCounts(): Pr262QueueSourceCounts {
  return {
    sec: 0,
    official: 0,
    direct_issuer: 0,
    company_news: 0,
    market_price: 0,
    unknown: 0,
  };
}

export function countPr262QueueEventsBySource(values: unknown[]) {
  return values.reduce<Pr262QueueSourceCounts>((counts, value) => {
    counts[pr262QueueSourceBucket(value)] += 1;
    return counts;
  }, emptySourceCounts());
}

type RemovalReason = "stale_company_news" | "low_value_non_authoritative_company_news";

function removalReason(value: unknown, nowMs: number): RemovalReason | null {
  const item = record(value);
  // Unknown and legacy rows are retained unless they are positively identified
  // as ordinary company-news. This one-time tool must fail closed.
  if (!item || normalizedText(item.source) !== "company_news" || isPr262ProtectedQueueEvent(item)) return null;

  const id = normalizedText(item.id);
  const provider = normalizedText(item.sourceProvider ?? item.source_provider);
  const observedAt = typeof item.observedAt === "string"
    ? Date.parse(item.observedAt)
    : typeof item.observed_at === "string"
      ? Date.parse(item.observed_at)
      : Number.NaN;
  const rawPriority = item.priority;
  const priority = typeof rawPriority === "number"
    ? rawPriority
    : typeof rawPriority === "string" && rawPriority.trim()
      ? Number(rawPriority)
      : Number.NaN;
  // The provider is required because it is one of the legacy direct-issuer
  // identity markers. Missing any core field makes deletion unsafe.
  if (!id || !provider || !Number.isFinite(observedAt) || !Number.isFinite(priority)) return null;
  if (nowMs >= observedAt && nowMs - observedAt > PR262_QUEUE_STALE_COMPANY_NEWS_MS) {
    return "stale_company_news";
  }
  return priority < PR262_QUEUE_LOW_VALUE_PRIORITY
    ? "low_value_non_authoritative_company_news"
    : null;
}

export function selectPr262PendingForOneTimeCleanup(pending: unknown[], now: Date) {
  const retained: unknown[] = [];
  const removed: unknown[] = [];
  const removalReasons: Record<RemovalReason, number> = {
    stale_company_news: 0,
    low_value_non_authoritative_company_news: 0,
  };
  for (const event of pending) {
    const reason = removalReason(event, now.getTime());
    if (reason) {
      removed.push(event);
      removalReasons[reason] += 1;
    } else {
      retained.push(event);
    }
  }
  return {
    retained,
    removed,
    retainedCountsBySource: countPr262QueueEventsBySource(retained),
    removedCountsBySource: countPr262QueueEventsBySource(removed),
    removalReasons,
  };
}
