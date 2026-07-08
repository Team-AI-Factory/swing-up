import { NextResponse } from "next/server";
import { priceVolumeDiagnostics } from "@/lib/price-volume-proof";
import { withRedactionMetadata } from "@/lib/redact-secrets";
export const dynamic = "force-dynamic";
export async function GET(){ try{ return NextResponse.json(withRedactionMetadata(await priceVolumeDiagnostics())); }catch(error){ return NextResponse.json(withRedactionMetadata({ok:false,error:error instanceof Error?error.message.slice(0,160):"price_volume_diagnostics_failed_safe",noSecretsExposed:true,secretsRedacted:true}),{status:200}); }}
