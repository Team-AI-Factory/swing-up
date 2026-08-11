import type {
  ActiveSeriousSignal,
  UsSignalOperationsReport,
} from "@/lib/opportunity-engine/us-signal-operations";

export type RejectedSeriousSignal = {
  ticker: string;
  company: string;
  action: "buy" | "sell" | "watch_out";
  source: string;
  fingerprint: string;
  reasons: string[];
};

export type VerifiedSeriousSignalReport = {
  version: 1;
  policy: "pr262_authoritative_valuation_consistency_v1";
  sourceCheckedAt: string;
  verifiedAt: string;
  rawCounts: { buy: number; sell: number; watchOut: number };
  verifiedCounts: { buy: number; sell: number; watchOut: number };
  seriousSignals: {
    buy: ActiveSeriousSignal[];
    sell: ActiveSeriousSignal[];
    watchOut: ActiveSeriousSignal[];
  };
  rejected: RejectedSeriousSignal[];
  invariants: {
    specialistModelOverridesGenericThresholds: true;
    displayedPotentialMustMatchDisplayedBaseFairValue: true;
    generalModelFairValueRangeMustBeOrdered: true;
    generalModelBuyMustRemainBelowConservativeFairValue: true;
    specialistBuyRequiresThirtyPercentMarginToSpecialistFairValue: true;
    unsupportedPharmaGeneralModelCannotPromoteSeriousBuy: true;
    eventPilotRequiresHistoricalPilot: true;
    fullCommitteeAndFinalJudgeRequired: true;
  };
};

const UNSUPPORTED_GENERAL_PHARMA = /\b(?:pharma|pharmaceuticals?|biotech|biotechnology|therapeutics|biosciences?|biopharma)\b/i;

function finite(value: number | null): value is number {
  return value !== null && Number.isFinite(value);
}

function calculatedPotential(price: number, fairValue: number) {
  return (fairValue / price - 1) * 100;
}

function verifyBuy(signal: ActiveSeriousSignal) {
  const blockers: string[] = [];
  const price = signal.currentPrice;
  const base = signal.baseFairValue;
  const conservative = signal.conservativeFairValue;
  const optimistic = signal.optimisticFairValue;
  const specialist = signal.evidence.specialistModel;

  if (!finite(price) || price <= 0) blockers.push("No usable positive current price is attached to the signal.");
  if (!finite(base) || base <= 0) blockers.push("No usable authoritative base fair value is attached to the signal.");
  if (!signal.evidence.priceCrossChecked) blockers.push("The current price was not independently cross-checked.");
  if (!signal.evidence.secDiligenceConfirmed) blockers.push("Official SEC/company diligence did not confirm the Buy case.");
  if (signal.source === "event_pilot" && signal.evidence.historicalPilotPassed !== true) {
    blockers.push("The event-driven Buy did not pass the mandatory Pilot 5 historical gate.");
  }

  if (finite(price) && finite(base) && price > 0 && base > 0) {
    const expected = calculatedPotential(price, base);
    if (!finite(signal.potentialPercent) || Math.abs(expected - signal.potentialPercent) > 1) {
      blockers.push("Displayed potential return does not reconcile with the displayed current price and authoritative base fair value.");
    }
    if (expected <= 0) blockers.push("The authoritative base fair value is not above the current price.");
  }

  if (specialist === "general") {
    if (finite(conservative) && finite(base) && finite(optimistic)) {
      if (!(conservative <= base && base <= optimistic)) {
        blockers.push("The conservative, base, and optimistic fair values are internally inconsistent.");
      }
      if (finite(price) && price >= conservative) {
        blockers.push("The current price is not below the conservative fair-value estimate.");
      }
    } else {
      blockers.push("The general-model Buy does not have a complete conservative/base/optimistic fair-value range.");
    }
    if (UNSUPPORTED_GENERAL_PHARMA.test(`${signal.company} ${signal.ticker}`)) {
      blockers.push("A pharmaceutical/biotech company cannot use the ordinary general model for a Serious Buy; product, patent, pipeline, royalty, and regulatory economics require a specialist model.");
    }
  } else {
    if (signal.evidence.longTermNormalizationPassed !== true) {
      blockers.push("The specialist-model Buy does not have confirmed long-term normalization.");
    }
    if (finite(price) && finite(base) && price > base * 0.70) {
      blockers.push("The price is not at least 30% below the authoritative specialist fair value.");
    }
    if (finite(conservative) && finite(base) && conservative > base * 1.25) {
      blockers.push("Generic conservative value materially conflicts with the specialist fair value; the specialist model must be the single valuation authority.");
    }
  }

  return [...new Set(blockers)];
}

function basicSignalChecks(signal: ActiveSeriousSignal) {
  const blockers: string[] = [];
  if (!signal.ticker || !signal.company) blockers.push("Issuer identity is incomplete.");
  if (!signal.fingerprint) blockers.push("Stable signal fingerprint is missing.");
  if (!signal.evidence.officialSourceConfirmed) blockers.push("Official or primary evidence is not confirmed.");
  if (signal.action !== "watch_out" && !signal.evidence.priceCrossChecked) blockers.push("Actionable Buy/Sell price is not independently cross-checked.");
  if (signal.evidence.committeeApproved !== true) blockers.push("The full AI committee did not approve this signal.");
  if (signal.evidence.committeeAgentsCompleted !== 14 || signal.evidence.committeeAgentsFailed !== 0) {
    blockers.push("All 13 specialists plus the Final Judge did not complete successfully.");
  }
  if (signal.evidence.finalJudgePositive !== true || (signal.evidence.finalJudgeConfidence ?? 0) < 80) {
    blockers.push("The Final Judge did not return a positive verdict at 80% confidence or higher.");
  }
  return blockers;
}

export function verifyUsSeriousSignals(
  report: UsSignalOperationsReport,
  verifiedAt = new Date().toISOString(),
): VerifiedSeriousSignalReport {
  const rejected: RejectedSeriousSignal[] = [];
  const verifiedBuy: ActiveSeriousSignal[] = [];
  const verifiedSell: ActiveSeriousSignal[] = [];
  const verifiedWatchOut: ActiveSeriousSignal[] = [];

  for (const signal of report.seriousSignals.buy) {
    const blockers = [...basicSignalChecks(signal), ...verifyBuy(signal)];
    if (!blockers.length) verifiedBuy.push(signal);
    else rejected.push({
      ticker: signal.ticker,
      company: signal.company,
      action: signal.action,
      source: signal.source,
      fingerprint: signal.fingerprint,
      reasons: [...new Set(blockers)],
    });
  }

  for (const signal of report.seriousSignals.sell) {
    const blockers = basicSignalChecks(signal);
    if (!blockers.length) verifiedSell.push(signal);
    else rejected.push({
      ticker: signal.ticker,
      company: signal.company,
      action: signal.action,
      source: signal.source,
      fingerprint: signal.fingerprint,
      reasons: [...new Set(blockers)],
    });
  }

  for (const signal of report.seriousSignals.watchOut) {
    const blockers = basicSignalChecks(signal);
    if (!blockers.length) verifiedWatchOut.push(signal);
    else rejected.push({
      ticker: signal.ticker,
      company: signal.company,
      action: signal.action,
      source: signal.source,
      fingerprint: signal.fingerprint,
      reasons: [...new Set(blockers)],
    });
  }

  return {
    version: 1,
    policy: "pr262_authoritative_valuation_consistency_v1",
    sourceCheckedAt: report.checkedAt,
    verifiedAt,
    rawCounts: {
      buy: report.seriousSignals.buy.length,
      sell: report.seriousSignals.sell.length,
      watchOut: report.seriousSignals.watchOut.length,
    },
    verifiedCounts: {
      buy: verifiedBuy.length,
      sell: verifiedSell.length,
      watchOut: verifiedWatchOut.length,
    },
    seriousSignals: {
      buy: verifiedBuy,
      sell: verifiedSell,
      watchOut: verifiedWatchOut,
    },
    rejected,
    invariants: {
      specialistModelOverridesGenericThresholds: true,
      displayedPotentialMustMatchDisplayedBaseFairValue: true,
      generalModelFairValueRangeMustBeOrdered: true,
      generalModelBuyMustRemainBelowConservativeFairValue: true,
      specialistBuyRequiresThirtyPercentMarginToSpecialistFairValue: true,
      unsupportedPharmaGeneralModelCannotPromoteSeriousBuy: true,
      eventPilotRequiresHistoricalPilot: true,
      fullCommitteeAndFinalJudgeRequired: true,
    },
  };
}
