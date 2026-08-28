import { NextRequest, NextResponse } from "next/server";
import { internalApiScopeAuthorized } from "@/lib/internal-api-auth";
import { getValuationWatchlistStatus } from "@/lib/opportunity-engine/valuation-watchlist-feed";

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
    const status = await getValuationWatchlistStatus({
      limit: boundedInteger(request.nextUrl.searchParams.get("limit"), 60, 1, 200),
    });
    return NextResponse.json(status, { headers: { "cache-control": "private, no-store" } });
  } catch {
    return NextResponse.json({
      ok: false,
      error: "valuation_watchlist_temporarily_unavailable",
      candidates: [],
      sanitized: true,
      provisionalResearchOnly: true,
    }, { status: 503, headers: { "cache-control": "private, no-store" } });
  }
}
