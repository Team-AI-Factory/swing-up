import {
  getR2Config,
  writeVersionedJsonToR2,
} from "@/lib/r2-warehouse";
import type {
  UsValueCompanyAnalysis,
  UsValueInvestingCycle,
} from "@/lib/opportunity-engine/us-value-investing-engine";

export type HardenedUsValueInvestingCycle = UsValueInvestingCycle & {
  methodology: UsValueInvestingCycle["methodology"] & {
    safetyOverlay: "us_value_alert_safety_v2";
    specialistSectorModelsRequired: true;
    minimumConservativeValueUpsidePercent: 20;
    maximumValuationMethodSpreadPercent: 60;
    minimumSeriousAlertPrice: 1;
  };
  coverage: UsValueInvestingCycle["coverage"] & {
    providerRowsExcludedOutsideEligibleExchanges: number;
    eligibleExchangeCoveragePercent: number;
  };
};

type OverlayState = {
  persistedAt?: number;
  warehouse?: {
    shardKeys: string[];
    immutableRunKey: string;
    companyRecordsStored: number;
  };
};

const state = globalThis as typeof globalThis & {
  __swingUpValueSafetyState?: OverlayState;
};

const SAFETY_STATE = state.__swingUpValueSafetyState ??= {};
const ELIGIBLE_EXCHANGES = new Set(["NASDAQ", "NYSE", "AMEX", "NYSEAMERICAN"]);
const SPECIALIST_SECTOR = /\b(finance|financial|bank|insurance|real estate|reit|utility|utilities)\b/i;
const R2_PREFIX = "branch-labs/pr-262/value-investing" as const;
const LATEST_INDEX_KEY = `${R2_PREFIX}/latest/index.json`;
const SHARD_SIZE = 500;
const PERSIST_MS = 6 * 60 * 60 * 1000;
const SHARD_WRITE_CONCURRENCY = 4;

function rounded(value: number | null, digits = 2) {
  if (value === null || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function dateKey(value: string) {
  return value.replace(/[^0-9]/g, "").slice(0, 14);
}

function safeError(error: unknown) {
  return error instanceof Error
    ? error.message.replace(/\s+/g, " ").slice(0, 300)
    : "unknown_value_safety_error";
}

function valuationDiagnostics(item: UsValueCompanyAnalysis) {
  const values = item.fairValue.methods
    .map((method) => method.value)
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((left, right) => left - right);
  const base = item.fairValue.baseValue;
  const conservative = item.fairValue.conservativeValue;
  const optimistic = item.fairValue.optimisticValue;
  const methodSpreadPercent = values.length >= 2 && base && base > 0
    ? ((values.at(-1)! - values[0]) / base) * 100
    : null;
  const conservativeUpsidePercent = conservative && conservative > 0
    ? ((conservative / item.currentPrice) - 1) * 100
    : null;
  const premiumToBasePercent = base && base > 0
    ? ((item.currentPrice / base) - 1) * 100
    : null;
  const premiumToOptimisticPercent = optimistic && optimistic > 0
    ? ((item.currentPrice / optimistic) - 1) * 100
    : null;
  return {
    methodSpreadPercent,
    conservativeUpsidePercent,
    premiumToBasePercent,
    premiumToOptimisticPercent,
  };
}

function isSpecialistSector(item: UsValueCompanyAnalysis) {
  return SPECIALIST_SECTOR.test(`${item.sector ?? ""} ${item.industry ?? ""}`);
}

function hardenCompany(item: UsValueCompanyAnalysis): UsValueCompanyAnalysis {
  const diagnostics = valuationDiagnostics(item);
  const eligibleExchange = ELIGIBLE_EXCHANGES.has(item.exchange.toUpperCase());
  const sensiblePrice = Number.isFinite(item.currentPrice) && item.currentPrice >= 1;
  const liquid = (item.marketCap ?? 0) >= 500_000_000
    && (item.estimatedAverageDollarVolume10d ?? 0) >= 5_000_000;
  const watchOutLiquid = (item.marketCap ?? 0) >= 300_000_000
    && (item.estimatedAverageDollarVolume10d ?? 0) >= 2_000_000;
  const specialistSector = isSpecialistSector(item);
  const supportedGeneralModel = !specialistSector;
  const methodAgreement = diagnostics.methodSpreadPercent !== null
    && diagnostics.methodSpreadPercent <= 60;
  const profitable = (item.fundamentals.netIncome ?? 0) > 0
    && (item.fundamentals.freeCashFlow ?? 0) > 0
    && (item.fundamentals.dilutedEpsTtm ?? 0) > 0;
  const growthDeteriorating = [
    item.fundamentals.revenueGrowthTtmPercent,
    item.fundamentals.revenueGrowthFyPercent,
    item.fundamentals.netIncomeGrowthTtmPercent,
    item.fundamentals.epsGrowthTtmPercent,
  ].some((value) => value !== null && value < -5);
  const directStress = (item.fundamentals.freeCashFlow ?? 0) <= 0
    || (item.fundamentals.netIncome ?? 0) <= 0
    || (item.fundamentals.debtToEquityPercent ?? 0) > 250
    || (item.fundamentals.currentRatio ?? 2) < 0.8;

  const seriousBuy = eligibleExchange
    && sensiblePrice
    && liquid
    && supportedGeneralModel
    && profitable
    && item.scores.businessQuality >= 75
    && item.scores.balanceSheet >= 60
    && item.scores.risk <= 45
    && item.scores.fairValueConfidence >= 75
    && item.fairValue.methods.length >= 2
    && methodAgreement
    && (item.fairValue.upsideToBasePercent ?? -Infinity) >= 40
    && (diagnostics.conservativeUpsidePercent ?? -Infinity) >= 20;

  const seriousSell = eligibleExchange
    && sensiblePrice
    && liquid
    && supportedGeneralModel
    && item.scores.fairValueConfidence >= 70
    && item.fairValue.methods.length >= 2
    && methodAgreement
    && (diagnostics.premiumToBasePercent ?? -Infinity) >= 50
    && (diagnostics.premiumToOptimisticPercent ?? -Infinity) >= 20
    && (growthDeteriorating || item.scores.risk >= 55 || item.scores.businessQuality < 65);

  const seriousWatchOut = eligibleExchange
    && sensiblePrice
    && watchOutLiquid
    && item.scores.risk >= 80
    && item.scores.evidenceCompleteness >= 65
    && directStress;

  const qualityWatch = !seriousBuy
    && !seriousSell
    && !seriousWatchOut
    && eligibleExchange
    && sensiblePrice
    && supportedGeneralModel
    && liquid
    && item.scores.businessQuality >= 70
    && item.scores.risk <= 50
    && item.fairValue.baseValue !== null;

  let action: UsValueCompanyAnalysis["decision"]["action"] = "no_action";
  let tier: UsValueCompanyAnalysis["decision"]["tier"] = item.fairValue.baseValue === null
    ? "insufficient_evidence"
    : "research_only";
  let publicationStatus: UsValueCompanyAnalysis["decision"]["publicationStatus"] = "research_only";
  const reasons: string[] = [];
  const blockers: string[] = [];

  if (seriousBuy) {
    action = "buy";
    tier = "serious_foundation_buy";
    publicationStatus = "serious_internal_review_only";
    reasons.push(`Current price $${item.currentPrice.toFixed(2)} is below every accepted valuation method and ${(diagnostics.conservativeUpsidePercent ?? 0).toFixed(1)}% below the lowest fair-value estimate.`);
    reasons.push(`Base fair value is $${item.fairValue.baseValue!.toFixed(2)}, implying ${(item.fairValue.upsideToBasePercent ?? 0).toFixed(1)}% potential upside before any new catalyst.`);
    reasons.push(`Business quality is ${item.scores.businessQuality}/100, risk is ${item.scores.risk}/100, and valuation-method spread is ${(diagnostics.methodSpreadPercent ?? 0).toFixed(1)}%.`);
  } else if (seriousSell) {
    action = "sell";
    tier = "serious_foundation_sell";
    publicationStatus = "serious_internal_review_only";
    reasons.push(`Current price $${item.currentPrice.toFixed(2)} is ${(diagnostics.premiumToBasePercent ?? 0).toFixed(1)}% above base fair value and ${(diagnostics.premiumToOptimisticPercent ?? 0).toFixed(1)}% above the highest accepted estimate.`);
    reasons.push(`The premium is not supported by current growth, quality, or risk: quality ${item.scores.businessQuality}/100 and risk ${item.scores.risk}/100.`);
  } else if (seriousWatchOut) {
    action = "watch_out";
    tier = "serious_foundation_watch_out";
    publicationStatus = "serious_internal_review_only";
    reasons.push(`Fundamental danger is ${item.scores.risk}/100, with direct cash-flow, profit, liquidity, or leverage stress.`);
    reasons.push("The warning does not predict an exact price target; it says the business may be too fragile for ordinary valuation assumptions.");
  } else if (qualityWatch) {
    action = "watch";
    tier = "quality_price_watchlist";
    publicationStatus = "watchlist_internal";
    reasons.push(`Business quality is ${item.scores.businessQuality}/100, but the current price is not yet safely below the conservative valuation range.`);
    reasons.push(`Preferred buy-below level is $${(item.fairValue.buyBelowPrice ?? item.fairValue.baseValue ?? 0).toFixed(2)}.`);
  }

  if (!eligibleExchange) blockers.push("Not listed on Nasdaq, NYSE, or NYSE American; excluded from PR #262 serious foundation alerts.");
  if (!sensiblePrice) blockers.push("Current price is below $1 or invalid; serious foundation promotion is blocked.");
  if (!liquid) blockers.push("Market capitalization or average dollar trading volume is below the serious Buy/Sell threshold.");
  if (specialistSector) blockers.push("Banks, insurers, real estate, and utilities require a specialist sector valuation model before serious Buy/Sell promotion.");
  if (item.fairValue.methods.length < 2) blockers.push("Fewer than two independent fair-value methods are available.");
  if (!methodAgreement) blockers.push("The fair-value methods disagree too widely for a serious directional alert.");
  if ((diagnostics.conservativeUpsidePercent ?? -Infinity) < 20) blockers.push("The current price is not at least 20% below the lowest accepted fair-value estimate.");

  return {
    ...item,
    decision: {
      ...item.decision,
      action,
      tier,
      seriousSignal: seriousBuy || seriousSell || seriousWatchOut,
      publicationStatus,
      evidenceTriggered: seriousBuy || seriousSell || seriousWatchOut,
      reasons,
      blockers: [...new Set(blockers)],
    },
  };
}

function buildHardened(raw: UsValueInvestingCycle): HardenedUsValueInvestingCycle {
  const eligible = raw.analyses
    .filter((item) => ELIGIBLE_EXCHANGES.has(item.exchange.toUpperCase()))
    .map(hardenCompany);
  const seriousBuy = eligible
    .filter((item) => item.decision.tier === "serious_foundation_buy")
    .sort((left, right) => (right.fairValue.upsideToBasePercent ?? -Infinity) - (left.fairValue.upsideToBasePercent ?? -Infinity));
  const seriousSell = eligible
    .filter((item) => item.decision.tier === "serious_foundation_sell")
    .sort((left, right) => (left.fairValue.upsideToBasePercent ?? Infinity) - (right.fairValue.upsideToBasePercent ?? Infinity));
  const seriousWatchOut = eligible
    .filter((item) => item.decision.tier === "serious_foundation_watch_out")
    .sort((left, right) => right.scores.risk - left.scores.risk);
  const qualityWatch = eligible
    .filter((item) => item.decision.tier === "quality_price_watchlist")
    .sort((left, right) => right.scores.businessQuality - left.scores.businessQuality);
  const researchOnly = eligible.filter((item) => ["research_only", "insufficient_evidence"].includes(item.decision.tier));
  const excluded = Math.max(0, raw.coverage.totalProviderRows - eligible.length);
  const coveragePercent = eligible.length > 0 ? 100 : 0;

  return {
    ...raw,
    ok: raw.coverage.pagesFailed === 0 && eligible.length > 0,
    methodology: {
      ...raw.methodology,
      safetyOverlay: "us_value_alert_safety_v2",
      specialistSectorModelsRequired: true,
      minimumConservativeValueUpsidePercent: 20,
      maximumValuationMethodSpreadPercent: 60,
      minimumSeriousAlertPrice: 1,
    },
    coverage: {
      ...raw.coverage,
      usPrimaryListings: eligible.length,
      companiesAnalyzed: eligible.length,
      companiesWithFairValue: eligible.filter((item) => item.fairValue.baseValue !== null).length,
      companiesWithoutFairValue: eligible.filter((item) => item.fairValue.baseValue === null).length,
      processingCoveragePercent: rounded(coveragePercent) ?? 0,
      providerRowsExcludedOutsideEligibleExchanges: excluded,
      eligibleExchangeCoveragePercent: rounded(coveragePercent) ?? 0,
    },
    seriousAlerts: {
      buy: seriousBuy.slice(0, 250),
      sell: seriousSell.slice(0, 250),
      watchOut: seriousWatchOut.slice(0, 250),
    },
    watchlists: {
      qualityWaitingForPrice: qualityWatch.slice(0, 1_000),
      researchOnly,
    },
    analyses: eligible,
    warehouse: {
      ...raw.warehouse,
      storage: "not_persisted",
      immutableRunKey: null,
      shardKeys: [],
      persistedThisCycle: false,
      companyRecordsStored: 0,
      errors: [],
    },
  };
}

async function persistHardened(result: HardenedUsValueInvestingCycle) {
  const errors: string[] = [];
  const shardKeys: string[] = [];
  const now = Date.now();
  const shouldPersist = !SAFETY_STATE.persistedAt || now - SAFETY_STATE.persistedAt >= PERSIST_MS;
  if (!getR2Config().configured) {
    return {
      available: false,
      persistedThisCycle: false,
      shardKeys,
      immutableRunKey: null as string | null,
      companyRecordsStored: 0,
      errors,
    };
  }
  if (!shouldPersist && SAFETY_STATE.warehouse) {
    return {
      available: true,
      persistedThisCycle: false,
      shardKeys: SAFETY_STATE.warehouse.shardKeys,
      immutableRunKey: SAFETY_STATE.warehouse.immutableRunKey,
      companyRecordsStored: SAFETY_STATE.warehouse.companyRecordsStored,
      errors,
    };
  }
  try {
    const shardNumbers = Array.from(
      { length: Math.ceil(result.analyses.length / SHARD_SIZE) },
      (_, shardNumber) => shardNumber,
    );
    let cursor = 0;
    const shardWriteErrors: unknown[] = [];
    await Promise.all(Array.from(
      { length: Math.min(SHARD_WRITE_CONCURRENCY, Math.max(1, shardNumbers.length)) },
      async () => {
        while (cursor < shardNumbers.length) {
          const shardNumber = shardNumbers[cursor++];
          const index = shardNumber * SHARD_SIZE;
          const key = `${R2_PREFIX}/latest/shard-${String(shardNumber).padStart(3, "0")}.json`;
          try {
            await writeVersionedJsonToR2(key, {
              version: 2,
              safetyOverlay: "us_value_alert_safety_v2",
              checkedAt: result.checkedAt,
              shardNumber,
              companies: result.analyses.slice(index, index + SHARD_SIZE),
            });
            shardKeys[shardNumber] = key;
          } catch (error) {
            shardWriteErrors.push(error);
          }
        }
      },
    ));
    if (shardWriteErrors.length) throw shardWriteErrors[0];
    const immutableRunKey = `${R2_PREFIX}/runs/${result.checkedAt.slice(0, 10)}/${dateKey(result.checkedAt)}.json`;
    const summary = {
      version: 2,
      safetyOverlay: "us_value_alert_safety_v2",
      checkedAt: result.checkedAt,
      marketScope: result.marketScope,
      methodology: result.methodology,
      coverage: result.coverage,
      seriousAlerts: result.seriousAlerts,
      watchlists: {
        qualityWaitingForPrice: result.watchlists.qualityWaitingForPrice,
        researchOnlyCount: result.watchlists.researchOnly.length,
      },
      shardKeys,
      companyRecordsStored: result.analyses.length,
      safety: result.safety,
    };
    await writeVersionedJsonToR2(LATEST_INDEX_KEY, summary);
    await writeVersionedJsonToR2(immutableRunKey, summary, { createOnly: true });
    SAFETY_STATE.persistedAt = now;
    SAFETY_STATE.warehouse = {
      shardKeys: [...shardKeys],
      immutableRunKey,
      companyRecordsStored: result.analyses.length,
    };
    return {
      available: true,
      persistedThisCycle: true,
      shardKeys,
      immutableRunKey,
      companyRecordsStored: result.analyses.length,
      errors,
    };
  } catch (error) {
    errors.push(safeError(error));
    return {
      available: Boolean(SAFETY_STATE.warehouse),
      persistedThisCycle: false,
      shardKeys: SAFETY_STATE.warehouse?.shardKeys ?? shardKeys,
      immutableRunKey: SAFETY_STATE.warehouse?.immutableRunKey ?? null,
      companyRecordsStored: SAFETY_STATE.warehouse?.companyRecordsStored ?? 0,
      errors,
    };
  }
}

export async function persistHardenedUsValueInvestingCycle(
  result: HardenedUsValueInvestingCycle,
): Promise<HardenedUsValueInvestingCycle> {
  const persisted = await persistHardened(result);
  result.warehouse = {
    ...result.warehouse,
    storage: persisted.available ? "cloudflare_r2" : "not_persisted",
    immutableRunKey: persisted.immutableRunKey,
    shardKeys: persisted.shardKeys,
    persistedThisCycle: persisted.persistedThisCycle,
    companyRecordsStored: persisted.companyRecordsStored,
    errors: persisted.errors,
  };
  return result;
}

export async function hardenAndPersistUsValueInvestingCycle(
  raw: UsValueInvestingCycle,
  options: { persist?: boolean } = {},
): Promise<HardenedUsValueInvestingCycle> {
  const result = buildHardened(raw);
  return options.persist === false
    ? result
    : persistHardenedUsValueInvestingCycle(result);
}

export function hardenUsValueInvestingCycleForTest(raw: UsValueInvestingCycle) {
  return buildHardened(raw);
}
