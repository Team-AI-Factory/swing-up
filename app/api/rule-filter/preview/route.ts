import { NextRequest, NextResponse } from "next/server";
import { evaluateRuleFilter, mockRuleFilterInput, type RuleFilterInput } from "@/lib/rule-filter";

export async function GET(request: NextRequest) {
  const mock = request.nextUrl.searchParams.get("mock") === "true";
  if (!mock) {
    return NextResponse.json({ ok: false, error: "Use ?mock=true for a safe rule filter preview, or POST a raw signal-like payload." }, { status: 400 });
  }

  return NextResponse.json(evaluateRuleFilter(mockRuleFilterInput));
}

export async function POST(request: NextRequest) {
  let payload: RuleFilterInput;
  try {
    payload = (await request.json()) as RuleFilterInput;
  } catch {
    return NextResponse.json({ ok: false, error: "Request body must be valid JSON." }, { status: 400 });
  }

  return NextResponse.json(evaluateRuleFilter(payload));
}
