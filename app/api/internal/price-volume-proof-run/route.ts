import { NextRequest, NextResponse } from "next/server";
import { runPriceVolumeProofRecovery } from "@/lib/price-volume-proof";
import { withRedactionMetadata } from "@/lib/redact-secrets";
export const dynamic = "force-dynamic";
export async function GET(){ const result=await runPriceVolumeProofRecovery({dryRun:true,confirmRun:false,maxCandidates:3}); return NextResponse.json(withRedactionMetadata(result)); }
export async function POST(request: NextRequest){ const body=await request.json().catch(()=>({})); try{ return NextResponse.json(withRedactionMetadata(await runPriceVolumeProofRecovery(body))); }catch(error){ return NextResponse.json(withRedactionMetadata({ok:false,dryRun:body.dryRun!==false,error:error instanceof Error?error.message.slice(0,160):"price_volume_proof_run_failed_safe",noOpenAI:true,noPublish:true,noTelegram:true,secretsRedacted:true}),{status:200}); }}
