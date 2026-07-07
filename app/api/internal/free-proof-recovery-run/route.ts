import { NextRequest, NextResponse } from "next/server";
import { runFreeProofRecovery } from "@/lib/free-proof-recovery";
import { withRedactionMetadata } from "@/lib/redact-secrets";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) { const body = await request.json().catch(()=>({})); const result = await runFreeProofRecovery(body).catch((e)=>({ok:false,dryRun:body?.dryRun!==false,candidatesInspected:0,safeErrorCategory:"free_proof_recovery_failed_safe",safeErrorMessage:e instanceof Error?e.message.slice(0,120):"Unknown error",noOpenAI:true,noPublish:true,noTelegram:true,secretsRedacted:true})); return NextResponse.json(withRedactionMetadata(result)); }
