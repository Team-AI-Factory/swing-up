import { NextRequest, NextResponse } from "next/server";
import { internalApiScopeAuthorized } from "@/lib/internal-api-auth";
import { getSeriousSignalStatus } from "@/lib/notifications/serious-signal-delivery";

export const dynamic = "force-dynamic";

function boundedInteger(value: string | null, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, Math.floor(parsed))) : fallback;
}

export async function GET(request: NextRequest) {
  if (!internalApiScopeAuthorized(request.headers, "serious_signal_read")) {
    return NextResponse.json(
      { ok: false, error: "not_found" },
      { status: 404, headers: { "cache-control": "no-store" } },
    );
  }
  try {
    const status = await getSeriousSignalStatus({
      hours: boundedInteger(request.nextUrl.searchParams.get("hours"), 48, 1, 168),
      limit: boundedInteger(request.nextUrl.searchParams.get("limit"), 100, 1, 200),
    });
    return NextResponse.json(status, { headers: { "cache-control": "private, no-store" } });
  } catch {
    return NextResponse.json({
      ok: false,
      error: "serious_signal_status_temporarily_unavailable",
      alerts: [],
      sanitized: true,
      secretsIncluded: false,
    }, { status: 503, headers: { "cache-control": "private, no-store" } });
  }
}
