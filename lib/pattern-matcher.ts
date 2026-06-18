import { Prisma } from "@prisma/client";

export type PatternConfidenceLabel = "strong" | "moderate" | "weak" | "none";
export type HistoricalPatternMatch = "strong" | "moderate" | "weak" | "no_clear_match";

export type PatternRawSignal = {
  ticker?: string | null;
  signalType?: string | null;
  title?: string | null;
  summary?: string | null;
  source?: string | null;
  payload?: unknown;
};

export type PatternCandidateSignal = PatternRawSignal & {
  company?: string | null;
  sector?: string | null;
  industry?: string | null;
  eventType?: string | null;
  patternTags?: unknown;
  catalystStrength?: string | number | null;
  macroSnapshot?: unknown;
  sectorTrend?: string | null;
  priceMovementBeforeEvent?: string | number | null;
  volumeMovement?: string | number | null;
  valuationContext?: string | null;
  sourceStrength?: string | number | null;
  outcomeHistory?: string | null;
  sourceReceipts?: unknown;
};

export type PatternHistoricalEvent = {
  id?: string | null;
  ticker?: string | null;
  companyName?: string | null;
  eventType?: string | null;
  title?: string | null;
  summary?: string | null;
  source?: string | null;
  sourceReceipts?: unknown;
  sector?: string | null;
  industry?: string | null;
  eventDate?: Date | string | null;
  outcomeLabel?: string | null;
  patternTags?: unknown;
  macroSnapshot?: unknown;
  sectorTrend?: string | null;
  priceBefore?: Prisma.Decimal | number | string | null;
  priceAfter1d?: Prisma.Decimal | number | string | null;
  volumeBeforeEvent?: Prisma.Decimal | number | string | null;
  volumeAfterEvent?: Prisma.Decimal | number | string | null;
  valuationAtTime?: string | null;
  maxGain?: Prisma.Decimal | number | string | null;
  maxDrawdown?: Prisma.Decimal | number | string | null;
};

export type PatternMatchResult = {
  matchScore: number;
  confidenceLabel: PatternConfidenceLabel;
  matchReason: string;
  matchedFeatures: string[];
};

export type PatternPreviewMatchedEvent = {
  historicalEventId: string | null;
  ticker: string | null;
  company: string | null;
  eventDate: string | null;
  eventType: string | null;
  outcome: string;
  maxGain: number | null;
  maxDrawdown: number | null;
  similarityScore: number;
  reasonForMatch: string;
  sourceReceipts: unknown[];
};

export type PatternPreviewResult = {
  ok: true;
  candidateSummary: Record<string, unknown>;
  historicalPatternMatch: HistoricalPatternMatch;
  matchedEvents: PatternPreviewMatchedEvent[];
  similarityScore: number;
  pastOutcomeMix: Record<string, number>;
  simpleExplanation: string;
  warnings: string[];
};

const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "by", "for", "from", "in", "into", "is", "it", "of", "on", "or", "the", "to", "with",
]);

const mockCandidateSignal: PatternCandidateSignal = {
  ticker: "NVDA",
  company: "NVIDIA",
  sector: "Technology",
  industry: "Semiconductors",
  eventType: "guidance_raise",
  signalType: "guidance_raise",
  title: "Mock AI infrastructure guidance raise",
  summary: "Preview-only candidate: strong AI demand, higher volume, and premium valuation around an earnings catalyst.",
  patternTags: ["ai_demand", "guidance_reset", "high_volume"],
  catalystStrength: "high",
  macroSnapshot: { rates: "elevated", riskMood: "constructive" },
  sectorTrend: "AI infrastructure leadership",
  priceMovementBeforeEvent: "positive_momentum",
  volumeMovement: "volume_expansion",
  valuationContext: "premium",
  sourceStrength: "company_release",
  source: "Mock earnings release",
  sourceReceipts: [{ source: "Mock earnings release", note: "Preview candidate only" }],
};

function normalize(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function payloadValue(payload: unknown, key: string) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return "";
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === "string" ? value : "";
}

function candidateValue(candidate: PatternCandidateSignal, key: keyof PatternCandidateSignal, payloadKey = String(key)) {
  const direct = candidate[key];
  return typeof direct === "string" || typeof direct === "number" ? String(direct) : payloadValue(candidate.payload, payloadKey);
}

function words(value: unknown) {
  return new Set(
    normalize(value)
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((word) => word.length >= 4 && !STOP_WORDS.has(word)),
  );
}

function overlapScore(left: Set<string>, right: Set<string>) {
  if (left.size === 0 || right.size === 0) return 0;
  let overlap = 0;
  left.forEach((word) => {
    if (right.has(word)) overlap += 1;
  });
  return overlap / Math.max(left.size, right.size);
}

function confidenceLabel(score: number): PatternConfidenceLabel {
  if (score >= 75) return "strong";
  if (score >= 50) return "moderate";
  if (score >= 25) return "weak";
  return "none";
}

function previewLabel(score: number): HistoricalPatternMatch {
  if (score >= 75) return "strong";
  if (score >= 50) return "moderate";
  if (score >= 25) return "weak";
  return "no_clear_match";
}

function jsonArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function normalizedArray(value: unknown) {
  return jsonArray(value).map((item) => normalize(item)).filter(Boolean);
}

function decimalNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value instanceof Prisma.Decimal ? value.toString() : value);
  return Number.isFinite(parsed) ? parsed : null;
}

function dateString(value: unknown) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function addExactScore(features: string[], left: unknown, right: unknown, points: number, feature: string) {
  if (normalize(left) && normalize(left) === normalize(right)) {
    features.push(feature);
    return points;
  }
  return 0;
}

function macroOverlap(candidate: unknown, event: unknown) {
  if (!candidate || !event || typeof candidate !== "object" || typeof event !== "object" || Array.isArray(candidate) || Array.isArray(event)) return 0;
  let matches = 0;
  let comparable = 0;
  for (const [key, value] of Object.entries(candidate as Record<string, unknown>)) {
    const eventValue = (event as Record<string, unknown>)[key];
    if (eventValue === undefined) continue;
    comparable += 1;
    if (normalize(String(value)) === normalize(String(eventValue))) matches += 1;
  }
  return comparable ? matches / comparable : 0;
}

export function compareSignalToHistoricalEvent(
  signal: PatternRawSignal,
  event: PatternHistoricalEvent,
  now = new Date(),
): PatternMatchResult {
  let score = 0;
  const features: string[] = [];

  const signalTicker = normalize(signal.ticker);
  const eventTicker = normalize(event.ticker);
  if (signalTicker && eventTicker && signalTicker === eventTicker) {
    score += 35;
    features.push("same ticker");
  }

  const signalType = normalize(signal.signalType);
  const eventType = normalize(event.eventType);
  if (signalType && eventType && signalType === eventType) {
    score += 30;
    features.push("same signal/event type");
  }

  const signalSector = normalize(payloadValue(signal.payload, "sector"));
  const eventSector = normalize(event.sector);
  if (signalSector && eventSector && signalSector === eventSector) {
    score += 15;
    features.push("same sector");
  }

  const titleSimilarity = overlapScore(words(`${signal.title ?? ""} ${signal.summary ?? ""}`), words(`${event.title ?? ""} ${event.summary ?? ""}`));
  if (titleSimilarity > 0) {
    const boost = Math.min(10, Math.round(titleSimilarity * 10));
    score += boost;
    features.push("similar title words");
  }

  const signalSourceCategory = normalize(payloadValue(signal.payload, "source_category") || signal.source);
  const eventSourceCategory = normalize(event.source);
  if (signalSourceCategory && eventSourceCategory && signalSourceCategory === eventSourceCategory) {
    score += 5;
    features.push("similar source category");
  }

  const eventDate = event.eventDate ? new Date(event.eventDate) : null;
  if (eventDate && !Number.isNaN(eventDate.getTime())) {
    const daysOld = Math.max(0, (now.getTime() - eventDate.getTime()) / 86_400_000);
    if (daysOld <= 730) {
      score += 5;
      features.push("recent historical event");
    }
  }

  const matchScore = Math.max(0, Math.min(100, Math.round(score)));
  const label = confidenceLabel(matchScore);
  const matchReason = features.length ? `Matched on ${features.join(", ")}.` : "No meaningful pattern features matched.";

  return { matchScore, confidenceLabel: label, matchReason, matchedFeatures: features };
}

export function getMockPatternCandidate(): PatternCandidateSignal {
  return { ...mockCandidateSignal, macroSnapshot: { ...(mockCandidateSignal.macroSnapshot as Record<string, unknown>) }, patternTags: [...jsonArray(mockCandidateSignal.patternTags)], sourceReceipts: [...jsonArray(mockCandidateSignal.sourceReceipts)] };
}

export function compareCandidateToHistoricalEvent(candidate: PatternCandidateSignal, event: PatternHistoricalEvent): PatternMatchResult {
  let score = 0;
  const features: string[] = [];
  const eventType = candidate.eventType ?? candidate.signalType;

  score += addExactScore(features, candidate.sector ?? payloadValue(candidate.payload, "sector"), event.sector, 14, "same sector");
  score += addExactScore(features, candidate.industry ?? payloadValue(candidate.payload, "industry"), event.industry, 12, "same industry");
  score += addExactScore(features, eventType, event.eventType, 16, "same event type");
  score += addExactScore(features, candidate.sectorTrend ?? payloadValue(candidate.payload, "sectorTrend"), event.sectorTrend, 8, "similar sector trend");
  score += addExactScore(features, candidate.valuationContext ?? payloadValue(candidate.payload, "valuationContext"), event.valuationAtTime, 8, "similar valuation context");

  const candidateTags = normalizedArray(candidate.patternTags ?? (candidate.payload as Record<string, unknown> | undefined)?.patternTags);
  const eventTags = normalizedArray(event.patternTags);
  const tagScore = overlapScore(new Set(candidateTags), new Set(eventTags));
  if (tagScore > 0) {
    score += Math.round(tagScore * 14);
    features.push("overlapping pattern tags");
  }

  const macroScore = macroOverlap(candidate.macroSnapshot ?? (candidate.payload as Record<string, unknown> | undefined)?.macroSnapshot, event.macroSnapshot);
  if (macroScore > 0) {
    score += Math.round(macroScore * 8);
    features.push("similar macro snapshot");
  }

  const titleSimilarity = overlapScore(words(`${candidate.title ?? ""} ${candidate.summary ?? ""}`), words(`${event.title ?? ""} ${event.summary ?? ""}`));
  if (titleSimilarity > 0) {
    score += Math.min(8, Math.round(titleSimilarity * 8));
    features.push("similar setup description");
  }

  const sourceStrength = normalize(candidateValue(candidate, "sourceStrength", "sourceStrength") || candidate.source);
  const eventSource = normalize(event.source);
  if (sourceStrength && eventSource && (sourceStrength === eventSource || eventSource.includes(sourceStrength) || sourceStrength.includes(eventSource))) {
    score += 6;
    features.push("similar source strength");
  }

  const candidateVolume = normalize(candidateValue(candidate, "volumeMovement", "volumeMovement"));
  const beforeVolume = decimalNumber(event.volumeBeforeEvent);
  const afterVolume = decimalNumber(event.volumeAfterEvent);
  if (candidateVolume && beforeVolume && afterVolume) {
    const expanded = afterVolume > beforeVolume * 1.25;
    if ((expanded && candidateVolume.includes("expansion")) || (expanded && candidateVolume.includes("high")) || (!expanded && candidateVolume.includes("normal"))) {
      score += 6;
      features.push("similar volume movement");
    }
  }

  const priceBefore = decimalNumber(event.priceBefore);
  const priceAfter = decimalNumber(event.priceAfter1d);
  const candidatePriceMove = normalize(candidateValue(candidate, "priceMovementBeforeEvent", "priceMovementBeforeEvent"));
  if (candidatePriceMove && priceBefore && priceAfter) {
    const positive = priceAfter >= priceBefore;
    if ((positive && candidatePriceMove.includes("positive")) || (!positive && (candidatePriceMove.includes("negative") || candidatePriceMove.includes("down")))) {
      score += 4;
      features.push("compatible price movement around event");
    }
  }

  const catalystStrength = normalize(candidateValue(candidate, "catalystStrength", "catalystStrength"));
  if (catalystStrength) {
    const maxGain = decimalNumber(event.maxGain);
    const maxDrawdown = decimalNumber(event.maxDrawdown);
    if ((catalystStrength.includes("high") && (Math.abs(maxGain ?? 0) >= 0.2 || Math.abs(maxDrawdown ?? 0) >= 0.2)) || catalystStrength.includes("medium")) {
      score += 6;
      features.push("compatible catalyst strength");
    }
  }

  const outcomeHistory = normalize(candidateValue(candidate, "outcomeHistory", "outcomeHistory"));
  if (outcomeHistory && normalize(event.outcomeLabel) && outcomeHistory.includes(normalize(event.outcomeLabel))) {
    score += 4;
    features.push("candidate outcome history references this outcome type");
  }

  const matchScore = Math.max(0, Math.min(100, Math.round(score)));
  return {
    matchScore,
    confidenceLabel: confidenceLabel(matchScore),
    matchReason: features.length ? `Matched on ${features.join(", ")}.` : "No clear match across sector, event type, tags, market context, source strength, or outcome history.",
    matchedFeatures: features,
  };
}

export function buildPatternMatchPreview(candidate: PatternCandidateSignal, historicalEvents: PatternHistoricalEvent[], limit = 5): PatternPreviewResult {
  const warnings = ["Preview only. This is not a guaranteed prediction and does not publish real alerts."];
  if (!historicalEvents.length) {
    warnings.push("No historical events were available to compare against.");
    return {
      ok: true,
      candidateSummary: summarizeCandidate(candidate),
      historicalPatternMatch: "no_clear_match",
      matchedEvents: [],
      similarityScore: 0,
      pastOutcomeMix: {},
      simpleExplanation: "No similar past setups were available in the Historical Event Store, so Swing Up cannot form a clear historical pattern match yet.",
      warnings,
    };
  }

  const matchedEvents = historicalEvents
    .map((event) => ({ event, result: compareCandidateToHistoricalEvent(candidate, event) }))
    .sort((left, right) => right.result.matchScore - left.result.matchScore)
    .slice(0, limit)
    .filter((match) => match.result.matchScore > 0)
    .map(({ event, result }) => ({
      historicalEventId: event.id ?? null,
      ticker: event.ticker ?? null,
      company: event.companyName ?? null,
      eventDate: dateString(event.eventDate),
      eventType: event.eventType ?? null,
      outcome: event.outcomeLabel ?? "unknown",
      maxGain: decimalNumber(event.maxGain),
      maxDrawdown: decimalNumber(event.maxDrawdown),
      similarityScore: result.matchScore,
      reasonForMatch: result.matchReason,
      sourceReceipts: jsonArray(event.sourceReceipts),
    }));

  const similarityScore = matchedEvents[0]?.similarityScore ?? 0;
  const pastOutcomeMix = matchedEvents.reduce<Record<string, number>>((mix, event) => {
    mix[event.outcome] = (mix[event.outcome] ?? 0) + 1;
    return mix;
  }, {});
  const historicalPatternMatch = previewLabel(similarityScore);
  const simpleExplanation = matchedEvents.length
    ? `The closest similar past setups match on ${matchedEvents[0].reasonForMatch.replace(/^Matched on /, "").replace(/\.$/, "")}. This is context only, not a guarantee that the setup will repeat.`
    : "Historical events exist, but none shared enough setup details to form a clear match.";

  return { ok: true, candidateSummary: summarizeCandidate(candidate), historicalPatternMatch, matchedEvents, similarityScore, pastOutcomeMix, simpleExplanation, warnings };
}

function summarizeCandidate(candidate: PatternCandidateSignal) {
  return {
    ticker: candidate.ticker ?? null,
    company: candidate.company ?? null,
    sector: candidate.sector ?? (payloadValue(candidate.payload, "sector") || null),
    industry: candidate.industry ?? (payloadValue(candidate.payload, "industry") || null),
    eventType: candidate.eventType ?? candidate.signalType ?? null,
    patternTags: jsonArray(candidate.patternTags ?? (candidate.payload as Record<string, unknown> | undefined)?.patternTags),
    catalystStrength: candidate.catalystStrength ?? (payloadValue(candidate.payload, "catalystStrength") || null),
    valuationContext: candidate.valuationContext ?? (payloadValue(candidate.payload, "valuationContext") || null),
  };
}
