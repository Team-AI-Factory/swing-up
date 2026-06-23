import { NextResponse } from "next/server";
import { SOURCE_RELEVANCE_MAP } from "@/lib/global-ear-scheduler";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ ok: true, productRule: "Every relevant source is considered per ticker, but calls must be meaningful and budget-aware.", sources: SOURCE_RELEVANCE_MAP });
}
