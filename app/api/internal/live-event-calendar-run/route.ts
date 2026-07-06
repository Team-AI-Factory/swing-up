import { NextRequest, NextResponse } from "next/server";
import { runLiveEventCalendar } from "@/lib/live-event-calendar";
import { withRedactionMetadata } from "@/lib/redact-secrets";
export const dynamic="force-dynamic";
export async function POST(request:NextRequest){ const body=await request.json().catch(()=>({})); try{return NextResponse.json(withRedactionMetadata(await runLiveEventCalendar(body)));}catch(e){return NextResponse.json(withRedactionMetadata({ok:false,safeErrorCategory:"live_event_calendar_failed_safe",safeErrorMessage:e instanceof Error?e.message.slice(0,160):"Unknown error",noOpenAI:true,noPublish:true,noTelegram:true}),{status:200});}}
export async function GET(){return NextResponse.json(withRedactionMetadata({ok:false,methodRequired:"POST",exampleBody:{dryRun:true,confirmRun:false,symbols:["NVDA","AMD","MSFT","GOOGL"],lookAheadHours:72,lookBackHours:24,maxEvents:100},noOpenAI:true,noPublish:true,noTelegram:true}));}
