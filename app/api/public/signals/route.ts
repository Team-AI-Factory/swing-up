import { NextRequest, NextResponse } from "next/server";
import { internalApiScopeAuthorized } from "@/lib/internal-api-auth";
import { isSimpleAlertPilot } from "@/lib/simple-alert-pilot-runtime";
import { getValuationWatchlistStatus } from "@/lib/opportunity-engine/valuation-watchlist-feed";
import { readResearchAlerts, readEvidenceQuality, isResearchAlertCurrent } from "@/lib/opportunity-engine/pr262-research-evidence";
import { assembleRestrictedResearchWatch } from "@/lib/restricted-research-watch";
import { assemblePublicSignals } from "@/lib/public-signals";

export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  const restrictedBeta = isSimpleAlertPilot();
  if (restrictedBeta && !internalApiScopeAuthorized(request.headers, "serious_signal_read")) {
    return NextResponse.json({ ok: false, error: "not_found" }, {
      status: 404, headers: { "cache-control": "private, no-store" },
    });
  }
  try {
    const [valuation, reviewed, dataQuality] = await Promise.all([getValuationWatchlistStatus({ limit: 1000 }), readResearchAlerts(), readEvidenceQuality()]);
    const now = Date.now();
    const recent = reviewed.filter(r => isResearchAlertCurrent(r, now));
    const action = request.nextUrl.searchParams.get("action") ?? "all";
    const alerts = assemblePublicSignals(valuation.candidates, recent, action);
    return NextResponse.json({ ok: true, sanitized: true, ...(restrictedBeta ? { researchWatch: assembleRestrictedResearchWatch(reviewed) } : {}), coverage: valuation.foundation.coverage, dataQuality, generatedAt: new Date().toISOString(), sort: "buy_and_sell_by_base_case_potential_desc", total: alerts.length, truncated: alerts.length > 200, alerts: alerts.slice(0, 200) },
      { headers: { "cache-control": restrictedBeta ? "private, no-store" : "public, max-age=30, stale-while-revalidate=60" } });
  } catch {
    return NextResponse.json({ ok: false, sanitized: true, alerts: [], error: "Signals are temporarily unavailable." }, { status: 503, headers: { "cache-control": "private, no-store" } });
  }
}
