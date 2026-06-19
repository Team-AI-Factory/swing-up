import { NextRequest, NextResponse } from "next/server";
import { capAlphaVantageLimit, runAlphaVantageIngestion } from "@/lib/ears/alpha-vantage";

function parseDryRun(value: string | null) {
  if (value === null) return true;
  return !(value === "false" || value === "0" || value === "no");
}

function parseTickers(value: string | null) {
  return value?.split(",").map((ticker) => ticker.trim()).filter(Boolean) ?? undefined;
}

export async function GET(request: NextRequest) {
  const dryRun = parseDryRun(request.nextUrl.searchParams.get("dryRun"));
  const limit = capAlphaVantageLimit(Number.parseInt(request.nextUrl.searchParams.get("limit") ?? "", 10));
  const tickers = parseTickers(request.nextUrl.searchParams.get("tickers"));
  const result = await runAlphaVantageIngestion({ dryRun, limit, tickers });
  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}
