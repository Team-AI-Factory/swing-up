import { NextResponse } from "next/server";
import { catalystOpportunityRegistry } from "@/lib/build154-registries";
export const dynamic="force-dynamic"; export async function GET(){ return NextResponse.json({ok:true,...catalystOpportunityRegistry()}); }
