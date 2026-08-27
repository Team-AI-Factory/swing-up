import { runGlobalDeepResearch, type GlobalDeepResearchCase, type GlobalDeepResearchResult } from "./global-deep-research";
import { mapGlobalListingToYahoo, type GlobalYahooMapping } from "./global-listing-identity";

type YahooPrice = { price: number; observedAt: string; sourceUrl: string };

const unique = <T>(values: T[]) => [...new Set(values)];
const clamp = (value: number) => Math.max(0, Math.min(100, Math.round(value)));
const safeError = (error: unknown) => error instanceof Error ? error.message.replace(/\s+/g, " ").slice(0, 260) : "yahoo_fallback_failed";

async function fetchYahooPrice(mapping: GlobalYahooMapping): Promise<YahooPrice> {
  const failures: string[] = [];
  for (const host of ["query1.finance.yahoo.com", "query2.finance.yahoo.com"]) {
    const url = `https://${host}/v8/finance/chart/${encodeURIComponent(mapping.symbol)}?range=10d&interval=1d&events=history&includeAdjustedClose=true`;
    try {
      const response = await fetch(url, {
        cache: "no-store",
        headers: { accept: "application/json", "user-agent": "Mozilla/5.0 (compatible; SwingUpDeepResearch/2.0)", referer: "https://finance.yahoo.com/" },
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) throw new Error(`yahoo_http_${response.status}`);
      const payload = await response.json() as Record<string, unknown>;
      const chart = payload.chart as Record<string, unknown> | undefined;
      const result = Array.isArray(chart?.result) ? chart.result[0] as Record<string, unknown> : null;
      const timestamps = Array.isArray(result?.timestamp) ? result.timestamp : [];
      const indicators = result?.indicators as Record<string, unknown> | undefined;
      const adjustedContainer = Array.isArray(indicators?.adjclose) ? indicators.adjclose[0] as Record<string, unknown> : null;
      const quoteContainer = Array.isArray(indicators?.quote) ? indicators.quote[0] as Record<string, unknown> : null;
      const adjusted = Array.isArray(adjustedContainer?.adjclose) ? adjustedContainer.adjclose : [];
      const closes = Array.isArray(quoteContainer?.close) ? quoteContainer.close : [];
      for (let index = timestamps.length - 1; index >= 0; index -= 1) {
        const seconds = Number(timestamps[index]);
        const value = Number(adjusted[index] ?? closes[index]);
        if (Number.isFinite(seconds) && Number.isFinite(value) && value > 0) {
          return { price: value, observedAt: new Date(seconds * 1000).toISOString(), sourceUrl: url };
        }
      }
      throw new Error(`yahoo_price_unavailable:${mapping.symbol}`);
    } catch (error) {
      failures.push(`${host}:${safeError(error)}`);
    }
  }
  throw new Error(`all_yahoo_price_sources_failed:${mapping.symbol}:${failures.join("|")}`);
}

function agreementPercent(left: number, right: number) {
  const midpoint = (left + right) / 2;
  return midpoint > 0 ? (Math.abs(left - right) / midpoint) * 100 : null;
}

async function enrichCase(item: GlobalDeepResearchCase): Promise<GlobalDeepResearchCase> {
  if (item.secondSourcePrice !== null) return item;
  const mapping = mapGlobalListingToYahoo(item);
  if (!mapping) {
    return {
      ...item,
      providersAttempted: unique([...item.providersAttempted, "Yahoo Finance"]),
      providerErrors: unique([...item.providerErrors, `Yahoo mapping unavailable for ${item.exchange}:${item.symbol}`]),
      blockedReasons: unique([...item.blockedReasons, "A supported independent price mapping was unavailable for this listing."]),
    };
  }
  try {
    const yahoo = await fetchYahooPrice(mapping);
    const agreement = agreementPercent(item.currentPrice, yahoo.price);
    const conflict = agreement !== null && agreement > 5;
    const evidenceScore = clamp(item.evidenceScore + (conflict ? -20 : agreement !== null && agreement <= 2 ? 20 : 10));
    const blockedReasons = unique([
      ...item.blockedReasons.filter((reason) => reason !== "A second current price source was unavailable."),
      ...(conflict ? [`TradingView and Yahoo prices disagree by ${agreement?.toFixed(2)}%.`] : []),
    ]);
    const researchDisposition = conflict
      ? "reject_or_deprioritize"
      : evidenceScore >= 80 && item.researchDisposition !== "reject_or_deprioritize"
        ? "advance_to_committee_research"
        : evidenceScore >= 55
          ? "watch_for_more_evidence"
          : "reject_or_deprioritize";
    return {
      ...item,
      secondSourcePrice: yahoo.price,
      priceAgreementPercent: agreement,
      providersAttempted: unique([...item.providersAttempted, "Yahoo Finance"]),
      providersUsed: unique([...item.providersUsed, "Yahoo Finance"]),
      evidenceScore,
      researchDisposition,
      blockedReasons,
      receipts: [...item.receipts, { source: `Yahoo Finance adjusted price (${mapping.reason})`, url: yahoo.sourceUrl, observedAt: yahoo.observedAt, fields: ["adjusted close", "independent price confirmation"] }],
    };
  } catch (error) {
    return {
      ...item,
      providersAttempted: unique([...item.providersAttempted, "Yahoo Finance"]),
      providerErrors: unique([...item.providerErrors, `Yahoo Finance: ${safeError(error)}`]),
      blockedReasons: unique([...item.blockedReasons, "Independent adjusted-price confirmation failed."]),
    };
  }
}

export async function runGlobalDeepResearchV2(options?: { perAction?: number }): Promise<GlobalDeepResearchResult> {
  const base = await runGlobalDeepResearch(options);
  const buy: GlobalDeepResearchCase[] = [];
  const sell: GlobalDeepResearchCase[] = [];
  const watchOut: GlobalDeepResearchCase[] = [];
  for (const item of base.results.buy) buy.push(await enrichCase(item));
  for (const item of base.results.sell) sell.push(await enrichCase(item));
  for (const item of base.results.watchOut) watchOut.push(await enrichCase(item));
  const all = [...buy, ...sell, ...watchOut];
  return {
    ...base,
    checkedAt: new Date().toISOString(),
    results: { buy, sell, watchOut },
    summary: {
      researched: all.length,
      advanced: all.filter((row) => row.researchDisposition === "advance_to_committee_research").length,
      watched: all.filter((row) => row.researchDisposition === "watch_for_more_evidence").length,
      rejected: all.filter((row) => row.researchDisposition === "reject_or_deprioritize").length,
      seriousSignals: 0,
      providerErrors: all.reduce((sum, row) => sum + row.providerErrors.length, 0),
    },
  };
}
