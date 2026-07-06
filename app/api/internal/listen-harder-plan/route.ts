import { NextResponse } from "next/server";
import { buildListenHarderPlan } from "@/lib/live-event-calendar";
import { withRedactionMetadata } from "@/lib/redact-secrets";
export const dynamic="force-dynamic";
export async function GET(){ try{return NextResponse.json(withRedactionMetadata(await buildListenHarderPlan({dryRun:true})));}catch(e){return NextResponse.json(withRedactionMetadata({ok:false,safeErrorCategory:"listen_harder_plan_failed_safe",safeErrorMessage:e instanceof Error?e.message.slice(0,160):"Unknown error",liveRoomsActiveNow:[],liveRoomsUpcoming24h:[],recentlyFinishedEvents:[],noOpenAI:true,noPublish:true,noTelegram:true}),{status:200});}}
