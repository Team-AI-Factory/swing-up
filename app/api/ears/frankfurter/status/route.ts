import { NextResponse } from "next/server";
import { FRANKFURTER_SOURCE, getFrankfurterSourceHealth } from "@/lib/ears/frankfurter";

export async function GET() {
  try {
    const health = await getFrankfurterSourceHealth();
    return NextResponse.json({ ok: true, source: FRANKFURTER_SOURCE, health });
  } catch {
    return NextResponse.json(
      { ok: false, source: FRANKFURTER_SOURCE, error: "Unable to load Frankfurter FX source health." },
      { status: 500 },
    );
  }
}
