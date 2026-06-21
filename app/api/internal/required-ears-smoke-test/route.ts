import { NextResponse } from "next/server";
import { runRequiredEarsSmokeTest } from "@/lib/ops/required-ears-smoke-test";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const result = await runRequiredEarsSmokeTest({ dryRun: body.dryRun !== false, limitPerSource: body.limitPerSource, sources: Array.isArray(body.sources) ? body.sources : undefined });
  return NextResponse.json(result, { status: result.ok ? 200 : 503 });
}
