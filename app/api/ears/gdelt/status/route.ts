import { NextResponse } from "next/server";
import { GDELT_SOURCE, getGdeltSourceHealth } from "@/lib/ears/gdelt";

export async function GET() {
  try {
    const health = await getGdeltSourceHealth();
    return NextResponse.json({ ok: true, source: GDELT_SOURCE, health });
  } catch {
    return NextResponse.json(
      { ok: false, source: GDELT_SOURCE, error: "Unable to load GDELT source health." },
      { status: 500 },
    );
  }
}
