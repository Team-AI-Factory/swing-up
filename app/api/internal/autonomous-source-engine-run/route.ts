import { NextRequest, NextResponse } from "next/server";
import { runAutonomousSourceEngine, DEFAULT_AUTONOMOUS_PAYLOAD } from "@/lib/autonomous-source-engine";
import { withRedactionMetadata } from "@/lib/redact-secrets";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) { const body = await request.json().catch(() => ({})); try { return NextResponse.json(withRedactionMetadata(await runAutonomousSourceEngine({ ...DEFAULT_AUTONOMOUS_PAYLOAD, ...body }))); } catch (e) { return NextResponse.json(withRedactionMetadata({ ok:false, safeErrorCategory:"autonomous_source_engine_failed_safe", safeErrorMessage:e instanceof Error?e.message.slice(0,160):"Unknown error", noOpenAI:true,noPublish:true,noTelegram:true }), { status:200 }); } }
export async function GET(){ return NextResponse.json(withRedactionMetadata({ ok:false, methodRequired:"POST", exampleBody: DEFAULT_AUTONOMOUS_PAYLOAD, noOpenAI:true,noPublish:true,noTelegram:true })); }
