import { NextRequest, NextResponse } from "next/server";
import { capPolygonLimit, runPolygonIngestion } from "@/lib/ears/polygon";

function parseDryRun(value: string | null) {
  if (value === null) return true;
  return !(value === "false" || value === "0" || value === "no");
}

function parseTickers(value: string | null) {
  return value?.split(",").map((ticker) => ticker.trim()).filter(Boolean) ?? undefined;
}

export async function GET(request: NextRequest) {
  const dryRun = parseDryRun(request.nextUrl.searchParams.get("dryRun"));
  const limit = capPolygonLimit(Number.parseInt(request.nextUrl.searchParams.get("limit") ?? "", 10));
  const tickers = parseTickers(request.nextUrl.searchParams.get("tickers"));
  const result = await runPolygonIngestion({ dryRun, limit, tickers });
  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}
