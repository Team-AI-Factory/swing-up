import { NextResponse } from "next/server";
import { getAutonomousSourceEngineStatus } from "@/lib/autonomous-source-engine";
import { withRedactionMetadata } from "@/lib/redact-secrets";
export const dynamic = "force-dynamic";
export async function GET(){ try { return NextResponse.json(withRedactionMetadata(await getAutonomousSourceEngineStatus())); } catch(e){ return NextResponse.json(withRedactionMetadata({ enabled:false, health:{ok:false}, safeErrorCategory:"autonomous_source_engine_status_failed_safe", safeErrorMessage:e instanceof Error?e.message.slice(0,160):"Unknown error", noOpenAI:true,noPublish:true,noTelegram:true }), {status:200}); } }
