import { NextRequest, NextResponse } from "next/server";
import { mockReceiptInputs, normalizeReceipts } from "@/lib/receipt-normalizer";

export async function GET(request: NextRequest) {
  const mock = request.nextUrl.searchParams.get("mock") === "true";
  if (!mock) {
    return NextResponse.json(
      { ok: false, error: "Use ?mock=true for a safe receipts normalization preview, or POST receipt input JSON." },
      { status: 400 },
    );
  }

  return NextResponse.json(normalizeReceipts(mockReceiptInputs));
}

export async function POST(request: NextRequest) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Request body must be valid JSON." }, { status: 400 });
  }

  const receipts = payload && typeof payload === "object" && "receipts" in payload ? (payload as { receipts: unknown }).receipts : payload;
  return NextResponse.json(normalizeReceipts(receipts));
}
