import { NextRequest, NextResponse } from "next/server";
import { runMarketSnapshotEar } from "@/lib/price-volume-proof";
import { withRedactionMetadata } from "@/lib/redact-secrets";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest){ const body=await request.json().catch(()=>({})); try{ return NextResponse.json(withRedactionMetadata(await runMarketSnapshotEar(body))); }catch(error){ return NextResponse.json(withRedactionMetadata({ok:false,dryRun:body.dryRun!==false,error:error instanceof Error?error.message.slice(0,160):"market_snapshot_ear_failed_safe",noOpenAI:true,noPublish:true,noTelegram:true,secretsRedacted:true}),{status:200}); }}
