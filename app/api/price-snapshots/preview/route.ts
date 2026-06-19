import { NextRequest, NextResponse } from "next/server";
import { buildPriceSnapshotPreview, mockPriceSnapshotInput, type PriceSnapshotPreviewInput } from "@/lib/price-snapshot-tracker";

export async function GET(request: NextRequest) {
  const mock = request.nextUrl.searchParams.get("mock") === "true";
  if (!mock) {
    return NextResponse.json({ ok: false, error: "Use ?mock=true for a safe price snapshot preview, or POST mock alert and snapshot JSON." }, { status: 400 });
  }

  return NextResponse.json(buildPriceSnapshotPreview(mockPriceSnapshotInput));
}

export async function POST(request: NextRequest) {
  let payload: PriceSnapshotPreviewInput;
  try {
    payload = (await request.json()) as PriceSnapshotPreviewInput;
  } catch {
    return NextResponse.json({ ok: false, error: "Request body must be valid JSON." }, { status: 400 });
  }

  return NextResponse.json(buildPriceSnapshotPreview(payload));
}
