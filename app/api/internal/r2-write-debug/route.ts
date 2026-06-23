import { NextRequest, NextResponse } from "next/server";
import { checkR2Health } from "@/lib/r2-warehouse";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  return NextResponse.json(await checkR2Health(body?.confirmWrite === true));
}
