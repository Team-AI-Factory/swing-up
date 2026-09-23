import { negativeEarningsEvidence, type NegativeEarningsEvidence } from "@/lib/valuation-availability";

type Json = Record<string, unknown>;
const object = (value: unknown): Json => value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
const positive = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
const round = (value: number) => Math.round(value * 100) / 100;

export type PriceOutlook = {
  fairValueUnavailable?: NegativeEarningsEvidence;
  currency: string | null;
  currentPrice: number | null;
  basis: "valuation" | "historical_scenarios" | "unavailable";
  conservative: { price: number | null; changePercent: number | null };
  base: { price: number | null; changePercent: number | null };
  optimistic: { price: number | null; changePercent: number | null };
  upsidePercent: number | null;
  downsidePercent: number | null;
  potentialPercent: number | null;
  horizon: string;
  horizonBasis: "historical_scenarios" | "assessment_window" | "unavailable";
  assessmentWindow: string | null;
};

export function signalAction(value: unknown) {
  const action = String(value ?? "").replace(/_research$/, "");
  return action === "upside" ? "buy" : action === "downside" ? "sell" : action;
}

const windows: Record<string, string> = {
  "6_to_24_months": "6–24 months",
  "hours_to_10_trading_days": "Hours to 10 trading days",
  "1_to_20_trading_days": "1–20 trading days",
};

/** Keep value estimates, historical scenarios and assessment windows distinct. */
export function buildPriceOutlook(input: {
  currentPrice?: unknown; currency?: unknown; action?: unknown;
  conservative?: unknown; base?: unknown; optimistic?: unknown;
  basis?: PriceOutlook["basis"]; timeHorizon?: unknown; forecastHorizon?: unknown;
}): PriceOutlook {
  const currentPrice = positive(input.currentPrice);
  let low = positive(input.conservative), base = positive(input.base), high = positive(input.optimistic);
  // Corrupt/reversed ranges cannot create an apparently attractive return.
  if ((low !== null && base !== null && low > base) || (base !== null && high !== null && base > high) || (low !== null && high !== null && low > high)) {
    low = null; base = null; high = null;
  }
  const scenario = (price: number | null) => ({ price, changePercent: price !== null && currentPrice !== null ? round((price / currentPrice - 1) * 100) : null });
  const conservative = scenario(low), central = scenario(base), optimistic = scenario(high);
  const action = signalAction(input.action);
  const move = central.changePercent;
  const potential = move === null ? null : action === "buy" ? move : action === "sell" ? -move : null;
  const basis = [low, base, high].some(value => value !== null) ? input.basis ?? "valuation" : "unavailable";
  const assessmentWindow = windows[String(input.timeHorizon)] ?? (basis === "valuation" ? windows["6_to_24_months"] : null);
  const forecastDays = basis === "historical_scenarios" && /^(1|3|7|30|90)D$/.test(String(input.forecastHorizon)) ? Number(String(input.forecastHorizon).slice(0, -1)) : null;
  return {
    currency: typeof input.currency === "string" && /^[A-Z]{3}$/.test(input.currency) ? input.currency : null,
    currentPrice, basis, conservative, base: central, optimistic,
    upsidePercent: optimistic.changePercent !== null && optimistic.changePercent > 0 ? optimistic.changePercent : null,
    downsidePercent: conservative.changePercent !== null && conservative.changePercent < 0 ? conservative.changePercent : null,
    potentialPercent: potential !== null && potential > 0 ? round(potential) : null,
    horizon: forecastDays ? `${forecastDays} calendar day${forecastDays === 1 ? "" : "s"} from the price observation` : basis === "valuation" ? "6–24 months · model assessment window; target date unconfirmed" : "Target timing not yet estimated",
    horizonBasis: forecastDays ? "historical_scenarios" : basis === "valuation" ? "assessment_window" : "unavailable",
    assessmentWindow,
  };
}

export function candidatePriceOutlook(candidate: Json, analysis?: Json, now = new Date()): PriceOutlook {
  const forecast = object(candidate.priceForecast), fair = object(analysis?.fairValue ?? candidate.valuationRange);
  const forecastReady = ["provisional", "calibrating", "calibrated"].includes(String(forecast.status))
    && [forecast.lowPrice, forecast.medianPrice, forecast.highPrice].every(value => positive(value) !== null);
  const outlook = buildPriceOutlook({
    currentPrice: object(candidate.quote).price ?? candidate.price, currency: analysis?.currency ?? candidate.currency,
    action: candidate.direction, timeHorizon: candidate.timeHorizon,
    conservative: forecastReady ? forecast.lowPrice : fair.conservativeValue,
    base: forecastReady ? forecast.medianPrice : fair.baseValue,
    optimistic: forecastReady ? forecast.highPrice : fair.optimisticValue,
    basis: forecastReady ? "historical_scenarios" : "valuation", forecastHorizon: forecastReady ? forecast.horizon : null,
  });
  const loss = ![fair.conservativeValue, fair.baseValue, fair.optimisticValue].some(value => positive(value) !== null)
    ? negativeEarningsEvidence(candidate, now) : null;
  return loss ? { ...outlook, fairValueUnavailable: loss } : outlook;
}

type Ranked = { action?: unknown; ticker?: unknown; id?: unknown; outlook?: PriceOutlook | null; userAlertEligible?: boolean; committeeStatus?: unknown };
export function compareSignalPotential(left: Ranked, right: Ranked) {
  const active = (row: Ranked) => row.userAlertEligible === false || row.committeeStatus === "rejected" ? 1 : 0;
  const group = (row: Ranked) => ({ buy: 0, sell: 1, watch_out: 2, price_watch: 3 })[signalAction(row.action)] ?? 4;
  const potential = (row: Ranked) => row.outlook?.potentialPercent ?? -1;
  return active(left) - active(right) || group(left) - group(right) || potential(right) - potential(left)
    || String(left.ticker ?? "").localeCompare(String(right.ticker ?? "")) || String(left.id ?? "").localeCompare(String(right.id ?? ""));
}
