import { NextRequest, NextResponse } from "next/server";
import { runWikidataRippleIngestion } from "@/lib/ears/wikidata-ripple";

function parseDryRun(value: string | null) {
  if (value === null) return true;
  return !(value === "false" || value === "0" || value === "no");
}

export async function GET(request: NextRequest) {
  const result = await runWikidataRippleIngestion({ dryRun: parseDryRun(request.nextUrl.searchParams.get("dryRun")) });
  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}
