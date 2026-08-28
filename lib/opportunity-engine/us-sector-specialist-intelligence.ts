export type SpecialistSectorKind = "bank" | "financial" | "insurer" | "real_estate_reit" | "utility";
export type SpecialistAction = "buy" | "sell" | "watch_out" | "watch" | "research_only";
export type EvidenceSourceType = "regulatory" | "sec_filing" | "company_ir" | "market_data" | "derived" | "analyst_estimate" | "unknown";

export type EvidenceMetric = {
  value: number | null;
  previousValue?: number | null;
  asOf?: string | null;
  sourceType: EvidenceSourceType;
  primarySource: boolean;
  sourceUrl?: string | null;
  estimated?: boolean;
  conflict?: boolean;
};

export type SectorSpecialistBaseline = {
  sectorKind: SpecialistSectorKind;
  ticker: string;
  company: string;
  evidenceScore: number;
  qualityScore: number;
  riskScore: number;
  fairValue: {
    conservativeValue: number | null;
    baseValue: number | null;
    optimisticValue: number | null;
    buyBelowPrice: number | null;
    strongBuyBelowPrice: number | null;
    trimAbovePrice: number | null;
    upsideToBasePercent: number | null;
    conservativeUpsidePercent: number | null;
    premiumToBasePercent: number | null;
    premiumToOptimisticPercent: number | null;
    methodSpreadPercent: number | null;
  };
  decision: {
    action: SpecialistAction;
    foundationPromotionEligible: boolean;
    reasons: string[];
    blockers: string[];
  };
};

export type SectorSpecialistCompany = {
  ticker: string;
  company: string;
  sector: string | null;
  industry: string | null;
  currentPrice: number;
  marketCap: number | null;
  estimatedAverageDollarVolume10d: number | null;
};

export type SpecialistMarketContext = {
  observedAt?: string | null;
  priceChange1dPercent?: number | null;
  priceChange5dPercent?: number | null;
  priceChange20dPercent?: number | null;
  sectorChange1dPercent?: number | null;
  sectorChange5dPercent?: number | null;
  marketChange1dPercent?: number | null;
  marketChange5dPercent?: number | null;
  relativeVolume?: number | null;
  volatility20dPercent?: number | null;
};

export type BankEvidence = {
  tangibleBookValuePerShare?: EvidenceMetric;
  returnOnTangibleCommonEquityPercent?: EvidenceMetric;
  cet1RatioPercent?: EvidenceMetric;
  netInterestMarginPercent?: EvidenceMetric;
  netInterestMarginChangeBps?: EvidenceMetric;
  depositGrowthPercent?: EvidenceMetric;
  loanGrowthPercent?: EvidenceMetric;
  uninsuredDepositPercent?: EvidenceMetric;
  nonInterestBearingDepositPercent?: EvidenceMetric;
  loanToDepositPercent?: EvidenceMetric;
  nonperformingLoanPercent?: EvidenceMetric;
  netChargeOffPercent?: EvidenceMetric;
  allowanceCoveragePercent?: EvidenceMetric;
  commercialRealEstateToCapitalPercent?: EvidenceMetric;
  aociToTangibleEquityPercent?: EvidenceMetric;
};

export type FinancialEvidence = {
  assetsUnderManagementGrowthPercent?: EvidenceMetric;
  netFlowsPercentOfAum?: EvidenceMetric;
  effectiveFeeRateBps?: EvidenceMetric;
  recurringRevenuePercent?: EvidenceMetric;
  clientAssetsGrowthPercent?: EvidenceMetric;
  compensationRatioPercent?: EvidenceMetric;
  operatingMarginPercent?: EvidenceMetric;
  creditLossRatioPercent?: EvidenceMetric;
  netLeverage?: EvidenceMetric;
  regulatoryCapitalRatioPercent?: EvidenceMetric;
};

export type InsurerEvidence = {
  riskBasedCapitalPercent?: EvidenceMetric;
  combinedRatioPercent?: EvidenceMetric;
  lossRatioPercent?: EvidenceMetric;
  premiumGrowthPercent?: EvidenceMetric;
  adverseReserveDevelopmentPercent?: EvidenceMetric;
  investmentYieldPercent?: EvidenceMetric;
  unrealizedLossesToEquityPercent?: EvidenceMetric;
  catastropheLossRatioPercent?: EvidenceMetric;
  statutoryCapitalGrowthPercent?: EvidenceMetric;
};

export type ReitEvidence = {
  ffoPerShare?: EvidenceMetric;
  affoPerShare?: EvidenceMetric;
  ffoGrowthPercent?: EvidenceMetric;
  sameStoreNoiGrowthPercent?: EvidenceMetric;
  occupancyPercent?: EvidenceMetric;
  rentGrowthPercent?: EvidenceMetric;
  navPerShare?: EvidenceMetric;
  impliedCapRatePercent?: EvidenceMetric;
  netDebtToEbitda?: EvidenceMetric;
  fixedRateDebtPercent?: EvidenceMetric;
  weightedAverageDebtRatePercent?: EvidenceMetric;
  weightedAverageDebtMaturityYears?: EvidenceMetric;
  dividendPayoutToAffoPercent?: EvidenceMetric;
};

export type UtilityEvidence = {
  rateBaseGrowthPercent?: EvidenceMetric;
  allowedRoePercent?: EvidenceMetric;
  earnedRoePercent?: EvidenceMetric;
  equityCapitalRatioPercent?: EvidenceMetric;
  interestCoverage?: EvidenceMetric;
  debtToCapitalPercent?: EvidenceMetric;
  regulatoryAssetsToEquityPercent?: EvidenceMetric;
  capexToRateBasePercent?: EvidenceMetric;
  loadGrowthPercent?: EvidenceMetric;
  pendingRateCaseRevenueImpactPercent?: EvidenceMetric;
  dividendPayoutPercent?: EvidenceMetric;
  contingentLiabilityToEquityPercent?: EvidenceMetric;
};

export type SectorEvidence = {
  bank?: BankEvidence;
  financial?: FinancialEvidence;
  insurer?: InsurerEvidence;
  reit?: ReitEvidence;
  utility?: UtilityEvidence;
};

export type SpecialistIntelligenceInput = {
  company: SectorSpecialistCompany;
  baseline: SectorSpecialistBaseline;
  evidence?: SectorEvidence;
  market?: SpecialistMarketContext;
  evaluatedAt?: string;
};

type MetricSpec = {
  key: string;
  metric: EvidenceMetric | undefined;
  critical?: boolean;
};

type SectorAssessment = {
  qualityDelta: number;
  riskDelta: number;
  hardRiskFlags: string[];
  positiveSignals: string[];
  contradictions: string[];
  requiredNextChecks: string[];
  criticalMetrics: MetricSpec[];
  supportingMetrics: MetricSpec[];
};

export type SectorSpecialistIntelligence = {
  version: 2;
  model: "swing_up_us_sector_specialist_intelligence_v2";
  sectorKind: SpecialistSectorKind;
  ticker: string;
  company: string;
  evaluatedAt: string;
  evidence: {
    criticalCoveragePercent: number;
    supportingCoveragePercent: number;
    reliabilityScore: number;
    primaryCriticalMetrics: number;
    staleCriticalMetrics: string[];
    conflictedMetrics: string[];
    decisionGrade: boolean;
  };
  scores: {
    adjustedQuality: number;
    adjustedRisk: number;
    buyOpportunity: number;
    sellOpportunity: number;
    watchOutRisk: number;
    confidence: number;
  };
  movement: {
    classification: "company_specific_selloff" | "company_specific_rally" | "broad_market_move" | "sector_move" | "quiet" | "unknown";
    relativeMove1dPercent: number | null;
    relativeMove5dPercent: number | null;
    abnormal: boolean;
    pricedInRisk: "low" | "medium" | "high" | "unknown";
    opportunityUse: string;
  };
  scenario: {
    bearValue: number | null;
    baseValue: number | null;
    bullValue: number | null;
    downsideToBearPercent: number | null;
    upsideToBasePercent: number | null;
    upsideToBullPercent: number | null;
    upsideDownsideRatio: number | null;
    status: "decision_ready" | "screen_grade" | "insufficient";
  };
  adversarialReview: {
    positiveSignals: string[];
    antiThesis: string[];
    hardRiskFlags: string[];
    contradictions: string[];
    requiredNextChecks: string[];
  };
  decision: {
    action: SpecialistAction;
    foundationPromotionEligible: boolean;
    urgentResearch: boolean;
    opportunityScore: number;
    reasons: string[];
    blockers: string[];
  };
};

const DAY_MS = 24 * 60 * 60_000;

function clamp(value: number, minimum = 0, maximum = 100) {
  return Math.min(maximum, Math.max(minimum, value));
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function sourceWeight(metric: EvidenceMetric) {
  const base: Record<EvidenceSourceType, number> = {
    regulatory: 100,
    sec_filing: 100,
    company_ir: 92,
    market_data: 82,
    derived: 68,
    analyst_estimate: 48,
    unknown: 25,
  };
  let score = base[metric.sourceType];
  if (metric.primarySource) score += 4;
  if (metric.estimated) score -= 18;
  if (metric.conflict) score -= 45;
  return clamp(score);
}

function metricAgeDays(metric: EvidenceMetric, now: Date) {
  const parsed = metric.asOf ? Date.parse(metric.asOf) : Number.NaN;
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, (now.getTime() - parsed) / DAY_MS);
}

function freshnessWeight(metric: EvidenceMetric, now: Date) {
  const age = metricAgeDays(metric, now);
  if (age === null) return 55;
  if (age <= 120) return 100;
  if (age <= 220) return 90;
  if (age <= 400) return 75;
  return 40;
}

function metricUsable(metric: EvidenceMetric | undefined) {
  return Boolean(metric && finite(metric.value) !== null && metric.conflict !== true);
}

function metricReliability(metric: EvidenceMetric | undefined, now: Date) {
  if (!metricUsable(metric) || !metric) return 0;
  return sourceWeight(metric) * 0.65 + freshnessWeight(metric, now) * 0.35;
}

function coverage(specs: MetricSpec[]) {
  if (!specs.length) return 0;
  return Math.round((specs.filter((item) => metricUsable(item.metric)).length / specs.length) * 100);
}

function reliability(specs: MetricSpec[], now: Date) {
  const usable = specs.filter((item) => metricUsable(item.metric));
  if (!usable.length) return 0;
  return Math.round(usable.reduce((sum, item) => sum + metricReliability(item.metric, now), 0) / usable.length);
}

function primaryCount(specs: MetricSpec[]) {
  return specs.filter((item) => metricUsable(item.metric) && item.metric?.primarySource === true).length;
}

function staleKeys(specs: MetricSpec[], now: Date) {
  return specs.flatMap((item) => {
    if (!metricUsable(item.metric) || !item.metric) return [];
    const age = metricAgeDays(item.metric, now);
    return age !== null && age > 400 ? [item.key] : [];
  });
}

function conflictKeys(specs: MetricSpec[]) {
  return specs.filter((item) => item.metric?.conflict === true).map((item) => item.key);
}

function value(metric: EvidenceMetric | undefined) {
  return metricUsable(metric) && metric ? finite(metric.value) : null;
}

function pushIf(target: string[], condition: boolean, message: string) {
  if (condition) target.push(message);
}

function bankAssessment(evidence: BankEvidence = {}): SectorAssessment {
  const quality: number[] = [];
  const risk: number[] = [];
  const positive: string[] = [];
  const hard: string[] = [];
  const contradictions: string[] = [];
  const next: string[] = [];
  const tbv = value(evidence.tangibleBookValuePerShare);
  const rotce = value(evidence.returnOnTangibleCommonEquityPercent);
  const cet1 = value(evidence.cet1RatioPercent);
  const nim = value(evidence.netInterestMarginPercent);
  const nimChange = value(evidence.netInterestMarginChangeBps);
  const depositGrowth = value(evidence.depositGrowthPercent);
  const uninsured = value(evidence.uninsuredDepositPercent);
  const npl = value(evidence.nonperformingLoanPercent);
  const nco = value(evidence.netChargeOffPercent);
  const loanDeposit = value(evidence.loanToDepositPercent);
  const cre = value(evidence.commercialRealEstateToCapitalPercent);
  const aoci = value(evidence.aociToTangibleEquityPercent);

  if (rotce !== null && rotce >= 14) positive.push(`Strong return on tangible common equity (${rotce.toFixed(1)}%).`);
  if (cet1 !== null && cet1 >= 11) positive.push(`CET1 capital buffer appears solid (${cet1.toFixed(1)}%).`);
  if (nimChange !== null && nimChange > 0) positive.push(`Net interest margin is expanding (${nimChange.toFixed(0)} bps).`);
  if (depositGrowth !== null && depositGrowth > 2) positive.push(`Deposits are growing (${depositGrowth.toFixed(1)}%).`);
  if (npl !== null && npl < 1.5) positive.push(`Nonperforming loans remain contained (${npl.toFixed(2)}%).`);

  if (rotce !== null) quality.push(rotce >= 16 ? 12 : rotce >= 11 ? 6 : rotce < 6 ? -12 : 0);
  if (cet1 !== null) risk.push(cet1 < 8 ? 30 : cet1 < 10 ? 15 : cet1 >= 12 ? -8 : 0);
  if (nimChange !== null) quality.push(nimChange >= 15 ? 8 : nimChange <= -25 ? -10 : 0);
  if (depositGrowth !== null) risk.push(depositGrowth <= -8 ? 18 : depositGrowth < 0 ? 8 : -3);
  if (uninsured !== null) risk.push(uninsured >= 50 ? 18 : uninsured >= 35 ? 10 : uninsured <= 20 ? -4 : 0);
  if (npl !== null) risk.push(npl >= 3 ? 20 : npl >= 2 ? 10 : npl < 1 ? -5 : 0);
  if (nco !== null) risk.push(nco >= 2 ? 20 : nco >= 1 ? 10 : nco < 0.5 ? -4 : 0);
  if (loanDeposit !== null) risk.push(loanDeposit >= 110 ? 15 : loanDeposit >= 100 ? 8 : loanDeposit >= 70 && loanDeposit <= 95 ? -4 : 0);
  if (cre !== null) risk.push(cre >= 350 ? 18 : cre >= 250 ? 10 : 0);
  if (aoci !== null) risk.push(aoci <= -40 ? 20 : aoci <= -25 ? 10 : 0);

  if (cet1 !== null && cet1 < 7) hard.push(`CET1 is unusually weak (${cet1.toFixed(1)}%); capital adequacy requires immediate primary-source review.`);
  pushIf(hard, depositGrowth !== null && depositGrowth <= -15 && uninsured !== null && uninsured >= 40, "Rapid deposit shrinkage plus high uninsured-deposit exposure creates acute funding risk.");
  pushIf(hard, npl !== null && npl >= 4 && nco !== null && nco >= 2, "Credit quality is deteriorating across both nonperforming loans and net charge-offs.");
  pushIf(contradictions, nimChange !== null && nimChange > 15 && depositGrowth !== null && depositGrowth < -5, "NIM expansion is accompanied by deposit contraction; the apparent earnings improvement may be funding-driven and fragile.");
  pushIf(contradictions, rotce !== null && rotce >= 14 && cet1 !== null && cet1 < 9, "Strong returns coexist with a thin capital buffer; profitability may be coming with excessive balance-sheet risk.");

  if (tbv === null) next.push("Verify tangible book value per share from the latest filing/IR materials.");
  if (cet1 === null) next.push("Verify CET1 capital and management's capital target/buffer.");
  if (nim === null || nimChange === null) next.push("Verify current NIM, funding cost and sequential NIM trend.");
  if (uninsured === null || depositGrowth === null) next.push("Verify deposit growth, uninsured deposit mix and non-interest-bearing deposit mix.");
  if (npl === null || nco === null) next.push("Verify NPL, criticized assets, net charge-offs and allowance coverage.");
  if (cre === null) next.push("Verify CRE concentration and office/multifamily sub-exposures when material.");

  return {
    qualityDelta: quality.reduce((a, b) => a + b, 0),
    riskDelta: risk.reduce((a, b) => a + b, 0),
    hardRiskFlags: hard,
    positiveSignals: positive,
    contradictions,
    requiredNextChecks: next,
    criticalMetrics: [
      { key: "tangible_book_value_per_share", metric: evidence.tangibleBookValuePerShare, critical: true },
      { key: "return_on_tangible_common_equity", metric: evidence.returnOnTangibleCommonEquityPercent, critical: true },
      { key: "cet1_ratio", metric: evidence.cet1RatioPercent, critical: true },
      { key: "net_interest_margin", metric: evidence.netInterestMarginPercent, critical: true },
      { key: "deposit_growth", metric: evidence.depositGrowthPercent, critical: true },
      { key: "nonperforming_loans", metric: evidence.nonperformingLoanPercent, critical: true },
      { key: "net_charge_offs", metric: evidence.netChargeOffPercent, critical: true },
    ],
    supportingMetrics: [
      { key: "nim_change_bps", metric: evidence.netInterestMarginChangeBps },
      { key: "uninsured_deposits", metric: evidence.uninsuredDepositPercent },
      { key: "non_interest_bearing_deposits", metric: evidence.nonInterestBearingDepositPercent },
      { key: "loan_to_deposit", metric: evidence.loanToDepositPercent },
      { key: "cre_to_capital", metric: evidence.commercialRealEstateToCapitalPercent },
      { key: "aoci_to_tangible_equity", metric: evidence.aociToTangibleEquityPercent },
    ],
  };
}

function financialAssessment(evidence: FinancialEvidence = {}, industry = ""): SectorAssessment {
  const positive: string[] = [];
  const hard: string[] = [];
  const contradictions: string[] = [];
  const next: string[] = [];
  let quality = 0;
  let risk = 0;
  const assetManager = /asset management|investment management|alternative asset|fund manager/i.test(industry);
  const brokerExchange = /broker|exchange|capital market|securities/i.test(industry);
  const specialtyCredit = /credit|consumer finance|mortgage|lending|specialty finance/i.test(industry);
  const aumGrowth = value(evidence.assetsUnderManagementGrowthPercent);
  const flows = value(evidence.netFlowsPercentOfAum);
  const fee = value(evidence.effectiveFeeRateBps);
  const recurring = value(evidence.recurringRevenuePercent);
  const clientGrowth = value(evidence.clientAssetsGrowthPercent);
  const comp = value(evidence.compensationRatioPercent);
  const margin = value(evidence.operatingMarginPercent);
  const creditLoss = value(evidence.creditLossRatioPercent);
  const leverage = value(evidence.netLeverage);
  const capital = value(evidence.regulatoryCapitalRatioPercent);

  if (assetManager) {
    if (aumGrowth !== null) quality += aumGrowth >= 10 ? 10 : aumGrowth < -10 ? -12 : 0;
    if (flows !== null) quality += flows >= 3 ? 12 : flows <= -5 ? -15 : flows < 0 ? -6 : 0;
    if (recurring !== null) quality += recurring >= 70 ? 8 : recurring < 40 ? -8 : 0;
    if (flows !== null && flows > 0) positive.push(`Positive organic net flows (${flows.toFixed(1)}% of AUM).`);
    pushIf(contradictions, aumGrowth !== null && aumGrowth > 10 && flows !== null && flows < 0, "AUM is rising while clients are withdrawing money; market appreciation may be masking franchise weakness.");
  }
  if (brokerExchange) {
    if (clientGrowth !== null) quality += clientGrowth >= 8 ? 10 : clientGrowth < -5 ? -10 : 0;
    if (comp !== null) risk += comp >= 60 ? 10 : comp <= 45 ? -4 : 0;
    if (clientGrowth !== null && clientGrowth > 5) positive.push(`Client assets are growing (${clientGrowth.toFixed(1)}%).`);
  }
  if (specialtyCredit) {
    if (creditLoss !== null) risk += creditLoss >= 5 ? 25 : creditLoss >= 3 ? 12 : creditLoss < 1.5 ? -5 : 0;
    if (capital !== null) risk += capital < 8 ? 20 : capital >= 12 ? -6 : 0;
    if (creditLoss !== null && creditLoss >= 8) hard.push(`Credit-loss ratio is extremely high (${creditLoss.toFixed(1)}%).`);
  }
  if (margin !== null) quality += margin >= 25 ? 8 : margin < 10 ? -8 : 0;
  if (leverage !== null) risk += leverage >= 5 ? 18 : leverage >= 3 ? 8 : leverage <= 1 ? -5 : 0;
  if (fee !== null && assetManager) pushIf(contradictions, fee < 20 && aumGrowth !== null && aumGrowth > 15, "Fast AUM growth is occurring at a low fee rate; revenue growth may lag headline AUM growth.");

  if (assetManager && (aumGrowth === null || flows === null)) next.push("Verify AUM growth, net flows by strategy and fee-rate mix.");
  if (assetManager && fee === null) next.push("Verify effective management fee rate and mix shift between high/low fee products.");
  if (brokerExchange && clientGrowth === null) next.push("Verify client assets/accounts, activity and recurring fee revenue.");
  if (specialtyCredit && creditLoss === null) next.push("Verify delinquency, charge-off and provision trends before directional promotion.");
  if (margin === null) next.push("Verify normalized operating margin and one-time compensation/transaction items.");

  const critical: MetricSpec[] = assetManager
    ? [
        { key: "aum_growth", metric: evidence.assetsUnderManagementGrowthPercent, critical: true },
        { key: "net_flows_percent_of_aum", metric: evidence.netFlowsPercentOfAum, critical: true },
        { key: "effective_fee_rate_bps", metric: evidence.effectiveFeeRateBps, critical: true },
        { key: "operating_margin", metric: evidence.operatingMarginPercent, critical: true },
      ]
    : brokerExchange
      ? [
          { key: "client_assets_growth", metric: evidence.clientAssetsGrowthPercent, critical: true },
          { key: "recurring_revenue", metric: evidence.recurringRevenuePercent, critical: true },
          { key: "compensation_ratio", metric: evidence.compensationRatioPercent, critical: true },
          { key: "operating_margin", metric: evidence.operatingMarginPercent, critical: true },
        ]
      : specialtyCredit
        ? [
            { key: "credit_loss_ratio", metric: evidence.creditLossRatioPercent, critical: true },
            { key: "regulatory_capital_ratio", metric: evidence.regulatoryCapitalRatioPercent, critical: true },
            { key: "net_leverage", metric: evidence.netLeverage, critical: true },
            { key: "operating_margin", metric: evidence.operatingMarginPercent, critical: true },
          ]
        : [
            { key: "operating_margin", metric: evidence.operatingMarginPercent, critical: true },
            { key: "recurring_revenue", metric: evidence.recurringRevenuePercent, critical: true },
            { key: "net_leverage", metric: evidence.netLeverage, critical: true },
          ];

  return {
    qualityDelta: quality,
    riskDelta: risk,
    hardRiskFlags: hard,
    positiveSignals: positive,
    contradictions,
    requiredNextChecks: next,
    criticalMetrics: critical,
    supportingMetrics: [
      { key: "aum_growth", metric: evidence.assetsUnderManagementGrowthPercent },
      { key: "net_flows", metric: evidence.netFlowsPercentOfAum },
      { key: "fee_rate", metric: evidence.effectiveFeeRateBps },
      { key: "client_assets_growth", metric: evidence.clientAssetsGrowthPercent },
      { key: "credit_loss_ratio", metric: evidence.creditLossRatioPercent },
      { key: "regulatory_capital", metric: evidence.regulatoryCapitalRatioPercent },
    ],
  };
}

function insurerAssessment(evidence: InsurerEvidence = {}, industry = ""): SectorAssessment {
  const positive: string[] = [];
  const hard: string[] = [];
  const contradictions: string[] = [];
  const next: string[] = [];
  let quality = 0;
  let risk = 0;
  const pc = /property|casualty|p&c|reinsurance/i.test(industry);
  const rbc = value(evidence.riskBasedCapitalPercent);
  const combined = value(evidence.combinedRatioPercent);
  const premiumGrowth = value(evidence.premiumGrowthPercent);
  const reserve = value(evidence.adverseReserveDevelopmentPercent);
  const yieldValue = value(evidence.investmentYieldPercent);
  const unrealized = value(evidence.unrealizedLossesToEquityPercent);
  const cat = value(evidence.catastropheLossRatioPercent);
  const capitalGrowth = value(evidence.statutoryCapitalGrowthPercent);

  if (rbc !== null) {
    risk += rbc < 200 ? 35 : rbc < 300 ? 15 : rbc >= 400 ? -8 : 0;
    if (rbc >= 400) positive.push(`Risk-based capital is strong (${rbc.toFixed(0)}%).`);
    if (rbc < 200) hard.push(`Risk-based capital is below 200% (${rbc.toFixed(0)}%); this requires immediate solvency review.`);
  }
  if (pc && combined !== null) {
    quality += combined < 95 ? 12 : combined < 100 ? 5 : combined >= 105 ? -15 : -6;
    risk += combined >= 110 ? 20 : combined >= 105 ? 10 : 0;
    if (combined < 95) positive.push(`Underwriting is strongly profitable (combined ratio ${combined.toFixed(1)}%).`);
  }
  if (premiumGrowth !== null) quality += premiumGrowth >= 8 ? 6 : premiumGrowth < -5 ? -8 : 0;
  if (reserve !== null) risk += reserve >= 8 ? 25 : reserve >= 4 ? 12 : reserve <= 0 ? -4 : 0;
  if (unrealized !== null) risk += unrealized >= 35 ? 20 : unrealized >= 20 ? 10 : 0;
  if (cat !== null && pc) risk += cat >= 15 ? 15 : cat >= 8 ? 8 : 0;
  if (capitalGrowth !== null) quality += capitalGrowth >= 8 ? 6 : capitalGrowth <= -10 ? -10 : 0;
  pushIf(contradictions, premiumGrowth !== null && premiumGrowth > 10 && combined !== null && combined > 105, "Premium growth is accelerating while underwriting profitability is poor; growth may be value-destructive.");
  pushIf(contradictions, yieldValue !== null && yieldValue > 5 && unrealized !== null && unrealized > 25, "Higher investment yield is accompanied by large unrealized losses; portfolio income may be hiding balance-sheet sensitivity.");

  if (rbc === null) next.push("Verify latest statutory RBC/capital adequacy and management's target buffer.");
  if (pc && combined === null) next.push("Verify current and prior combined ratio, loss ratio and catastrophe-normalized underwriting result.");
  if (reserve === null) next.push("Verify favorable/adverse reserve development and reserve adequacy commentary.");
  if (unrealized === null) next.push("Verify investment portfolio duration, credit quality and unrealized losses relative to equity.");

  return {
    qualityDelta: quality,
    riskDelta: risk,
    hardRiskFlags: hard,
    positiveSignals: positive,
    contradictions,
    requiredNextChecks: next,
    criticalMetrics: [
      { key: "risk_based_capital", metric: evidence.riskBasedCapitalPercent, critical: true },
      ...(pc ? [{ key: "combined_ratio", metric: evidence.combinedRatioPercent, critical: true } as MetricSpec] : []),
      { key: "premium_growth", metric: evidence.premiumGrowthPercent, critical: true },
      { key: "reserve_development", metric: evidence.adverseReserveDevelopmentPercent, critical: true },
      { key: "unrealized_losses_to_equity", metric: evidence.unrealizedLossesToEquityPercent, critical: true },
    ],
    supportingMetrics: [
      { key: "investment_yield", metric: evidence.investmentYieldPercent },
      { key: "catastrophe_loss_ratio", metric: evidence.catastropheLossRatioPercent },
      { key: "statutory_capital_growth", metric: evidence.statutoryCapitalGrowthPercent },
    ],
  };
}

function reitAssessment(evidence: ReitEvidence = {}): SectorAssessment {
  const positive: string[] = [];
  const hard: string[] = [];
  const contradictions: string[] = [];
  const next: string[] = [];
  let quality = 0;
  let risk = 0;
  const ffo = value(evidence.ffoPerShare);
  const affo = value(evidence.affoPerShare);
  const ffoGrowth = value(evidence.ffoGrowthPercent);
  const noi = value(evidence.sameStoreNoiGrowthPercent);
  const occupancy = value(evidence.occupancyPercent);
  const nav = value(evidence.navPerShare);
  const leverage = value(evidence.netDebtToEbitda);
  const fixed = value(evidence.fixedRateDebtPercent);
  const maturity = value(evidence.weightedAverageDebtMaturityYears);
  const payout = value(evidence.dividendPayoutToAffoPercent);

  if (ffoGrowth !== null) quality += ffoGrowth >= 8 ? 10 : ffoGrowth < -8 ? -12 : 0;
  if (noi !== null) quality += noi >= 4 ? 10 : noi < -3 ? -12 : 0;
  if (occupancy !== null) quality += occupancy >= 95 ? 8 : occupancy < 85 ? -15 : occupancy < 90 ? -8 : 0;
  if (leverage !== null) risk += leverage >= 8 ? 22 : leverage >= 6.5 ? 10 : leverage <= 5 ? -6 : 0;
  if (fixed !== null) risk += fixed < 60 ? 12 : fixed >= 85 ? -5 : 0;
  if (maturity !== null) risk += maturity < 2 ? 15 : maturity >= 5 ? -4 : 0;
  if (payout !== null) risk += payout > 110 ? 18 : payout > 100 ? 10 : payout <= 85 ? -3 : 0;
  if (noi !== null && noi >= 4) positive.push(`Same-store NOI is growing (${noi.toFixed(1)}%).`);
  if (occupancy !== null && occupancy >= 95) positive.push(`Occupancy is high (${occupancy.toFixed(1)}%).`);
  pushIf(hard, leverage !== null && leverage >= 9 && maturity !== null && maturity < 2, "Very high leverage plus near-term debt maturity creates refinancing risk.");
  pushIf(hard, payout !== null && payout > 120 && ffoGrowth !== null && ffoGrowth < 0, "Dividend payout materially exceeds AFFO while FFO is shrinking.");
  pushIf(contradictions, occupancy !== null && occupancy > 94 && noi !== null && noi < -3, "High occupancy is not translating into NOI growth; concessions, expenses or rent pressure may be eroding economics.");
  pushIf(contradictions, nav !== null && nav > 0 && affo !== null && affo > 0 && ffo !== null && ffo > 0 && affo < ffo * 0.7, "AFFO is materially below FFO; recurring capital/leasing costs may make headline FFO look too strong.");

  if (ffo === null && affo === null) next.push("Verify company-reported FFO/AFFO per share and reconciliation to GAAP net income.");
  if (noi === null || occupancy === null) next.push("Verify same-store NOI, occupancy and rent/re-leasing spreads.");
  if (nav === null) next.push("Verify current NAV or property-level NOI/cap-rate inputs rather than relying only on book value.");
  if (leverage === null || fixed === null || maturity === null) next.push("Verify net debt/EBITDA, fixed-rate share, weighted debt cost and maturity ladder.");
  if (payout === null) next.push("Verify dividend payout against AFFO, not GAAP EPS alone.");

  return {
    qualityDelta: quality,
    riskDelta: risk,
    hardRiskFlags: hard,
    positiveSignals: positive,
    contradictions,
    requiredNextChecks: next,
    criticalMetrics: [
      { key: "ffo_or_affo_per_share", metric: evidence.affoPerShare ?? evidence.ffoPerShare, critical: true },
      { key: "same_store_noi_growth", metric: evidence.sameStoreNoiGrowthPercent, critical: true },
      { key: "occupancy", metric: evidence.occupancyPercent, critical: true },
      { key: "net_debt_to_ebitda", metric: evidence.netDebtToEbitda, critical: true },
      { key: "debt_maturity_years", metric: evidence.weightedAverageDebtMaturityYears, critical: true },
      { key: "nav_per_share", metric: evidence.navPerShare, critical: true },
    ],
    supportingMetrics: [
      { key: "ffo_growth", metric: evidence.ffoGrowthPercent },
      { key: "rent_growth", metric: evidence.rentGrowthPercent },
      { key: "implied_cap_rate", metric: evidence.impliedCapRatePercent },
      { key: "fixed_rate_debt", metric: evidence.fixedRateDebtPercent },
      { key: "debt_rate", metric: evidence.weightedAverageDebtRatePercent },
      { key: "affo_payout", metric: evidence.dividendPayoutToAffoPercent },
    ],
  };
}

function utilityAssessment(evidence: UtilityEvidence = {}): SectorAssessment {
  const positive: string[] = [];
  const hard: string[] = [];
  const contradictions: string[] = [];
  const next: string[] = [];
  let quality = 0;
  let risk = 0;
  const rateBaseGrowth = value(evidence.rateBaseGrowthPercent);
  const allowedRoe = value(evidence.allowedRoePercent);
  const earnedRoe = value(evidence.earnedRoePercent);
  const equityRatio = value(evidence.equityCapitalRatioPercent);
  const coverageValue = value(evidence.interestCoverage);
  const debtCapital = value(evidence.debtToCapitalPercent);
  const regAssets = value(evidence.regulatoryAssetsToEquityPercent);
  const loadGrowth = value(evidence.loadGrowthPercent);
  const rateCase = value(evidence.pendingRateCaseRevenueImpactPercent);
  const payout = value(evidence.dividendPayoutPercent);
  const liability = value(evidence.contingentLiabilityToEquityPercent);

  if (rateBaseGrowth !== null) quality += rateBaseGrowth >= 6 ? 10 : rateBaseGrowth < 1 ? -6 : 0;
  if (allowedRoe !== null && earnedRoe !== null) {
    const gap = earnedRoe - allowedRoe;
    quality += gap >= -0.5 ? 8 : gap <= -3 ? -12 : gap <= -1.5 ? -6 : 0;
    risk += gap <= -3 ? 12 : 0;
    if (gap >= -0.5) positive.push(`Earned ROE (${earnedRoe.toFixed(1)}%) is close to or above allowed ROE (${allowedRoe.toFixed(1)}%).`);
  }
  if (equityRatio !== null) risk += equityRatio < 35 ? 15 : equityRatio >= 45 ? -4 : 0;
  if (coverageValue !== null) risk += coverageValue < 1.5 ? 25 : coverageValue < 2 ? 12 : coverageValue >= 3 ? -5 : 0;
  if (debtCapital !== null) risk += debtCapital > 70 ? 18 : debtCapital > 60 ? 8 : 0;
  if (regAssets !== null) risk += regAssets > 100 ? 15 : regAssets > 60 ? 8 : 0;
  if (loadGrowth !== null) quality += loadGrowth >= 3 ? 6 : loadGrowth < -2 ? -7 : 0;
  if (rateCase !== null) quality += rateCase >= 5 ? 5 : rateCase <= -5 ? -8 : 0;
  if (payout !== null) risk += payout > 100 ? 12 : payout > 90 ? 6 : 0;
  if (liability !== null) risk += liability >= 50 ? 30 : liability >= 25 ? 15 : 0;
  if (coverageValue !== null && coverageValue < 1.2) hard.push(`Interest coverage is dangerously weak (${coverageValue.toFixed(2)}x).`);
  if (liability !== null && liability >= 75) hard.push(`Contingent liabilities are very large relative to equity (${liability.toFixed(0)}%).`);
  pushIf(contradictions, rateBaseGrowth !== null && rateBaseGrowth >= 6 && earnedRoe !== null && allowedRoe !== null && earnedRoe < allowedRoe - 2, "Rate base is growing but returns are materially below the allowed ROE; capital spending may not be translating into shareholder economics.");

  if (rateBaseGrowth === null) next.push("Verify rate-base growth and major capital-plan additions by jurisdiction.");
  if (allowedRoe === null || earnedRoe === null) next.push("Verify allowed ROE, earned ROE and the reasons for any regulatory lag.");
  if (equityRatio === null || coverageValue === null) next.push("Verify regulatory capital structure and interest-coverage headroom.");
  if (rateCase === null) next.push("Verify pending rate cases, requested/approved revenue requirement and timing.");
  if (liability === null) next.push("Check wildfire, storm, nuclear, environmental and other material contingent liabilities.");

  return {
    qualityDelta: quality,
    riskDelta: risk,
    hardRiskFlags: hard,
    positiveSignals: positive,
    contradictions,
    requiredNextChecks: next,
    criticalMetrics: [
      { key: "rate_base_growth", metric: evidence.rateBaseGrowthPercent, critical: true },
      { key: "allowed_roe", metric: evidence.allowedRoePercent, critical: true },
      { key: "earned_roe", metric: evidence.earnedRoePercent, critical: true },
      { key: "equity_capital_ratio", metric: evidence.equityCapitalRatioPercent, critical: true },
      { key: "interest_coverage", metric: evidence.interestCoverage, critical: true },
      { key: "debt_to_capital", metric: evidence.debtToCapitalPercent, critical: true },
    ],
    supportingMetrics: [
      { key: "regulatory_assets_to_equity", metric: evidence.regulatoryAssetsToEquityPercent },
      { key: "capex_to_rate_base", metric: evidence.capexToRateBasePercent },
      { key: "load_growth", metric: evidence.loadGrowthPercent },
      { key: "rate_case_revenue_impact", metric: evidence.pendingRateCaseRevenueImpactPercent },
      { key: "dividend_payout", metric: evidence.dividendPayoutPercent },
      { key: "contingent_liability_to_equity", metric: evidence.contingentLiabilityToEquityPercent },
    ],
  };
}

function sectorAssessment(input: SpecialistIntelligenceInput) {
  const kind = input.baseline.sectorKind;
  if (kind === "bank") return bankAssessment(input.evidence?.bank);
  if (kind === "insurer") return insurerAssessment(input.evidence?.insurer, input.company.industry ?? "");
  if (kind === "real_estate_reit") return reitAssessment(input.evidence?.reit);
  if (kind === "utility") return utilityAssessment(input.evidence?.utility);
  return financialAssessment(input.evidence?.financial, input.company.industry ?? "");
}

function movementAssessment(input: SpecialistIntelligenceInput) {
  const market = input.market ?? {};
  const p1 = finite(market.priceChange1dPercent);
  const p5 = finite(market.priceChange5dPercent);
  const s1 = finite(market.sectorChange1dPercent);
  const s5 = finite(market.sectorChange5dPercent);
  const m1 = finite(market.marketChange1dPercent);
  const m5 = finite(market.marketChange5dPercent);
  const relative1 = p1 === null ? null : p1 - (s1 ?? m1 ?? 0);
  const relative5 = p5 === null ? null : p5 - (s5 ?? m5 ?? 0);
  const rv = finite(market.relativeVolume);
  const abnormal = Math.abs(relative1 ?? 0) >= 4 || Math.abs(relative5 ?? 0) >= 8 || (rv ?? 0) >= 2.5;
  let classification: SectorSpecialistIntelligence["movement"]["classification"] = "unknown";
  if (p1 === null && p5 === null) classification = "unknown";
  else if (Math.abs(relative1 ?? 0) < 2 && Math.abs(p1 ?? 0) >= 3 && s1 !== null) classification = "sector_move";
  else if (Math.abs(relative1 ?? 0) < 2 && Math.abs(p1 ?? 0) >= 3 && m1 !== null) classification = "broad_market_move";
  else if ((relative1 ?? 0) <= -4 || (relative5 ?? 0) <= -8) classification = "company_specific_selloff";
  else if ((relative1 ?? 0) >= 4 || (relative5 ?? 0) >= 8) classification = "company_specific_rally";
  else classification = "quiet";

  const upside = input.baseline.fairValue.upsideToBasePercent;
  const premium = input.baseline.fairValue.premiumToBasePercent;
  let pricedInRisk: SectorSpecialistIntelligence["movement"]["pricedInRisk"] = "unknown";
  if (classification === "company_specific_rally" && (upside ?? 0) < 10) pricedInRisk = "high";
  else if (classification === "company_specific_selloff" && (upside ?? 0) >= 30) pricedInRisk = "low";
  else if (upside !== null || premium !== null) pricedInRisk = "medium";

  const opportunityUse = classification === "company_specific_selloff"
    ? "Use the selloff as a priority signal: determine whether sector fundamentals stayed intact before treating the lower price as opportunity."
    : classification === "company_specific_rally"
      ? "Use the rally as a priced-in/overvaluation check: determine whether fundamentals improved enough to justify the extra move."
      : classification === "sector_move" || classification === "broad_market_move"
        ? "Treat this mostly as a relative-value screen. A stock moving with its sector/market needs issuer-specific evidence before promotion."
        : "Market movement alone provides no Serious Signal authority.";
  return { classification, relative1, relative5, abnormal, pricedInRisk, opportunityUse };
}

function scenarioOverlay(input: SpecialistIntelligenceInput, adjustedQuality: number, adjustedRisk: number, decisionGrade: boolean) {
  const fv = input.baseline.fairValue;
  if (fv.baseValue === null || fv.conservativeValue === null || fv.optimisticValue === null || input.company.currentPrice <= 0) {
    return { bearValue: null, baseValue: fv.baseValue, bullValue: null, downsideToBearPercent: null, upsideToBasePercent: fv.upsideToBasePercent, upsideToBullPercent: null, upsideDownsideRatio: null, status: "insufficient" as const };
  }
  const riskHaircut = clamp(adjustedRisk / 250, 0.05, 0.35);
  const qualityBonus = clamp(adjustedQuality / 1000, 0.02, 0.1);
  const bear = fv.conservativeValue * (1 - riskHaircut);
  const bull = fv.optimisticValue * (1 + qualityBonus);
  const downside = ((bear / input.company.currentPrice) - 1) * 100;
  const upsideBase = ((fv.baseValue / input.company.currentPrice) - 1) * 100;
  const upsideBull = ((bull / input.company.currentPrice) - 1) * 100;
  const ratio = downside < 0 && upsideBase > 0 ? upsideBase / Math.abs(downside) : null;
  return {
    bearValue: Math.round(bear * 100) / 100,
    baseValue: fv.baseValue,
    bullValue: Math.round(bull * 100) / 100,
    downsideToBearPercent: Math.round(downside * 100) / 100,
    upsideToBasePercent: Math.round(upsideBase * 100) / 100,
    upsideToBullPercent: Math.round(upsideBull * 100) / 100,
    upsideDownsideRatio: ratio === null ? null : Math.round(ratio * 100) / 100,
    status: decisionGrade ? "decision_ready" as const : "screen_grade" as const,
  };
}

export function evaluateSectorSpecialistIntelligence(input: SpecialistIntelligenceInput): SectorSpecialistIntelligence {
  if (input.baseline.ticker.toUpperCase() !== input.company.ticker.toUpperCase()) throw new Error("sector_specialist_identity_mismatch");
  const now = new Date(input.evaluatedAt ?? new Date().toISOString());
  if (!Number.isFinite(now.getTime())) throw new Error("sector_specialist_invalid_evaluated_at");
  const assessment = sectorAssessment(input);
  const criticalCoverage = coverage(assessment.criticalMetrics);
  const supportingCoverage = coverage(assessment.supportingMetrics);
  const allMetrics = [...assessment.criticalMetrics, ...assessment.supportingMetrics];
  const evidenceReliability = reliability(allMetrics, now);
  const primaryCritical = primaryCount(assessment.criticalMetrics);
  const staleCritical = staleKeys(assessment.criticalMetrics, now);
  const conflicted = conflictKeys(allMetrics);
  const minCriticalCoverage = input.baseline.sectorKind === "financial" ? 70 : 75;
  const minPrimary = input.baseline.sectorKind === "financial" ? 2 : 3;
  const decisionGrade = criticalCoverage >= minCriticalCoverage
    && evidenceReliability >= 72
    && primaryCritical >= minPrimary
    && staleCritical.length === 0
    && conflicted.length === 0;

  const adjustedQuality = Math.round(clamp(input.baseline.qualityScore + assessment.qualityDelta - assessment.contradictions.length * 4));
  const adjustedRisk = Math.round(clamp(input.baseline.riskScore + assessment.riskDelta + assessment.contradictions.length * 5));
  const movement = movementAssessment(input);
  const valuationBuy = clamp(((input.baseline.fairValue.upsideToBasePercent ?? 0) - 10) * 1.2, 0, 45);
  const valuationSell = clamp(((input.baseline.fairValue.premiumToBasePercent ?? 0) - 10) * 1.1, 0, 45);
  const movementBuy = movement.classification === "company_specific_selloff" ? clamp(Math.abs(movement.relative1 ?? movement.relative5 ?? 0) * 1.2, 0, 15) : 0;
  const movementSell = movement.classification === "company_specific_rally" ? clamp(Math.abs(movement.relative1 ?? movement.relative5 ?? 0) * 1.1, 0, 15) : 0;
  const evidenceBoost = decisionGrade ? 18 : evidenceReliability * 0.12;
  const buyOpportunity = Math.round(clamp(valuationBuy + adjustedQuality * 0.22 + evidenceBoost + movementBuy - adjustedRisk * 0.18));
  const sellOpportunity = Math.round(clamp(valuationSell + adjustedRisk * 0.26 + evidenceBoost + movementSell + (100 - adjustedQuality) * 0.08));
  const watchOutRisk = Math.round(clamp(adjustedRisk * 0.75 + assessment.hardRiskFlags.length * 18 + assessment.contradictions.length * 6));
  const confidence = Math.round(clamp(evidenceReliability * 0.55 + criticalCoverage * 0.25 + Math.max(0, 100 - (input.baseline.fairValue.methodSpreadPercent ?? 100)) * 0.2 - assessment.contradictions.length * 5));
  const scenario = scenarioOverlay(input, adjustedQuality, adjustedRisk, decisionGrade);

  const blockers = [
    ...(!decisionGrade ? ["Sector-specific evidence is not decision-grade yet; market movement may prioritize research but cannot authorize a directional promotion."] : []),
    ...conflicted.map((key) => `Conflicting evidence must be reconciled: ${key}.`),
    ...staleCritical.map((key) => `Critical evidence is stale: ${key}.`),
  ];

  const buyEligible = decisionGrade
    && assessment.hardRiskFlags.length === 0
    && assessment.contradictions.length === 0
    && confidence >= 78
    && buyOpportunity >= 70
    && (scenario.upsideDownsideRatio ?? 0) >= 1.25
    && (scenario.downsideToBearPercent ?? -100) > -35;
  const sellEligible = decisionGrade
    && assessment.contradictions.length === 0
    && confidence >= 78
    && sellOpportunity >= 70
    && (input.baseline.fairValue.premiumToBasePercent ?? 0) >= 20;
  const watchOutEligible = decisionGrade && watchOutRisk >= 78;
  const action: SpecialistAction = buyEligible
    ? "buy"
    : sellEligible
      ? "sell"
      : watchOutEligible
        ? "watch_out"
        : Math.max(buyOpportunity, sellOpportunity, watchOutRisk) >= 58
          ? "watch"
          : "research_only";
  const opportunityScore = Math.max(buyOpportunity, sellOpportunity, watchOutRisk);
  const urgentResearch = movement.abnormal || opportunityScore >= 65 || assessment.hardRiskFlags.length > 0;
  const reasons = [
    ...assessment.positiveSignals,
    ...assessment.hardRiskFlags.map((flag) => `Risk flag: ${flag}`),
    `Adjusted sector quality ${adjustedQuality}/100, risk ${adjustedRisk}/100, evidence reliability ${evidenceReliability}/100.`,
    `Buy opportunity ${buyOpportunity}/100; Sell opportunity ${sellOpportunity}/100; Watch Out risk ${watchOutRisk}/100.`,
    movement.opportunityUse,
  ];

  const antiThesis = [
    ...assessment.contradictions,
    ...(scenario.downsideToBearPercent !== null && scenario.downsideToBearPercent <= -30 ? [`Stress-case downside is ${Math.abs(scenario.downsideToBearPercent).toFixed(1)}%; the apparent valuation gap may be a value trap.`] : []),
    ...(movement.pricedInRisk === "high" ? ["A large favorable move may already have consumed much of the fundamental upside."] : []),
  ];

  return {
    version: 2,
    model: "swing_up_us_sector_specialist_intelligence_v2",
    sectorKind: input.baseline.sectorKind,
    ticker: input.company.ticker.toUpperCase(),
    company: input.company.company,
    evaluatedAt: now.toISOString(),
    evidence: {
      criticalCoveragePercent: criticalCoverage,
      supportingCoveragePercent: supportingCoverage,
      reliabilityScore: evidenceReliability,
      primaryCriticalMetrics: primaryCritical,
      staleCriticalMetrics: staleCritical,
      conflictedMetrics: conflicted,
      decisionGrade,
    },
    scores: { adjustedQuality, adjustedRisk, buyOpportunity, sellOpportunity, watchOutRisk, confidence },
    movement: {
      classification: movement.classification,
      relativeMove1dPercent: movement.relative1 === null ? null : Math.round(movement.relative1 * 100) / 100,
      relativeMove5dPercent: movement.relative5 === null ? null : Math.round(movement.relative5 * 100) / 100,
      abnormal: movement.abnormal,
      pricedInRisk: movement.pricedInRisk,
      opportunityUse: movement.opportunityUse,
    },
    scenario,
    adversarialReview: {
      positiveSignals: assessment.positiveSignals,
      antiThesis,
      hardRiskFlags: assessment.hardRiskFlags,
      contradictions: assessment.contradictions,
      requiredNextChecks: assessment.requiredNextChecks,
    },
    decision: {
      action,
      foundationPromotionEligible: ["buy", "sell", "watch_out"].includes(action) && blockers.length === 0,
      urgentResearch,
      opportunityScore,
      reasons,
      blockers,
    },
  };
}
