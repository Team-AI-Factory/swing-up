export type PatternConfidenceLabel = "strong" | "moderate" | "weak" | "none";

export type PatternRawSignal = {
  ticker?: string | null;
  signalType?: string | null;
  title?: string | null;
  summary?: string | null;
  source?: string | null;
  payload?: unknown;
};

export type PatternHistoricalEvent = {
  ticker?: string | null;
  eventType?: string | null;
  title?: string | null;
  summary?: string | null;
  source?: string | null;
  sector?: string | null;
  eventDate?: Date | string | null;
};

export type PatternMatchResult = {
  matchScore: number;
  confidenceLabel: PatternConfidenceLabel;
  matchReason: string;
  matchedFeatures: string[];
};

const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "by", "for", "from", "in", "into", "is", "it", "of", "on", "or", "the", "to", "with",
]);

function normalize(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function payloadValue(payload: unknown, key: string) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return "";
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === "string" ? value : "";
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
