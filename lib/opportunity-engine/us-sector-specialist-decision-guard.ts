import {
  evaluateSectorSpecialistIntelligence,
  type EvidenceMetric,
  type SpecialistIntelligenceInput,
  type SectorSpecialistIntelligence,
} from "@/lib/opportunity-engine/us-sector-specialist-intelligence";

type CriticalMetric = {
  key: string;
  metric: EvidenceMetric | undefined;
  maximumAgeDays: number;
  mandatory: boolean;
};

type CriticalProfile = {
  metrics: CriticalMetric[];
  minimumTrustedCoveragePercent: number;
};

const TRUSTED_PRIMARY_SOURCE_TYPES = new Set(["regulatory", "sec_filing", "company_ir"]);
const DAY_MS = 24 * 60 * 60_000;

function finite(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function ageDays(metric: EvidenceMetric, now: Date) {
  if (!metric.asOf) return null;
  const parsed = Date.parse(metric.asOf);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, (now.getTime() - parsed) / DAY_MS);
}

function trusted(metric: EvidenceMetric | undefined, now: Date, maximumAgeDays: number) {
  if (!metric || finite(metric.value) === null) return { ok: false, reason: "missing" as const };
  if (metric.conflict === true) return { ok: false, reason: "conflict" as const };
  if (metric.estimated === true) return { ok: false, reason: "estimated" as const };
  if (!metric.primarySource || !TRUSTED_PRIMARY_SOURCE_TYPES.has(metric.sourceType)) {
    return { ok: false, reason: "not_primary_source" as const };
  }
  const age = ageDays(metric, now);
  if (age === null) return { ok: false, reason: "undated" as const };
  if (age > maximumAgeDays) return { ok: false, reason: "stale" as const };
  return { ok: true, reason: null };
}

function criticalProfile(input: SpecialistIntelligenceInput): CriticalProfile {
  const kind = input.baseline.sectorKind;
  if (kind === "bank") {
    const e = input.evidence?.bank;
    return {
      minimumTrustedCoveragePercent: 75,
      metrics: [
        { key: "tangible_book_value_per_share", metric: e?.tangibleBookValuePerShare, maximumAgeDays: 220, mandatory: false },
        { key: "return_on_tangible_common_equity", metric: e?.returnOnTangibleCommonEquityPercent, maximumAgeDays: 220, mandatory: false },
        { key: "cet1_ratio", metric: e?.cet1RatioPercent, maximumAgeDays: 220, mandatory: true },
        { key: "net_interest_margin", metric: e?.netInterestMarginPercent, maximumAgeDays: 220, mandatory: false },
        { key: "deposit_growth", metric: e?.depositGrowthPercent, maximumAgeDays: 220, mandatory: true },
        { key: "nonperforming_loans", metric: e?.nonperformingLoanPercent, maximumAgeDays: 220, mandatory: true },
        { key: "net_charge_offs", metric: e?.netChargeOffPercent, maximumAgeDays: 220, mandatory: true },
      ],
    };
  }
  if (kind === "insurer") {
    const e = input.evidence?.insurer;
    const pc = /property|casualty|p&c|reinsurance/i.test(input.company.industry ?? "");
    return {
      minimumTrustedCoveragePercent: 75,
      metrics: [
        { key: "risk_based_capital", metric: e?.riskBasedCapitalPercent, maximumAgeDays: 400, mandatory: true },
        ...(pc ? [{ key: "combined_ratio", metric: e?.combinedRatioPercent, maximumAgeDays: 220, mandatory: true }] : []),
        { key: "premium_growth", metric: e?.premiumGrowthPercent, maximumAgeDays: 220, mandatory: false },
        { key: "reserve_development", metric: e?.adverseReserveDevelopmentPercent, maximumAgeDays: 220, mandatory: true },
        { key: "unrealized_losses_to_equity", metric: e?.unrealizedLossesToEquityPercent, maximumAgeDays: 220, mandatory: false },
      ],
    };
  }
  if (kind === "real_estate_reit") {
    const e = input.evidence?.reit;
    return {
      minimumTrustedCoveragePercent: 75,
      metrics: [
        { key: "ffo_or_affo_per_share", metric: e?.affoPerShare ?? e?.ffoPerShare, maximumAgeDays: 220, mandatory: true },
        { key: "same_store_noi_growth", metric: e?.sameStoreNoiGrowthPercent, maximumAgeDays: 220, mandatory: true },
        { key: "occupancy", metric: e?.occupancyPercent, maximumAgeDays: 220, mandatory: false },
        { key: "net_debt_to_ebitda", metric: e?.netDebtToEbitda, maximumAgeDays: 220, mandatory: true },
        { key: "debt_maturity_years", metric: e?.weightedAverageDebtMaturityYears, maximumAgeDays: 220, mandatory: true },
        { key: "nav_per_share", metric: e?.navPerShare, maximumAgeDays: 220, mandatory: false },
      ],
    };
  }
  if (kind === "utility") {
    const e = input.evidence?.utility;
    return {
      minimumTrustedCoveragePercent: 75,
      metrics: [
        { key: "rate_base_growth", metric: e?.rateBaseGrowthPercent, maximumAgeDays: 400, mandatory: false },
        { key: "allowed_roe", metric: e?.allowedRoePercent, maximumAgeDays: 550, mandatory: true },
        { key: "earned_roe", metric: e?.earnedRoePercent, maximumAgeDays: 220, mandatory: true },
        { key: "equity_capital_ratio", metric: e?.equityCapitalRatioPercent, maximumAgeDays: 220, mandatory: false },
        { key: "interest_coverage", metric: e?.interestCoverage, maximumAgeDays: 220, mandatory: true },
        { key: "debt_to_capital", metric: e?.debtToCapitalPercent, maximumAgeDays: 220, mandatory: true },
      ],
    };
  }

  const e = input.evidence?.financial;
  const industry = input.company.industry ?? "";
  if (/asset management|investment management|alternative asset|fund manager/i.test(industry)) {
    return {
      minimumTrustedCoveragePercent: 75,
      metrics: [
        { key: "aum_growth", metric: e?.assetsUnderManagementGrowthPercent, maximumAgeDays: 220, mandatory: true },
        { key: "net_flows_percent_of_aum", metric: e?.netFlowsPercentOfAum, maximumAgeDays: 220, mandatory: true },
        { key: "effective_fee_rate_bps", metric: e?.effectiveFeeRateBps, maximumAgeDays: 220, mandatory: false },
        { key: "operating_margin", metric: e?.operatingMarginPercent, maximumAgeDays: 220, mandatory: true },
      ],
    };
  }
  if (/broker|exchange|capital market|securities/i.test(industry)) {
    return {
      minimumTrustedCoveragePercent: 75,
      metrics: [
        { key: "client_assets_growth", metric: e?.clientAssetsGrowthPercent, maximumAgeDays: 220, mandatory: true },
        { key: "recurring_revenue", metric: e?.recurringRevenuePercent, maximumAgeDays: 220, mandatory: true },
        { key: "compensation_ratio", metric: e?.compensationRatioPercent, maximumAgeDays: 220, mandatory: false },
        { key: "operating_margin", metric: e?.operatingMarginPercent, maximumAgeDays: 220, mandatory: true },
      ],
    };
  }
  if (/credit|consumer finance|mortgage|lending|specialty finance/i.test(industry)) {
    return {
      minimumTrustedCoveragePercent: 75,
      metrics: [
        { key: "credit_loss_ratio", metric: e?.creditLossRatioPercent, maximumAgeDays: 220, mandatory: true },
        { key: "regulatory_capital_ratio", metric: e?.regulatoryCapitalRatioPercent, maximumAgeDays: 220, mandatory: false },
        { key: "net_leverage", metric: e?.netLeverage, maximumAgeDays: 220, mandatory: true },
        { key: "operating_margin", metric: e?.operatingMarginPercent, maximumAgeDays: 220, mandatory: true },
      ],
    };
  }
  return {
    minimumTrustedCoveragePercent: 100,
    metrics: [
      { key: "operating_margin", metric: e?.operatingMarginPercent, maximumAgeDays: 220, mandatory: true },
      { key: "recurring_revenue", metric: e?.recurringRevenuePercent, maximumAgeDays: 220, mandatory: true },
      { key: "net_leverage", metric: e?.netLeverage, maximumAgeDays: 220, mandatory: true },
    ],
  };
}

function adaptiveMovement(input: SpecialistIntelligenceInput) {
  const market = input.market ?? {};
  const p1 = finite(market.priceChange1dPercent);
  const s1 = finite(market.sectorChange1dPercent);
  const m1 = finite(market.marketChange1dPercent);
  const relative1d = p1 === null ? null : p1 - (s1 ?? m1 ?? 0);
  const relativeVolume = finite(market.relativeVolume);
  const volatility = Math.abs(finite(market.volatility20dPercent) ?? 0);
  const threshold = Math.max(1.5, Math.min(5, volatility > 0 ? volatility * 1.5 : 4));
  const unusual = Math.abs(relative1d ?? 0) >= threshold || (relativeVolume ?? 0) >= 2;
  return {
    relative1dPercent: relative1d,
    adaptiveThresholdPercent: Math.round(threshold * 100) / 100,
    unusual,
    reason: unusual
      ? `Adaptive movement trigger fired: stock moved ${relative1d === null ? "n/a" : `${relative1d.toFixed(1)}%`} versus sector/market; threshold ${threshold.toFixed(1)}%.`
      : null,
  };
}

export function evaluateFailClosedSectorSpecialist(input: SpecialistIntelligenceInput): SectorSpecialistIntelligence & {
  provenanceGuard: {
    passed: boolean;
    failedMetrics: Array<{ key: string; reason: string; mandatory: boolean }>;
    trustedCriticalMetrics: number;
    totalCriticalMetrics: number;
    trustedCoveragePercent: number;
    minimumTrustedCoveragePercent: number;
  };
  adaptiveMovement: {
    relative1dPercent: number | null;
    adaptiveThresholdPercent: number;
    unusual: boolean;
    reason: string | null;
  };
} {
  const now = new Date(input.evaluatedAt ?? new Date().toISOString());
  if (!Number.isFinite(now.getTime())) throw new Error("sector_specialist_guard_invalid_evaluated_at");
  const base = evaluateSectorSpecialistIntelligence(input);
  const profile = criticalProfile(input);
  const evaluated = profile.metrics.map((item) => ({ ...item, result: trusted(item.metric, now, item.maximumAgeDays) }));
  const failedMetrics = evaluated.flatMap((item) => item.result.ok ? [] : [{ key: item.key, reason: item.result.reason ?? "untrusted", mandatory: item.mandatory }]);
  const mandatoryFailures = failedMetrics.filter((item) => item.mandatory);
  const trustedCount = evaluated.filter((item) => item.result.ok).length;
  const trustedCoveragePercent = profile.metrics.length ? Math.round((trustedCount / profile.metrics.length) * 100) : 0;
  const guardPassed = profile.metrics.length > 0
    && mandatoryFailures.length === 0
    && trustedCoveragePercent >= profile.minimumTrustedCoveragePercent;
  const movement = adaptiveMovement(input);

  const provenanceGuard = {
    passed: guardPassed,
    failedMetrics,
    trustedCriticalMetrics: trustedCount,
    totalCriticalMetrics: profile.metrics.length,
    trustedCoveragePercent,
    minimumTrustedCoveragePercent: profile.minimumTrustedCoveragePercent,
  };

  if (guardPassed) {
    return {
      ...base,
      decision: {
        ...base.decision,
        urgentResearch: base.decision.urgentResearch || movement.unusual,
        reasons: [
          ...base.decision.reasons,
          ...(movement.reason ? [movement.reason] : []),
          ...(failedMetrics.length ? [`Trusted sector evidence coverage is ${trustedCoveragePercent}%; non-mandatory evidence still missing: ${failedMetrics.map((item) => item.key).join(", ")}.`] : []),
        ],
      },
      provenanceGuard,
      adaptiveMovement: movement,
    };
  }

  const urgentResearch = base.decision.urgentResearch || movement.unusual || base.decision.opportunityScore >= 58;
  const fallbackAction = base.decision.action === "watch_out" && base.evidence.decisionGrade
    ? "watch_out" as const
    : urgentResearch
      ? "watch" as const
      : "research_only" as const;
  return {
    ...base,
    evidence: { ...base.evidence, decisionGrade: false },
    decision: {
      ...base.decision,
      action: fallbackAction,
      foundationPromotionEligible: false,
      urgentResearch,
      reasons: [
        ...base.decision.reasons,
        ...(movement.reason ? [movement.reason] : []),
        `Directional promotion is blocked until every must-have sector fact is current and primary-source supported and trusted coverage reaches ${profile.minimumTrustedCoveragePercent}%.`,
      ],
      blockers: [
        ...base.decision.blockers,
        ...mandatoryFailures.map((item) => `Untrusted must-have metric: ${item.key} (${item.reason}).`),
        ...(trustedCoveragePercent < profile.minimumTrustedCoveragePercent ? [`Trusted sector evidence coverage ${trustedCoveragePercent}% is below ${profile.minimumTrustedCoveragePercent}%.`] : []),
      ],
    },
    provenanceGuard,
    adaptiveMovement: movement,
  };
}
