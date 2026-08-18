import { NextRequest, NextResponse } from "next/server";

/**
 * PR #262 runtime boundary.
 *
 * The legacy scanners and public API routes remain blocked. The only active
 * branch runtime path is the short-lived Railway cron endpoint, protected by a
 * per-process token and used only by the five-minute lightweight sensor job.
 */
export function middleware(request: NextRequest) {
  if (request.nextUrl.pathname === "/api/health" && request.method === "GET") {
    return NextResponse.next();
  }

  if (
    request.nextUrl.pathname === "/api/internal/combined-opportunity-engine/cron-v3"
    && request.method === "POST"
  ) {
    const expected = process.env.SWING_UP_PR262_CRON_RUNTIME_TOKEN?.trim()
      || process.env.SWING_UP_PR262_SENSOR_TOKEN?.trim()
      || process.env.SWING_UP_AUTOMATION_TOKEN?.trim();
    const supplied = request.headers.get("x-swing-up-pr262-cron-token")?.trim();
    if (expected && supplied === expected) return NextResponse.next();
  }

  return NextResponse.json(
    { ok: false, error: "pr262_runtime_route_blocked" },
    { status: 404, headers: { "cache-control": "no-store" } },
  );
}

export const config = {
  matcher: ["/api/:path*"],
};
