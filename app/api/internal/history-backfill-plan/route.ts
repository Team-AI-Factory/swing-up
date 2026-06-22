import { NextRequest, NextResponse } from "next/server";
import { createHistoryBackfillPlan } from "@/lib/history-backfill-plan";
export async function POST(request:NextRequest){ return NextResponse.json(await createHistoryBackfillPlan(await request.json().catch(()=>({})))); }
