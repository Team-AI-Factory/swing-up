import { NextResponse } from "next/server";
import { getSecEdgarSourceHealth, SEC_EDGAR_SOURCE } from "@/lib/ears/sec-edgar";

export async function GET() {
  try {
    const health = await getSecEdgarSourceHealth();
    return NextResponse.json({ ok: true, source: SEC_EDGAR_SOURCE, health });
  } catch {
    return NextResponse.json(
      { ok: false, source: SEC_EDGAR_SOURCE, error: "Unable to load SEC EDGAR source health." },
      { status: 500 },
    );
  }
}
