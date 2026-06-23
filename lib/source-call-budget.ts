import { prisma } from "@/lib/db/client";

export type SourceCallBudget = {
  source: string;
  roles: readonly string[];
  callsUsedToday: number;
  dailyLimit: number | null;
  perRunLimit: number | null;
  cooldownUntil: string | null;
  cacheHitRate: number | null;
  lastRun: string | null;
  nextAllowedRun: string | null;
  recommendation: string;
};

const DAY_CACHED = "Cache by day; do not pull again in the same UTC day unless forced.";

export const SOURCE_CALL_BUDGETS = [
  { source: "FMP Catalyst", roles: ["fundamentals", "earnings calendar", "transcripts if available", "press releases", "analyst targets", "price/volume if available", "shortlist proof enrichment only"], dailyLimit: 12, perRunLimit: 3, cooldownMinutes: 30 },
  { source: "Marketaux Catalyst", roles: ["discovery", "fresh news", "entity/ticker sentiment", "strict entity match required"], dailyLimit: 120, perRunLimit: 30, cooldownMinutes: 15 },
  { source: "Alpha Vantage Catalyst", roles: ["backup news sentiment", "backup quote/fundamental sample", "shortlist only"], dailyLimit: 5, perRunLimit: 3, cooldownMinutes: 60 },
  { source: "SEC EDGAR", roles: ["official proof", "8-K", "Form 4", "10-Q/10-K", "13F where available", "shortlist only"], dailyLimit: 20, perRunLimit: 5, cooldownMinutes: 10 },
  { source: "Google News RSS", roles: ["secondary news proof", "targeted ticker/company/topic searches only"], dailyLimit: 25, perRunLimit: 5, cooldownMinutes: 15 },
  { source: "GDELT", roles: ["broad macro/news context", "low frequency tiny batches"], dailyLimit: 8, perRunLimit: 1, cooldownMinutes: 120 },
  { source: "openFDA", roles: ["healthcare/regulatory proof only", "healthcare tickers only"], dailyLimit: 10, perRunLimit: 2, cooldownMinutes: 60 },
  { source: "FRED Macro", roles: ["macro context only", DAY_CACHED], dailyLimit: 1, perRunLimit: 1, cooldownMinutes: 24 * 60 },
  { source: "CoinGecko", roles: ["crypto context only", DAY_CACHED], dailyLimit: 1, perRunLimit: 1, cooldownMinutes: 24 * 60 },
  { source: "Frankfurter FX", roles: ["FX context only", DAY_CACHED], dailyLimit: 1, perRunLimit: 1, cooldownMinutes: 24 * 60 },
  { source: "FINRA Short Sale", roles: ["short-sale context only", "selected ticker only"], dailyLimit: 5, perRunLimit: 1, cooldownMinutes: 60 },
  { source: "Wikidata", roles: ["supplier/customer/ripple map", "second-order context only"], dailyLimit: 5, perRunLimit: 1, cooldownMinutes: 24 * 60 },
] as const;

function startOfUtcDay() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export async function sourceCallBudgetStatus(): Promise<SourceCallBudget[]> {
  const since = startOfUtcDay();
  if (!process.env.DATABASE_URL) {
    return SOURCE_CALL_BUDGETS.map((budget) => ({ ...budget, callsUsedToday: 0, cooldownUntil: null, cacheHitRate: null, lastRun: null, nextAllowedRun: null, recommendation: "DATABASE_URL is not configured; showing configured limits only." }));
  }
  const [grouped, latest] = await Promise.all([
    prisma.sourceRun.groupBy({ by: ["source"], where: { startedAt: { gte: since } }, _count: { _all: true } }),
    Promise.all(SOURCE_CALL_BUDGETS.map((budget) => prisma.sourceRun.findFirst({ where: { source: budget.source }, orderBy: { startedAt: "desc" }, select: { startedAt: true, status: true } }))),
  ]);
  const counts = new Map(grouped.map((row) => [row.source, row._count._all]));
  return SOURCE_CALL_BUDGETS.map((budget, index) => {
    const last = latest[index];
    const lastRun = last?.startedAt ?? null;
    const nextAllowedDate = lastRun ? new Date(lastRun.getTime() + budget.cooldownMinutes * 60_000) : null;
    const coolingDown = Boolean(nextAllowedDate && nextAllowedDate.getTime() > Date.now());
    const callsUsedToday = counts.get(budget.source) ?? 0;
    const exhausted = callsUsedToday >= budget.dailyLimit;
    return {
      ...budget,
      callsUsedToday,
      cooldownUntil: coolingDown && nextAllowedDate ? nextAllowedDate.toISOString() : null,
      cacheHitRate: budget.cooldownMinutes >= 24 * 60 && lastRun && lastRun >= since ? 1 : null,
      lastRun: lastRun?.toISOString() ?? null,
      nextAllowedRun: coolingDown && nextAllowedDate ? nextAllowedDate.toISOString() : new Date().toISOString(),
      recommendation: exhausted ? "Do not run today; daily budget exhausted." : coolingDown ? "Wait for cooldown/cache window before another pull." : budget.source === "Alpha Vantage Catalyst" ? "Use only after the shortlist and stop on rate-limit errors." : budget.source === "FMP Catalyst" ? "Use only for shortlisted symbols or tiny press/news discovery." : "Allowed within role and per-run limit.",
    };
  });
}
