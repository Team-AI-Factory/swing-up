import { NextRequest, NextResponse } from "next/server";

/**
 * Binding PR #262 shutdown barrier.
 *
 * The branch-specific Railway launcher exits before Next.js starts. This
 * middleware is a second, independent barrier for stale deployments, manual
 * `npm start`, or a Railway start-command override: no API route can fetch a
 * provider, run analysis, call the committee, mutate state, or publish while
 * the consolidation pause is in force. Re-enabling requires a reviewed code
 * change and an update to the runtime-pause smoke test.
 */
export function middleware(request: NextRequest) {
  if (request.nextUrl.pathname === "/api/health" && request.method === "GET") {
    return NextResponse.next();
  }
  return NextResponse.json(
    { ok: false, error: "pr262_runtime_hard_paused" },
    { status: 404, headers: { "cache-control": "no-store" } },
  );
}

export const config = {
  matcher: ["/api/:path*"],
};
