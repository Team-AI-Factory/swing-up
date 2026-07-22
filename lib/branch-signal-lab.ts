import { runEquitySignalLab, type EquityProviderCallDecision, type EquityProviderCallRequest, type EquitySignalLabInput } from "@/lib/equity-signal/runner";

export type BranchProviderCallRequest = EquityProviderCallRequest;
export type BranchProviderCallDecision = EquityProviderCallDecision;
export type BranchSignalLabInput = EquitySignalLabInput;

class ProviderBudgetError extends Error {
  constructor(public readonly provider: string, message: string) {
    super(message);
    this.name = "ProviderBudgetError";
  }
}

function requestUrl(value: RequestInfo | URL) {
  try {
    return value instanceof URL ? value : new URL(typeof value === "string" ? value : value.url);
  } catch {
    return null;
  }
}

function providerCallRequest(value: RequestInfo | URL, now: Date): BranchProviderCallRequest | null {
  const url = requestUrl(value);
  if (!url) return null;
  const day = 24 * 60 * 60 * 1000;
  const minute = 60 * 1000;
  const base = { checkedAt: now.toISOString() };
  const host = url.hostname.toLowerCase();
  const path = url.pathname.toLowerCase();

  if (host === "www.nasdaqtrader.com") {
    return { ...base, provider: "nasdaq_trader", quotaKey: "nasdaq_trader_equity_universe", cadenceKey: `nasdaq_trader:${path}`, rollingWindowMs: day, maximumCallsInWindow: 4, minimumIntervalMs: 4.5 * minute };
  }
  if (host === "www.sec.gov" && path === "/files/company_tickers_exchange.json") {
    return { ...base, provider: "sec_edgar", quotaKey: "sec_equity_universe", cadenceKey: "sec_equity_universe", rollingWindowMs: day, maximumCallsInWindow: 2, minimumIntervalMs: 4.5 * minute };
  }
  if (host === "www.sec.gov" && path === "/cgi-bin/browse-edgar") {
    const form = (url.searchParams.get("type") ?? "unknown").toUpperCase();
    const minimumIntervalMs = ["8-K", "6-K"].includes(form) ? 4.5 * minute : form === "4" ? 14 * minute : 59 * minute;
    return { ...base, provider: "sec_edgar", quotaKey: "sec_current_filings", cadenceKey: `sec_current_filings:${form}`, rollingWindowMs: day, maximumCallsInWindow: 900, minimumIntervalMs };
  }
  if (host === "www.sec.gov" && path.startsWith("/archives/edgar/data/")) {
    return { ...base, provider: "sec_edgar", quotaKey: "sec_filing_details", cadenceKey: `sec_filing_detail:${path}`, rollingWindowMs: day, maximumCallsInWindow: 96, minimumIntervalMs: 59 * minute };
  }
  if (host === "www.sec.gov" || host === "data.sec.gov") {
    return { ...base, provider: "sec_edgar", quotaKey: "sec_official_feeds", cadenceKey: `sec:${path}`, rollingWindowMs: day, maximumCallsInWindow: 400, minimumIntervalMs: 4.5 * minute };
  }
  if (host === "news.google.com") {
    return { ...base, provider: "google_news", quotaKey: "google_news_public_rss", cadenceKey: "google_news_event_discovery", rollingWindowMs: day, maximumCallsInWindow: 300, minimumIntervalMs: 4.5 * minute };
  }
  if (host === "api.gdeltproject.org") {
    return { ...base, provider: "gdelt", quotaKey: "gdelt_doc", cadenceKey: "gdelt_event_discovery", rollingWindowMs: day, maximumCallsInWindow: 96, minimumIntervalMs: 14 * minute };
  }
  if (host === "api.marketaux.com") {
    return { ...base, provider: "marketaux", quotaKey: "marketaux_free_100_daily", cadenceKey: "marketaux_equity_news", rollingWindowMs: day, maximumCallsInWindow: 96, minimumIntervalMs: 14.5 * minute };
  }
  if (host === "api.commerce.gov") {
    return { ...base, provider: "commerce", quotaKey: "commerce_demo_key_50_daily", cadenceKey: "commerce_official_news", rollingWindowMs: day, maximumCallsInWindow: 48, minimumIntervalMs: 29 * minute };
  }
  if (host === "www.alphavantage.co") {
    const fn = (url.searchParams.get("function") ?? "unknown").toUpperCase();
    const symbol = (url.searchParams.get("symbol") ?? "all").toUpperCase();
    const minimumIntervalMs = fn === "EARNINGS_CALENDAR" ? 23 * 60 * minute : fn === "NEWS_SENTIMENT" ? 119 * minute : 59 * minute;
    return { ...base, provider: "alpha_vantage", quotaKey: "alpha_vantage_free_25_daily", cadenceKey: `alpha_vantage:${fn}:${fn === "GLOBAL_QUOTE" ? symbol : "all"}`, rollingWindowMs: day, maximumCallsInWindow: 25, minimumIntervalMs };
  }
  if (host === "financialmodelingprep.com") {
    const symbol = (url.searchParams.get("symbol") ?? "all").toUpperCase();
    return { ...base, provider: "fmp", quotaKey: "fmp_free_250_daily", cadenceKey: `fmp:${path}:${symbol}`, rollingWindowMs: day, maximumCallsInWindow: 240, minimumIntervalMs: 29 * minute };
  }
  if (host === "fred.stlouisfed.org" || host === "api.stlouisfed.org") {
    const series = (url.searchParams.get("series_id") ?? url.searchParams.get("id") ?? "unknown").toUpperCase();
    return { ...base, provider: "fred", quotaKey: "fred_macro_regime", cadenceKey: `fred:${series}`, rollingWindowMs: day, maximumCallsInWindow: 300, minimumIntervalMs: 59 * minute };
  }
  if (host === "api.frankfurter.app") {
    return { ...base, provider: "frankfurter", quotaKey: "frankfurter_daily_reference", cadenceKey: "frankfurter_daily_reference", rollingWindowMs: day, maximumCallsInWindow: 2, minimumIntervalMs: 23 * 60 * minute };
  }
  if (host === "www.federalregister.gov") {
    return { ...base, provider: "federal_register", quotaKey: "federal_register_public", cadenceKey: "federal_register_recent", rollingWindowMs: day, maximumCallsInWindow: 48, minimumIntervalMs: 29 * minute };
  }
  if (host === "api.fda.gov") {
    return { ...base, provider: "openfda", quotaKey: "openfda_public", cadenceKey: `openfda:${path}`, rollingWindowMs: day, maximumCallsInWindow: 4, minimumIntervalMs: 6 * 60 * minute };
  }
  if (host === "query1.finance.yahoo.com") {
    const ticker = decodeURIComponent(path.split("/").filter(Boolean).at(-1) ?? "unknown").toUpperCase();
    return { ...base, provider: "yahoo_finance", quotaKey: "yahoo_public_chart_shortlist", cadenceKey: `yahoo_chart:${ticker}`, rollingWindowMs: day, maximumCallsInWindow: 1_000, minimumIntervalMs: 4.5 * minute };
  }
  if (["www.federalreserve.gov", "www.bls.gov", "apps.bea.gov", "home.treasury.gov", "www.whitehouse.gov", "www.commerce.gov", "ofac.treasury.gov", "www.bis.gov", "www.cisa.gov", "www.state.gov", "www.defense.gov"].includes(host)) {
    return { ...base, provider: "official_government_feed", quotaKey: "official_public_event_feeds", cadenceKey: `official_feed:${host}${path}`, rollingWindowMs: day, maximumCallsInWindow: 4_000, minimumIntervalMs: 4.5 * minute };
  }
  return null;
}

export async function runBranchSignalLab(input: BranchSignalLabInput = {}) {
  const now = input.now ?? new Date();
  const rawFetch = input.fetchImpl ?? fetch;
  const quotaAwareFetch: typeof fetch = async (request, init) => {
    const quotaRequest = providerCallRequest(request, now);
    if (quotaRequest && input.beforeProviderCall) {
      const decision = await input.beforeProviderCall(quotaRequest);
      if (!decision.allowed) throw new ProviderBudgetError(quotaRequest.provider, `${quotaRequest.provider}_${decision.reason}`);
    }
    return rawFetch(request, init);
  };
  return runEquitySignalLab({ ...input, now, fetchImpl: quotaAwareFetch });
}
