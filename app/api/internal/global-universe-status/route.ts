import { NextResponse } from "next/server";
import { getGlobalUniverseStatus } from "@/lib/global-ear-scheduler";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ ok: true, universeMode: "global", ...getGlobalUniverseStatus() });
}
