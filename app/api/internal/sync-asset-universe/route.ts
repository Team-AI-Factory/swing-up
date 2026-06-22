import { NextRequest, NextResponse } from "next/server";
import { syncAssetUniverseDryRun } from "@/lib/build154-registries";
export const dynamic="force-dynamic"; export async function POST(req:NextRequest){ const body=await req.json().catch(()=>({})); const dryRun=body.dryRun !== false; if(!dryRun) return NextResponse.json({ok:false,dryRun:false,error:"non_dry_run_blocked_until_R2_and_cooldowns_are_configured"},{status:409}); return NextResponse.json(syncAssetUniverseDryRun()); }
