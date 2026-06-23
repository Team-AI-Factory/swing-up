import { NextRequest, NextResponse } from "next/server";
import { runHistorical } from "@/lib/proof-ears";
export const dynamic = "force-dynamic";
export async function GET() { const result = await runHistorical({ maxTickers: 3, maxHistoricalMatches: 20 }); return NextResponse.json({ ok: true, ...result, dryRun: true, confirmRun: false, safety: { callsOpenAI: false, publishesAlerts: false, sendsTelegram: false } }); }
export async function POST(request: NextRequest) { const body = await request.json().catch(() => ({})); const result = await runHistorical(body); return NextResponse.json({ ok: true, ...result, dryRun: body.dryRun !== false, confirmRun: body.confirmRun === true, safety: { callsOpenAI: false, publishesAlerts: false, sendsTelegram: false } }); }
