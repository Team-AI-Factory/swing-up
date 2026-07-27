import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Json = Record<string, unknown>;
const object = (value: unknown): Json => value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
const rows = (value: unknown): unknown[] => Array.isArray(value) ? value : [];

function branchAllowed() {
  if (process.env.SWING_UP_COMBINED_ENGINE_ALLOW_LOCAL === "true") return true;
  const branch = process.env.RAILWAY_GIT_BRANCH?.trim();
  const environment = process.env.RAILWAY_ENVIRONMENT_NAME?.trim().toLowerCase();
  return Boolean(process.env.RAILWAY_PROJECT_ID && branch === "agent/combined-opportunity-engine" && environment && environment !== "production");
}

function suppliedToken(request: NextRequest) {
  return request.headers.get("x-swing-up-automation-token")?.trim()
    || request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
}

function safeMessage(value: unknown) {
  return JSON.stringify(value ?? "").replace(/[A-Za-z0-9_-]{24,}/g, "[redacted]").slice(0, 500);
}

async function fmpProbe(path: string, apiKey: string) {
  const separator = path.includes("?") ? "&" : "?";
  const url = `https://financialmodelingprep.com/stable/${path}${separator}apikey=${encodeURIComponent(apiKey)}`;
  const started = Date.now();
  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: { accept: "application/json", apikey: apiKey, "user-agent": "SwingUpDirectoryAudit/2.0" },
      signal: AbortSignal.timeout(90_000),
    });
    const payload = await response.json().catch(async () => await response.text().catch(() => null));
    const list = rows(payload);
    const first = object(list[0]);
    return {
      provider: "FMP",
      endpoint: path.split("?")[0],
      status: response.status,
      ok: response.ok,
      rowCount: list.length,
      totalCount: list.length,
      firstRowKeys: Object.keys(first).slice(0, 50),
      sampleSymbols: list.slice(0, 5).map((item) => object(item).symbol).filter(Boolean),
      safeBodyWhenUnavailable: response.ok ? null : safeMessage(payload),
      responseTimeMs: Date.now() - started,
    };
  } catch (error) {
    return { provider: "FMP", endpoint: path.split("?")[0], status: null, ok: false, rowCount: 0, totalCount: 0, firstRowKeys: [], sampleSymbols: [], safeBodyWhenUnavailable: error instanceof Error ? error.message.slice(0, 300) : "probe_failed", responseTimeMs: Date.now() - started };
  }
}

async function yahooScreenerProbe(region: string) {
  const started = Date.now();
  const url = new URL("https://query2.finance.yahoo.com/v1/finance/screener");
  url.searchParams.set("corsDomain", "finance.yahoo.com");
  url.searchParams.set("formatted", "false");
  url.searchParams.set("lang", region === "US" ? "en-US" : "en-GB");
  url.searchParams.set("region", region);
  const body = {
    offset: 0,
    size: 250,
    sortField: "intradaymarketcap",
    sortType: "DESC",
    quoteType: "EQUITY",
    query: { operator: "AND", operands: [{ operator: "EQ", operands: ["region", region.toLowerCase()] }] },
    userId: "",
    userIdType: "guid",
  };
  try {
    const response = await fetch(url, {
      method: "POST",
      cache: "no-store",
      headers: { accept: "application/json", "content-type": "application/json", origin: "https://finance.yahoo.com", referer: "https://finance.yahoo.com/", "user-agent": "Mozilla/5.0 (compatible; SwingUpDirectoryAudit/2.0)" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(90_000),
    });
    const payload = await response.json().catch(async () => await response.text().catch(() => null));
    const finance = object(payload).finance;
    const result = object(rows(object(finance).result)[0]);
    const quotes = rows(result.quotes);
    return {
      provider: "Yahoo Finance",
      endpoint: `equity-screener-${region}`,
      status: response.status,
      ok: response.ok && quotes.length > 0,
      rowCount: quotes.length,
      totalCount: Number(result.total ?? result.count ?? quotes.length),
      firstRowKeys: Object.keys(object(quotes[0])).slice(0, 60),
      sampleSymbols: quotes.slice(0, 5).map((item) => object(item).symbol).filter(Boolean),
      safeBodyWhenUnavailable: response.ok && quotes.length ? null : safeMessage(payload),
      responseTimeMs: Date.now() - started,
    };
  } catch (error) {
    return { provider: "Yahoo Finance", endpoint: `equity-screener-${region}`, status: null, ok: false, rowCount: 0, totalCount: 0, firstRowKeys: [], sampleSymbols: [], safeBodyWhenUnavailable: error instanceof Error ? error.message.slice(0, 300) : "probe_failed", responseTimeMs: Date.now() - started };
  }
}

async function tradingViewProbe(market: string) {
  const started = Date.now();
  const url = `https://scanner.tradingview.com/${market}/scan`;
  const body = {
    filter: [{ left: "type", operation: "equal", right: "stock" }],
    options: { lang: "en" },
    markets: [market],
    symbols: { query: { types: [] }, tickers: [] },
    columns: ["name", "description", "exchange", "country", "currency", "close", "change", "volume", "market_cap_basic", "price_52_week_high", "price_52_week_low"],
    sort: { sortBy: "market_cap_basic", sortOrder: "desc" },
    range: [0, 249],
  };
  try {
    const response = await fetch(url, {
      method: "POST",
      cache: "no-store",
      headers: { accept: "application/json", "content-type": "application/json", origin: "https://www.tradingview.com", referer: "https://www.tradingview.com/", "user-agent": "Mozilla/5.0 (compatible; SwingUpDirectoryAudit/2.0)" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(90_000),
    });
    const payload = await response.json().catch(async () => await response.text().catch(() => null));
    const data = rows(object(payload).data);
    const first = object(data[0]);
    return {
      provider: "TradingView public scanner",
      endpoint: `scanner-${market}`,
      status: response.status,
      ok: response.ok && data.length > 0,
      rowCount: data.length,
      totalCount: Number(object(payload).totalCount ?? data.length),
      firstRowKeys: Object.keys(first).slice(0, 20),
      sampleSymbols: data.slice(0, 5).map((item) => object(item).s).filter(Boolean),
      safeBodyWhenUnavailable: response.ok && data.length ? null : safeMessage(payload),
      responseTimeMs: Date.now() - started,
    };
  } catch (error) {
    return { provider: "TradingView public scanner", endpoint: `scanner-${market}`, status: null, ok: false, rowCount: 0, totalCount: 0, firstRowKeys: [], sampleSymbols: [], safeBodyWhenUnavailable: error instanceof Error ? error.message.slice(0, 300) : "probe_failed", responseTimeMs: Date.now() - started };
  }
}

export async function GET(request: NextRequest) {
  if (!branchAllowed()) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  const expected = process.env.SWING_UP_AUTOMATION_TOKEN?.trim();
  if (expected && suppliedToken(request) !== expected) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const apiKey = process.env.FMP_API_KEY?.trim();
  if (!apiKey) return NextResponse.json({ ok: false, error: "fmp_not_configured" }, { status: 503 });

  const results = [];
  for (const endpoint of [
    "company-screener?isEtf=false&isActivelyTrading=true&limit=100000",
    "batch-exchange-quote?exchange=NASDAQ",
    "batch-exchange-quote?exchange=LSE",
    "available-exchanges",
    "all-exchange-market-hours",
    "quote?symbol=AAPL",
  ]) results.push(await fmpProbe(endpoint, apiKey));
  for (const region of ["US", "GB", "DE", "JP", "HK", "IN", "AU", "CA"]) results.push(await yahooScreenerProbe(region));
  for (const market of ["america", "uk", "germany", "japan", "hongkong", "india", "australia", "canada"]) results.push(await tradingViewProbe(market));

  const usable = results.filter((result) => result.ok && result.rowCount > 0);
  return NextResponse.json({
    ok: true,
    checkedAt: new Date().toISOString(),
    usableEndpoints: usable.map((result) => `${result.provider}:${result.endpoint}`),
    results,
    safety: { databaseWrites: false, publishing: false, notifications: false, secretsRedacted: true },
  });
}
