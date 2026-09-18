import type { getValuationWatchlistStatus } from "@/lib/opportunity-engine/valuation-watchlist-feed";
import { publicExplanation } from "@/lib/signal-explanation";
import { buildPriceOutlook, compareSignalPotential, signalAction, type PriceOutlook } from "@/lib/signal-outlook";

type Json = Record<string, unknown>;
type Candidate = Awaited<ReturnType<typeof getValuationWatchlistStatus>>["candidates"][number];
const object = (value: unknown): Json => value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};

export function assemblePublicSignals(candidates: Candidate[], recent: Json[], action = "all") {
  const byTicker = new Map(candidates.map(candidate => [candidate.ticker, candidate]));
  const reviewedValuations = new Set(recent.filter(row => row.kind === "valuation" && row.valuationObservedAt === byTicker.get(String(row.ticker))?.observedAt).map(row => String(row.ticker)));
  const events = recent.filter(row => row.userAlertEligible === true && (row.kind !== "valuation" || !byTicker.has(String(row.ticker)) || row.valuationObservedAt === byTicker.get(String(row.ticker))?.observedAt)).map(row => {
    const context = byTicker.get(String(row.ticker));
    const stored = object(row.outlook);
    const basis = stored.basis === "historical_scenarios" ? "historical_scenarios" : "valuation";
    const outlook = Object.keys(stored).length ? row.outlook as PriceOutlook : buildPriceOutlook({
      currentPrice: row.currentPrice, currency: row.currency ?? context?.currency, action: row.action,
      conservative: context?.fairValue.conservative, base: row.fairValue ?? context?.fairValue.base,
      optimistic: context?.fairValue.optimistic, basis,
    });
    return {
      id: String(row.id), ticker: String(row.ticker), company: String(row.company), action: signalAction(row.action), createdAt: row.createdAt,
      eventObservedAt: row.eventObservedAt, currentPrice: row.currentPrice, priceObservedAt: row.priceObservedAt,
      fairValue: row.fairValue, outlook, committeeApproved: row.committeeApproved === true, committeeStatus: row.committeeStatus,
      publicationStatus: row.publicationStatus, sources: row.sources,
      explanation: publicExplanation(row.explanation, { company: String(row.company), industry: row.industry ?? context?.industry, sector: row.sector ?? context?.sector, headline: row.eventHeadline, eventFamily: row.eventFamily }),
      kind: row.kind, confidence: object(row.committee).confidence ?? null,
    };
  });
  const valuations = candidates.filter(row => row.userAlertEligible && !reviewedValuations.has(row.ticker)).map(row => ({
    id: row.id, ticker: row.ticker, company: row.company, action: signalAction(row.action), createdAt: row.observedAt,
    eventObservedAt: null, currentPrice: row.currentPrice, priceObservedAt: row.priceObservedAt,
    fairValue: row.fairValue.base, outlook: row.outlook, committeeApproved: row.committeeApproved, committeeStatus: row.committeeStatus,
    publicationStatus: row.publicationStatus, explanation: row.explanation, sources: row.links,
    confidence: row.scores.fairValueConfidence, kind: "valuation",
  }));
  return [...events, ...valuations].filter(row => action === "all" || (action === "approved" ? row.committeeApproved : row.action === action)).sort(compareSignalPotential);
}
