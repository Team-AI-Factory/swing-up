import { NextRequest, NextResponse } from "next/server";
import { checkR2Health } from "@/lib/r2-warehouse";
import { withRedactionMetadata } from "@/lib/redact-secrets";

export async function GET() {
  return NextResponse.json(withRedactionMetadata(await checkR2Health(false)));
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  return NextResponse.json(withRedactionMetadata(await checkR2Health(body?.confirmWrite === true)));
}
