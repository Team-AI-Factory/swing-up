import type { Pr262ExposureEntry } from "@/lib/opportunity-engine/pr262-exposure-index";

/** One bounded scan: retain active companies, rotate through every other listing. */
export function selectMarketWatch(exposure: Pr262ExposureEntry[], offset: number, activeTickers: string[] = []) {
  const all = exposure.filter(row => row.tradingViewSymbol).sort((a, b) => a.ticker.localeCompare(b.ticker));
  const active = new Set(activeTickers);
  const hot = all.filter(row => active.has(row.ticker)).slice(0, 100);
  const hotTickers = new Set(hot.map(row => row.ticker));
  const rest = all.filter(row => !hotTickers.has(row.ticker));
  const count = Math.min(500 - hot.length, rest.length);
  const start = rest.length ? Math.max(0, Math.floor(Number.isFinite(offset) ? offset : 0)) % rest.length : 0;
  const rotating = Array.from({ length: count }, (_, index) => rest[(start + index) % rest.length]);
  return { entries: [...hot, ...rotating], nextOffset: rest.length ? (start + count) % rest.length : 0,
    eligibleCompanies: all.length, activeCompanies: hot.length, rotationCycles: Math.ceil(rest.length / Math.max(1, count)) };
}

export type WatchPrice = { ticker: string; checkedAt: string; price: number };
export function mergeWatchPrices(previous: unknown, incoming: WatchPrice[], now: Date): WatchPrice[] {
  const snapshot = previous && typeof previous === "object" ? previous as Record<string, unknown> : {};
  const rows = Array.isArray(snapshot.prices) ? snapshot.prices as WatchPrice[] : [];
  const prices = new Map<string, WatchPrice>();
  for (const row of [...rows.map(row => ({ ...row, checkedAt: row.checkedAt ?? String(snapshot.checkedAt ?? "") })), ...incoming]) {
    const age = now.getTime() - Date.parse(row.checkedAt);
    if (typeof row.ticker === "string" && typeof row.price === "number" && Number.isFinite(row.price) && row.price > 0 && age >= 0 && age <= 6 * 3600000) prices.set(row.ticker, row);
  }
  return [...prices.values()];
}
