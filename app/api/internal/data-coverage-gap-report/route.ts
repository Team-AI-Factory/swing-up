import { NextResponse } from "next/server";
import { dataCoverageGapReport } from "@/lib/build154-registries";
export const dynamic="force-dynamic"; export async function GET(){ return NextResponse.json({ok:true,...dataCoverageGapReport()}); }
