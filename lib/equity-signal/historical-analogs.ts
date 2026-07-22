export type HistoricalAnalogDirection = "upside" | "downside";
export type HistoricalAnalogRelationship = "direct" | "second_order" | "third_order";
export type HistoricalAnalogHorizon = "1D" | "3D" | "7D" | "30D" | "90D";
export type HistoricalAnalogStrength = "missing" | "weak" | "medium" | "strong";

export type HistoricalAnalogCheckpoint = {
  /** Raw security return. For example, 4.2 means +4.2%, not 0.042. */
  returnPercent: number;
  /** Optional broad-market or sector benchmark return over the same interval. */
  benchmarkReturnPercent?: number | null;
  /** Time at which this outcome became observable. */
  observedAt: string;
  source?: string | null;
};

export type HistoricalSignalRecord = {
  id: string;
  /** Stable event-cluster identity. Duplicate articles for one event must share this key. */
  eventKey: string;
  ticker: string;
  eventFamily: string;
  direction: HistoricalAnalogDirection;
  relationship: HistoricalAnalogRelationship;
  causalChain: string[];
  macroRegime: string[];
  /** When the original signal first became observable to the system. */
  signalObservedAt: string;
  /** Latest timestamp of any feature used to describe this historical setup. */
  featuresAsOf: string;
  /** Only real records are eligible. Mock, synthetic, and unknown records are rejected. */
  dataQuality: "real" | "mock" | "synthetic" | "unknown";
  /** Receipts that prove the event and price history used to build this record. */
  provenance?: {
    origin: "swing_up_forward_outcome" | "public_historical_bootstrap";
    eventPublisher: string;
    eventSourceUrl: string;
    priceSource: string;
    benchmarkSource: string;
    methodologyVersion: string;
  };
  checkpoints: Partial<Record<HistoricalAnalogHorizon, HistoricalAnalogCheckpoint>>;
};

export type HistoricalAnalogQuery = {
  eventKey: string;
  eventFamily: string;
  direction: HistoricalAnalogDirection;
  relationship: HistoricalAnalogRelationship;
  causalChain: string[];
  macroRegime: string[];
  /** Point-in-time cutoff. Nothing first seen or measured at/after this time is eligible. */
  asOf: string;
  /** Latest timestamp of any feature used by the current query. */
  featuresAsOf: string;
};

export type HistoricalAnalogOptions = {
  minimumSimilarity?: number;
  maximumAnalogs?: number;
  maximumAnalogsPerTicker?: number;
  minimumSamplesForPreferredHorizon?: number;
  hitThresholdPercent?: number;
  priorAlpha?: number;
  priorBeta?: number;
};

export type HistoricalAnalogSimilarity = {
  total: number;
  family: number;
  direction: number;
  relationship: number;
  causalChain: number;
  macroRegime: number;
};

export type HistoricalAnalogItem = {
  recordId: string;
  eventKey: string;
  ticker: string;
  signalObservedAt: string;
  outcomeObservedAt: string;
  horizon: HistoricalAnalogHorizon;
  similarity: number;
  similarityComponents: HistoricalAnalogSimilarity;
  matchedFeatures: string[];
  provenance: HistoricalSignalRecord["provenance"] | null;
  directionAdjustedReturnPercent: number;
  marketRelativeDirectionAdjustedReturnPercent: number | null;
  hit: boolean;
};

export type HistoricalAnalogMarketRelativeStats = {
  sampleSize: number;
  hitRatePercent: number;
  posteriorHitProbabilityPercent: number;
  medianDirectionAdjustedReturnPercent: number;
  p25DirectionAdjustedReturnPercent: number;
  p75DirectionAdjustedReturnPercent: number;
};

export type HistoricalAnalogDiagnostics = {
  inputRecords: number;
  realRecords: number;
  groupedIndependentEvents: number;
  duplicateRecordsCollapsed: number;
  excludedNonReal: number;
  excludedInvalidTimestamp: number;
  excludedFutureSignal: number;
  excludedSameEvent: number;
  excludedPostSignalFeatures: number;
  excludedLowSimilarity: number;
  excludedUnavailableOutcome: number;
  horizonCoverage: Record<HistoricalAnalogHorizon, number>;
  queryFeatureCutoffValid: boolean;
};

export type HistoricalAnalogAnalysis = {
  available: boolean;
  strength: HistoricalAnalogStrength;
  requestedHorizon: HistoricalAnalogHorizon;
  selectedHorizon: HistoricalAnalogHorizon | null;
  usedFallbackHorizon: boolean;
  sampleSize: number;
  effectiveSampleSize: number;
  averageSimilarity: number;
  hitRatePercent: number | null;
  weightedHitRatePercent: number | null;
  posteriorHitProbabilityPercent: number;
  conservativeHitProbabilityPercent: number;
  maximumProbabilityAllowedBySamplePercent: number;
  medianDirectionAdjustedReturnPercent: number | null;
  p25DirectionAdjustedReturnPercent: number | null;
  p75DirectionAdjustedReturnPercent: number | null;
  marketRelative: HistoricalAnalogMarketRelativeStats | null;
  historicalSupport: number;
  leakageSafe: boolean;
  summary: string;
  items: HistoricalAnalogItem[];
  diagnostics: HistoricalAnalogDiagnostics;
};

type SafeRecord = HistoricalSignalRecord & { signalTime: number; featureTime: number };
type GroupedRecord = { eventKey: string; canonical: SafeRecord; records: SafeRecord[]; similarity: ReturnType<typeof comparePreEventFeatures> };
type WeightedValue = { value: number; weight: number };

const HORIZON_PLANS: Record<HistoricalAnalogRelationship, HistoricalAnalogHorizon[]> = {
  direct: ["7D", "3D", "1D"],
  second_order: ["30D", "7D", "3D", "1D"],
  third_order: ["90D", "30D", "7D", "3D", "1D"],
};

const DEFAULT_OPTIONS: Required<HistoricalAnalogOptions> = {
  minimumSimilarity: 0.45,
  maximumAnalogs: 50,
  maximumAnalogsPerTicker: 3,
  minimumSamplesForPreferredHorizon: 3,
  hitThresholdPercent: 0,
  priorAlpha: 2,
  priorBeta: 2,
};

const TOKEN_STOP_WORDS = new Set([
  "a", "an", "and", "as", "at", "by", "for", "from", "in", "into", "is", "of", "on", "or", "the", "to", "with",
]);

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function rounded(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function timestamp(value: string) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalized(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function tokens(values: string[]) {
  return new Set(
    values
      .join(" ")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(/\s+/)
      .filter((value) => value.length > 1 && !TOKEN_STOP_WORDS.has(value)),
  );
}

function setSimilarity(left: Set<string>, right: Set<string>) {
  if (!left.size || !right.size) return 0;
  const intersection = [...left].filter((value) => right.has(value)).length;
  return intersection / new Set([...left, ...right]).size;
}

function relationshipSimilarity(left: HistoricalAnalogRelationship, right: HistoricalAnalogRelationship) {
  if (left === right) return 1;
  if ((left === "direct" && right === "second_order") || (left === "second_order" && right === "direct")) return 0.35;
  if ((left === "second_order" && right === "third_order") || (left === "third_order" && right === "second_order")) return 0.5;
  return 0;
}

/**
 * Deliberately accepts only fields that must be knowable at signal time. Outcomes,
 * future price moves, later volume, max gain, and drawdown cannot enter this score.
 */
export function comparePreEventFeatures(query: HistoricalAnalogQuery, record: HistoricalSignalRecord) {
  const family = normalized(query.eventFamily) === normalized(record.eventFamily) ? 1 : 0;
  const direction = query.direction === record.direction ? 1 : 0;
  const relationship = relationshipSimilarity(query.relationship, record.relationship);
  const causalChain = setSimilarity(tokens(query.causalChain), tokens(record.causalChain));
  const macroRegime = setSimilarity(new Set(query.macroRegime.map(normalized).filter(Boolean)), new Set(record.macroRegime.map(normalized).filter(Boolean)));
  const total = family * 0.3 + direction * 0.15 + relationship * 0.15 + causalChain * 0.25 + macroRegime * 0.15;
  const matchedFeatures = [
    family === 1 ? "same event family" : null,
    direction === 1 ? "same predicted direction" : null,
    relationship === 1 ? "same causal relationship depth" : relationship > 0 ? "nearby causal relationship depth" : null,
    causalChain > 0 ? "overlapping causal-chain mechanism" : null,
    macroRegime > 0 ? "overlapping pre-event macro regime" : null,
  ].filter((value): value is string => Boolean(value));
  return {
    total: rounded(total, 4),
    components: {
      total: rounded(total, 4),
      family: rounded(family, 4),
      direction: rounded(direction, 4),
      relationship: rounded(relationship, 4),
      causalChain: rounded(causalChain, 4),
      macroRegime: rounded(macroRegime, 4),
    } satisfies HistoricalAnalogSimilarity,
    matchedFeatures,
  };
}

export function horizonPlanForRelationship(relationship: HistoricalAnalogRelationship) {
  return [...HORIZON_PLANS[relationship]];
}

function validCheckpoint(checkpoint: HistoricalAnalogCheckpoint | undefined, signalTime: number, asOf: number) {
  if (!checkpoint || !Number.isFinite(checkpoint.returnPercent)) return null;
  const observedAt = timestamp(checkpoint.observedAt);
  if (observedAt === null || observedAt < signalTime || observedAt >= asOf) return null;
  if (checkpoint.benchmarkReturnPercent != null && !Number.isFinite(checkpoint.benchmarkReturnPercent)) return null;
  return { checkpoint, observedAt };
}

function checkpointForGroup(group: GroupedRecord, horizon: HistoricalAnalogHorizon, asOf: number) {
  return group.records
    .flatMap((record) => {
      const value = validCheckpoint(record.checkpoints[horizon], group.canonical.signalTime, asOf);
      return value ? [{ ...value, record }] : [];
    })
    .sort((left, right) => left.observedAt - right.observedAt || left.record.id.localeCompare(right.record.id))[0] ?? null;
}

function directionAdjusted(value: number, direction: HistoricalAnalogDirection) {
  return direction === "downside" ? -value : value;
}

function weightedQuantile(values: WeightedValue[], quantile: number) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left.value - right.value);
  const totalWeight = sorted.reduce((sum, item) => sum + item.weight, 0);
  const target = clamp(quantile, 0, 1) * totalWeight;
  let cumulative = 0;
  for (const item of sorted) {
    cumulative += item.weight;
    if (cumulative >= target) return rounded(item.value);
  }
  return rounded(sorted.at(-1)!.value);
}

function maximumProbabilityForSample(sampleSize: number) {
  if (sampleSize <= 0) return 50;
  if (sampleSize === 1) return 60;
  if (sampleSize === 2) return 64;
  if (sampleSize < 5) return 70;
  if (sampleSize < 10) return 80;
  if (sampleSize < 20) return 88;
  return 97;
}

function strengthFor(sampleSize: number, historicalSupport: number): HistoricalAnalogStrength {
  if (!sampleSize) return "missing";
  if (sampleSize >= 20 && historicalSupport >= 65) return "strong";
  if (sampleSize >= 8 && historicalSupport >= 40) return "medium";
  return "weak";
}

function supportCap(sampleSize: number) {
  if (sampleSize < 3) return 15;
  if (sampleSize < 5) return 25;
  if (sampleSize < 10) return 45;
  if (sampleSize < 20) return 65;
  return 100;
}

function posterior(items: Array<{ weight: number; hit: boolean }>, alpha: number, beta: number) {
  const totalWeight = items.reduce((sum, item) => sum + item.weight, 0);
  const weightedHits = items.reduce((sum, item) => sum + (item.hit ? item.weight : 0), 0);
  const weightedSquares = items.reduce((sum, item) => sum + item.weight ** 2, 0);
  const effectiveSampleSize = weightedSquares > 0 ? totalWeight ** 2 / weightedSquares : 0;
  const probability = (alpha + weightedHits) / (alpha + beta + totalWeight);
  const reliability = effectiveSampleSize / (effectiveSampleSize + 20);
  const conservative = 0.5 + (probability - 0.5) * reliability;
  return { totalWeight, weightedHits, effectiveSampleSize, probability, conservative };
}

function emptyResult(
  query: HistoricalAnalogQuery,
  diagnostics: HistoricalAnalogDiagnostics,
  leakageSafe: boolean,
  summary: string,
): HistoricalAnalogAnalysis {
  const requestedHorizon = HORIZON_PLANS[query.relationship][0];
  return {
    available: false,
    strength: "missing",
    requestedHorizon,
    selectedHorizon: null,
    usedFallbackHorizon: false,
    sampleSize: 0,
    effectiveSampleSize: 0,
    averageSimilarity: 0,
    hitRatePercent: null,
    weightedHitRatePercent: null,
    posteriorHitProbabilityPercent: 50,
    conservativeHitProbabilityPercent: 50,
    maximumProbabilityAllowedBySamplePercent: 50,
    medianDirectionAdjustedReturnPercent: null,
    p25DirectionAdjustedReturnPercent: null,
    p75DirectionAdjustedReturnPercent: null,
    marketRelative: null,
    historicalSupport: 0,
    leakageSafe,
    summary,
    items: [],
    diagnostics,
  };
}

function resolvedOptions(options: HistoricalAnalogOptions): Required<HistoricalAnalogOptions> {
  return {
    minimumSimilarity: clamp(options.minimumSimilarity ?? DEFAULT_OPTIONS.minimumSimilarity, 0, 1),
    maximumAnalogs: Math.max(1, Math.min(500, Math.floor(options.maximumAnalogs ?? DEFAULT_OPTIONS.maximumAnalogs))),
    maximumAnalogsPerTicker: Math.max(1, Math.min(50, Math.floor(options.maximumAnalogsPerTicker ?? DEFAULT_OPTIONS.maximumAnalogsPerTicker))),
    minimumSamplesForPreferredHorizon: Math.max(1, Math.min(100, Math.floor(options.minimumSamplesForPreferredHorizon ?? DEFAULT_OPTIONS.minimumSamplesForPreferredHorizon))),
    hitThresholdPercent: Number.isFinite(options.hitThresholdPercent) ? options.hitThresholdPercent! : DEFAULT_OPTIONS.hitThresholdPercent,
    priorAlpha: Math.max(0.1, Number.isFinite(options.priorAlpha) ? options.priorAlpha! : DEFAULT_OPTIONS.priorAlpha),
    priorBeta: Math.max(0.1, Number.isFinite(options.priorBeta) ? options.priorBeta! : DEFAULT_OPTIONS.priorBeta),
  };
}

export function analyzeHistoricalAnalogs(
  query: HistoricalAnalogQuery,
  records: HistoricalSignalRecord[],
  options: HistoricalAnalogOptions = {},
): HistoricalAnalogAnalysis {
  const settings = resolvedOptions(options);
  const horizonPlan = HORIZON_PLANS[query.relationship];
  const horizonCoverage = Object.fromEntries(["1D", "3D", "7D", "30D", "90D"].map((horizon) => [horizon, 0])) as Record<HistoricalAnalogHorizon, number>;
  const diagnostics: HistoricalAnalogDiagnostics = {
    inputRecords: records.length,
    realRecords: 0,
    groupedIndependentEvents: 0,
    duplicateRecordsCollapsed: 0,
    excludedNonReal: 0,
    excludedInvalidTimestamp: 0,
    excludedFutureSignal: 0,
    excludedSameEvent: 0,
    excludedPostSignalFeatures: 0,
    excludedLowSimilarity: 0,
    excludedUnavailableOutcome: 0,
    horizonCoverage,
    queryFeatureCutoffValid: false,
  };
  const asOf = timestamp(query.asOf);
  const queryFeaturesAsOf = timestamp(query.featuresAsOf);
  diagnostics.queryFeatureCutoffValid = asOf !== null && queryFeaturesAsOf !== null && queryFeaturesAsOf <= asOf;
  if (!diagnostics.queryFeatureCutoffValid || asOf === null) {
    return emptyResult(query, diagnostics, false, "The query feature cutoff is invalid or later than the analysis cutoff, so no historical probability was calculated.");
  }

  const safeRecords: SafeRecord[] = [];
  for (const record of records) {
    if (record.dataQuality !== "real") {
      diagnostics.excludedNonReal += 1;
      continue;
    }
    diagnostics.realRecords += 1;
    const signalTime = timestamp(record.signalObservedAt);
    const featureTime = timestamp(record.featuresAsOf);
    if (signalTime === null || featureTime === null) {
      diagnostics.excludedInvalidTimestamp += 1;
      continue;
    }
    if (record.eventKey.trim() === query.eventKey.trim()) {
      diagnostics.excludedSameEvent += 1;
      continue;
    }
    if (signalTime >= asOf) {
      diagnostics.excludedFutureSignal += 1;
      continue;
    }
    if (featureTime > signalTime) {
      diagnostics.excludedPostSignalFeatures += 1;
      continue;
    }
    safeRecords.push({ ...record, signalTime, featureTime });
  }

  const grouped = new Map<string, SafeRecord[]>();
  for (const record of safeRecords) grouped.set(record.eventKey, [...(grouped.get(record.eventKey) ?? []), record]);
  diagnostics.groupedIndependentEvents = grouped.size;
  diagnostics.duplicateRecordsCollapsed = safeRecords.length - grouped.size;
  const groups: GroupedRecord[] = [];
  for (const [eventKey, groupRecords] of grouped) {
    const ordered = [...groupRecords].sort((left, right) => left.signalTime - right.signalTime || left.id.localeCompare(right.id));
    const canonical = ordered[0];
    const similarity = comparePreEventFeatures(query, canonical);
    if (similarity.total < settings.minimumSimilarity) {
      diagnostics.excludedLowSimilarity += 1;
      continue;
    }
    groups.push({ eventKey, canonical, records: ordered, similarity });
  }

  for (const horizon of horizonPlan) {
    horizonCoverage[horizon] = groups.filter((group) => checkpointForGroup(group, horizon, asOf) !== null).length;
  }
  let selectedHorizon = horizonPlan.find((horizon) => horizonCoverage[horizon] >= settings.minimumSamplesForPreferredHorizon) ?? null;
  if (!selectedHorizon) {
    selectedHorizon = [...horizonPlan].sort((left, right) => horizonCoverage[right] - horizonCoverage[left] || horizonPlan.indexOf(left) - horizonPlan.indexOf(right))[0] ?? null;
    if (selectedHorizon && horizonCoverage[selectedHorizon] === 0) selectedHorizon = null;
  }
  if (!selectedHorizon) {
    diagnostics.excludedUnavailableOutcome = groups.length;
    return emptyResult(query, diagnostics, true, "No independent, point-in-time historical analogue has an outcome observable before the current cutoff.");
  }

  const candidates = groups
    .flatMap((group) => {
      const outcome = checkpointForGroup(group, selectedHorizon!, asOf);
      return outcome ? [{ group, outcome }] : [];
    })
    .sort((left, right) => right.group.similarity.total - left.group.similarity.total || right.group.canonical.signalTime - left.group.canonical.signalTime || left.group.eventKey.localeCompare(right.group.eventKey));
  diagnostics.excludedUnavailableOutcome = groups.length - candidates.length;
  const tickerCounts = new Map<string, number>();
  const selected: typeof candidates = [];
  for (const candidate of candidates) {
    const ticker = candidate.group.canonical.ticker.trim().toUpperCase();
    if ((tickerCounts.get(ticker) ?? 0) >= settings.maximumAnalogsPerTicker) continue;
    tickerCounts.set(ticker, (tickerCounts.get(ticker) ?? 0) + 1);
    selected.push(candidate);
    if (selected.length >= settings.maximumAnalogs) break;
  }

  const items: HistoricalAnalogItem[] = selected.map(({ group, outcome }) => {
    const rawReturn = outcome.checkpoint.returnPercent;
    const adjusted = directionAdjusted(rawReturn, group.canonical.direction);
    const benchmark = outcome.checkpoint.benchmarkReturnPercent;
    const marketRelative = benchmark == null ? null : directionAdjusted(rawReturn - benchmark, group.canonical.direction);
    return {
      recordId: group.canonical.id,
      eventKey: group.eventKey,
      ticker: group.canonical.ticker,
      signalObservedAt: group.canonical.signalObservedAt,
      outcomeObservedAt: outcome.checkpoint.observedAt,
      horizon: selectedHorizon!,
      similarity: group.similarity.total,
      similarityComponents: group.similarity.components,
      matchedFeatures: group.similarity.matchedFeatures,
      provenance: group.canonical.provenance ?? null,
      directionAdjustedReturnPercent: rounded(adjusted),
      marketRelativeDirectionAdjustedReturnPercent: marketRelative == null ? null : rounded(marketRelative),
      hit: adjusted > settings.hitThresholdPercent,
    };
  });
  if (!items.length) return emptyResult(query, diagnostics, true, "No independent analogue remained after point-in-time, similarity, outcome, and concentration safeguards.");

  const weightedItems = items.map((item) => ({ ...item, weight: Math.max(0.01, item.similarity ** 2) }));
  const posteriorStats = posterior(weightedItems, settings.priorAlpha, settings.priorBeta);
  const sampleSize = items.length;
  const hitRate = items.filter((item) => item.hit).length / sampleSize;
  const weightedHitRate = posteriorStats.totalWeight > 0 ? posteriorStats.weightedHits / posteriorStats.totalWeight : 0;
  const averageSimilarity = items.reduce((sum, item) => sum + item.similarity, 0) / sampleSize;
  const maxProbability = maximumProbabilityForSample(sampleSize) / 100;
  const posteriorProbability = Math.min(maxProbability, posteriorStats.probability);
  const conservativeProbability = Math.min(maxProbability, posteriorStats.conservative);
  const probabilityEdge = Math.max(0, (posteriorProbability - 0.5) * 2);
  const sampleFactor = Math.min(1, posteriorStats.effectiveSampleSize / 20);
  const rawHistoricalSupport = 100 * averageSimilarity * probabilityEdge * sampleFactor;
  const historicalSupport = Math.round(Math.min(supportCap(sampleSize), rawHistoricalSupport));
  const strength = strengthFor(sampleSize, historicalSupport);
  const returnValues = weightedItems.map((item) => ({ value: item.directionAdjustedReturnPercent, weight: item.weight }));
  const marketItems = weightedItems.filter((item): item is typeof item & { marketRelativeDirectionAdjustedReturnPercent: number } => item.marketRelativeDirectionAdjustedReturnPercent !== null);
  const marketPosterior = posterior(marketItems.map((item) => ({ weight: item.weight, hit: item.marketRelativeDirectionAdjustedReturnPercent > settings.hitThresholdPercent })), settings.priorAlpha, settings.priorBeta);
  const marketValues = marketItems.map((item) => ({ value: item.marketRelativeDirectionAdjustedReturnPercent, weight: item.weight }));
  const marketRelative: HistoricalAnalogMarketRelativeStats | null = marketItems.length ? {
    sampleSize: marketItems.length,
    hitRatePercent: rounded((marketItems.filter((item) => item.marketRelativeDirectionAdjustedReturnPercent > settings.hitThresholdPercent).length / marketItems.length) * 100),
    posteriorHitProbabilityPercent: rounded(Math.min(maximumProbabilityForSample(marketItems.length) / 100, marketPosterior.probability) * 100),
    medianDirectionAdjustedReturnPercent: weightedQuantile(marketValues, 0.5)!,
    p25DirectionAdjustedReturnPercent: weightedQuantile(marketValues, 0.25)!,
    p75DirectionAdjustedReturnPercent: weightedQuantile(marketValues, 0.75)!,
  } : null;

  const requestedHorizon = horizonPlan[0];
  const usedFallbackHorizon = selectedHorizon !== requestedHorizon;
  return {
    available: true,
    strength,
    requestedHorizon,
    selectedHorizon,
    usedFallbackHorizon,
    sampleSize,
    effectiveSampleSize: rounded(posteriorStats.effectiveSampleSize),
    averageSimilarity: rounded(averageSimilarity * 100),
    hitRatePercent: rounded(hitRate * 100),
    weightedHitRatePercent: rounded(weightedHitRate * 100),
    posteriorHitProbabilityPercent: rounded(posteriorProbability * 100),
    conservativeHitProbabilityPercent: rounded(conservativeProbability * 100),
    maximumProbabilityAllowedBySamplePercent: rounded(maxProbability * 100),
    medianDirectionAdjustedReturnPercent: weightedQuantile(returnValues, 0.5),
    p25DirectionAdjustedReturnPercent: weightedQuantile(returnValues, 0.25),
    p75DirectionAdjustedReturnPercent: weightedQuantile(returnValues, 0.75),
    marketRelative,
    historicalSupport,
    leakageSafe: true,
    summary: `${sampleSize} independent real analogue(s) were measured at ${selectedHorizon}${usedFallbackHorizon ? `, an earlier observable fallback from ${requestedHorizon}` : ""}. Posterior hit probability is ${rounded(posteriorProbability * 100)}%; small samples remain heavily capped and shrunk toward 50%.`,
    items,
    diagnostics,
  };
}

export const buildHistoricalAnalogAnalysis = analyzeHistoricalAnalogs;
