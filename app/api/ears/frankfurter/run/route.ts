import { NextRequest, NextResponse } from "next/server";
import { runFrankfurterIngestion } from "@/lib/ears/frankfurter";

function parseBoolean(value: string | null) {
  return value === "true" || value === "1" || value === "yes";
}

async function handleRun(request: NextRequest) {
  const dryRun = parseBoolean(request.nextUrl.searchParams.get("dryRun"));
  const force = parseBoolean(request.nextUrl.searchParams.get("force"));
  const result = await runFrankfurterIngestion({ dryRun, force });
  const status = result.ok ? 200 : 502;

  return NextResponse.json(result, { status });
}

export async function GET(request: NextRequest) {
  return handleRun(request);
}

export async function POST(request: NextRequest) {
  return handleRun(request);
}
