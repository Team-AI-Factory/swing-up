import { NextRequest, NextResponse } from "next/server";
import { mockMiniAiScanInput, previewMiniAiScan, type MiniAiScanInput } from "@/lib/mini-ai-scan";

export async function GET(request: NextRequest) {
  const mock = request.nextUrl.searchParams.get("mock") === "true";
  if (!mock) {
    return NextResponse.json({ ok: false, error: "Use ?mock=true for a safe Mini AI Scan preview, or POST a Mini AI Scan input payload." }, { status: 400 });
  }

  return NextResponse.json(previewMiniAiScan(mockMiniAiScanInput));
}

export async function POST(request: NextRequest) {
  let payload: MiniAiScanInput;
  try {
    payload = (await request.json()) as MiniAiScanInput;
  } catch {
    return NextResponse.json({ ok: false, error: "Request body must be valid JSON." }, { status: 400 });
  }

  return NextResponse.json(previewMiniAiScan(payload));
}
