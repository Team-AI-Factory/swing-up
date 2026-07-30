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
  | "financing_proposal"
  | "regulatory_advisory"
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
  responseTimeMs?: number | null;
  cacheAgeMs?: number | null;
  consecutiveFailures?: number;
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
  marketSession?: "pre_market" | "regular" | "post_market" | "latest_close" | "halted" | "unknown";
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

export type EventMagnitudeMetric = {
  kind: "contract_value" | "offering_value" | "offering_shares" | "dilution_percent" | "guidance_change_percent" | "fine_value" | "transaction_value";
  value: number;
  unit: "USD" | "shares" | "percent";
  sourceReceiptId: string;
  sourceUrl: string;
  sourcePublisher?: string;
  primarySource?: boolean;
  corroboratingPublishers?: number;
  promotionEvidenceVerified?: boolean;
  evidenceText: string;
  /** Present when the event text explicitly states a multi-year term. */
  termYears?: number | null;
  /** Status words captured from the same evidence construction. */
  eventStatus?: "committed" | "priced" | "completed" | "proposed" | "ceiling" | "secondary" | "final" | null;
};

export type EventMagnitudeEvidence = {
  status:
    | "not_required"
    | "unquantified"
    | "absolute_only"
    | "relative_to_company"
    | "verified_material"
    | "verified_below_threshold"
    | "non_actionable_status";
  metrics: EventMagnitudeMetric[];
  relativeToCompany: {
    metric: "annual_revenue" | "shares_outstanding";
    eventValue: number;
    eventMetricSourceReceiptId?: string;
    companyValue: number;
    ratioPercent: number;
    sourceUrl: string;
  } | null;
  materialityBasis: string;
};

export type CausalExposureEvidence = {
  status: "direct_issuer" | "event_specific" | "generic_sector_proxy";
  exposureType: "direct" | "customer" | "supplier" | "geography" | "commodity" | "policy" | "sector_proxy";
  confidence: number;
  evidenceText: string;
  sourceUrl: string;
  eligibleForSeriousSignal: boolean;
  sourceReceiptId?: string;
  publisher?: string;
  publishedAt?: string;
  expiresAt?: string | null;
  sensitivityDirection?: "upside" | "downside" | null;
};

export type ImpactCandidate = {
  ticker: string;
  company: string;
  cik: string | null;
  rootEventKey: string;
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
  causalExposure: CausalExposureEvidence;
  eventMagnitude: EventMagnitudeEvidence;
  falsifiers: string[];
  timeHorizon: string;
  score: number;
  gateChecks: Record<string, boolean>;
  gatePassed: boolean;
  trackingDisposition: "qualified" | "shadow_near_miss" | "rejected";
  failedGateChecks: string[];
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
