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
  return JSON.stringify(value ?? "").replace(/[A-Za-z0-9_-]{24,}/g, "[redacted]").slice(0, 240);
}

async function probe(path: string, apiKey: string) {
  const separator = path.includes("?") ? "&" : "?";
  const url = `https://financialmodelingprep.com/stable/${path}${separator}apikey=${encodeURIComponent(apiKey)}`;
  const started = Date.now();
  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: { accept: "application/json", apikey: apiKey, "user-agent": "SwingUpDirectoryAudit/1.0" },
      signal: AbortSignal.timeout(90_000),
    });
    const payload = await response.json().catch(async () => await response.text().catch(() => null));
    const list = rows(payload);
    const first = object(list[0]);
    return {
      endpoint: path.split("?")[0],
      status: response.status,
      ok: response.ok,
      rowCount: list.length,
      firstRowKeys: Object.keys(first).slice(0, 40),
      sampleSymbols: list.slice(0, 5).map((item) => object(item).symbol).filter(Boolean),
      safeBodyWhenUnavailable: response.ok ? null : safeMessage(payload),
      responseTimeMs: Date.now() - started,
    };
  } catch (error) {
    return {
      endpoint: path.split("?")[0],
      status: null,
      ok: false,
      rowCount: 0,
      firstRowKeys: [],
      sampleSymbols: [],
      safeBodyWhenUnavailable: error instanceof Error ? error.message.slice(0, 240) : "probe_failed",
      responseTimeMs: Date.now() - started,
    };
  }
}

export async function GET(request: NextRequest) {
  if (!branchAllowed()) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  const expected = process.env.SWING_UP_AUTOMATION_TOKEN?.trim();
  if (expected && suppliedToken(request) !== expected) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const apiKey = process.env.FMP_API_KEY?.trim();
  if (!apiKey) return NextResponse.json({ ok: false, error: "fmp_not_configured" }, { status: 503 });

  const endpoints = [
    "company-screener?isEtf=false&isActivelyTrading=true&limit=100000",
    "company-screener?exchange=NASDAQ&isEtf=false&isActivelyTrading=true&limit=10000",
    "batch-exchange-quote?exchange=NASDAQ",
    "batch-exchange-quote?exchange=NYSE",
    "batch-exchange-quote?exchange=LSE",
    "available-exchanges",
    "available-countries",
    "all-exchange-market-hours",
    "latest-financial-statements?page=0&limit=250",
    "quote?symbol=AAPL",
  ];
  const results = [];
  for (const endpoint of endpoints) results.push(await probe(endpoint, apiKey));
  const usable = results.filter((result) => result.ok && result.rowCount > 0);
  return NextResponse.json({
    ok: true,
    checkedAt: new Date().toISOString(),
    usableEndpoints: usable.map((result) => result.endpoint),
    results,
    safety: { databaseWrites: false, publishing: false, notifications: false, secretsRedacted: true },
  });
}
