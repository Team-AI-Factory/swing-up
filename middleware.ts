import { NextRequest, NextResponse } from "next/server";

const PR262_BRANCH = "agent/combined-opportunity-engine";
const PR262_CRON_PATH = "/api/internal/combined-opportunity-engine/cron-v3";
const PROTECTED_PRODUCTION_PATHS = [
  "/api/internal/publish-approved-alert",
  "/api/internal/run-live-alert-cycle",
  "/api/internal/e2e-alert-test",
  "/api/internal/full-e2e-telegram-test",
  "/api/internal/candidate-factory-run",
  "/api/internal/ledger-outcome-scheduler",
  "/api/internal/live-outcome-evaluator",
  "/api/internal/railway-branch-signal-lab",
  "/api/internal/combined-opportunity-engine",
  "/api/candidate-alerts/from-raw-signal",
  "/api/candidate-alerts/persist-analysis",
  "/api/price-snapshots/from-alert",
  "/api/ai-committee/run",
] as const;

function suppliedInternalToken(request: NextRequest) {
  const authorization = request.headers.get("authorization")?.trim() ?? "";
  const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  return bearer
    || request.headers.get("x-swing-up-internal-token")?.trim()
    || request.headers.get("x-swing-up-pr262-cron-token")?.trim()
    || null;
}

function expectedInternalTokens() {
  return [
    process.env.SWING_UP_PR262_CRON_RUNTIME_TOKEN,
    process.env.SWING_UP_PR262_SENSOR_TOKEN,
    process.env.SWING_UP_INTERNAL_API_TOKEN,
    process.env.SWING_UP_AUTOMATION_TOKEN,
  ].map((value) => value?.trim()).filter((value): value is string => Boolean(value));
}

function internalTokenAccepted(request: NextRequest) {
  const supplied = suppliedInternalToken(request);
  return Boolean(supplied && expectedInternalTokens().some((expected) => supplied === expected));
}

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

  if (path === "/api/health" && request.method === "GET") return NextResponse.next();

  if (branch === PR262_BRANCH) {
    if (path === PR262_CRON_PATH && request.method === "POST" && internalTokenAccepted(request)) {
      return NextResponse.next();
    }
    return NextResponse.json(
      { ok: false, error: "pr262_runtime_route_blocked" },
      { status: 404, headers: { "cache-control": "no-store" } },
    );
  }

  const protectedProductionRoute = PROTECTED_PRODUCTION_PATHS.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
  if (!protectedProductionRoute) return NextResponse.next();

  if (internalTokenAccepted(request)) return NextResponse.next();
  return hiddenRoute();
}

export const config = {
  matcher: ["/api/:path*"],
};
