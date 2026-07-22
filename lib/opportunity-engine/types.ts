export type OpportunityPath = "foundation" | "event";

export type CandidateBucket =
  | "advance_to_deeper_work"
  | "valuation_or_expectations_gated"
  | "exposure_not_yet_proven"
  | "deprioritized_or_reject";

export type ThesisStatus =
  | "untested"
  | "strengthening"
  | "intact"
  | "watch"
  | "impaired"
  | "broken";

export type SecurityReadiness =
  | "ready"
  | "conditional"
  | "wait_for_price"
  | "wait_for_proof"
  | "not_decision_grade";

export type OpportunityAlertType =
  | "new_opportunity"
  | "price_opportunity"
  | "thesis_strengthening"
  | "catalyst_alert"
  | "risk_warning"
  | "thesis_broken"
  | "wait_for_proof"
  | "no_action";

export type SeriousSignalAction = "buy" | "sell" | "watch_out" | "watch" | "no_action";
export type ConfidenceKind = "evidence_only" | "historically_calibrated";
export type PillarStatus = "confirming" | "neutral" | "warning" | "impaired" | "untested";
export type EvidenceDirection = "confirming" | "disconfirming" | "neutral";
export type EvidenceReliability = "official" | "high" | "medium" | "low" | "unknown";

export type SourceReceipt = {
  source: string;
  url: string | null;
  observedAt: string | null;
  reliability: EvidenceReliability;
  fields?: string[];
};

export type FoundationMetrics = {
  revenueGrowthYoY: number | null;
  priorRevenueGrowthYoY: number | null;
  operatingMargin: number | null;
  priorOperatingMargin: number | null;
  netMargin: number | null;
  freeCashFlowMargin: number | null;
  cashToLiabilities: number | null;
  debtToAssets: number | null;
  sharesGrowthYoY: number | null;
  returnOnAssets: number | null;
};

export type ValuationMetrics = {
  marketCap: number | null;
  priceToSales: number | null;
  priceToEarnings: number | null;
  freeCashFlowYield: number | null;
  forwardPriceToEarnings: number | null;
  enterpriseValueToRevenue?: number | null;
  priceToFreeCashFlow?: number | null;
};

export type MarketMetrics = {
  currentPrice: number | null;
  priceChange1d: number | null;
  priceChange20d: number | null;
  priceChange90d: number | null;
  volumeRatio: number | null;
  priceObservedAt: string | null;
  secondSourcePrice?: number | null;
  secondSourceObservedAt?: string | null;
  priceSourceCount?: number;
  priceAgreementPercent?: number | null;
  benchmarkReturn20d?: number | null;
  relativeStrength20d?: number | null;
  volatility20d?: number | null;
  drawdown90d?: number | null;
  marketRegime?: "risk_on" | "neutral" | "risk_off" | "unknown";
};

export type ExpectationsMetrics = {
  analystRevisionScore: number | null;
  earningsSurprisePercent: number | null;
  consensusRevenueGrowthPercent: number | null;
  consensusEpsGrowthPercent?: number | null;
  targetPriceConsensus?: number | null;
  targetPriceMedian?: number | null;
  targetPriceHigh?: number | null;
  targetPriceLow?: number | null;
  analystCount?: number | null;
  strongBuyCount?: number | null;
  buyCount?: number | null;
  holdCount?: number | null;
  sellCount?: number | null;
  strongSellCount?: number | null;
  observedAt?: string | null;
  sources?: string[];
  providerAgreementScore?: number | null;
};

export type CatalystContext = {
  description: string | null;
  expectedAt: string | null;
  confidence: number | null;
};

export type DataQualityContext = {
  marketAgeDays: number | null;
  financialPeriodAgeDays: number | null;
  filingAgeDays: number | null;
  independentPriceSources: number;
  independentFundamentalSources: number;
  independentExpectationSources: number;
  contradictionCount: number;
  staleFields: string[];
  providerErrors: string[];
  sourceAgreementPercent: number | null;
};

export type CalibrationEvidence = {
  horizonDays: 1 | 3 | 7 | 30 | 90;
  sampleSize: number;
  wins: number;
  losses: number;
  precision: number | null;
  lowerConfidenceBound: number | null;
  asOf: string | null;
  source: string;
  successDefinition: string;
};

export type PriceTargetScenario = {
  currentPrice: number | null;
  bearPrice: number | null;
  basePrice: number | null;
  bullPrice: number | null;
  consensusPrice: number | null;
  expectedPrice: number | null;
  upsidePercent: number | null;
  downsidePercent: number | null;
  rewardRiskRatio: number | null;
  horizonDays: number;
  method: "provider_consensus" | "provider_and_fundamental_blend" | "fundamental_screen" | "unavailable";
  sourcePosture: "source_derived" | "screen_grade" | "unavailable";
  assumptions: string[];
};

export type ConfidenceBreakdown = {
  dataQuality: number;
  freshness: number;
  sourceAgreement: number;
  completeness: number;
  calibration: number;
  scenario: number;
  overall: number;
  kind: ConfidenceKind;
  seriousSignalEligible: boolean;
  calibrationSampleSize: number;
  confidenceCaps: string[];
};

export type CompanyFoundationInput = {
  ticker: string;
  company: string;
  sector: string | null;
  industry: string | null;
  observedAt: string;
  fiscalPeriod: string | null;
  metrics: FoundationMetrics;
  valuation: ValuationMetrics;
  market: MarketMetrics;
  expectations: ExpectationsMetrics;
  catalyst: CatalystContext;
  receipts: SourceReceipt[];
  missingFields: string[];
  warnings: string[];
  dataQuality?: DataQualityContext;
  calibration?: CalibrationEvidence | null;
  contradictions?: string[];
  raw?: Record<string, unknown>;
};

export type FoundationScoreBreakdown = {
  businessQuality: number;
  financialMomentum: number;
  valuationSupport: number;
  expectationsGap: number;
  timingQuality: number;
  evidenceConfidence: number;
  riskScore: number;
  opportunityScore: number;
};

export type ThesisPillar = {
  id: "growth" | "margins" | "cash_conversion" | "balance_sheet" | "valuation" | "expectations" | "catalyst";
  label: string;
  status: PillarStatus;
  baseline: string;
  nextTest: string;
  confirmCondition: string;
  warningCondition: string;
  breakCondition: string;
};

export type EvidenceItem = {
  path: OpportunityPath;
  direction: EvidenceDirection;
  pillar: ThesisPillar["id"] | "governance" | "legal_regulatory" | "other";
  sourceName: string;
  sourceUrl: string | null;
  rawSignalId: string | null;
  observedAt: string;
  summary: string;
  reliability: EvidenceReliability;
  payload: Record<string, unknown>;
};

export type FoundationDecision = {
  path: "foundation";
  ticker: string;
  company: string;
  evaluatedAt: string;
  candidateBucket: CandidateBucket;
  thesisStatus: ThesisStatus;
  securityReadiness: SecurityReadiness;
  alertType: OpportunityAlertType;
  signalAction: SeriousSignalAction;
  seriousSignal: boolean;
  userAlertEligible: boolean;
  abstained: boolean;
  horizonDays: number;
  scores: FoundationScoreBreakdown;
  confidence: ConfidenceBreakdown;
  priceTarget: PriceTargetScenario;
  confidenceExplanation: string[];
  actionability: string;
  variantWedge: string;
  whyNow: string;
  firstRejection: string;
  whatWouldMakeInvestable: string[];
  killCriteria: string[];
  blockedReasons: string[];
  pillars: ThesisPillar[];
  evidence: EvidenceItem[];
  nextWorkflow: string;
  input: CompanyFoundationInput;
};

export type EventSignalInput = {
  rawSignalId: string | null;
  ticker: string;
  signalType: string;
  title: string;
  summary: string;
  source: string;
  sourceUrl: string | null;
  receivedAt: string;
  importanceHint: string;
  payload: Record<string, unknown>;
};

export type StoredThesisSnapshot = {
  id: string | null;
  ticker: string;
  company: string;
  companyStatus: ThesisStatus;
  securityReadiness: SecurityReadiness;
  candidateBucket: CandidateBucket;
  opportunityScore: number;
  evidenceConfidence: number;
  riskScore: number;
  signalAction?: SeriousSignalAction;
  confidence?: ConfidenceBreakdown | null;
  originalUnderwriting: FoundationDecision | null;
  currentAssessment: FoundationDecision | EventDecision | null;
  updatedAt: string | null;
};

export type EventImpact = {
  direction: EvidenceDirection;
  severity: "low" | "medium" | "high" | "critical";
  score: number;
  evidenceConfidence: number;
  linkedPillars: EvidenceItem["pillar"][];
  matchedPositiveSignals: string[];
  matchedNegativeSignals: string[];
  pricedInRisk: "low" | "medium" | "high" | "unknown";
};

export type EventDecision = {
  path: "event";
  ticker: string;
  company: string;
  evaluatedAt: string;
  alertType: OpportunityAlertType;
  signalAction: SeriousSignalAction;
  seriousSignal: boolean;
  userAlertEligible: boolean;
  abstained: boolean;
  horizonDays: number;
  candidateBucket: CandidateBucket;
  thesisStatusBefore: ThesisStatus;
  thesisStatusAfter: ThesisStatus;
  securityReadinessBefore: SecurityReadiness;
  securityReadinessAfter: SecurityReadiness;
  impact: EventImpact;
  confidence: ConfidenceBreakdown;
  confidenceExplanation: string[];
  thesisDelta: string;
  firstRejection: string;
  requiredFollowUp: string[];
  blockedReasons: string[];
  evidence: EvidenceItem[];
  nextWorkflow: string;
  event: EventSignalInput;
};

export type CombinedEngineMode = "foundation" | "events" | "combined";

export type CombinedEngineOptions = {
  mode: CombinedEngineMode;
  dryRun: boolean;
  confirmRun: boolean;
  tickers: string[];
  maxTickers: number;
  maxEventsPerTicker: number;
  eventWindowHours: number;
  allowLiveFetch: boolean;
  providedCompanies: CompanyFoundationInput[];
  now?: Date;
};

export type CombinedEngineResult = {
  ok: boolean;
  mode: CombinedEngineMode;
  dryRun: boolean;
  confirmRun: boolean;
  checkedAt: string;
  tickersRequested: string[];
  tickersChecked: string[];
  foundationDecisions: FoundationDecision[];
  eventDecisions: EventDecision[];
  summary: {
    foundationChecked: number;
    eventsChecked: number;
    advanceCount: number;
    gatedCount: number;
    proofNeededCount: number;
    rejectedCount: number;
    alertEligibleCount: number;
    seriousSignalCount: number;
    buySignalCount: number;
    sellSignalCount: number;
    watchOutSignalCount: number;
    thesisStrengtheningCount: number;
    riskWarningCount: number;
    thesisBrokenCount: number;
    errors: string[];
  };
  safety: {
    databaseWrites: boolean;
    alertPublishing: false;
    notifications: false;
    openAiCalled: false;
  };
};
