import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    ok: true,
    route: "/api/health",
    status: "healthy",
    message: "Swing Up health check is healthy.",
    service: "swing-up",
    noOpenAI: true,
    noPublish: true,
    noTelegram: true,
    secretsRedacted: true,
  });
}
