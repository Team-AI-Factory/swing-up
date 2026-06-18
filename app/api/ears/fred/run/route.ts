import { NextRequest, NextResponse } from "next/server";
import { runFredIngestion } from "@/lib/ears/fred";

export async function GET(request: NextRequest) {
  const dryRun = request.nextUrl.searchParams.get("dryRun") !== "false";
  const result = await runFredIngestion({ dryRun });
  return NextResponse.json(result);
}
