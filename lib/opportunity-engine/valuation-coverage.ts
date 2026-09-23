import type { UsValueCompanyAnalysis } from "@/lib/opportunity-engine/us-value-investing-engine";
import { hasNegativeEarnings } from "@/lib/valuation-availability";

export const VALUATION_MODEL_REVISION = 3;
export type ValuationCoverageAssessment = {
  status: "fundamental_estimate" | "peer_comparison" | "needs_validation" | "missing_inputs" | "specialist_inputs" | "non_positive_earnings_and_cashflow" | "negative_earnings_deferred";
  missingInputs: string[];
  warnings: string[];
  peerTickers?: string[];
  peerCount?: number;
};
const positive = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;
const round = (n: number) => Math.round(n * 100) / 100;
const specialist = (item: UsValueCompanyAnalysis) => /\b(finance|financial|banks?|insurance|real estate|reit|utility|utilities)\b/i.test(`${item.sector ?? ""} ${item.industry ?? ""}`);
const issuerKey = (item: UsValueCompanyAnalysis) => item.company.toLowerCase().replace(/\s+class\s+[a-z]\b.*$/, "").replace(/[^a-z0-9]/g, "");

export function assessValuationCoverage(item: UsValueCompanyAnalysis): ValuationCoverageAssessment {
  if (item.valuationCoverage?.status === "peer_comparison") return item.valuationCoverage;
  const values = item.fairValue.methods.filter(method => positive(method.value));
  const missingInputs = [
    ...(!item.currency ? ["valuation_currency"] : []),
    ...(item.fundamentals.dilutedEpsTtm === null ? ["diluted_earnings_per_share"] : []),
    ...(item.fundamentals.freeCashFlow === null ? ["free_cash_flow"] : []),
    ...(!positive(item.marketCap) ? ["share_count_or_market_cap"] : []),
  ];
  if (positive(item.fairValue.baseValue)) {
    const extremes = item.fairValue.baseValue < item.currentPrice * 0.2 || item.fairValue.baseValue > item.currentPrice * 5;
    return { status: extremes || values.length < 2 ? "needs_validation" : "fundamental_estimate", missingInputs,
      warnings: [
        ...(extremes ? ["The calculated value is far from the share price. Verify share units, currency, recent capital changes and sustainable earnings before using the gap."] : []),
        ...(values.length < 2 ? ["Only one valuation method is supported; independent corroboration is still needed."] : []),
      ] };
  }
  if (hasNegativeEarnings(item.fundamentals)) return { status: "negative_earnings_deferred", missingInputs,
    warnings: ["Earnings are negative and this model has no supported fair value. Recheck on the normal financial refresh; event-triggered opportunities remain eligible for review."] };
  return { status: specialist(item) ? "specialist_inputs"
    : missingInputs.length ? "missing_inputs" : "non_positive_earnings_and_cashflow", missingInputs,
    warnings: ["A supported value could not yet be calculated. An analyst target or the market price is not substituted for fair value."] };
}

function quantile(sorted: number[], p: number) {
  const at = (sorted.length - 1) * p, low = Math.floor(at);
  return sorted[low] + (sorted[Math.ceil(at)] - sorted[low]) * (at - low);
}

/** Uses the already collected universe: no provider calls, forecasts or invented margins. */
export function completeValuationCoverage(items: UsValueCompanyAnalysis[]): UsValueCompanyAnalysis[] {
  return items.map(item => {
    let result = item;
    const f = item.fundamentals;
    if (!positive(item.fairValue.baseValue) && !hasNegativeEarnings(f) && !specialist(item) && item.currency === "USD"
      && item.industry && positive(item.currentPrice) && positive(item.valuation.priceToSales)
      && (f.revenue ?? 0) >= 50_000_000 && positive(f.grossMarginPercent)
      && f.revenueGrowthTtmPercent !== null && Number.isFinite(f.revenueGrowthTtmPercent)) {
      const peers = [...new Map(items.filter(peer => peer.ticker !== item.ticker && issuerKey(peer) !== issuerKey(item)
        && peer.industry === item.industry && peer.currency === item.currency && peer.observedAt === item.observedAt
        && positive(peer.valuation.priceToSales) && (peer.marketCap ?? 0) >= 500_000_000
        && positive(peer.fundamentals.netIncome) && positive(peer.fundamentals.freeCashFlow)
        && positive(peer.fundamentals.grossMarginPercent) && peer.fundamentals.revenueGrowthTtmPercent !== null
        && Math.abs(peer.fundamentals.grossMarginPercent - f.grossMarginPercent!) <= 20
        && Math.abs(peer.fundamentals.revenueGrowthTtmPercent - f.revenueGrowthTtmPercent!) <= 25)
        .map(peer => [issuerKey(peer), peer])).values()];
      if (peers.length >= 8) {
        const multiples = peers.map(peer => peer.valuation.priceToSales!).sort((a, b) => a - b);
        // Price divided by the provider's price/sales ratio gives sales per
        // listed share in the same quote currency, avoiding an ADR share mix.
        const salesPerShare = item.currentPrice / item.valuation.priceToSales;
        const [low, base, high] = [0.25, 0.5, 0.75].map(p => round(salesPerShare * quantile(multiples, p)));
        if ([low, base, high].every(positive)) {
          const warning = "This is a comparison with profitable industry peers, not a proven earnings value. Losses, cash burn, dilution or weaker products can justify a lower price.";
          result = { ...item, scores: { ...item.scores, fairValueConfidence: Math.min(55, item.scores.fairValueConfidence) },
            fairValue: { methods: [{ method: "industry_sales_comparison", value: base,
              assumption: `Same-industry sales multiples from ${peers.length} profitable cash-generating issuers with similar gross margins and revenue growth; quartiles define the range.` }],
            conservativeValue: low, baseValue: base, optimisticValue: high, buyBelowPrice: null, strongBuyBelowPrice: null,
            trimAbovePrice: null, upsideToBasePercent: round((base / item.currentPrice - 1) * 100),
            discountToBasePercent: round((1 - item.currentPrice / base) * 100), marginOfSafetyPercent: null },
            valuationCoverage: { status: "peer_comparison", missingInputs: [], warnings: [warning],
              peerCount: peers.length, peerTickers: peers.map(peer => peer.ticker).sort() },
            decision: { ...item.decision, action: "no_action", tier: "research_only", seriousSignal: false,
              userAlertEligible: false, publicationStatus: "research_only", evidenceTriggered: false,
              reasons: ["An industry comparison provides an initial valuation range for further research."], blockers: [warning, "Independent valuation and company-specific evidence are still required."] } };
        }
      }
    }
    return { ...result, valuationCoverage: assessValuationCoverage(result) };
  });
}

export function valuationCoverageSummary(items: UsValueCompanyAnalysis[]) {
  const counts: Record<string, number> = {}, missingInputs: Record<string, number> = {};
  for (const item of items) {
    const assessment = item.valuationCoverage ?? assessValuationCoverage(item);
    counts[assessment.status] = (counts[assessment.status] ?? 0) + 1;
    if (!positive(item.fairValue.baseValue)) for (const field of assessment.missingInputs) missingInputs[field] = (missingInputs[field] ?? 0) + 1;
  }
  return { modelRevision: VALUATION_MODEL_REVISION, counts, missingInputs };
}
