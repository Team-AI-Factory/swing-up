import { NextResponse } from "next/server";
import { historyCapabilityStatus } from "@/lib/build154-registries";
export const dynamic="force-dynamic"; export async function GET(){ return NextResponse.json({ok:true,...historyCapabilityStatus()}); }
