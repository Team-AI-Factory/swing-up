import { loadEquityUniverse } from "@/lib/equity-signal/universe";
import type { HardenedUsValueInvestingCycle } from "@/lib/opportunity-engine/us-value-investing-safety";
import {
  getR2Config,
  writeVersionedJsonToR2,
} from "@/lib/r2-warehouse";

export type DiligenceGrade = "pass" | "conditional" | "blocked" | "insufficient";

export type CatalystDiligenceMetrics = {
  revenueCurrent: number | null;
  revenuePrior: number | null;
  revenuePrior2: number | null;
  netIncome: number | null;
  netIncomePrior: number | null;
  operatingIncome: number | null;
  operatingCashFlow: number | null;
  capitalExpenditure: number | null;
  incomeTaxExpenseBenefit: number | null;
  gainOnAssetOrBusinessSale: number | null;
  cash: number | null;
  currentDebt: number | null;
  noncurrentDebt: number | null;
  assets: number | null;
  liabilities: number | null;
};

export type CatalystCompanyDiligence = {
  ticker: string;
  company: string;
  cik: string | null;
  observedAt: string;
  sourceUrl: string | null;
  status: "buy_quality_confirmed" | "valuation_inputs_reliable" | "fundamental_risk_confirmed" | "mixed" | "insufficient";
  buyQualityConfirmed: boolean;
  valuationInputsReliable: boolean;
  fundamentalRiskConfirmed: boolean;
  checks: {
    debtLoad: DiligenceGrade;
    earningsQuality: DiligenceGrade;
    revenueDurability: DiligenceGrade;
    reinvestmentBurden: DiligenceGrade;
    oneTimeEarningsRisk: DiligenceGrade;
  };
  metrics: {
    totalDebt: number | null;
    freeCashFlow: number | null;
    debtToCash: number | null;
    currentDebtToCash: number | null;
    debtToAssets: number | null;
    operatingCashFlowToNetIncome: number | null;
    freeCashFlowToNetIncome: number | null;
    capitalExpenditureToRevenue: number | null;
    capitalExpenditureToOperatingCashFlow: number | null;
    latestRevenueGrowthPercent: number | null;
    priorRevenueGrowthPercent: number | null;
    netIncomeGrowthPercent: number | null;
    directCustomerRetentionDisclosureAvailable: false;
    revenueDurabilityUsedAsCustomerRetentionProxy: true;
  };
  reasons: string[];
  blockers: string[];
};

export type CatalystCompanyDiligenceReport = {
  version: 1;
  checkedAt: string;
  marketScope: "US listed common stocks and ADRs only";
  policy: {
    primarySource: "SEC Company Facts";
    seriousFoundationBuyRequiresBuyQualityConfirmed: true;
    seriousFoundationSellRequiresReliableValuationInputs: true;
    seriousFoundationWatchOutRequiresFundamentalRiskConfirmed: true;
    directCustomerRetentionDisclosureRequiredWhenAvailable: true;
    revenueDurabilityIsOnlyAProxy: true;
    maximumFreshSecCompaniesPerScan: number;
    requestTimeoutSeconds: number;
    maximumWorstCaseFreshSecStageSeconds: number;
    reservedCatalystSlotsWhenBothQueuesNonEmpty: number;
    rotatesFoundationAndCatalystQueues: true;
    cacheHours: number;
    noSyntheticData: true;
  };
  coverage: {
    catalystCompaniesDiscovered: number;
    foundationAlertCompaniesAdded: number;
    companiesSelectedThisScan: number;
    companiesCompleted: number;
    companiesFromCache: number;
    companiesUnavailable: number;
    foundationCompaniesQueuedForLaterScan: number;
    catalystCompaniesQueuedForLaterScan: number;
  };
  companies: Record<string, CatalystCompanyDiligence>;
  alertConfirmation: {
    buy: string[];
    sell: string[];
    watchOut: string[];
    suppressedBuy: string[];
    suppressedSell: string[];
    suppressedWatchOut: string[];
  };
  warehouse: {
    latestKey: string;
    immutableRunKey: string | null;
    persisted: boolean;
    errors: string[];
  };
  safety: {
    publishing: false;
    notifications: false;
    trades: false;
    databaseWrites: false;
  };
};

type Json = Record<string, unknown>;
type FactRow = {
  start: string | null;
  end: string | null;
  value: number;
  filed: string | null;
  form: string | null;
};
type Namespace = "us-gaap" | "ifrs-full";
type CachedDiligence = { expiresAt: number; value: CatalystCompanyDiligence };

const SEC_FACTS_BASE = "https://data.sec.gov/api/xbrl/companyfacts";
const R2_PREFIX = "branch-labs/pr-262/value-investing/catalyst-diligence";
const LATEST_KEY = `${R2_PREFIX}/latest.json`;
const CACHE_MS = 12 * 60 * 60 * 1000;
const PERSIST_MS = 6 * 60 * 60 * 1000;
const ROTATION_BUCKET_MS = 5 * 60 * 1000;
const MAX_FRESH_SEC_COMPANIES_PER_SCAN = 12;
const RESERVED_CATALYST_SLOTS = 4;
const SEC_REQUEST_TIMEOUT_MS = 8_000;
const SEC_REQUEST_PACING_MS = 400;
const SEC_REQUEST_CONCURRENCY = 2;
const ANNUAL_FORMS = new Set(["10-K", "20-F", "40-F"]);

const state = globalThis as typeof globalThis & {
  __swingUpCatalystDiligenceCache?: Map<string, CachedDiligence>;
  __swingUpCatalystDiligencePersistedAt?: number;
};
const cache = state.__swingUpCatalystDiligenceCache ??= new Map<string, CachedDiligence>();

export const CATALYST_DILIGENCE_EXECUTION_POLICY = Object.freeze({
  maximumFreshSecCompaniesPerScan: MAX_FRESH_SEC_COMPANIES_PER_SCAN,
  requestTimeoutSeconds: SEC_REQUEST_TIMEOUT_MS / 1_000,
  maximumWorstCaseFreshSecStageSeconds: Math.ceil(
    (MAX_FRESH_SEC_COMPANIES_PER_SCAN / SEC_REQUEST_CONCURRENCY)
    * (SEC_REQUEST_TIMEOUT_MS + SEC_REQUEST_PACING_MS)
    / 1_000,
  ),
  reservedCatalystSlotsWhenBothQueuesNonEmpty: RESERVED_CATALYST_SLOTS,
  rotatesFoundationAndCatalystQueues: true as const,
});

const CONCEPTS = {
  revenue: {
    "us-gaap": ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet", "SalesRevenueGoodsNet"],
    "ifrs-full": ["Revenue"],
  },
  netIncome: {
    "us-gaap": ["NetIncomeLoss", "ProfitLoss"],
    "ifrs-full": ["ProfitLoss"],
  },
  operatingIncome: {
    "us-gaap": ["OperatingIncomeLoss"],
    "ifrs-full": ["ProfitLossFromOperatingActivities"],
  },
  operatingCashFlow: {
    "us-gaap": ["NetCashProvidedByUsedInOperatingActivities", "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations"],
    "ifrs-full": ["CashFlowsFromUsedInOperatingActivities"],
  },
  capitalExpenditure: {
    "us-gaap": ["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsForAdditionsToPropertyPlantAndEquipment"],
    "ifrs-full": ["PurchaseOfPropertyPlantAndEquipment"],
  },
  tax: {
    "us-gaap": ["IncomeTaxExpenseBenefit"],
    "ifrs-full": ["IncomeTaxExpenseContinuingOperations"],
  },
  gainOnSale: {
    "us-gaap": ["GainLossOnSaleOfPropertyPlantEquipment", "GainLossOnSaleOfBusiness", "GainLossOnSaleOfAssets"],
    "ifrs-full": ["GainsLossesOnDisposalOfNoncurrentAssets"],
  },
  cash: {
    "us-gaap": ["CashAndCashEquivalentsAtCarryingValue", "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents"],
    "ifrs-full": ["CashAndCashEquivalents"],
  },
  currentDebt: {
    "us-gaap": ["DebtCurrent", "LongTermDebtCurrent", "ShortTermBorrowings", "CommercialPaper"],
    "ifrs-full": ["CurrentBorrowings"],
  },
  noncurrentDebt: {
    "us-gaap": ["LongTermDebtNoncurrent", "LongTermDebtAndFinanceLeaseObligationsNoncurrent", "LongTermDebtAndCapitalLeaseObligations"],
    "ifrs-full": ["NoncurrentBorrowings"],
  },
  assets: {
    "us-gaap": ["Assets"],
    "ifrs-full": ["Assets"],
  },
  liabilities: {
    "us-gaap": ["Liabilities"],
    "ifrs-full": ["Liabilities"],
  },
} as const;

function object(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function finite(value: unknown) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value.replace(/,/g, "")) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function ratio(numerator: number | null, denominator: number | null) {
  if (numerator === null || denominator === null || denominator === 0) return null;
  const value = numerator / denominator;
  return Number.isFinite(value) ? value : null;
}

function growth(current: number | null, prior: number | null) {
  if (current === null || prior === null || prior === 0) return null;
  return ((current / prior) - 1) * 100;
}

function rounded(value: number | null, digits = 2) {
  if (value === null || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function safeError(error: unknown) {
  return error instanceof Error ? error.message.replace(/\s+/g, " ").slice(0, 260) : "unknown_catalyst_diligence_error";
}

function durationDays(row: FactRow) {
  if (!row.start || !row.end) return null;
  const duration = Date.parse(row.end) - Date.parse(row.start);
  return Number.isFinite(duration) ? duration / 86_400_000 : null;
}

function factRows(payload: Json, namespace: Namespace, concept: string, units: string[]) {
  const facts = object(payload.facts);
  const namespaceFacts = object(facts[namespace]);
  const fact = object(namespaceFacts[concept]);
  const unitGroups = object(fact.units);
  for (const unit of units) {
    const rows = array(unitGroups[unit]).flatMap((raw): FactRow[] => {
      const row = object(raw);
      const value = finite(row.val);
      if (value === null) return [];
      return [{
        start: text(row.start),
        end: text(row.end),
        value,
        filed: text(row.filed),
        form: text(row.form),
      }];
    });
    if (rows.length) return rows;
  }
  return [] as FactRow[];
}

function annualRows(payload: Json, concepts: readonly string[], namespace: Namespace) {
  for (const concept of concepts) {
    const rows = factRows(payload, namespace, concept, ["USD"]) 
      .filter((row) => ANNUAL_FORMS.has(row.form ?? "") && (durationDays(row) ?? 0) >= 250 && (durationDays(row) ?? 0) <= 450)
      .sort((left, right) => `${right.end ?? ""}:${right.filed ?? ""}`.localeCompare(`${left.end ?? ""}:${left.filed ?? ""}`));
    const unique = [...new Map(rows.map((row) => [`${row.start}|${row.end}|${row.form}`, row])).values()];
    if (unique.length) return unique;
  }
  return [] as FactRow[];
}

function matchingAnnualValue(payload: Json, concepts: readonly string[], namespace: Namespace, period: FactRow | null) {
  if (!period) return null;
  for (const concept of concepts) {
    const match = factRows(payload, namespace, concept, ["USD"])
      .filter((row) => row.start === period.start && row.end === period.end && row.form === period.form)
      .sort((left, right) => `${right.filed ?? ""}`.localeCompare(`${left.filed ?? ""}`))[0];
    if (match) return match.value;
  }
  return null;
}

function latestInstant(payload: Json, concepts: readonly string[], namespace: Namespace, endAtOrBefore: string | null) {
  for (const concept of concepts) {
    const rows = factRows(payload, namespace, concept, ["USD"])
      .filter((row) => row.end && (!endAtOrBefore || row.end <= endAtOrBefore) && ANNUAL_FORMS.has(row.form ?? ""))
      .sort((left, right) => `${right.end ?? ""}:${right.filed ?? ""}`.localeCompare(`${left.end ?? ""}:${left.filed ?? ""}`));
    if (rows[0]) return rows[0].value;
  }
  return null;
}

function namespaceFor(payload: Json): Namespace | null {
  const facts = object(payload.facts);
  if (Object.keys(object(facts["us-gaap"])).length) return "us-gaap";
  if (Object.keys(object(facts["ifrs-full"])).length) return "ifrs-full";
  return null;
}

function gradeDebt(debtToCash: number | null, currentDebtToCash: number | null, debtToAssets: number | null): DiligenceGrade {
  if (debtToCash === null && currentDebtToCash === null && debtToAssets === null) return "insufficient";
  if ((debtToCash ?? 0) > 5 && (debtToAssets ?? 0) > 0.6) return "blocked";
  if ((currentDebtToCash ?? 0) > 2) return "blocked";
  if ((debtToCash ?? 0) > 3 || (debtToAssets ?? 0) > 0.5 || (currentDebtToCash ?? 0) > 1) return "conditional";
  return "pass";
}

function gradeEarningsQuality(cfoToIncome: number | null, fcfToIncome: number | null): DiligenceGrade {
  if (cfoToIncome === null || fcfToIncome === null) return "insufficient";
  if (cfoToIncome < 0.5 || fcfToIncome < 0) return "blocked";
  if (cfoToIncome < 0.8 || fcfToIncome < 0.5) return "conditional";
  return "pass";
}

function gradeRevenueDurability(latestGrowth: number | null, priorGrowth: number | null): DiligenceGrade {
  if (latestGrowth === null || priorGrowth === null) return "insufficient";
  if ((latestGrowth < -20) || (latestGrowth < 0 && priorGrowth < 0)) return "blocked";
  if (latestGrowth < 0 || priorGrowth < 0) return "conditional";
  return "pass";
}

function gradeReinvestment(capexToRevenue: number | null, capexToCfo: number | null): DiligenceGrade {
  if (capexToRevenue === null || capexToCfo === null) return "insufficient";
  if (capexToRevenue > 0.25 || capexToCfo > 0.85) return "blocked";
  if (capexToRevenue > 0.15 || capexToCfo > 0.6) return "conditional";
  return "pass";
}

export function evaluateCatalystDiligenceMetricsForTest(input: CatalystDiligenceMetrics) {
  const totalDebt = (input.currentDebt ?? 0) + (input.noncurrentDebt ?? 0);
  const freeCashFlow = input.operatingCashFlow !== null && input.capitalExpenditure !== null
    ? input.operatingCashFlow - Math.abs(input.capitalExpenditure)
    : null;
  const debtToCash = ratio(totalDebt, input.cash);
  const currentDebtToCash = ratio(input.currentDebt, input.cash);
  const debtToAssets = ratio(totalDebt, input.assets);
  const cfoToIncome = ratio(input.operatingCashFlow, input.netIncome);
  const fcfToIncome = ratio(freeCashFlow, input.netIncome);
  const capexToRevenue = ratio(input.capitalExpenditure === null ? null : Math.abs(input.capitalExpenditure), input.revenueCurrent);
  const capexToCfo = ratio(input.capitalExpenditure === null ? null : Math.abs(input.capitalExpenditure), input.operatingCashFlow);
  const latestRevenueGrowth = growth(input.revenueCurrent, input.revenuePrior);
  const priorRevenueGrowth = growth(input.revenuePrior, input.revenuePrior2);
  const netIncomeGrowth = growth(input.netIncome, input.netIncomePrior);
  const taxBenefitRisk = input.incomeTaxExpenseBenefit !== null
    && input.incomeTaxExpenseBenefit < 0
    && (input.netIncome ?? 0) > 0
    && Math.abs(input.incomeTaxExpenseBenefit) / (input.netIncome ?? 1) > 0.2;
  const gainOnSaleRisk = (input.gainOnAssetOrBusinessSale ?? 0) > 0
    && (input.netIncome ?? 0) > 0
    && (input.gainOnAssetOrBusinessSale ?? 0) / (input.netIncome ?? 1) > 0.15;
  const earningsOutranRevenue = netIncomeGrowth !== null
    && latestRevenueGrowth !== null
    && netIncomeGrowth - latestRevenueGrowth > 40
    && (cfoToIncome ?? 0) < 0.8;
  const oneTimeRisk = taxBenefitRisk || gainOnSaleRisk || earningsOutranRevenue;

  const checks = {
    debtLoad: gradeDebt(debtToCash, currentDebtToCash, debtToAssets),
    earningsQuality: gradeEarningsQuality(cfoToIncome, fcfToIncome),
    revenueDurability: gradeRevenueDurability(latestRevenueGrowth, priorRevenueGrowth),
    reinvestmentBurden: gradeReinvestment(capexToRevenue, capexToCfo),
    oneTimeEarningsRisk: oneTimeRisk ? "blocked" as const : "pass" as const,
  };
  const grades = Object.values(checks);
  const observed = [
    input.revenueCurrent,
    input.revenuePrior,
    input.netIncome,
    input.operatingCashFlow,
    input.capitalExpenditure,
    input.cash,
    input.currentDebt,
    input.noncurrentDebt,
    input.assets,
  ].filter((value) => value !== null).length;
  const completeness = observed / 9;
  const valuationInputsReliable = completeness >= 0.67
    && checks.earningsQuality !== "blocked"
    && checks.oneTimeEarningsRisk !== "blocked";
  const buyQualityConfirmed = valuationInputsReliable
    && checks.debtLoad !== "blocked"
    && checks.revenueDurability !== "blocked"
    && checks.reinvestmentBurden !== "blocked"
    && grades.filter((grade) => grade === "pass").length >= 3;
  const fundamentalRiskConfirmed = checks.debtLoad === "blocked"
    || checks.earningsQuality === "blocked"
    || checks.revenueDurability === "blocked"
    || checks.reinvestmentBurden === "blocked"
    || checks.oneTimeEarningsRisk === "blocked";

  return {
    checks,
    buyQualityConfirmed,
    valuationInputsReliable,
    fundamentalRiskConfirmed,
    metrics: {
      totalDebt: rounded(totalDebt),
      freeCashFlow: rounded(freeCashFlow),
      debtToCash: rounded(debtToCash),
      currentDebtToCash: rounded(currentDebtToCash),
      debtToAssets: rounded(debtToAssets),
      operatingCashFlowToNetIncome: rounded(cfoToIncome),
      freeCashFlowToNetIncome: rounded(fcfToIncome),
      capitalExpenditureToRevenue: rounded(capexToRevenue),
      capitalExpenditureToOperatingCashFlow: rounded(capexToCfo),
      latestRevenueGrowthPercent: rounded(latestRevenueGrowth),
      priorRevenueGrowthPercent: rounded(priorRevenueGrowth),
      netIncomeGrowthPercent: rounded(netIncomeGrowth),
      directCustomerRetentionDisclosureAvailable: false as const,
      revenueDurabilityUsedAsCustomerRetentionProxy: true as const,
    },
    flags: { taxBenefitRisk, gainOnSaleRisk, earningsOutranRevenue },
  };
}

function buildMetrics(payload: Json): CatalystDiligenceMetrics | null {
  const namespace = namespaceFor(payload);
  if (!namespace) return null;
  const revenueRows = annualRows(payload, CONCEPTS.revenue[namespace], namespace);
  const currentPeriod = revenueRows[0] ?? null;
  const priorPeriod = revenueRows[1] ?? null;
  const prior2Period = revenueRows[2] ?? null;
  if (!currentPeriod) return null;
  const end = currentPeriod.end;
  return {
    revenueCurrent: currentPeriod.value,
    revenuePrior: priorPeriod?.value ?? null,
    revenuePrior2: prior2Period?.value ?? null,
    netIncome: matchingAnnualValue(payload, CONCEPTS.netIncome[namespace], namespace, currentPeriod),
    netIncomePrior: matchingAnnualValue(payload, CONCEPTS.netIncome[namespace], namespace, priorPeriod),
    operatingIncome: matchingAnnualValue(payload, CONCEPTS.operatingIncome[namespace], namespace, currentPeriod),
    operatingCashFlow: matchingAnnualValue(payload, CONCEPTS.operatingCashFlow[namespace], namespace, currentPeriod),
    capitalExpenditure: matchingAnnualValue(payload, CONCEPTS.capitalExpenditure[namespace], namespace, currentPeriod),
    incomeTaxExpenseBenefit: matchingAnnualValue(payload, CONCEPTS.tax[namespace], namespace, currentPeriod),
    gainOnAssetOrBusinessSale: matchingAnnualValue(payload, CONCEPTS.gainOnSale[namespace], namespace, currentPeriod),
    cash: latestInstant(payload, CONCEPTS.cash[namespace], namespace, end),
    currentDebt: latestInstant(payload, CONCEPTS.currentDebt[namespace], namespace, end),
    noncurrentDebt: latestInstant(payload, CONCEPTS.noncurrentDebt[namespace], namespace, end),
    assets: latestInstant(payload, CONCEPTS.assets[namespace], namespace, end),
    liabilities: latestInstant(payload, CONCEPTS.liabilities[namespace], namespace, end),
  };
}

async function fetchDiligence(input: {
  ticker: string;
  company: string;
  cik: string | null;
  fetchImpl: typeof fetch;
  now: Date;
}) {
  const cached = cache.get(input.ticker);
  if (cached && cached.expiresAt > input.now.getTime()) return { value: cached.value, fromCache: true };
  if (!input.cik) {
    const value: CatalystCompanyDiligence = {
      ticker: input.ticker,
      company: input.company,
      cik: null,
      observedAt: input.now.toISOString(),
      sourceUrl: null,
      status: "insufficient",
      buyQualityConfirmed: false,
      valuationInputsReliable: false,
      fundamentalRiskConfirmed: false,
      checks: { debtLoad: "insufficient", earningsQuality: "insufficient", revenueDurability: "insufficient", reinvestmentBurden: "insufficient", oneTimeEarningsRisk: "insufficient" },
      metrics: { totalDebt: null, freeCashFlow: null, debtToCash: null, currentDebtToCash: null, debtToAssets: null, operatingCashFlowToNetIncome: null, freeCashFlowToNetIncome: null, capitalExpenditureToRevenue: null, capitalExpenditureToOperatingCashFlow: null, latestRevenueGrowthPercent: null, priorRevenueGrowthPercent: null, netIncomeGrowthPercent: null, directCustomerRetentionDisclosureAvailable: false, revenueDurabilityUsedAsCustomerRetentionProxy: true },
      reasons: [],
      blockers: ["SEC CIK mapping is unavailable, so debt, earnings quality, and reinvestment checks cannot be completed."],
    };
    cache.set(input.ticker, { expiresAt: input.now.getTime() + CACHE_MS, value });
    return { value, fromCache: false };
  }
  const sourceUrl = `${SEC_FACTS_BASE}/CIK${input.cik}.json`;
  try {
    const response = await input.fetchImpl(sourceUrl, {
      headers: {
        accept: "application/json",
        "user-agent": process.env.SEC_USER_AGENT?.trim() || "Swing Up research automation support@swingup.app",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(SEC_REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`sec_companyfacts_http_${response.status}`);
    const payload = object(await response.json());
    const rawMetrics = buildMetrics(payload);
    if (!rawMetrics) throw new Error("sec_companyfacts_required_annual_facts_unavailable");
    const evaluated = evaluateCatalystDiligenceMetricsForTest(rawMetrics);
    const status: CatalystCompanyDiligence["status"] = evaluated.buyQualityConfirmed
      ? "buy_quality_confirmed"
      : evaluated.fundamentalRiskConfirmed
        ? "fundamental_risk_confirmed"
        : evaluated.valuationInputsReliable
          ? "valuation_inputs_reliable"
          : "mixed";
    const reasons = [
      `Debt load: ${evaluated.checks.debtLoad}; operating-cash-flow conversion: ${evaluated.metrics.operatingCashFlowToNetIncome ?? "unavailable"}x; free-cash-flow conversion: ${evaluated.metrics.freeCashFlowToNetIncome ?? "unavailable"}x.`,
      `Revenue durability proxy: latest ${evaluated.metrics.latestRevenueGrowthPercent ?? "unavailable"}% and prior ${evaluated.metrics.priorRevenueGrowthPercent ?? "unavailable"}%.`,
      `Reinvestment burden: capex/revenue ${evaluated.metrics.capitalExpenditureToRevenue ?? "unavailable"} and capex/operating cash flow ${evaluated.metrics.capitalExpenditureToOperatingCashFlow ?? "unavailable"}.`,
      "Direct customer-retention disclosure is not assumed; multi-year revenue durability is used only as a proxy until a filing explicitly provides retention, renewal, backlog, or customer-concentration data.",
    ];
    const blockers = [
      ...(evaluated.checks.debtLoad === "blocked" ? ["Debt or near-term refinancing pressure is too high for an ordinary quality-company Buy."] : []),
      ...(evaluated.checks.earningsQuality === "blocked" ? ["Reported profit is not converting into operating and free cash flow reliably enough."] : []),
      ...(evaluated.checks.revenueDurability === "blocked" ? ["Multi-year revenue weakened enough to challenge the assumption that customers will keep buying at the previous rate."] : []),
      ...(evaluated.checks.reinvestmentBurden === "blocked" ? ["Required capital expenditure consumes too much revenue or operating cash flow."] : []),
      ...(evaluated.checks.oneTimeEarningsRisk === "blocked" ? ["A tax benefit, asset-sale gain, or profit/cash mismatch suggests that current earnings may be unusually high and not repeatable."] : []),
    ];
    const value: CatalystCompanyDiligence = {
      ticker: input.ticker,
      company: text(payload.entityName) ?? input.company,
      cik: input.cik,
      observedAt: input.now.toISOString(),
      sourceUrl,
      status,
      buyQualityConfirmed: evaluated.buyQualityConfirmed,
      valuationInputsReliable: evaluated.valuationInputsReliable,
      fundamentalRiskConfirmed: evaluated.fundamentalRiskConfirmed,
      checks: evaluated.checks,
      metrics: evaluated.metrics,
      reasons,
      blockers,
    };
    cache.set(input.ticker, { expiresAt: input.now.getTime() + CACHE_MS, value });
    return { value, fromCache: false };
  } catch (error) {
    const value: CatalystCompanyDiligence = {
      ticker: input.ticker,
      company: input.company,
      cik: input.cik,
      observedAt: input.now.toISOString(),
      sourceUrl,
      status: "insufficient",
      buyQualityConfirmed: false,
      valuationInputsReliable: false,
      fundamentalRiskConfirmed: false,
      checks: { debtLoad: "insufficient", earningsQuality: "insufficient", revenueDurability: "insufficient", reinvestmentBurden: "insufficient", oneTimeEarningsRisk: "insufficient" },
      metrics: { totalDebt: null, freeCashFlow: null, debtToCash: null, currentDebtToCash: null, debtToAssets: null, operatingCashFlowToNetIncome: null, freeCashFlowToNetIncome: null, capitalExpenditureToRevenue: null, capitalExpenditureToOperatingCashFlow: null, latestRevenueGrowthPercent: null, priorRevenueGrowthPercent: null, netIncomeGrowthPercent: null, directCustomerRetentionDisclosureAvailable: false, revenueDurabilityUsedAsCustomerRetentionProxy: true },
      reasons: [],
      blockers: [`SEC diligence unavailable: ${safeError(error)}`],
    };
    cache.set(input.ticker, { expiresAt: input.now.getTime() + Math.min(CACHE_MS, 60 * 60 * 1000), value });
    return { value, fromCache: false };
  }
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>) {
  const output = new Array<R>(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, items.length)) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await worker(items[index]);
      await new Promise((resolve) => setTimeout(resolve, SEC_REQUEST_PACING_MS));
    }
  }));
  return output;
}

function tickerFromCandidate(value: unknown) {
  const candidate = object(value);
  return text(candidate.ticker)?.toUpperCase() ?? null;
}

function companyFromCandidate(value: unknown) {
  const candidate = object(value);
  return text(candidate.company) ?? text(candidate.name) ?? tickerFromCandidate(value) ?? "Unknown company";
}

function dateKey(value: string) {
  return value.replace(/[^0-9]/g, "").slice(0, 14);
}

function rotated<T>(items: T[], offset: number) {
  if (!items.length) return [];
  const normalized = ((offset % items.length) + items.length) % items.length;
  return [...items.slice(normalized), ...items.slice(0, normalized)];
}

function selectDiligenceTickers(priorityTickers: string[], catalystTickers: string[], now: Date) {
  const cycle = Math.floor(now.getTime() / ROTATION_BUCKET_MS);
  const bothQueuesHaveWork = priorityTickers.length > 0 && catalystTickers.length > 0;
  const initialPriorityLimit = bothQueuesHaveWork
    ? MAX_FRESH_SEC_COMPANIES_PER_SCAN - RESERVED_CATALYST_SLOTS
    : MAX_FRESH_SEC_COMPANIES_PER_SCAN;
  const initialCatalystLimit = bothQueuesHaveWork
    ? RESERVED_CATALYST_SLOTS
    : MAX_FRESH_SEC_COMPANIES_PER_SCAN;
  const rotatedPriority = rotated(priorityTickers, cycle * Math.max(1, initialPriorityLimit));
  const rotatedCatalysts = rotated(catalystTickers, cycle * Math.max(1, initialCatalystLimit));
  const priority = rotatedPriority.slice(0, initialPriorityLimit);
  const catalysts = rotatedCatalysts.slice(0, initialCatalystLimit);
  const selected = [...priority, ...catalysts];
  if (selected.length < MAX_FRESH_SEC_COMPANIES_PER_SCAN) {
    selected.push(
      ...rotatedPriority.slice(priority.length),
      ...rotatedCatalysts.slice(catalysts.length),
    );
  }
  return [...new Set(selected)].slice(0, MAX_FRESH_SEC_COMPANIES_PER_SCAN);
}

export function selectCatalystDiligenceTickersForTest(input: {
  priorityTickers: string[];
  catalystTickers: string[];
  now: Date;
}) {
  return selectDiligenceTickers(input.priorityTickers, input.catalystTickers, input.now);
}

async function persistReport(report: CatalystCompanyDiligenceReport) {
  const errors: string[] = [];
  if (!getR2Config().configured) return { persisted: false, immutableRunKey: null as string | null, errors };
  try {
    await writeVersionedJsonToR2(LATEST_KEY, report);
    const now = Date.now();
    let immutableRunKey: string | null = null;
    if (!state.__swingUpCatalystDiligencePersistedAt || now - state.__swingUpCatalystDiligencePersistedAt >= PERSIST_MS) {
      immutableRunKey = `${R2_PREFIX}/runs/${report.checkedAt.slice(0, 10)}/${dateKey(report.checkedAt)}.json`;
      await writeVersionedJsonToR2(immutableRunKey, report, { createOnly: true });
      state.__swingUpCatalystDiligencePersistedAt = now;
    }
    return { persisted: true, immutableRunKey, errors };
  } catch (error) {
    errors.push(safeError(error));
    return { persisted: false, immutableRunKey: null, errors };
  }
}

export async function buildCatalystCompanyDiligence(input: {
  candidates: unknown[];
  valueInvesting: HardenedUsValueInvestingCycle;
  fetchImpl?: typeof fetch;
  now?: Date;
  persist?: boolean;
}): Promise<CatalystCompanyDiligenceReport> {
  const now = input.now ?? new Date();
  const fetchImpl = input.fetchImpl ?? fetch;
  const catalystCompanies = new Map<string, string>();
  for (const candidate of input.candidates) {
    const ticker = tickerFromCandidate(candidate);
    if (ticker && !catalystCompanies.has(ticker)) catalystCompanies.set(ticker, companyFromCandidate(candidate));
  }
  const foundationCompanies = new Map<string, string>();
  for (const item of [
    ...input.valueInvesting.seriousAlerts.buy,
    ...input.valueInvesting.seriousAlerts.sell,
    ...input.valueInvesting.seriousAlerts.watchOut,
    ...input.valueInvesting.watchlists.qualityWaitingForPrice.slice(0, 25),
  ]) {
    foundationCompanies.set(item.ticker.toUpperCase(), item.company);
  }
  const priorityTickers = [...foundationCompanies.keys()];
  const remainingCatalysts = [...catalystCompanies.keys()].filter((ticker) => !foundationCompanies.has(ticker));
  const selected = selectDiligenceTickers(priorityTickers, remainingCatalysts, now);
  const selectedSet = new Set(selected);

  const universe = await loadEquityUniverse(fetchImpl, now);
  const profiles = new Map(universe.snapshot.entries.map((entry) => [entry.ticker.toUpperCase(), entry]));
  const completed = await mapWithConcurrency(selected, SEC_REQUEST_CONCURRENCY, async (ticker) => {
    const profile = profiles.get(ticker);
    const company = foundationCompanies.get(ticker) ?? catalystCompanies.get(ticker) ?? profile?.name ?? ticker;
    return fetchDiligence({ ticker, company, cik: profile?.cik ?? null, fetchImpl, now });
  });
  const companies = Object.fromEntries(completed.map((item) => [item.value.ticker, item.value]));
  const buy = input.valueInvesting.seriousAlerts.buy.filter((item) => companies[item.ticker]?.buyQualityConfirmed).map((item) => item.ticker);
  const sell = input.valueInvesting.seriousAlerts.sell.filter((item) => companies[item.ticker]?.valuationInputsReliable).map((item) => item.ticker);
  const watchOut = input.valueInvesting.seriousAlerts.watchOut.filter((item) => companies[item.ticker]?.fundamentalRiskConfirmed).map((item) => item.ticker);
  const report: CatalystCompanyDiligenceReport = {
    version: 1,
    checkedAt: now.toISOString(),
    marketScope: "US listed common stocks and ADRs only",
    policy: {
      primarySource: "SEC Company Facts",
      seriousFoundationBuyRequiresBuyQualityConfirmed: true,
      seriousFoundationSellRequiresReliableValuationInputs: true,
      seriousFoundationWatchOutRequiresFundamentalRiskConfirmed: true,
      directCustomerRetentionDisclosureRequiredWhenAvailable: true,
      revenueDurabilityIsOnlyAProxy: true,
      maximumFreshSecCompaniesPerScan: MAX_FRESH_SEC_COMPANIES_PER_SCAN,
      requestTimeoutSeconds: CATALYST_DILIGENCE_EXECUTION_POLICY.requestTimeoutSeconds,
      maximumWorstCaseFreshSecStageSeconds: CATALYST_DILIGENCE_EXECUTION_POLICY.maximumWorstCaseFreshSecStageSeconds,
      reservedCatalystSlotsWhenBothQueuesNonEmpty: RESERVED_CATALYST_SLOTS,
      rotatesFoundationAndCatalystQueues: true,
      cacheHours: CACHE_MS / 3_600_000,
      noSyntheticData: true,
    },
    coverage: {
      catalystCompaniesDiscovered: catalystCompanies.size,
      foundationAlertCompaniesAdded: foundationCompanies.size,
      companiesSelectedThisScan: selected.length,
      companiesCompleted: completed.length,
      companiesFromCache: completed.filter((item) => item.fromCache).length,
      companiesUnavailable: completed.filter((item) => item.value.status === "insufficient").length,
      foundationCompaniesQueuedForLaterScan: priorityTickers.filter((ticker) => !selectedSet.has(ticker)).length,
      catalystCompaniesQueuedForLaterScan: remainingCatalysts.filter((ticker) => !selectedSet.has(ticker)).length,
    },
    companies,
    alertConfirmation: {
      buy,
      sell,
      watchOut,
      suppressedBuy: input.valueInvesting.seriousAlerts.buy.filter((item) => !buy.includes(item.ticker)).map((item) => item.ticker),
      suppressedSell: input.valueInvesting.seriousAlerts.sell.filter((item) => !sell.includes(item.ticker)).map((item) => item.ticker),
      suppressedWatchOut: input.valueInvesting.seriousAlerts.watchOut.filter((item) => !watchOut.includes(item.ticker)).map((item) => item.ticker),
    },
    warehouse: { latestKey: LATEST_KEY, immutableRunKey: null, persisted: false, errors: [] },
    safety: { publishing: false, notifications: false, trades: false, databaseWrites: false },
  };
  if (input.persist !== false) {
    const persisted = await persistReport(report);
    report.warehouse = { latestKey: LATEST_KEY, immutableRunKey: persisted.immutableRunKey, persisted: persisted.persisted, errors: persisted.errors };
  }
  return report;
}
