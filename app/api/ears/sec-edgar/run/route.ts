import { NextRequest, NextResponse } from "next/server";
import { DEFAULT_SEC_TICKERS, runSecEdgarIngestion } from "@/lib/ears/sec-edgar";

const MAX_AUTHENTICATED_TICKERS = 25;
const MAX_UNAUTHENTICATED_TICKERS = 2;
const MAX_AUTHENTICATED_LIMIT = 25;
const MAX_UNAUTHENTICATED_LIMIT = 3;

function parseTickers(value: string | null) {
  if (!value) return DEFAULT_SEC_TICKERS;
  return value
    .split(",")
    .map((ticker) => ticker.trim().toUpperCase())
    .filter(Boolean);
}

function parseLimit(value: string | null, fallback: number) {
  const parsed = Number.parseInt(value ?? String(fallback), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return parsed;
}

function parseDryRun(value: string | null) {
  return value === "true" || value === "1" || value === "yes";
}

async function handleRun(request: NextRequest) {
  const runToken = process.env.EAR_RUN_TOKEN?.trim();
  const suppliedToken = request.nextUrl.searchParams.get("token")?.trim();
  const hasConfiguredToken = Boolean(runToken);

  if (hasConfiguredToken && suppliedToken !== runToken) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }

  const maxTickers = hasConfiguredToken ? MAX_AUTHENTICATED_TICKERS : MAX_UNAUTHENTICATED_TICKERS;
  const maxLimit = hasConfiguredToken ? MAX_AUTHENTICATED_LIMIT : MAX_UNAUTHENTICATED_LIMIT;
  const requestedTickers = parseTickers(request.nextUrl.searchParams.get("tickers"));
  const tickers = requestedTickers.slice(0, maxTickers);
  const limit = Math.min(parseLimit(request.nextUrl.searchParams.get("limit"), maxLimit), maxLimit);
  const dryRun = parseDryRun(request.nextUrl.searchParams.get("dryRun"));

  const result = await runSecEdgarIngestion({ tickers, limit, dryRun });
  const status = result.ok ? 200 : 502;

  return NextResponse.json(
    {
      ok: result.ok,
      source: result.source,
      tickersChecked: result.tickersChecked,
      signalsCreated: result.signalsCreated,
      duplicatesSkipped: result.duplicatesSkipped,
      errors: result.errors,
      dryRun,
      capped: !hasConfiguredToken,
    },
    { status },
  );
}

export async function GET(request: NextRequest) {
  return handleRun(request);
}

export async function POST(request: NextRequest) {
  return handleRun(request);
}
