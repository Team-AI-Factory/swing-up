import { NextRequest, NextResponse } from "next/server";
import { mockAlertTierAccessInput, previewAlertTierAccess, type AlertTierAccessInput } from "@/lib/alert-tier-access";

export async function GET(request: NextRequest) {
  const mock = request.nextUrl.searchParams.get("mock") === "true";
  if (!mock) {
    return NextResponse.json(
      { ok: false, error: "Use ?mock=true for a safe alert tier access preview, or POST mock user plan and alert data." },
      { status: 400 },
    );
  }

  return NextResponse.json(previewAlertTierAccess(mockAlertTierAccessInput()));
}

export async function POST(request: NextRequest) {
  let payload: AlertTierAccessInput;
  try {
    payload = (await request.json()) as AlertTierAccessInput;
  } catch {
    return NextResponse.json({ ok: false, error: "Request body must be valid JSON." }, { status: 400 });
  }

  return NextResponse.json(previewAlertTierAccess(payload));
}
