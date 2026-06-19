import { NextResponse } from "next/server";
import { getAccessDecision } from "@/lib/access-control";

export async function GET() {
  const access = await getAccessDecision();
  return NextResponse.json(access);
}
