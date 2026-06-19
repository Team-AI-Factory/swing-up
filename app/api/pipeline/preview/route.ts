import { NextRequest, NextResponse } from "next/server";
import { buildPipelinePreview } from "@/lib/pipeline-preview";
import { mockRuleFilterInput, type RuleFilterInput } from "@/lib/rule-filter";

export async function GET(request: NextRequest) {
  const mock = request.nextUrl.searchParams.get("mock") === "true";
  if (!mock) {
    return NextResponse.json({ ok: false, error: "Use ?mock=true for a safe connected pipeline preview, or POST a raw signal-like payload." }, { status: 400 });
  }

  return NextResponse.json(buildPipelinePreview(mockRuleFilterInput, "mock"));
}

export async function POST(request: NextRequest) {
  let payload: RuleFilterInput;
  try {
    payload = (await request.json()) as RuleFilterInput;
  } catch {
    return NextResponse.json({ ok: false, error: "Request body must be valid JSON." }, { status: 400 });
  }

  return NextResponse.json(buildPipelinePreview(payload, "supplied_payload"));
}
