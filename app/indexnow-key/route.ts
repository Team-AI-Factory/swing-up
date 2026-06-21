import { NextResponse } from "next/server";

export function GET() {
  const key = process.env.INDEXNOW_KEY;
  if (!key) return new NextResponse("not_configured", { status: 404 });
  return new NextResponse(key, { headers: { "content-type": "text/plain; charset=utf-8" } });
}
