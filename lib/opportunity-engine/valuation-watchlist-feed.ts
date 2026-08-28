import { readVersionedTextFromR2 } from "@/lib/r2-warehouse";
import { pr262StorageKey } from "@/lib/opportunity-engine/pr262-storage";
import type { UsValueCompanyAnalysis } from "@/lib/opportunity-engine/us-value-investing-engine";

const LATEST_FOUNDATION_SUMMARY_KEY = pr262StorageKey("value-investing/resumable/latest/index.json");

type FoundationSummary = {
  kind?: unknown;
  cycleId?: unknown;
  status?: unknown;
  completedAt?: unknown;
  sourceCheckedAt?: unknown;
  coverage?: unknown;
  seriousAlerts?: unknown;
  qualityPriceWatchlist?: unknown;
};

type WatchlistAction = "buy_research" | "sell_research" | "watch_out_research" | "price_watch";

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function finite(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function safeTicker(value: unknown) {
  const ticker = text(value)?.toUpperCase() ?? "";
  return /^[A-Z0-9.\-]{1,12}$/.test(ticker) ? ticker : null;
}

function safeTradingViewUrl(symbol: unknown) {
  const value = text(symbol)?.toUpperCase() ?? "";
  if (!/^[A-Z0-9._\-]+:[A-Z0-9._\-]+$/.test(value)) return null;
  return `https://www.tradingview.com/symbols/${value.replace(":", "-")}/`;
}

function sanitizeReasons(value: unknown, maximum = 4) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      .map((item) => item.replace(/\s+/g, " ").trim().slice(0, 280))
      .slice(0, maximum)
    : [];
}

function rank(item: UsValueCompanyAnalysis, action: WatchlistAction) {
  if (action === "buy_research") return item.fairValue.upsideToBasePercent ?? -Infinity;
  if (action === "sell_research") return -(item.fairValue.upsideToBasePercent ?? Infinity);
  if (action === "watch_out_research") return item.scores.risk;
  return item.scores.businessQuality;
}

function sanitizeCandidate(item: UsValueCompanyAnalysis, action: WatchlistAction, cycleId: string) {
  const ticker = safeTicker(item.ticker);
  if (!ticker) return null;
  const reasons = sanitizeReasons(item.decision?.reasons);
  const blockers = sanitizeReasons(item.decision?.blockers);
  const specialistModelApplied = reasons.some((reason) => /specialist model/i.test(reason));
  const secUrl = `https://www.sec.gov/edgar/search/#/q=${encodeURIComponent(ticker)}`;
  const tradingViewUrl = safeTradingViewUrl(item.tradingViewSymbol);
  return {
    id: `${cycleId}:${action}:${ticker}`,
    anchor: `valuation-watchlist-${action}-${ticker.toLowerCase().replace(/[^a-z0-9-]/g, "-")}`,
    observedAt: item.observedAt,
    ticker,
    company: String(item.company ?? ticker).replace(/\s+/g, " ").trim().slice(0, 160),
    sector: text(item.sector),
    industry: text(item.industry),
    action,
    currentPrice: finite(item.currentPrice),
    fairValue: {
      conservative: finite(item.fairValue?.conservativeValue),
      base: finite(item.fairValue?.baseValue),
      optimistic: finite(item.fairValue?.optimisticValue),
      buyBelow: finite(item.fairValue?.buyBelowPrice),
      trimAbove: finite(item.fairValue?.trimAbovePrice),
      upsideToBasePercent: finite(item.fairValue?.upsideToBasePercent),
    },
    scores: {
      quality: finite(item.scores?.businessQuality),
      risk: finite(item.scores?.risk),
      evidence: finite(item.scores?.evidenceCompleteness),
      fairValueConfidence: finite(item.scores?.fairValueConfidence),
    },
    reasons,
    blockers,
    specialistModelApplied,
    publicationStatus: "provisional_research_only" as const,
    userAlertEligible: false as const,
    committeeApproved: false as const,
    links: [
      ...(tradingViewUrl ? [{ label: "Market and valuation", url: tradingViewUrl }] : []),
      { label: "SEC filings", url: secUrl },
    ],
  };
}

function arrayOfAnalyses(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is UsValueCompanyAnalysis => Boolean(item && typeof item === "object" && !Array.isArray(item)))
    : [];
}

export async function getValuationWatchlistStatus(options: { limit?: number } = {}) {
  const requestedLimit = Number(options.limit ?? 60);
  const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(200, Math.floor(requestedLimit))) : 60;
  const current = await readVersionedTextFromR2(LATEST_FOUNDATION_SUMMARY_KEY);
  if (!current.found || !current.text) {
    return {
      ok: true as const,
      generatedAt: new Date().toISOString(),
      foundation: { available: false, complete: false, cycleId: null, completedAt: null, sourceCheckedAt: null, coverage: null },
      summary: { total: 0, buyResearch: 0, sellResearch: 0, watchOutResearch: 0, priceWatch: 0, specialistModelApplied: 0 },
      candidates: [],
      truncated: false,
      sanitized: true as const,
      provisionalResearchOnly: true as const,
      userAlertEligible: false as const,
    };
  }

  const parsed = JSON.parse(current.text) as FoundationSummary;
  if (parsed.kind !== "us_value_investing_resumable_summary") throw new Error("valuation_watchlist_summary_invalid");
  const cycleId = text(parsed.cycleId) ?? "unknown-cycle";
  const serious = object(parsed.seriousAlerts);
  const groups: Array<[WatchlistAction, UsValueCompanyAnalysis[]]> = [
    ["buy_research", arrayOfAnalyses(serious.buy)],
    ["sell_research", arrayOfAnalyses(serious.sell)],
    ["watch_out_research", arrayOfAnalyses(serious.watchOut)],
    ["price_watch", arrayOfAnalyses(parsed.qualityPriceWatchlist)],
  ];
  const all = groups.flatMap(([action, items]) => items.map((item) => ({ action, item, rank: rank(item, action) })))
    .sort((left, right) => right.rank - left.rank)
    .flatMap(({ action, item }) => sanitizeCandidate(item, action, cycleId) ?? []);
  const candidates = all.slice(0, limit);
  const coverage = object(parsed.coverage);
  return {
    ok: true as const,
    generatedAt: new Date().toISOString(),
    foundation: {
      available: true,
      complete: parsed.status === "complete",
      cycleId,
      completedAt: text(parsed.completedAt),
      sourceCheckedAt: text(parsed.sourceCheckedAt),
      coverage: {
        companies: finite(coverage.companiesStored),
        totalCompanies: finite(coverage.totalCompanies),
        percent: finite(coverage.coveragePercent),
      },
    },
    summary: {
      total: all.length,
      buyResearch: groups[0][1].length,
      sellResearch: groups[1][1].length,
      watchOutResearch: groups[2][1].length,
      priceWatch: groups[3][1].length,
      specialistModelApplied: all.filter((item) => item.specialistModelApplied).length,
    },
    candidates,
    truncated: all.length > candidates.length,
    sanitized: true as const,
    provisionalResearchOnly: true as const,
    userAlertEligible: false as const,
  };
}

export const VALUATION_WATCHLIST_POLICY = Object.freeze({
  sourceKey: LATEST_FOUNDATION_SUMMARY_KEY,
  authenticated: true,
  sanitized: true,
  provisionalResearchOnly: true,
  committeeApproved: false,
  seriousSignalDeliveryAllowed: false,
});
