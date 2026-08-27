export type StrategicOptionalityAssessment = {
  version: 2;
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
  quantifiedEconomics: {
    disclosedCommercialCommitmentUsd: number | null;
    commercialCommitmentYears: number | null;
    annualizedDisclosedCommercialCommitmentUsd: number | null;
    disclosedInvestmentAmountUsd: number | null;
    disclosedFutureFundingCapacityUsd: number | null;
    disclosedValuesAreRevenueNotProfit: true;
  };
  optionalityScore: number;
  confidence: number;
  baseFairValueAdjustmentPercent: 0;
  valuationTreatment: {
    recurringOperatingProfitSeparatedFromInvestmentGains: true;
    quantifiedCommercialCommitmentsIncludedAsScenarioEvidence: boolean;
    unquantifiedFutureRevenueAddedToBaseFairValue: false;
    strategicOptionalityMayStrengthenUpsideScenario: boolean;
    ipoTimingAssumedCertain: false;
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

function moneyToUsd(amount: number, unit: string) {
  const scale = unit.toLowerCase().startsWith("trillion")
    ? 1_000_000_000_000
    : unit.toLowerCase().startsWith("billion")
      ? 1_000_000_000
      : unit.toLowerCase().startsWith("million")
        ? 1_000_000
        : 1;
  return amount * scale;
}

function amountsNear(text: string, pattern: RegExp) {
  const values: number[] = [];
  for (const match of text.matchAll(pattern)) {
    const amount = Number(match[1]);
    const unit = String(match[2] ?? "");
    if (Number.isFinite(amount) && amount > 0 && unit) values.push(moneyToUsd(amount, unit));
  }
  return values;
}

function yearNumber(value: string | undefined) {
  if (!value) return null;
  const words: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, fifteen: 15, twenty: 20 };
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : words[value.toLowerCase()] ?? null;
}

function quantifiedEconomics(text: string) {
  const commercialMatches = [...text.matchAll(/(?:spend|purchase|consume|commit(?:ment|ted)?\s+to\s+spend|contract(?:ed|ual)?\s+(?:spend|purchases?))[^.$]{0,120}\$\s*([0-9]+(?:\.[0-9]+)?)\s*(trillion|billion|million)\b[^.]{0,100}/gi)];
  const commercialValues = commercialMatches.flatMap((match) => {
    const amount = Number(match[1]);
    return Number.isFinite(amount) ? [moneyToUsd(amount, String(match[2]))] : [];
  });
  const commercialCommitment = commercialValues.length ? Math.max(...commercialValues) : null;
  let commercialYears: number | null = null;
  for (const match of commercialMatches) {
    const years = String(match[0]).match(/(?:over|during|across|for)\s+(?:the\s+next\s+)?(\d+|one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty)\s+years?/i);
    commercialYears = yearNumber(years?.[1]);
    if (commercialYears) break;
  }

  const investmentValues = amountsNear(
    text,
    /(?:invested?|investment(?:s)?(?:\s+of)?|preferred stock(?:\s+investment)?(?:\s+of)?)[^.$]{0,80}\$\s*([0-9]+(?:\.[0-9]+)?)\s*(trillion|billion|million)\b/gi,
  );
  const fundingValues = amountsNear(
    text,
    /(?:facility|future funding|make available|option to invest|additional investment|up to an additional)[^.$]{0,100}\$\s*([0-9]+(?:\.[0-9]+)?)\s*(trillion|billion|million)\b/gi,
  );
  return {
    disclosedCommercialCommitmentUsd: commercialCommitment,
    commercialCommitmentYears: commercialYears,
    annualizedDisclosedCommercialCommitmentUsd: commercialCommitment && commercialYears
      ? commercialCommitment / commercialYears
      : null,
    disclosedInvestmentAmountUsd: investmentValues.length ? Math.max(...investmentValues) : null,
    disclosedFutureFundingCapacityUsd: fundingValues.length ? Math.max(...fundingValues) : null,
    disclosedValuesAreRevenueNotProfit: true as const,
  };
}

function usd(value: number) {
  if (value >= 1_000_000_000_000) return `$${(value / 1_000_000_000_000).toFixed(1)}T`;
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

export function assessStrategicOptionality(sourceText: string): StrategicOptionalityAssessment {
  const value = sourceText.replace(/\s+/g, " ").trim();
  const equityInvestment = contains(value, /\b(?:investment|invested|preferred stock|common stock|equity investment|convertible note|warrant)\b/i);
  const commercialRelationship = contains(value, /\b(?:commercial arrangement|strategic collaboration|strategic partnership|cloud services|cloud service|customer|bedrock|compute services|compute capacity)\b/i);
  const infrastructureDemand = contains(value, /\b(?:trainium|gpu|chips?|compute capacity|data cent(?:er|re)|infrastructure|gigawatts?|accelerator)\b/i);
  const liquidityEvent = contains(value, /\b(?:initial public offering|\bIPO\b|direct listing|liquidity event|public listing|draft registration statement)\b/i);
  const markToMarketOrNonOperatingGain = contains(value, /\b(?:unrealized gain|fair value adjustment|observable changes in prices|other income|non-operating income|nonoperating income|mark.to.market)\b/i);
  const futureFundingCommitment = contains(value, /\b(?:commitment|facility|option to invest|future funding|capital commitment|contractual obligations?|make available)\b/i);
  const relatedEntities = relationEntities(value);
  const quantified = quantifiedEconomics(value);
  const detected = relatedEntities.length > 0 && (equityInvestment || commercialRelationship || liquidityEvent);

  let score = 0;
  if (equityInvestment) score += 20;
  if (commercialRelationship) score += 25;
  if (infrastructureDemand) score += 15;
  if (liquidityEvent) score += 15;
  if (markToMarketOrNonOperatingGain) score += 10;
  if (futureFundingCommitment) score += 5;
  if (quantified.disclosedCommercialCommitmentUsd) score += 10;
  if (relatedEntities.length) score += 10;
  score = Math.min(100, score);

  const supportiveFactors = [
    ...(equityInvestment ? ["A strategic equity or convertible investment can create asset-value upside separate from the operating business."] : []),
    ...(commercialRelationship ? ["A commercial relationship can create recurring product, cloud, or service revenue in addition to investment value."] : []),
    ...(infrastructureDemand ? ["The relationship can create infrastructure, compute, or chip demand that feeds the operating business."] : []),
    ...(liquidityEvent ? ["An actual IPO filing, direct-listing process, or other liquidity-event evidence can improve price discovery and monetisation of the strategic asset; timing is still uncertain until the transaction occurs."] : []),
    ...(quantified.disclosedCommercialCommitmentUsd ? [
      `The source discloses at least ${usd(quantified.disclosedCommercialCommitmentUsd)} of commercial spend/contract value${quantified.commercialCommitmentYears ? ` over about ${quantified.commercialCommitmentYears} years` : ""}.`,
    ] : []),
    ...(quantified.annualizedDisclosedCommercialCommitmentUsd ? [
      `That disclosed commitment averages about ${usd(quantified.annualizedDisclosedCommercialCommitmentUsd)} of gross annual commercial value before any margin assumption.`,
    ] : []),
    ...(relatedEntities.length ? [`Named strategic relationships detected: ${relatedEntities.join(", ")}.`] : []),
  ];
  const risks = [
    ...(markToMarketOrNonOperatingGain ? ["Investment revaluation gains are separated from recurring operating profit; they must not be annualised as ordinary earnings."] : []),
    ...(futureFundingCommitment ? ["Future funding or contractual commitments can consume cash and must be netted against the upside from the relationship."] : []),
    ...(quantified.disclosedFutureFundingCapacityUsd ? [`The source discloses up to ${usd(quantified.disclosedFutureFundingCapacityUsd)} of future funding/investment capacity, which can consume cash before the strategic asset pays off.`] : []),
    ...(equityInvestment ? ["Private-company valuations can fall before a liquidity event and may remain illiquid for longer than expected."] : []),
    ...(commercialRelationship ? ["Commercial commitment value is revenue/spend evidence, not profit. The model does not invent an undisclosed margin or add the full gross commitment directly to equity value."] : []),
    ...(liquidityEvent ? ["An IPO filing does not guarantee timing, pricing, completion, or a higher valuation."] : []),
  ];

  return {
    version: 2,
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
    quantifiedEconomics: quantified,
    optionalityScore: score,
    confidence: detected ? Math.min(92, 45 + score / 2) : 20,
    baseFairValueAdjustmentPercent: 0,
    valuationTreatment: {
      recurringOperatingProfitSeparatedFromInvestmentGains: true,
      quantifiedCommercialCommitmentsIncludedAsScenarioEvidence: quantified.disclosedCommercialCommitmentUsd !== null,
      unquantifiedFutureRevenueAddedToBaseFairValue: false,
      strategicOptionalityMayStrengthenUpsideScenario: detected && (commercialRelationship || liquidityEvent || infrastructureDemand),
      ipoTimingAssumedCertain: false,
      doubleCountingGuard: true,
    },
    supportiveFactors,
    risks,
  };
}
