import type { getValuationWatchlistStatus } from "@/lib/opportunity-engine/valuation-watchlist-feed";
import { buildPriceOutlook, type PriceOutlook } from "@/lib/signal-outlook";

export const CHANNELS = ["facebook", "instagram", "x"] as const;
export type Channel = typeof CHANNELS[number];
export type Candidate = Awaited<ReturnType<typeof getValuationWatchlistStatus>>["candidates"][number];
export const BRAND_LINE = "Know your moves before the market does.";
export const SLOT_HOURS_UTC = [2, 10, 16] as const; // 09:00, 17:00, 23:00 Bangkok, every day.
export const SLOT_ACTIONS = ["buy_research", "sell_research", "watch_out_research"] as const;
export const LABELS = { buy_research: "Opportunity", sell_research: "Sell research", watch_out_research: "Watch out" } as const;
export const COLORS = { buy_research: "#4ADE80", sell_research: "#F87171", watch_out_research: "#FBBF24" } as const;
export const PILOT_PRICE_CENTS = 1900;
export const CONSENT_VERSION = "early-access-2026-09-14-v1";
export type ResearchSnapshot = {
  version: 1; ticker: string; company: string; currency: string;
  action: keyof typeof LABELS; label: string; title: string; why: string; expected: string;
  risk: string; currentPrice: number; targetPrice: number; low: number; high: number;
  confidence: number; riskScore: number | null; evidenceScore: number | null;
  priceObservedAt: string; observedAt: string; capturedAt: string;
  eventKind: "valuation_screen"; eventAt: null; horizon: null;
  sources: { label: string; url: string }[]; methods: string[];
  publicationStatus: "provisional_research_only" | "provisional_alert" | "committee_approved_alert"; userAlertEligible: boolean; committeeApproved: boolean;
  companyDoes?: string; whatHappened?: string; committeeStatus?: string;
  outlook?: PriceOutlook;
};
export function snapshotOutlook(snapshot: ResearchSnapshot) {
  return snapshot.outlook ?? buildPriceOutlook({ currentPrice: snapshot.currentPrice, currency: snapshot.currency, action: snapshot.action,
    conservative: snapshot.low, base: snapshot.targetPrice, optimistic: snapshot.high, basis: "valuation" });
}
export function money(value: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(value);
}
export function timestamp(value: string) { return new Date(value).toISOString().slice(0, 16).replace("T", " ") + " UTC"; }
export function slotsForDay(now: Date) {
  const day = now.toISOString().slice(0, 10);
  return SLOT_HOURS_UTC.map((hour, index) => ({
    key: `${day}-${index}`, action: SLOT_ACTIONS[index],
    at: new Date(`${day}T${String(hour).padStart(2, "0")}:00:00.000Z`),
  }));
}
export function candidateProblem(candidate: Candidate, now: Date): string | null {
  if (candidate.committeeStatus === "rejected") return "Committee rejected this assessment";
  if (!(candidate.action in LABELS)) return "No publishable research category";
  if (candidate.currency !== "USD") return "Currency is not confirmed as USD";
  const priceAge = now.getTime() - Date.parse(candidate.priceObservedAt);
  const modelAge = now.getTime() - Date.parse(candidate.observedAt);
  if (!candidate.livePriceFresh || !Number.isFinite(priceAge) || priceAge < 0 || priceAge > 90 * 60_000) return "Price observation is stale or missing";
  if (!Number.isFinite(modelAge) || modelAge < 0 || modelAge > 72 * 60 * 60_000) return "Valuation screen is stale or missing";
  const values = [candidate.currentPrice, candidate.fairValue.base, candidate.fairValue.conservative, candidate.fairValue.optimistic];
  if (values.some((value) => value === null || !Number.isFinite(value) || value <= 0)) return "Price or valuation range is incomplete";
  if (candidate.fairValue.conservative! > candidate.fairValue.base! || candidate.fairValue.base! > candidate.fairValue.optimistic!) return "Valuation range is inconsistent";
  const score = candidate.scores.fairValueConfidence;
  if (score === null || score < 60 || score > 100 || (candidate.scores.evidence ?? 0) < 70) return "Model confidence or evidence is insufficient";
  if (candidate.action === "buy_research" && candidate.currentPrice! >= candidate.fairValue.conservative!) return "Latest price no longer supports opportunity classification";
  if (candidate.action === "sell_research" && candidate.currentPrice! <= candidate.fairValue.base!) return "Latest price no longer supports sell research classification";
  return null;
}
export function makeSnapshot(candidate: Candidate, now = new Date()): ResearchSnapshot {
  const problem = candidateProblem(candidate, now);
  if (problem) throw new Error(problem);
  const action = candidate.action as keyof typeof LABELS;
  const current = candidate.currentPrice!;
  const target = candidate.fairValue.base!;
  const gap = Math.abs((target - current) / current * 100).toFixed(1);
  const direction = target >= current ? "rise" : "fall";
  const titles = {
    buy_research: `${candidate.ticker}: price below the model's valuation range`,
    sell_research: `${candidate.ticker}: price above the model's base value`,
    watch_out_research: `${candidate.ticker}: the model flags business or valuation risk`,
  };
  const metrics: string[] = [];
  if (candidate.fundamentals.revenueGrowthTtmPercent !== null) metrics.push(`trailing revenue growth of ${candidate.fundamentals.revenueGrowthTtmPercent.toFixed(1)}%`);
  if (candidate.fundamentals.netMarginPercent !== null) metrics.push(`net margin of ${candidate.fundamentals.netMarginPercent.toFixed(1)}%`);
  const why = `Swing Up's stored company-fundamentals model compares the latest recorded price of ${money(current)} with base fair value of ${money(target)}.${metrics.length ? ` Its inputs include ${metrics.join(" and ")}.` : ""} This is a valuation-screen finding; no new news catalyst has been verified.`;
  const expected = action === "watch_out_research"
    ? `The scenario to monitor is weaker business performance or a valuation reset. Base value is ${money(target)}, but it is conditional on the model's assumptions. Reaching it from this price would mean a ${gap}% ${direction}; neither that move nor its timing is established.`
    : `If the model's assumptions hold and the market reprices toward base value, the implied move is a ${gap}% ${direction} to ${money(target)}. The stock can move away from that estimate. No catalyst or time horizon has been established.`;
  // Source reasons can contain old prices or unsupported causal language. Never repeat them as news.
  const risk = `Model risk score: ${candidate.scores.risk ?? "unavailable"}/100 (higher means more risk). Fundamentals may lag. Fair value depends on assumptions and does not predict a trade outcome. Review filings, liquidity and downside before acting.`;
  return {
    version: 1, ticker: candidate.ticker, company: candidate.company, currency: "USD", action,
    label: LABELS[action], title: titles[action], why, expected, risk,
    currentPrice: current, targetPrice: target, low: candidate.fairValue.conservative!, high: candidate.fairValue.optimistic!,
    confidence: candidate.scores.fairValueConfidence!, riskScore: candidate.scores.risk, evidenceScore: candidate.scores.evidence,
    priceObservedAt: candidate.priceObservedAt, observedAt: candidate.observedAt, capturedAt: now.toISOString(),
    eventKind: "valuation_screen", eventAt: null, horizon: null,
    sources: candidate.links, methods: candidate.valuationMethods.map((method) => `${method.method}: ${method.assumption}`),
    publicationStatus: candidate.publicationStatus ?? "provisional_alert", userAlertEligible: candidate.userAlertEligible === true, committeeApproved: candidate.committeeApproved === true,
    companyDoes: candidate.explanation?.companyDoes, whatHappened: candidate.explanation?.whatHappened, committeeStatus: candidate.committeeStatus,
    outlook: candidate.outlook,
  };
}
export function publicBaseUrl() {
  const value = process.env.APP_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || "https://swing-up-production.up.railway.app";
  const url = new URL(value);
  if (process.env.NODE_ENV === "production" && url.protocol !== "https:") throw new Error("Public image URL requires HTTPS");
  return url.origin;
}
export function captionFor(snapshot: ResearchSnapshot, channel: Channel, id: string, baseUrl: string) {
  const url = `${baseUrl}/go/${channel}/${id}`;
  if (channel === "x") {
    // Required context is also on the attached card and linked permanent research page.
    const copy = `$${snapshot.ticker} | ${snapshot.label}\nRecorded ${money(snapshot.currentPrice)} · Model target ${money(snapshot.targetPrice)}\nConfidence ${snapshot.confidence}/100 (not profit odds).\nProvisional. Context + early access: ${url}`;
    if (copy.replace(url, "x".repeat(23)).length > 280) throw new Error("X caption exceeds its standard limit");
    return copy;
  }
  const copy = `${snapshot.label.toUpperCase()} · ${snapshot.company} ($${snapshot.ticker})\n${snapshot.title}\n\nLatest recorded price: ${money(snapshot.currentPrice)} USD\nModel target: ${money(snapshot.targetPrice)} | Range: ${money(snapshot.low)}–${money(snapshot.high)}\nPrice collected: ${timestamp(snapshot.priceObservedAt)}\nScreen observed: ${timestamp(snapshot.observedAt)}\nNews event timestamp: not established\n\nWHAT THE COMPANY DOES\n${snapshot.companyDoes ?? "The company profile is still being verified."}\n\nWHY\n${snapshot.why}\n\nWHAT TO WATCH NEXT\n${snapshot.expected}\n\nModel confidence: ${snapshot.confidence}/100 — not the probability of profit.\n${snapshot.risk}\n\nJoin early-bird access for full research context when Swing Up launches: ${url}${channel === "instagram" ? "\nUse the link in our bio → select this ticker." : ""}\n\n${BRAND_LINE}\nProvisional research. Not personalized financial advice. No guaranteed returns. #SwingUp #StockResearch`;
  if (copy.length > (channel === "instagram" ? 2200 : 5000)) throw new Error("Caption exceeds channel limit");
  return copy;
}
