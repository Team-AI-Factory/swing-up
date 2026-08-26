import { NextRequest, NextResponse } from "next/server";
import {
  INTERNAL_API_PATHS,
  internalApiScopeAuthorized,
  requiredInternalApiScope,
} from "@/lib/internal-api-auth";
import { isPr262ApprovedPremergeProductionRollout } from "@/lib/opportunity-engine/pr262-runtime";

const PR262_BRANCH = "agent/combined-opportunity-engine";

function hiddenRoute() {
  return NextResponse.json(
    { ok: false, error: "not_found" },
    { status: 404, headers: { "cache-control": "no-store" } },
  );
}

/**
 * PR #262 remains tightly isolated before merge, while production keeps the
 * normal Swing Up API surface. After merge, high-risk mutation, committee,
 * scanner and analysis-persistence routes require an internal bearer/token
 * credential instead of relying on a branch-wide shutdown barrier.
 */
export function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const branch = process.env.RAILWAY_GIT_BRANCH?.trim() ?? "";
  const scope = requiredInternalApiScope(path, request.method);

  if (path === "/api/health" && request.method === "GET") return NextResponse.next();

  if (branch === PR262_BRANCH) {
    const approvedPremergeRollout = isPr262ApprovedPremergeProductionRollout();
    const branchAllowed = (
      (path === INTERNAL_API_PATHS.pr262Cron && scope === "cron_runtime")
      || (approvedPremergeRollout && path === INTERNAL_API_PATHS.pr262ProductionFoundation && scope === "foundation_runtime")
      || (path === INTERNAL_API_PATHS.pr262SensorHandoff && scope === "sensor_handoff")
      || (path === INTERNAL_API_PATHS.seriousSignalStatus && scope === "serious_signal_read")
    );
    if (branchAllowed && scope && internalApiScopeAuthorized(request.headers, scope)) {
      return NextResponse.next();
    }
    return NextResponse.json(
      { ok: false, error: "pr262_runtime_route_blocked" },
      { status: 404, headers: { "cache-control": "no-store" } },
    );
  }

  if (!scope) return NextResponse.next();

  if (internalApiScopeAuthorized(request.headers, scope)) return NextResponse.next();
  return hiddenRoute();
}

export const config = {
  matcher: ["/api/:path*"],
};
