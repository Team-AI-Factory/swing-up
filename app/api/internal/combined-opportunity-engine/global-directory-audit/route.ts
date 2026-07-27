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
  return JSON.stringify(value ?? "").replace(/[A-Za-z0-9_-]{24,}/g, "[redacted]").slice(0, 800);
}

async function fmpProbe(path: string, apiKey: string) {
  const separator = path.includes("?") ? "&" : "?";
  const url = `https://financialmodelingprep.com/stable/${path}${separator}apikey=${encodeURIComponent(apiKey)}`;
  const started = Date.now();
  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: { accept: "application/json", apikey: apiKey, "user-agent": "SwingUpDirectoryAudit/3.0" },
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
      sampleData: list.slice(0, 2),
      safeBodyWhenUnavailable: response.ok ? null : safeMessage(payload),
      responseTimeMs: Date.now() - started,
    };
  } catch (error) {
    return { provider: "FMP", endpoint: path.split("?")[0], status: null, ok: false, rowCount: 0, totalCount: 0, firstRowKeys: [], sampleSymbols: [], sampleData: [], safeBodyWhenUnavailable: error instanceof Error ? error.message.slice(0, 300) : "probe_failed", responseTimeMs: Date.now() - started };
  }
}

async function tradingViewProbe(market: string, primaryOnly: boolean, rangeEnd: number) {
  const started = Date.now();
  const url = `https://scanner.tradingview.com/${market}/scan`;
  const filters: Array<{ left: string; operation: string; right: unknown }> = [
    { left: "type", operation: "equal", right: "stock" },
  ];
  if (primaryOnly) filters.push({ left: "is_primary", operation: "equal", right: true });
  const columns = [
    "name", "description", "exchange", "country", "currency", "type", "typespecs", "is_primary",
    "close", "change", "volume", "relative_volume_10d_calc", "market_cap_basic",
    "price_52_week_high", "price_52_week_low", "update_mode", "pricescale", "minmov",
  ];
  const body = {
    filter: filters,
    options: { lang: "en" },
    markets: market === "global" ? [] : [market],
    symbols: { query: { types: [] }, tickers: [] },
    columns,
    sort: { sortBy: "market_cap_basic", sortOrder: "desc" },
    range: [0, rangeEnd],
  };
  try {
    const response = await fetch(url, {
      method: "POST",
      cache: "no-store",
      headers: { accept: "application/json", "content-type": "application/json", origin: "https://www.tradingview.com", referer: "https://www.tradingview.com/", "user-agent": "Mozilla/5.0 (compatible; SwingUpDirectoryAudit/3.0)" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });
    const payload = await response.json().catch(async () => await response.text().catch(() => null));
    const data = rows(object(payload).data);
    const first = object(data[0]);
    return {
      provider: "TradingView public scanner",
      endpoint: `scanner-${market}${primaryOnly ? "-primary" : ""}-range-${rangeEnd + 1}`,
      status: response.status,
      ok: response.ok && data.length > 0,
      rowCount: data.length,
      totalCount: Number(object(payload).totalCount ?? data.length),
      firstRowKeys: Object.keys(first).slice(0, 20),
      columns,
      sampleSymbols: data.slice(0, 5).map((item) => object(item).s).filter(Boolean),
      sampleData: data.slice(0, 3),
      safeBodyWhenUnavailable: response.ok && data.length ? null : safeMessage(payload),
      responseTimeMs: Date.now() - started,
    };
  } catch (error) {
    return { provider: "TradingView public scanner", endpoint: `scanner-${market}${primaryOnly ? "-primary" : ""}-range-${rangeEnd + 1}`, status: null, ok: false, rowCount: 0, totalCount: 0, firstRowKeys: [], columns, sampleSymbols: [], sampleData: [], safeBodyWhenUnavailable: error instanceof Error ? error.message.slice(0, 500) : "probe_failed", responseTimeMs: Date.now() - started };
  }
}

export async function GET(request: NextRequest) {
  if (!branchAllowed()) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  const expected = process.env.SWING_UP_AUTOMATION_TOKEN?.trim();
  if (expected && suppliedToken(request) !== expected) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const apiKey = process.env.FMP_API_KEY?.trim();
  if (!apiKey) return NextResponse.json({ ok: false, error: "fmp_not_configured" }, { status: 503 });

  const results = [];
  for (const endpoint of ["all-exchange-market-hours", "quote?symbol=AAPL"]) results.push(await fmpProbe(endpoint, apiKey));
  for (const probe of [
    ["global", false, 249],
    ["global", true, 249],
    ["global", true, 999],
    ["america", true, 999],
    ["uk", true, 999],
    ["germany", true, 999],
    ["japan", true, 999],
    ["hongkong", true, 999],
    ["india", true, 999],
    ["australia", true, 999],
    ["canada", true, 999],
  ] as const) results.push(await tradingViewProbe(probe[0], probe[1], probe[2]));

  const usable = results.filter((result) => result.ok && result.rowCount > 0);
  return NextResponse.json({
    ok: true,
    checkedAt: new Date().toISOString(),
    usableEndpoints: usable.map((result) => `${result.provider}:${result.endpoint}`),
    results,
    safety: { databaseWrites: false, publishing: false, notifications: false, secretsRedacted: true },
  });
}
