import { NextResponse } from "next/server";
import { diagnoseFmpAccess } from "@/lib/ears/fmp";
import { fmpDataRegistry } from "@/lib/build154-registries";
export const dynamic = "force-dynamic";
export async function GET() { const diagnostic = await diagnoseFmpAccess().catch((e)=>({ok:false,status:"unknown_provider_error",lastFailureReason:e instanceof Error?e.message:"unknown",attempts:[],endpointHealth:{}})); return NextResponse.json({ ok:true, diagnostic, registry:fmpDataRegistry(String(diagnostic.status), String(diagnostic.lastFailureReason ?? "") || null), officialDocsUsed:["https://site.financialmodelingprep.com/developer/docs","https://site.financialmodelingprep.com/developer/docs/stable/profile-symbol","https://site.financialmodelingprep.com/developer/docs/stable/search-symbol","https://site.financialmodelingprep.com/developer/docs/stable/company-symbols-list"] }); }
