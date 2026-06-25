import { NextResponse } from "next/server";
import { buildLiveSourceSchedulerPlan } from "@/lib/live-source-contracts";
import { withRedactionMetadata } from "@/lib/redact-secrets";
export const dynamic = "force-dynamic";
export async function GET() { return NextResponse.json(withRedactionMetadata(buildLiveSourceSchedulerPlan())); }
