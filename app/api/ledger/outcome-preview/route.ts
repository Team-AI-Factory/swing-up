import { NextRequest, NextResponse } from "next/server";
import { classifyAlertOutcome, mockOutcomePreviewInput, type OutcomePreviewInput } from "@/lib/alert-outcome-classifier";

export async function GET(request: NextRequest) {
  const mock = request.nextUrl.searchParams.get("mock") === "true";
  if (!mock) {
    return NextResponse.json(
      { ok: false, error: "Use ?mock=true for a safe outcome preview, or POST mock alert and price snapshot data." },
      { status: 400 },
    );
  }

  return NextResponse.json(classifyAlertOutcome(mockOutcomePreviewInput()));
}

export async function POST(request: NextRequest) {
  let payload: OutcomePreviewInput;
  try {
    payload = (await request.json()) as OutcomePreviewInput;
  } catch {
    return NextResponse.json({ ok: false, error: "Request body must be valid JSON." }, { status: 400 });
  }

  return NextResponse.json(classifyAlertOutcome(payload));
}
