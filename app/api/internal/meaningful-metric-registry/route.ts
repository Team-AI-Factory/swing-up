import { NextResponse } from "next/server";
import { MEANINGFUL_METRIC_REGISTRY } from "@/lib/global-ear-scheduler";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ ok: true, marketReactionRule: "bonus_only_never_required", metrics: MEANINGFUL_METRIC_REGISTRY });
}
