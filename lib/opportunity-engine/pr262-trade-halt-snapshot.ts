import { fetchNasdaqTradeHalts } from "@/lib/equity-signal/event-sources";
import type { EventReceipt, ProviderResult } from "@/lib/equity-signal/types";
import { pr262StorageKey } from "@/lib/opportunity-engine/pr262-storage";
import { readVersionedTextFromR2, writeVersionedJsonToR2 } from "@/lib/r2-warehouse";

const SNAPSHOT_KEY = pr262StorageKey("sensor/trade-halt-snapshot-v1.json");
const MAX_SNAPSHOT_AGE_MS = 15 * 60_000;
const OFFICIAL_URLS = new Set([
  "https://www.nyse.com/api/trade-halts/current",
  "https://m.nasdaqtrader.com/rss.aspx?feed=tradehalts",
  "https://www.nasdaqtrader.com/rss.aspx?feed=tradehalts",
  "https://nasdaqtrader.com/rss.aspx?feed=tradehalts",
]);

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function validReceipt(value: unknown): value is EventReceipt {
  const receipt = object(value);
  return receipt.channel === "nasdaq_trade_halts"
    && receipt.official === true && receipt.primarySource === true
    && typeof receipt.id === "string" && receipt.id.length > 0
    && typeof receipt.title === "string" && typeof receipt.publisher === "string"
    && (receipt.summary === null || typeof receipt.summary === "string")
    && typeof receipt.url === "string" && OFFICIAL_URLS.has(receipt.url)
    && typeof receipt.publishedAt === "string" && Number.isFinite(Date.parse(receipt.publishedAt))
    && typeof receipt.rawEventType === "string" && /^halt:[^:]+:(active|resumed)$/.test(receipt.rawEventType)
    && Array.isArray(receipt.symbolHints) && receipt.symbolHints.length > 0
    && receipt.symbolHints.every(symbol => typeof symbol === "string" && /^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol))
    && Array.isArray(receipt.companyHints) && receipt.companyHints.every(company => typeof company === "string");
}

function validSnapshot(value: unknown): ProviderResult | null {
  const snapshot = object(value);
  const provider = object(snapshot.provider);
  if (snapshot.version !== 1 || provider.provider !== "nasdaq_trade_halts"
    || provider.status !== "connected" || provider.cached !== false || provider.entitlementVerified !== true
    || typeof provider.checkedAt !== "string" || !Number.isFinite(Date.parse(provider.checkedAt))
    || !Array.isArray(provider.sourceUrls) || !provider.sourceUrls.length
    || !provider.sourceUrls.every(url => typeof url === "string" && OFFICIAL_URLS.has(url))
    || !Array.isArray(provider.receipts) || !provider.receipts.every(validReceipt)
    || provider.recordsRead !== provider.receipts.length) return null;
  return provider as ProviderResult;
}

async function persistSnapshot(provider: ProviderResult) {
  const snapshot = { version: 1, provider };
  if (!validSnapshot(snapshot)) return;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const current = await readVersionedTextFromR2(SNAPSHOT_KEY);
    let previous: ProviderResult | null = null;
    try { previous = current.text ? validSnapshot(JSON.parse(current.text)) : null; } catch { /* Replace invalid cache with verified evidence. */ }
    // A slower older request must not resurrect an active halt after a newer
    // authoritative empty or resumed snapshot has already been saved.
    if (previous && Date.parse(previous.checkedAt!) >= Date.parse(provider.checkedAt!)) return;
    const saved = await writeVersionedJsonToR2(SNAPSHOT_KEY, snapshot,
      current.etag ? { expectedEtag: current.etag } : { createOnly: true });
    if (!saved.conflict) return;
  }
}

/** Share the same authoritative safety observation between sensor and event jobs. */
export async function fetchPr262TradeHalts(fetchImpl: typeof fetch, now: Date): Promise<ProviderResult> {
  const current = await fetchNasdaqTradeHalts(fetchImpl, now);
  if (current.status === "connected") {
    // Storage availability cannot invalidate the authoritative response read in
    // this call. A failed write merely prevents other jobs from reusing it.
    await persistSnapshot(current).catch(() => undefined);
    return current;
  }
  // Only a deliberate cadence/quota deferral can reuse known safety state.
  // Transport failures remain failures; this does not mark an outage healthy.
  if (current.status !== "not_due") return current;
  try {
    const stored = await readVersionedTextFromR2(SNAPSHOT_KEY);
    const previous = stored.found && stored.text ? validSnapshot(JSON.parse(stored.text)) : null;
    const age = previous ? now.getTime() - Date.parse(previous.checkedAt!) : Number.NaN;
    if (!previous || !Number.isFinite(age) || age < 0 || age > MAX_SNAPSHOT_AGE_MS) return current;
    return { ...previous, status: "not_due", cached: true, cacheAgeMs: age,
      nextRetryAt: current.nextRetryAt, error: current.error };
  } catch {
    return current;
  }
}
