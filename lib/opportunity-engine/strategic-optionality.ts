export type StrategicOptionalityAssessment = {
  version: 1;
  detected: boolean;
  relatedEntities: string[];
  layers: {
    equityInvestment: boolean;
    commercialRelationship: boolean;
    infrastructureDemand: boolean;
    liquidityEvent: boolean;
    markToMarketOrNonOperatingGain: boolean;
    futureFundingCommitment: boolean;
  };
  optionalityScore: number;
  confidence: number;
  baseFairValueAdjustmentPercent: 0;
  valuationTreatment: {
    recurringOperatingProfitSeparatedFromInvestmentGains: true;
    unquantifiedFutureRevenueAddedToBaseFairValue: false;
    strategicOptionalityMayStrengthenUpsideScenario: boolean;
    doubleCountingGuard: true;
  };
  supportiveFactors: string[];
  risks: string[];
};

const KNOWN_PRIVATE_STRATEGIC_ENTITIES = [
  "Anthropic",
  "OpenAI",
  "SpaceX",
  "xAI",
  "Scale AI",
  "Databricks",
  "Stripe",
  "Waymo",
] as const;

function contains(text: string, pattern: RegExp) {
  return pattern.test(text);
}

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function relationEntities(text: string) {
  const known = KNOWN_PRIVATE_STRATEGIC_ENTITIES.filter((name) => new RegExp(`\\b${name.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}\\b`, "i").test(text));
  const captured: string[] = [];
  const patterns = [
    /(?:investment|invested|investments)\s+(?:of\s+[^.]{0,40}\s+)?(?:in|into)\s+([A-Z][A-Za-z0-9&.' -]{2,55})/g,
    /(?:commercial arrangement|strategic collaboration|strategic partnership|collaboration|partnership)\s+(?:primarily\s+)?(?:with|between)\s+([A-Z][A-Za-z0-9&.' -]{2,55})/g,
    /(?:preferred stock|convertible notes?|equity)\s+(?:in|of)\s+([A-Z][A-Za-z0-9&.' -]{2,55})/g,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const value = String(match[1] ?? "")
        .replace(/\b(?:and|which|that|with|for|under|pursuant|primarily)\b.*$/i, "")
        .replace(/[,:;].*$/, "")
        .trim();
      if (value.length >= 3 && value.length <= 55) captured.push(value);
    }
  }
  return unique([...known, ...captured]).slice(0, 12);
}

export function assessStrategicOptionality(sourceText: string): StrategicOptionalityAssessment {
  const value = sourceText.replace(/\s+/g, " ").trim();
  const equityInvestment = contains(value, /\b(?:investment|invested|preferred stock|common stock|equity investment|convertible note|warrant)\b/i);
  const commercialRelationship = contains(value, /\b(?:commercial arrangement|strategic collaboration|strategic partnership|cloud services|cloud service|customer|bedrock|compute services|compute capacity)\b/i);
  const infrastructureDemand = contains(value, /\b(?:trainium|gpu|chips?|compute capacity|data cent(?:er|re)|infrastructure|gigawatts?|accelerator)\b/i);
  const liquidityEvent = contains(value, /\b(?:initial public offering|\bIPO\b|direct listing|liquidity event|public listing)\b/i);
  const markToMarketOrNonOperatingGain = contains(value, /\b(?:unrealized gain|fair value adjustment|observable changes in prices|other income|non-operating income|nonoperating income|mark.to.market)\b/i);
  const futureFundingCommitment = contains(value, /\b(?:commitment|facility|option to invest|future funding|capital commitment|contractual obligations?|make available)\b/i);
  const relatedEntities = relationEntities(value);
  const detected = relatedEntities.length > 0 && (equityInvestment || commercialRelationship || liquidityEvent);

  let score = 0;
  if (equityInvestment) score += 20;
  if (commercialRelationship) score += 25;
  if (infrastructureDemand) score += 15;
  if (liquidityEvent) score += 15;
  if (markToMarketOrNonOperatingGain) score += 10;
  if (futureFundingCommitment) score += 5;
  if (relatedEntities.length) score += 10;
  score = Math.min(100, score);

  const supportiveFactors = [
    ...(equityInvestment ? ["A strategic equity or convertible investment can create asset-value upside separate from the operating business."] : []),
    ...(commercialRelationship ? ["A commercial relationship can create recurring product, cloud, or service revenue in addition to investment value."] : []),
    ...(infrastructureDemand ? ["The relationship can create infrastructure, compute, or chip demand that feeds the operating business."] : []),
    ...(liquidityEvent ? ["A future IPO, direct listing, or other liquidity event can improve price discovery and monetisation of the strategic asset."] : []),
    ...(relatedEntities.length ? [`Named strategic relationships detected: ${relatedEntities.join(", ")}.`] : []),
  ];
  const risks = [
    ...(markToMarketOrNonOperatingGain ? ["Investment revaluation gains are separated from recurring operating profit; they must not be annualised as ordinary earnings."] : []),
    ...(futureFundingCommitment ? ["Future funding or contractual commitments can consume cash and must be netted against the upside from the relationship."] : []),
    ...(equityInvestment ? ["Private-company valuations can fall before a liquidity event and may remain illiquid for longer than expected."] : []),
    ...(commercialRelationship ? ["Future commercial revenue is not counted in base fair value unless contract economics and timing are sufficiently disclosed."] : []),
  ];

  return {
    version: 1,
    detected,
    relatedEntities,
    layers: {
      equityInvestment,
      commercialRelationship,
      infrastructureDemand,
      liquidityEvent,
      markToMarketOrNonOperatingGain,
      futureFundingCommitment,
    },
    optionalityScore: score,
    confidence: detected ? Math.min(90, 45 + score / 2) : 20,
    baseFairValueAdjustmentPercent: 0,
    valuationTreatment: {
      recurringOperatingProfitSeparatedFromInvestmentGains: true,
      unquantifiedFutureRevenueAddedToBaseFairValue: false,
      strategicOptionalityMayStrengthenUpsideScenario: detected && (commercialRelationship || liquidityEvent || infrastructureDemand),
      doubleCountingGuard: true,
    },
    supportiveFactors,
    risks,
  };
}
