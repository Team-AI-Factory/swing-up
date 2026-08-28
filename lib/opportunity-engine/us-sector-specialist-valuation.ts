export type SpecialistSectorKind = "bank" | "financial" | "insurer" | "real_estate_reit" | "utility";
export type SpecialistAction = "buy" | "sell" | "watch_out" | "watch" | "research_only";

export type SpecialistValuationMethod = {
  method:
    | "bank_book_roe"
    | "bank_earnings_power"
    | "financial_book_roe"
    | "financial_earnings_power"
    | "financial_ev_ebitda"
    | "insurer_book_roe"
    | "insurer_earnings_power"
    | "reit_book_nav_proxy"
    | "reit_ev_ebitda_proxy"
    | "utility_book_roe"
    | "utility_earnings_power"
    | "utility_ev_ebitda";
  value: number;
  assumption: string;
};

export type SectorSpecialistInput = {
  ticker: string;
  company: string;
  sector: string | null;
  industry: string | null;
  currentPrice: number;
  marketCap: number | null;
  estimatedAverageDollarVolume10d: number | null;
  fundamentals: {
    revenue: number | null;
    netIncome: number | null;
    freeCashFlow: number | null;
    dilutedEpsTtm: number | null;
    revenueGrowthTtmPercent: number | null;
    revenueGrowthFyPercent: number | null;
    netIncomeGrowthTtmPercent: number | null;
    epsGrowthTtmPercent: number | null;
    grossMarginPercent: number | null;
    operatingMarginPercent: number | null;
    netMarginPercent: number | null;
    debtToEquityPercent: number | null;
    currentRatio: number | null;
    returnOnEquityPercent: number | null;
    returnOnAssetsPercent: number | null;
  };
  valuation: {
    priceToEarnings: number | null;
    priceToBook: number | null;
    priceToSales: number | null;
    enterpriseValueToEbitda: number | null;
  };
  scores: {
    evidenceCompleteness: number;
  };
};

export type SectorSpecialistValuation = {
  version: 1;
  model: "swing_up_us_sector_specialist_v1";
  sectorKind: SpecialistSectorKind;
  ticker: string;
  company: string;
  evaluatedAt: string;
  evidenceScore: number;
  qualityScore: number;
  riskScore: number;
  requiredInputs: string[];
  missingInputs: string[];
  methods: SpecialistValuationMethod[];
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
  thresholds: {
    minimumEvidenceScore: number;
    minimumMethodCount: number;
    maximumMethodSpreadPercent: number;
    minimumBuyBaseUpsidePercent: number;
    minimumBuyConservativeUpsidePercent: number;
    maximumBuyRiskScore: number;
    minimumBuyQualityScore: number;
    minimumSellPremiumToBasePercent: number;
    minimumSellPremiumToOptimisticPercent: number;
  };
  decision: {
    action: SpecialistAction;
    foundationPromotionEligible: boolean;
    reasons: string[];
    blockers: string[];
  };
  limitations: string[];
};

type ModelThresholds = SectorSpecialistValuation["thresholds"];

type ModelBuild = {
  sectorKind: SpecialistSectorKind;
  requiredInputs: string[];
  methods: SpecialistValuationMethod[];
  evidenceScore: number;
  qualityScore: number;
  riskScore: number;
  thresholds: ModelThresholds;
  deterioration: boolean;
  limitations: string[];
};

function clamp(value: number, minimum = 0, maximum = 100) {
  return Math.min(maximum, Math.max(minimum, value));
}

function round(value: number | null, digits = 2) {
  if (value === null || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function median(values: number[]) {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function scorePositive(value: number | null, poor: number, strong: number) {
  if (value === null) return 35;
  if (strong <= poor) return 50;
  return clamp(((value - poor) / (strong - poor)) * 100);
}

function scoreInverse(value: number | null, good: number, bad: number) {
  if (value === null) return 45;
  if (bad <= good) return 50;
  return clamp(100 - ((value - good) / (bad - good)) * 100);
}

function growthMedian(input: SectorSpecialistInput) {
  return median([
    input.fundamentals.revenueGrowthTtmPercent,
    input.fundamentals.revenueGrowthFyPercent,
    input.fundamentals.netIncomeGrowthTtmPercent,
    input.fundamentals.epsGrowthTtmPercent,
  ].filter((value): value is number => value !== null));
}

function bookValuePerShare(input: SectorSpecialistInput) {
  const multiple = input.valuation.priceToBook;
  return multiple !== null && multiple > 0 ? input.currentPrice / multiple : null;
}

function bookMultipleMethod(input: SectorSpecialistInput, method: SpecialistValuationMethod["method"], targetMultiple: number, assumption: string) {
  const book = bookValuePerShare(input);
  if (book === null || book <= 0 || !Number.isFinite(targetMultiple) || targetMultiple <= 0) return null;
  return { method, value: book * targetMultiple, assumption } satisfies SpecialistValuationMethod;
}

function earningsMethod(input: SectorSpecialistInput, method: SpecialistValuationMethod["method"], targetMultiple: number, assumption: string) {
  const eps = input.fundamentals.dilutedEpsTtm;
  if (eps === null || eps <= 0 || !Number.isFinite(targetMultiple) || targetMultiple <= 0) return null;
  return { method, value: eps * targetMultiple, assumption } satisfies SpecialistValuationMethod;
}

function evEbitdaMethod(input: SectorSpecialistInput, method: SpecialistValuationMethod["method"], targetMultiple: number, assumption: string) {
  const currentMultiple = input.valuation.enterpriseValueToEbitda;
  if (currentMultiple === null || currentMultiple <= 0 || !Number.isFinite(targetMultiple) || targetMultiple <= 0) return null;
  return { method, value: input.currentPrice * (targetMultiple / currentMultiple), assumption } satisfies SpecialistValuationMethod;
}

function present(value: number | null) {
  return value !== null && Number.isFinite(value);
}

function evidence(required: Array<[string, number | null]>) {
  const available = required.filter(([, value]) => present(value)).length;
  return {
    score: required.length ? Math.round((available / required.length) * 100) : 0,
    missing: required.filter(([, value]) => !present(value)).map(([name]) => name),
    names: required.map(([name]) => name),
  };
}

function commonRisk(input: SectorSpecialistInput) {
  let risk = 10;
  if ((input.fundamentals.netIncome ?? 0) <= 0) risk += 30;
  if ((growthMedian(input) ?? 0) < -10) risk += 15;
  if ((input.fundamentals.epsGrowthTtmPercent ?? 0) < -20) risk += 10;
  if ((input.marketCap ?? 0) < 500_000_000) risk += 10;
  if ((input.estimatedAverageDollarVolume10d ?? 0) < 5_000_000) risk += 10;
  return risk;
}

function bankModel(input: SectorSpecialistInput): ModelBuild {
  const growth = growthMedian(input) ?? 0;
  const roe = input.fundamentals.returnOnEquityPercent ?? 0;
  const roa = input.fundamentals.returnOnAssetsPercent ?? 0;
  const required = evidence([
    ["diluted_eps_ttm", input.fundamentals.dilutedEpsTtm],
    ["price_to_book", input.valuation.priceToBook],
    ["return_on_equity", input.fundamentals.returnOnEquityPercent],
    ["return_on_assets", input.fundamentals.returnOnAssetsPercent],
    ["net_income", input.fundamentals.netIncome],
    ["earnings_growth", input.fundamentals.epsGrowthTtmPercent ?? input.fundamentals.netIncomeGrowthTtmPercent],
  ]);
  const targetPb = clamp(0.65 + Math.max(0, roe) * 0.05 + Math.max(0, growth) * 0.008, 0.65, 1.8);
  const targetPe = clamp(7 + Math.max(0, roe) * 0.32 + Math.max(0, growth) * 0.06, 8, 15);
  const methods = [
    bookMultipleMethod(input, "bank_book_roe", targetPb, `Bank book value valued at ${targetPb.toFixed(2)}x based on ROE and current earnings trend; generic debt/FCF rules are intentionally ignored.`),
    earningsMethod(input, "bank_earnings_power", targetPe, `Bank normalized earnings valued at a conservative ${targetPe.toFixed(1)}x multiple based on ROE and growth.`),
  ].filter((value): value is SpecialistValuationMethod => Boolean(value));
  const quality = Math.round(scorePositive(roe, 5, 18) * 0.45 + scorePositive(roa, 0.4, 1.6) * 0.25 + scorePositive(growth, -5, 15) * 0.15 + required.score * 0.15);
  let risk = commonRisk(input);
  if (roe < 6) risk += 15;
  if (roa < 0.4) risk += 15;
  if ((input.valuation.priceToBook ?? 0) > 3) risk += 10;
  if (required.score < 80) risk += 15;
  return {
    sectorKind: "bank",
    requiredInputs: required.names,
    methods,
    evidenceScore: required.score,
    qualityScore: quality,
    riskScore: Math.round(clamp(risk)),
    thresholds: { minimumEvidenceScore: 80, minimumMethodCount: 2, maximumMethodSpreadPercent: 50, minimumBuyBaseUpsidePercent: 35, minimumBuyConservativeUpsidePercent: 20, maximumBuyRiskScore: 45, minimumBuyQualityScore: 70, minimumSellPremiumToBasePercent: 45, minimumSellPremiumToOptimisticPercent: 15 },
    deterioration: growth < -5 || roe < 7 || roa < 0.5,
    limitations: ["This first bank model uses book value, ROE, ROA and earnings; it does not pretend generic corporate free cash flow or debt-to-equity is an appropriate bank valuation framework.", "Final Serious Signal review should seek regulatory-capital, credit-quality and deposit/funding evidence when the event makes those items material."],
  };
}

function financialModel(input: SectorSpecialistInput): ModelBuild {
  const growth = growthMedian(input) ?? 0;
  const roe = input.fundamentals.returnOnEquityPercent ?? 0;
  const margin = input.fundamentals.netMarginPercent ?? 0;
  const required = evidence([
    ["diluted_eps_ttm", input.fundamentals.dilutedEpsTtm],
    ["price_to_book", input.valuation.priceToBook],
    ["return_on_equity", input.fundamentals.returnOnEquityPercent],
    ["net_margin", input.fundamentals.netMarginPercent],
    ["earnings_growth", input.fundamentals.epsGrowthTtmPercent ?? input.fundamentals.netIncomeGrowthTtmPercent],
    ["ev_to_ebitda", input.valuation.enterpriseValueToEbitda],
  ]);
  const targetPb = clamp(0.8 + Math.max(0, roe) * 0.045 + Math.max(0, growth) * 0.008, 0.8, 2.2);
  const targetPe = clamp(8 + Math.max(0, roe) * 0.22 + Math.max(0, growth) * 0.08, 8, 18);
  const targetEv = clamp(8 + Math.max(0, growth) * 0.08 + Math.max(0, margin) * 0.03, 8, 15);
  const methods = [
    bookMultipleMethod(input, "financial_book_roe", targetPb, `Financial-company book value valued at ${targetPb.toFixed(2)}x based on ROE and growth.`),
    earningsMethod(input, "financial_earnings_power", targetPe, `Financial-company earnings valued at ${targetPe.toFixed(1)}x based on ROE and growth.`),
    evEbitdaMethod(input, "financial_ev_ebitda", targetEv, `Enterprise-value cross-check normalized toward ${targetEv.toFixed(1)}x EBITDA while holding the observed capital structure constant.`),
  ].filter((value): value is SpecialistValuationMethod => Boolean(value));
  const quality = Math.round(scorePositive(roe, 6, 22) * 0.35 + scorePositive(margin, 5, 30) * 0.2 + scorePositive(growth, -5, 20) * 0.25 + required.score * 0.2);
  let risk = commonRisk(input);
  if (roe < 6) risk += 15;
  if (growth < -10) risk += 15;
  if (required.score < 70) risk += 15;
  return {
    sectorKind: "financial",
    requiredInputs: required.names,
    methods,
    evidenceScore: required.score,
    qualityScore: quality,
    riskScore: Math.round(clamp(risk)),
    thresholds: { minimumEvidenceScore: 70, minimumMethodCount: 2, maximumMethodSpreadPercent: 55, minimumBuyBaseUpsidePercent: 40, minimumBuyConservativeUpsidePercent: 20, maximumBuyRiskScore: 45, minimumBuyQualityScore: 72, minimumSellPremiumToBasePercent: 50, minimumSellPremiumToOptimisticPercent: 20 },
    deterioration: growth < -5 || roe < 7,
    limitations: ["This model is for non-bank, non-insurer financial companies such as asset managers, exchanges, brokers and diversified financial services.", "Business-specific assets under management, net flows, take rates or credit losses remain event-specific diligence inputs rather than invented model values."],
  };
}

function insurerModel(input: SectorSpecialistInput): ModelBuild {
  const growth = growthMedian(input) ?? 0;
  const roe = input.fundamentals.returnOnEquityPercent ?? 0;
  const margin = input.fundamentals.netMarginPercent ?? 0;
  const required = evidence([
    ["diluted_eps_ttm", input.fundamentals.dilutedEpsTtm],
    ["price_to_book", input.valuation.priceToBook],
    ["return_on_equity", input.fundamentals.returnOnEquityPercent],
    ["net_margin", input.fundamentals.netMarginPercent],
    ["net_income", input.fundamentals.netIncome],
    ["earnings_growth", input.fundamentals.epsGrowthTtmPercent ?? input.fundamentals.netIncomeGrowthTtmPercent],
  ]);
  const targetPb = clamp(0.7 + Math.max(0, roe) * 0.04 + Math.max(0, growth) * 0.006, 0.7, 1.6);
  const targetPe = clamp(7 + Math.max(0, roe) * 0.22 + Math.max(0, growth) * 0.05, 7.5, 13);
  const methods = [
    bookMultipleMethod(input, "insurer_book_roe", targetPb, `Insurer book value valued at ${targetPb.toFixed(2)}x based on ROE and earnings trend.`),
    earningsMethod(input, "insurer_earnings_power", targetPe, `Insurer normalized earnings valued at ${targetPe.toFixed(1)}x; generic corporate FCF is not required.`),
  ].filter((value): value is SpecialistValuationMethod => Boolean(value));
  const quality = Math.round(scorePositive(roe, 5, 18) * 0.4 + scorePositive(margin, 2, 15) * 0.2 + scorePositive(growth, -5, 15) * 0.2 + required.score * 0.2);
  let risk = commonRisk(input);
  if (roe < 5) risk += 15;
  if (growth < -10) risk += 15;
  if ((input.valuation.priceToBook ?? 0) > 2.5) risk += 10;
  if (required.score < 80) risk += 15;
  return {
    sectorKind: "insurer",
    requiredInputs: required.names,
    methods,
    evidenceScore: required.score,
    qualityScore: quality,
    riskScore: Math.round(clamp(risk)),
    thresholds: { minimumEvidenceScore: 80, minimumMethodCount: 2, maximumMethodSpreadPercent: 50, minimumBuyBaseUpsidePercent: 35, minimumBuyConservativeUpsidePercent: 20, maximumBuyRiskScore: 50, minimumBuyQualityScore: 70, minimumSellPremiumToBasePercent: 45, minimumSellPremiumToOptimisticPercent: 15 },
    deterioration: growth < -5 || roe < 6,
    limitations: ["Book value and normalized earnings are the primary insurer valuation anchors in this first model.", "Reserve adequacy, combined ratio, catastrophe exposure and investment-portfolio risk must be checked from current insurer disclosures when relevant; the model never fabricates them."],
  };
}

function reitModel(input: SectorSpecialistInput): ModelBuild {
  const growth = input.fundamentals.revenueGrowthTtmPercent ?? input.fundamentals.revenueGrowthFyPercent ?? 0;
  const roa = input.fundamentals.returnOnAssetsPercent ?? 0;
  const margin = input.fundamentals.operatingMarginPercent ?? input.fundamentals.netMarginPercent ?? 0;
  const debt = input.fundamentals.debtToEquityPercent;
  const required = evidence([
    ["price_to_book", input.valuation.priceToBook],
    ["ev_to_ebitda", input.valuation.enterpriseValueToEbitda],
    ["revenue_growth", input.fundamentals.revenueGrowthTtmPercent ?? input.fundamentals.revenueGrowthFyPercent],
    ["operating_or_net_margin", input.fundamentals.operatingMarginPercent ?? input.fundamentals.netMarginPercent],
    ["return_on_assets", input.fundamentals.returnOnAssetsPercent],
    ["debt_to_equity", debt],
  ]);
  const targetPb = clamp(1 + Math.max(0, roa) * 0.05 + Math.max(0, growth) * 0.015, 0.9, 1.8);
  const targetEv = clamp(11 + Math.max(0, growth) * 0.12 + Math.max(0, margin) * 0.025, 10, 18);
  const methods = [
    bookMultipleMethod(input, "reit_book_nav_proxy", targetPb, `REIT/real-estate book value used only as a conservative NAV proxy at ${targetPb.toFixed(2)}x; historical-cost accounting is explicitly recognized as imperfect.`),
    evEbitdaMethod(input, "reit_ev_ebitda_proxy", targetEv, `REIT/real-estate enterprise value normalized toward ${targetEv.toFixed(1)}x EBITDA as a second capital-structure-aware cross-check.`),
  ].filter((value): value is SpecialistValuationMethod => Boolean(value));
  const quality = Math.round(scorePositive(margin, 10, 45) * 0.3 + scorePositive(growth, -5, 12) * 0.25 + scorePositive(roa, 1, 7) * 0.2 + scoreInverse(debt, 80, 350) * 0.1 + required.score * 0.15);
  let risk = commonRisk(input);
  if ((debt ?? 0) > 300) risk += 20;
  if (growth < -8) risk += 15;
  if ((input.valuation.enterpriseValueToEbitda ?? 0) > 25) risk += 10;
  if (required.score < 80) risk += 15;
  return {
    sectorKind: "real_estate_reit",
    requiredInputs: required.names,
    methods,
    evidenceScore: required.score,
    qualityScore: quality,
    riskScore: Math.round(clamp(risk)),
    thresholds: { minimumEvidenceScore: 80, minimumMethodCount: 2, maximumMethodSpreadPercent: 45, minimumBuyBaseUpsidePercent: 45, minimumBuyConservativeUpsidePercent: 25, maximumBuyRiskScore: 50, minimumBuyQualityScore: 65, minimumSellPremiumToBasePercent: 40, minimumSellPremiumToOptimisticPercent: 15 },
    deterioration: growth < -5 || (debt ?? 0) > 300,
    limitations: ["REIT EPS and generic free cash flow are not treated as the primary valuation anchor because depreciation and property capex can distort them.", "This first-pass model uses book/NAV and EV/EBITDA proxies. FFO/AFFO, same-store NOI, occupancy, lease rollover and cap-rate evidence should supersede these proxies whenever current issuer disclosures provide them."],
  };
}

function utilityModel(input: SectorSpecialistInput): ModelBuild {
  const growth = input.fundamentals.revenueGrowthTtmPercent ?? input.fundamentals.revenueGrowthFyPercent ?? 0;
  const roe = input.fundamentals.returnOnEquityPercent ?? 0;
  const margin = input.fundamentals.operatingMarginPercent ?? 0;
  const debt = input.fundamentals.debtToEquityPercent;
  const required = evidence([
    ["diluted_eps_ttm", input.fundamentals.dilutedEpsTtm],
    ["price_to_book", input.valuation.priceToBook],
    ["return_on_equity", input.fundamentals.returnOnEquityPercent],
    ["operating_margin", input.fundamentals.operatingMarginPercent],
    ["revenue_growth", input.fundamentals.revenueGrowthTtmPercent ?? input.fundamentals.revenueGrowthFyPercent],
    ["ev_to_ebitda", input.valuation.enterpriseValueToEbitda],
  ]);
  const targetPb = clamp(1.1 + Math.max(0, roe) * 0.045 + Math.max(0, growth) * 0.01, 1.1, 2.3);
  const targetPe = clamp(12 + Math.max(0, roe) * 0.25 + Math.max(0, growth) * 0.08, 12, 20);
  const targetEv = clamp(8 + Math.max(0, growth) * 0.08 + Math.max(0, margin) * 0.03, 8, 13);
  const methods = [
    bookMultipleMethod(input, "utility_book_roe", targetPb, `Utility book value valued at ${targetPb.toFixed(2)}x based on allowed-return/ROE economics and growth.`),
    earningsMethod(input, "utility_earnings_power", targetPe, `Utility normalized earnings valued at ${targetPe.toFixed(1)}x; heavy regulated capex is not automatically treated as poor business quality.`),
    evEbitdaMethod(input, "utility_ev_ebitda", targetEv, `Utility enterprise value normalized toward ${targetEv.toFixed(1)}x EBITDA as a leverage-aware cross-check.`),
  ].filter((value): value is SpecialistValuationMethod => Boolean(value));
  const quality = Math.round(scorePositive(roe, 6, 14) * 0.3 + scorePositive(margin, 8, 28) * 0.25 + scorePositive(growth, -3, 8) * 0.2 + scoreInverse(debt, 80, 300) * 0.1 + required.score * 0.15);
  let risk = commonRisk(input);
  if ((debt ?? 0) > 250) risk += 15;
  if ((debt ?? 0) > 400) risk += 15;
  if ((input.fundamentals.currentRatio ?? 1) < 0.5) risk += 10;
  if (growth < -8) risk += 15;
  if (required.score < 70) risk += 15;
  return {
    sectorKind: "utility",
    requiredInputs: required.names,
    methods,
    evidenceScore: required.score,
    qualityScore: quality,
    riskScore: Math.round(clamp(risk)),
    thresholds: { minimumEvidenceScore: 70, minimumMethodCount: 2, maximumMethodSpreadPercent: 50, minimumBuyBaseUpsidePercent: 30, minimumBuyConservativeUpsidePercent: 20, maximumBuyRiskScore: 55, minimumBuyQualityScore: 65, minimumSellPremiumToBasePercent: 40, minimumSellPremiumToOptimisticPercent: 15 },
    deterioration: growth < -5 || (debt ?? 0) > 300 || roe < 6,
    limitations: ["Utility valuation emphasizes regulated earnings, book value and enterprise value rather than requiring positive generic free cash flow in a capital-intensive build cycle.", "Rate-base growth, allowed ROE, regulatory decisions, fuel recovery and major capital plans remain event-specific evidence and must be checked when material."],
  };
}

export function classifySpecialistSector(input: Pick<SectorSpecialistInput, "sector" | "industry">): SpecialistSectorKind | null {
  const text = `${input.sector ?? ""} ${input.industry ?? ""}`.toLowerCase();
  if (/\b(banks?|banking|regional banks?|money center banks?|thrift|savings and loan)\b/.test(text)) return "bank";
  if (/\b(insurance|insurers?|reinsurance)\b/.test(text)) return "insurer";
  if (/\b(reit|real estate|property trust|realty)\b/.test(text)) return "real_estate_reit";
  if (/\b(utility|utilities|electric utility|gas utility|water utility)\b/.test(text)) return "utility";
  if (/\b(finance|financial|asset management|capital markets|broker|exchange|credit services|investment services|mortgage finance)\b/.test(text)) return "financial";
  return null;
}

function buildModel(input: SectorSpecialistInput, kind: SpecialistSectorKind): ModelBuild {
  if (kind === "bank") return bankModel(input);
  if (kind === "insurer") return insurerModel(input);
  if (kind === "real_estate_reit") return reitModel(input);
  if (kind === "utility") return utilityModel(input);
  return financialModel(input);
}

export function evaluateSectorSpecialistValuation(input: SectorSpecialistInput, evaluatedAt = new Date().toISOString()): SectorSpecialistValuation | null {
  const sectorKind = classifySpecialistSector(input);
  if (!sectorKind) return null;
  const built = buildModel(input, sectorKind);
  const methods = built.methods
    .filter((method) => Number.isFinite(method.value) && method.value > input.currentPrice * 0.2 && method.value < input.currentPrice * 5)
    .map((method) => ({ ...method, value: round(method.value) ?? method.value }));
  const values = methods.map((method) => method.value).sort((left, right) => left - right);
  const conservativeValue = values.length ? values[0] : null;
  const baseValue = median(values);
  const optimisticValue = values.length ? values.at(-1)! : null;
  const methodSpreadPercent = values.length >= 2 && baseValue !== null && baseValue > 0 ? ((values.at(-1)! - values[0]) / baseValue) * 100 : null;
  const upsideToBasePercent = baseValue !== null ? ((baseValue / input.currentPrice) - 1) * 100 : null;
  const conservativeUpsidePercent = conservativeValue !== null ? ((conservativeValue / input.currentPrice) - 1) * 100 : null;
  const premiumToBasePercent = baseValue !== null ? ((input.currentPrice / baseValue) - 1) * 100 : null;
  const premiumToOptimisticPercent = optimisticValue !== null ? ((input.currentPrice / optimisticValue) - 1) * 100 : null;
  const thresholds = built.thresholds;
  const missingInputs = built.requiredInputs.filter((name) => {
    const mapping: Record<string, number | null> = {
      diluted_eps_ttm: input.fundamentals.dilutedEpsTtm,
      price_to_book: input.valuation.priceToBook,
      return_on_equity: input.fundamentals.returnOnEquityPercent,
      return_on_assets: input.fundamentals.returnOnAssetsPercent,
      net_income: input.fundamentals.netIncome,
      earnings_growth: input.fundamentals.epsGrowthTtmPercent ?? input.fundamentals.netIncomeGrowthTtmPercent,
      net_margin: input.fundamentals.netMarginPercent,
      ev_to_ebitda: input.valuation.enterpriseValueToEbitda,
      revenue_growth: input.fundamentals.revenueGrowthTtmPercent ?? input.fundamentals.revenueGrowthFyPercent,
      operating_or_net_margin: input.fundamentals.operatingMarginPercent ?? input.fundamentals.netMarginPercent,
      debt_to_equity: input.fundamentals.debtToEquityPercent,
      operating_margin: input.fundamentals.operatingMarginPercent,
    };
    return !present(mapping[name] ?? null);
  });
  const commonEvidence = built.evidenceScore >= thresholds.minimumEvidenceScore
    && methods.length >= thresholds.minimumMethodCount
    && methodSpreadPercent !== null
    && methodSpreadPercent <= thresholds.maximumMethodSpreadPercent;
  const buy = commonEvidence
    && (upsideToBasePercent ?? -Infinity) >= thresholds.minimumBuyBaseUpsidePercent
    && (conservativeUpsidePercent ?? -Infinity) >= thresholds.minimumBuyConservativeUpsidePercent
    && built.qualityScore >= thresholds.minimumBuyQualityScore
    && built.riskScore <= thresholds.maximumBuyRiskScore;
  const sell = commonEvidence
    && (premiumToBasePercent ?? -Infinity) >= thresholds.minimumSellPremiumToBasePercent
    && (premiumToOptimisticPercent ?? -Infinity) >= thresholds.minimumSellPremiumToOptimisticPercent
    && (built.deterioration || built.riskScore >= 55 || built.qualityScore < 60);
  const watchOut = built.evidenceScore >= thresholds.minimumEvidenceScore
    && built.riskScore >= 80;
  const watch = !buy && !sell && !watchOut && commonEvidence && built.qualityScore >= 65 && built.riskScore <= 60 && baseValue !== null;
  const action: SpecialistAction = buy ? "buy" : sell ? "sell" : watchOut ? "watch_out" : watch ? "watch" : "research_only";
  const blockers = [
    ...(built.evidenceScore < thresholds.minimumEvidenceScore ? [`Sector-specific evidence score ${built.evidenceScore}/100 is below ${thresholds.minimumEvidenceScore}/100.`] : []),
    ...(methods.length < thresholds.minimumMethodCount ? [`Only ${methods.length} usable specialist valuation method(s); at least ${thresholds.minimumMethodCount} are required.`] : []),
    ...(methodSpreadPercent === null ? ["Specialist valuation-method agreement cannot be measured yet."] : methodSpreadPercent > thresholds.maximumMethodSpreadPercent ? [`Specialist valuation methods disagree by ${methodSpreadPercent.toFixed(1)}%, above the ${thresholds.maximumMethodSpreadPercent}% limit.`] : []),
    ...missingInputs.map((name) => `Missing sector input: ${name}.`),
  ];
  const reasons = [
    `Applied ${sectorKind.replace(/_/g, " ")} specialist model instead of the generic corporate earnings/FCF framework.`,
    ...(baseValue !== null ? [`Specialist base fair value is $${baseValue.toFixed(2)} versus current price $${input.currentPrice.toFixed(2)}.`] : []),
    `Sector quality ${built.qualityScore}/100; sector risk ${built.riskScore}/100; evidence ${built.evidenceScore}/100.`,
  ];
  const buyBelowPrice = baseValue !== null ? baseValue / (1 + thresholds.minimumBuyBaseUpsidePercent / 100) : null;
  const strongBuyBelowPrice = baseValue !== null ? baseValue / (1 + (thresholds.minimumBuyBaseUpsidePercent + 15) / 100) : null;
  const trimAbovePrice = baseValue !== null ? baseValue * (1 + thresholds.minimumSellPremiumToBasePercent / 100) : null;
  return {
    version: 1,
    model: "swing_up_us_sector_specialist_v1",
    sectorKind,
    ticker: input.ticker,
    company: input.company,
    evaluatedAt,
    evidenceScore: built.evidenceScore,
    qualityScore: built.qualityScore,
    riskScore: built.riskScore,
    requiredInputs: built.requiredInputs,
    missingInputs,
    methods,
    fairValue: {
      conservativeValue: round(conservativeValue),
      baseValue: round(baseValue),
      optimisticValue: round(optimisticValue),
      buyBelowPrice: round(buyBelowPrice),
      strongBuyBelowPrice: round(strongBuyBelowPrice),
      trimAbovePrice: round(trimAbovePrice),
      upsideToBasePercent: round(upsideToBasePercent),
      conservativeUpsidePercent: round(conservativeUpsidePercent),
      premiumToBasePercent: round(premiumToBasePercent),
      premiumToOptimisticPercent: round(premiumToOptimisticPercent),
      methodSpreadPercent: round(methodSpreadPercent),
    },
    thresholds,
    decision: {
      action,
      foundationPromotionEligible: ["buy", "sell", "watch_out"].includes(action) && blockers.length === 0,
      reasons,
      blockers,
    },
    limitations: built.limitations,
  };
}
