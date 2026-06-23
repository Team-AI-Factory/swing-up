import { NextRequest, NextResponse } from "next/server";
import { runSec8k } from "@/lib/proof-ears";
export const dynamic = "force-dynamic";
export async function GET() { const result = await runSec8k({ maxFilingsToCheck: 10, maxMaterialEvents: 5 }); return NextResponse.json({ ok: true, ...result, dryRun: true, confirmRun: false, safety: { callsOpenAI: false, publishesAlerts: false, sendsTelegram: false } }); }
export async function POST(request: NextRequest) { const body = await request.json().catch(() => ({})); const result = await runSec8k(body); return NextResponse.json({ ok: true, ...result, dryRun: body.dryRun !== false, confirmRun: body.confirmRun === true, safety: { callsOpenAI: false, publishesAlerts: false, sendsTelegram: false } }); }
