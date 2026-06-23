import { NextResponse } from "next/server";
import { getSchedulerStatus } from "@/lib/global-ear-scheduler";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await getSchedulerStatus());
}
