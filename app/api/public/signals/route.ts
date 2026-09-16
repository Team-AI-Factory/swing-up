import { NextResponse } from "next/server";
import { getValuationWatchlistStatus } from "@/lib/opportunity-engine/valuation-watchlist-feed";
import { readResearchAlerts, readEvidenceQuality } from "@/lib/opportunity-engine/pr262-research-evidence";

export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const [valuation, reviewed, dataQuality] = await Promise.all([getValuationWatchlistStatus({ limit: 200 }), readResearchAlerts(), readEvidenceQuality()]);
    const now = Date.now();
    const recent = reviewed.filter(r => Number.isFinite(Date.parse(String(r.createdAt)))
      && now - Date.parse(String(r.createdAt)) <= (r.kind === "valuation" ? 24 : 72) * 3600000);
    const reviewedValuations = new Set(recent.filter(r => r.kind === "valuation").map(r => String(r.ticker)));
    const events = recent.filter(r => r.userAlertEligible === true).map(r => ({
      id: r.id, ticker: r.ticker, company: r.company, action: r.action, createdAt: r.createdAt,
      eventObservedAt: r.eventObservedAt, currentPrice: r.currentPrice, priceObservedAt: r.priceObservedAt,
      fairValue: r.fairValue, committeeApproved: r.committeeApproved, committeeStatus: r.committeeStatus,
      publicationStatus: r.publicationStatus, explanation: r.explanation, sources: r.sources,
      kind: r.kind, confidence: (r.committee as { confidence?: number })?.confidence ?? null,
    }));
    const alerts = valuation.candidates.filter(r => r.userAlertEligible && !reviewedValuations.has(r.ticker)).map(r => ({
      id: r.id, ticker: r.ticker, company: r.company, action: r.action.replace("_research", ""),
      createdAt: r.observedAt, eventObservedAt: null, currentPrice: r.currentPrice, priceObservedAt: r.priceObservedAt,
      fairValue: r.fairValue.base, committeeApproved: r.committeeApproved, committeeStatus: r.committeeStatus,
      publicationStatus: r.publicationStatus, explanation: r.explanation, sources: r.links,
      confidence: r.scores.fairValueConfidence, kind: "valuation",
    }));
    return NextResponse.json({ ok: true, sanitized: true, coverage: valuation.foundation.coverage, dataQuality, generatedAt: new Date().toISOString(), alerts: [...events, ...alerts].slice(0, 200) },
      { headers: { "cache-control": "public, max-age=30, stale-while-revalidate=60" } });
  } catch {
    return NextResponse.json({ ok: false, sanitized: true, alerts: [], error: "Signals are temporarily unavailable." }, { status: 503 });
  }
}
