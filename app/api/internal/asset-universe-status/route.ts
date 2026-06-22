import { NextResponse } from "next/server";
import { assetUniverseStatus } from "@/lib/build154-registries";
export const dynamic="force-dynamic"; export async function GET(){ return NextResponse.json({ok:true,...assetUniverseStatus()}); }
