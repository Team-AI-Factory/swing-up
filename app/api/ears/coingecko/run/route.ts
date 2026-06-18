import { NextRequest, NextResponse } from "next/server";
import { capCoinGeckoLimit, runCoinGeckoIngestion } from "@/lib/ears/coingecko";

function parseDryRun(value: string | null) {
  return value === "true" || value === "1" || value === "yes";
}

async function handleRun(request: NextRequest) {
  const limit = capCoinGeckoLimit(Number.parseInt(request.nextUrl.searchParams.get("limit") ?? "", 10));
  const dryRun = parseDryRun(request.nextUrl.searchParams.get("dryRun"));
  const result = await runCoinGeckoIngestion({ limit, dryRun });
  const status = result.ok || result.rateLimited ? 200 : 502;

  return NextResponse.json({ ...result, apiKeyConfigured: undefined }, { status });
}

export async function GET(request: NextRequest) {
  return handleRun(request);
}

export async function POST(request: NextRequest) {
  return handleRun(request);
}
