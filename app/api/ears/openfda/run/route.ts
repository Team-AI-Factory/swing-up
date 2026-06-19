import { NextRequest, NextResponse } from "next/server";
import { runOpenFdaIngestion } from "@/lib/ears/openfda";

function parseDryRun(value: string | null) {
  return value !== "false";
}

function parseLimit(value: string | null) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export async function GET(request: NextRequest) {
  const result = await runOpenFdaIngestion({
    dryRun: parseDryRun(request.nextUrl.searchParams.get("dryRun")),
    limit: parseLimit(request.nextUrl.searchParams.get("limit")),
  });

  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}
