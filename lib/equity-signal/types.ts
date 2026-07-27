import type { BranchNewsChannel } from "@/lib/branch-signal-lab-policy";
import type { HistoricalAnalogAnalysis } from "@/lib/equity-signal/historical-analogs";

export type ProviderStatus = "connected" | "not_due" | "rate_limited" | "temporarily_unavailable" | "not_configured" | "not_entitled" | "failed";
export type EventDirection = "upside" | "downside" | "mixed" | "unknown";
export type EventFamily =
  | "earnings_guidance"
  | "product_launch"
  | "technology_breakthrough"
  | "ai_breakthrough"
  | "merger_acquisition"
  | "contract_award"
  | "regulatory_approval"
  | "regulatory_enforcement"
  | "financing_dilution"
  | "insider_ownership"
  | "leadership_change"
  | "cyber_incident"
  | "supply_chain"
  | "macro_rates"
  | "macro_inflation"
  | "macro_employment"
  | "fiscal_policy"
  | "geopolitical_conflict"
  | "sanctions_trade"
  | "energy_commodity"
  | "government_announcement"
  | "live_conference"
  | "trading_halt"
  | "other_material";

export type EventReceipt = {
  id: string;
  title: string;
  summary: string | null;
  url: string;
  publisher: string;
  publishedAt: string;
  channel: BranchNewsChannel;
  official: boolean;
  primarySource: boolean;
  scheduled: boolean;
  symbolHints: string[];
  companyHints: string[];
  rawEventType: string | null;
};

export type ProviderResult = {
  provider: string;
  status: ProviderStatus;
  checkedAt: string | null;
  nextRetryAt: string | null;
  sourceUrls: string[];
  receipts: EventReceipt[];
  recordsRead: number;
  error: string | null;
  entitlementVerified: boolean;
  cached: boolean;
};

export type MarketQuote = {
  ticker: string;
  price: number;
  previousClose: number | null;
  changePercent: number | null;
  volume: number | null;
  averageVolume: number | null;
  marketCap: number | null;
  observedAt: string;
  source: string;
  delayedMinutes: number | null;
};

export type MacroSeriesSnapshot = {
  seriesId: string;
  label: string;
  latestDate: string | null;
  value: number | null;
  previousValue: number | null;
  change: number | null;
  changePercentile: number | null;
  changeZScore: number | null;
  observationCount: number;
  sourceUrl: string;
};

export type MacroContext = {
  checkedAt: string;
  status: "connected" | "partial" | "failed";
  series: MacroSeriesSnapshot[];
  regime: string[];
  historicalComparisonAvailable: boolean;
  errors: string[];
};

export type ImpactCandidate = {
  ticker: string;
  company: string;
  cik: string | null;
  eventFamily: EventFamily;
  direction: Exclude<EventDirection, "mixed" | "unknown">;
  relationship: "direct" | "second_order" | "third_order";
  eventHeadline: string;
  whatHappened: string;
  eventObservedAt: string;
  receipts: EventReceipt[];
  primarySource: boolean;
  independentPublishers: number;
  mappingConfidence: number;
  eventTruth: number;
  materiality: number;
  transmissionConfidence: number;
  historicalSupport: number;
  evidenceIndependence: number;
  contradictionPenalty: number;
  pricedInPenalty: number;
  rumour: boolean;
  causalChain: string[];
  falsifiers: string[];
  timeHorizon: string;
  score: number;
  gateChecks: Record<string, boolean>;
  gatePassed: boolean;
  quote: MarketQuote | null;
  fundamentals: {
    available: boolean;
    sourceUrl: string | null;
    checkedAt: string | null;
    latestFiledAt: string | null;
    fiscalPeriodEnd: string | null;
    items: Array<{ metric: string; value: number; unit: string; filedAt: string | null; periodEnd: string | null; form: string | null }>;
    error: string | null;
  } | null;
  historicalAnalog: HistoricalAnalogAnalysis & { source: string };
  priceForecast: {
    status: "insufficient_history" | "provisional" | "calibrating" | "calibrated";
    horizon: string | null;
    probabilityDirectionCorrectPercent: number | null;
    sampleSize: number;
    medianReturnPercent: number | null;
    pessimisticReturnPercent: number | null;
    optimisticReturnPercent: number | null;
    medianPrice: number | null;
    lowPrice: number | null;
    highPrice: number | null;
    forecastExpiresAt: string | null;
    basedOnMarketRelativeOutcomes: boolean;
    warning: string;
  };
};
