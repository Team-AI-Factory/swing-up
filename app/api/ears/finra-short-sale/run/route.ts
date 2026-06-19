import { NextRequest, NextResponse } from "next/server";
import { runFinraShortSaleIngestion } from "@/lib/ears/finra-short-sale";

function parseDryRun(value: string | null) {
  if (value === null) return true;
  return !(value === "false" || value === "0" || value === "no");
}

export async function GET(request: NextRequest) {
  const result = await runFinraShortSaleIngestion({ dryRun: parseDryRun(request.nextUrl.searchParams.get("dryRun")) });
  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}
