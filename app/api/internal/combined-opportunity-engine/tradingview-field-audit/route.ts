import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const CANDIDATE_FIELDS = [
  "Recommend.All",
  "Recommend.MA",
  "Recommend.Other",
  "RSI",
  "sector",
  "industry",
  "price_earnings_ttm",
  "price_sales_ratio",
  "price_book_ratio",
  "enterprise_value_ebitda_ttm",
  "total_revenue",
  "total_revenue_yoy_growth_ttm",
  "total_revenue_yoy_growth_fy",
  "net_income",
  "net_income_yoy_growth_ttm",
  "earnings_per_share_diluted_ttm",
  "earnings_per_share_diluted_yoy_growth_ttm",
  "gross_margin",
  "operating_margin",
  "net_margin",
  "free_cash_flow",
  "free_cash_flow_margin",
  "debt_to_equity",
  "current_ratio",
  "return_on_equity",
  "return_on_assets",
  "target_price",
  "target_price_date",
  "number_of_analysts",
  "earnings_release_next_date",
  "earnings_release_date",
  "dividends_yield_current",
  "beta_1_year",
  "Volatility.D",
  "relative_volume_10d_calc",
] as const;

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

function safeError(error: unknown) {
  return error instanceof Error ? error.message.replace(/\s+/g, " ").slice(0, 300) : "field_probe_failed";
}

async function probeField(field: string) {
  const response = await fetch("https://scanner.tradingview.com/global/scan", {
    method: "POST",
    cache: "no-store",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      origin: "https://www.tradingview.com",
      referer: "https://www.tradingview.com/",
      "user-agent": "Mozilla/5.0 (compatible; SwingUpFieldAudit/1.0)",
    },
    body: JSON.stringify({
      symbols: { tickers: ["NASDAQ:AAPL"], query: { types: [] } },
      columns: [field],
      range: [0, 1],
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const payload = await response.json().catch(async () => await response.text().catch(() => null));
  const container = payload && typeof payload === "object" && !Array.isArray(payload) ? payload as Record<string, unknown> : {};
  const data = Array.isArray(container.data) ? container.data : [];
  const row = data[0] && typeof data[0] === "object" && !Array.isArray(data[0]) ? data[0] as Record<string, unknown> : {};
  const values = Array.isArray(row.d) ? row.d : [];
  return {
    field,
    status: response.status,
    available: response.ok && data.length > 0 && values.length > 0,
    value: values[0] ?? null,
    safeError: response.ok ? null : JSON.stringify(payload ?? "").slice(0, 300),
  };
}

async function mapWithConcurrency<T, R>(items: readonly T[], concurrency: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const output = new Array<R>(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await worker(items[index]);
    }
  }));
  return output;
}

export async function GET(request: NextRequest) {
  if (!branchAllowed()) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  const expected = process.env.SWING_UP_AUTOMATION_TOKEN?.trim();
  if (expected && suppliedToken(request) !== expected) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const results = await mapWithConcurrency(CANDIDATE_FIELDS, 5, async (field) => {
    try {
      return await probeField(field);
    } catch (error) {
      return { field, status: null, available: false, value: null, safeError: safeError(error) };
    }
  });
  return NextResponse.json({
    ok: true,
    checkedAt: new Date().toISOString(),
    symbol: "NASDAQ:AAPL",
    availableFields: results.filter((row) => row.available).map((row) => row.field),
    unavailableFields: results.filter((row) => !row.available).map((row) => row.field),
    results,
    safety: { databaseWrites: false, publishing: false, notifications: false },
  });
}
