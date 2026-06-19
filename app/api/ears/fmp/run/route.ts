import { NextRequest, NextResponse } from "next/server";
import { capFmpLimit, runFmpIngestion } from "@/lib/ears/fmp";

function parseDryRun(value: string | null) {
  if (value === null) return true;
  return !(value === "false" || value === "0" || value === "no");
}

function parseTickers(value: string | null) {
  return value?.split(",").map((ticker) => ticker.trim()).filter(Boolean) ?? undefined;
}

async function handleRun(request: NextRequest) {
  const dryRun = parseDryRun(request.nextUrl.searchParams.get("dryRun"));
  const limit = capFmpLimit(Number.parseInt(request.nextUrl.searchParams.get("limit") ?? "", 10));
  const tickers = parseTickers(request.nextUrl.searchParams.get("tickers"));
  const result = await runFmpIngestion({ dryRun, limit, tickers });
  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}

export async function GET(request: NextRequest) {
  return handleRun(request);
}

export async function POST(request: NextRequest) {
  return handleRun(request);
}
