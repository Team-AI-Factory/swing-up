export type SeriousAlertAction = "buy" | "sell" | "watch_out";
export type SeriousAlertStatus = "certified" | "historical_research" | "live_research" | "blocked_missing_data";

export type OpportunityFamily = {
  id: string;
  action: SeriousAlertAction;
  label: string;
  meaning: string;
  requiredEvidence: string[];
  status: SeriousAlertStatus;
  seriousSignalEnabled: boolean;
  certificationRuleId: string | null;
};

export const CERTIFIED_EXTREME_VOLATILITY_RULE = {
  id: "watch_out_30d_extreme_volatility_after_60pct_drawdown_v2",
  action: "watch_out" as const,
  subtype: "extreme_volatility_direction_uncertain" as const,
  horizonTradingDays: 30 as const,
  trailing120SessionDrawdownMaximumPercent: -60 as const,
  futureMoveThresholdPercent: 12 as const,
  successDefinition: "Within the following 30 trading sessions, the security rises at least 12% or falls at least 12% from the alert close.",
  userMeaning: "A large price swing is likely to continue. Direction is uncertain; this is a risk warning, not a Sell instruction.",
  certification: {
    source: "Independent external holdout using real adjusted daily prices",
    checkedAt: "2026-07-22T13:54:40.762236+00:00",
    sampleSize: 41,
    wins: 40,
    losses: 1,
    observedPrecision: 40 / 41,
    lowerConfidenceBound90: 0.9084101591477487,
    uniqueTickers: 25,
    noSyntheticData: true as const,
  },
};

export const OPPORTUNITY_FAMILIES: OpportunityFamily[] = [
  {
    id: "buy_quality_value_dislocation",
    action: "buy",
    label: "Quality business at a discounted valuation",
    meaning: "The company remains financially strong while its market valuation has fallen below a defensible range.",
    requiredEvidence: ["current fundamentals", "trailing valuation", "forward estimates", "peer valuation", "price confirmation"],
    status: "historical_research",
    seriousSignalEnabled: false,
    certificationRuleId: null,
  },
  {
    id: "buy_earnings_revision_acceleration",
    action: "buy",
    label: "Positive expectations revision",
    meaning: "Analyst estimates and company guidance are improving faster than the current price appears to reflect.",
    requiredEvidence: ["point-in-time estimates", "guidance changes", "earnings surprise", "target revisions", "fresh price"],
    status: "blocked_missing_data",
    seriousSignalEnabled: false,
    certificationRuleId: null,
  },
  {
    id: "buy_catalyst_repricing",
    action: "buy",
    label: "Positive catalyst not fully priced in",
    meaning: "A verified event improves future cash flow or reduces risk before the market has fully repriced it.",
    requiredEvidence: ["two independent event receipts", "thesis impact", "valuation scenario", "volume and price response"],
    status: "live_research",
    seriousSignalEnabled: false,
    certificationRuleId: null,
  },
  {
    id: "buy_oversold_recovery",
    action: "buy",
    label: "Oversold recovery",
    meaning: "A heavily sold security begins recovering while business evidence remains intact.",
    requiredEvidence: ["drawdown", "reversal confirmation", "liquidity", "business thesis", "downside scenario"],
    status: "historical_research",
    seriousSignalEnabled: false,
    certificationRuleId: null,
  },
  {
    id: "buy_breakout_momentum",
    action: "buy",
    label: "Breakout with confirmation",
    meaning: "Price, volume and relative strength confirm a new upward regime with a defined exit condition.",
    requiredEvidence: ["adjusted price history", "volume", "relative strength", "market regime", "risk limit"],
    status: "historical_research",
    seriousSignalEnabled: false,
    certificationRuleId: null,
  },
  {
    id: "buy_special_situation",
    action: "buy",
    label: "Special situation",
    meaning: "A merger, spin-off, restructuring, tender, approval or other dated event creates a measurable payoff.",
    requiredEvidence: ["official event terms", "dated path", "probabilities", "payoffs", "liquidity"],
    status: "blocked_missing_data",
    seriousSignalEnabled: false,
    certificationRuleId: null,
  },
  {
    id: "sell_thesis_break",
    action: "sell",
    label: "Investment thesis broken",
    meaning: "New verified evidence invalidates a core reason for owning the security.",
    requiredEvidence: ["stored thesis", "new official evidence", "materiality", "valuation impact", "price confirmation"],
    status: "live_research",
    seriousSignalEnabled: false,
    certificationRuleId: null,
  },
  {
    id: "sell_earnings_deterioration",
    action: "sell",
    label: "Earnings and guidance deterioration",
    meaning: "Revenue, margins, cash flow or guidance weaken beyond what the market currently expects.",
    requiredEvidence: ["point-in-time estimates", "guidance", "reported results", "revision history", "fresh price"],
    status: "blocked_missing_data",
    seriousSignalEnabled: false,
    certificationRuleId: null,
  },
  {
    id: "sell_valuation_compression",
    action: "sell",
    label: "Overvaluation with slowing growth",
    meaning: "The price requires unrealistic growth while operating momentum is weakening.",
    requiredEvidence: ["forward valuation", "growth deceleration", "cash flow", "peer range", "bear scenario"],
    status: "historical_research",
    seriousSignalEnabled: false,
    certificationRuleId: null,
  },
  {
    id: "sell_balance_sheet_stress",
    action: "sell",
    label: "Balance-sheet or liquidity stress",
    meaning: "Debt, refinancing, cash burn or covenant pressure creates a material loss risk.",
    requiredEvidence: ["current debt", "cash runway", "maturity schedule", "interest burden", "official filings"],
    status: "blocked_missing_data",
    seriousSignalEnabled: false,
    certificationRuleId: null,
  },
  {
    id: "sell_dilution_or_governance",
    action: "sell",
    label: "Dilution or governance deterioration",
    meaning: "New issuance, insider behaviour, accounting concerns or governance changes impair shareholder value.",
    requiredEvidence: ["official filing", "share-count history", "insider or governance evidence", "materiality"],
    status: "live_research",
    seriousSignalEnabled: false,
    certificationRuleId: null,
  },
  {
    id: "sell_technical_breakdown",
    action: "sell",
    label: "Confirmed technical breakdown",
    meaning: "Price, volume and relative weakness indicate a persistent downward regime rather than normal volatility.",
    requiredEvidence: ["adjusted price history", "volume", "relative strength", "market regime", "rebound filter"],
    status: "historical_research",
    seriousSignalEnabled: false,
    certificationRuleId: null,
  },
  {
    id: "watch_out_extreme_volatility",
    action: "watch_out",
    label: "Certified extreme volatility",
    meaning: CERTIFIED_EXTREME_VOLATILITY_RULE.userMeaning,
    requiredEvidence: ["fresh adjusted daily history", "120-session high", "current price", "source agreement", "liquidity"],
    status: "certified",
    seriousSignalEnabled: true,
    certificationRuleId: CERTIFIED_EXTREME_VOLATILITY_RULE.id,
  },
  {
    id: "watch_out_liquidity_gap",
    action: "watch_out",
    label: "Liquidity or gap risk",
    meaning: "Thin trading, large gaps or abnormal volume may make normal entry and exit assumptions unsafe.",
    requiredEvidence: ["spread or liquidity", "volume history", "gap history", "market status"],
    status: "historical_research",
    seriousSignalEnabled: false,
    certificationRuleId: null,
  },
  {
    id: "watch_out_accounting_regulatory",
    action: "watch_out",
    label: "Accounting or regulatory risk",
    meaning: "A filing, regulator, auditor or legal event may create a discontinuous downside outcome.",
    requiredEvidence: ["official receipt", "independent confirmation", "materiality", "affected thesis pillars"],
    status: "live_research",
    seriousSignalEnabled: false,
    certificationRuleId: null,
  },
  {
    id: "watch_out_source_conflict",
    action: "watch_out",
    label: "Data-source contradiction",
    meaning: "Independent providers disagree materially, so the asset should not receive a directional alert.",
    requiredEvidence: ["two or more independent sources", "conflict measurement", "freshness"],
    status: "live_research",
    seriousSignalEnabled: false,
    certificationRuleId: null,
  },
  {
    id: "watch_out_crowded_positioning",
    action: "watch_out",
    label: "Crowded positioning or squeeze risk",
    meaning: "Options, short interest or concentrated positioning may create an unusually violent move.",
    requiredEvidence: ["short interest", "options positioning", "borrow cost", "volume", "price history"],
    status: "blocked_missing_data",
    seriousSignalEnabled: false,
    certificationRuleId: null,
  },
];

export function opportunityCoverageSummary() {
  const byAction = (action: SeriousAlertAction) => OPPORTUNITY_FAMILIES.filter((family) => family.action === action);
  return {
    buy: byAction("buy"),
    sell: byAction("sell"),
    watchOut: byAction("watch_out"),
    certifiedRuleIds: OPPORTUNITY_FAMILIES.filter((family) => family.seriousSignalEnabled).flatMap((family) => family.certificationRuleId ?? []),
    seriousSignalPolicy: "This worldwide registry can promote only the existing certified US-scope extreme-volatility Watch Out rule. Proposed Watch Out rules and non-US listings remain research-only. Current-event Buy, Sell, or Watch permission is handled separately by the US event-first current-evidence and full-committee path and does not require historical analogues.",
  };
}
