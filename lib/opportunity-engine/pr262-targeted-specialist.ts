import crypto from "node:crypto";
import { readVersionedTextFromR2, writeVersionedJsonToR2 } from "@/lib/r2-warehouse";
import { readPr262ChangeSensorState, type Pr262SensorEvent } from "@/lib/opportunity-engine/pr262-change-sensor";
import { pr262StorageKey } from "@/lib/opportunity-engine/pr262-storage";

const VALUE_STATE_KEY = pr262StorageKey("value-investing/resumable/state.json");
const SPECIALIST_STATE_KEY = pr262StorageKey("specialist/state-v1.json");
const SPECIALIST_RUN_PREFIX = pr262StorageKey("specialist/runs");

type ValueItem = {
  ticker?: string;
  company?: string;
  currentPrice?: number;
  fairValue?: {
    conservativeValue?: number | null;
    baseValue?: number | null;
    optimisticValue?: number | null;
    buyBelowPrice?: number | null;
    strongBuyBelowPrice?: number | null;
    trimAbovePrice?: number | null;
  };
  scores?: {
    businessQuality?: number;
    balanceSheet?: number;
    risk?: number;
    fairValueConfidence?: number;
  };
  decision?: { reasons?: string[]; blockers?: string[] };
};

type SpecialistState = {
  version: 1;
  updatedAt: string;
  processedEventIds: string[];
};

export type TargetedSpecialistResult = {
  eventId: string;
  ticker: string;
  company: string;
  source: Pr262SensorEvent["source"];
  eventKind: string;
  eventObservedAt: string;
  checkedAt: string;
  fullSourceRead: boolean;
  sourceTextBytes: number;
  sourceFirst: boolean;
  currentPriceCheckedAfterSource: boolean;
  currentPrice: number | null;
  storedBaseFairValue: number | null;
  storedBuyBelowPrice: number | null;
  storedStrongBuyBelowPrice: number | null;
  storedTrimAbovePrice: number | null;
  classification: "buy_candidate" | "sell_candidate" | "watch_out_candidate" | "research_only";
  confidence: number;
  reasons: string[];
  blockers: string[];
};

function num(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function safeSegment(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "event";
}

async function readJson(key: string) {
  const current = await readVersionedTextFromR2(key);
  if (!current.found || !current.text) return null;
  return JSON.parse(current.text) as Record<string, unknown>;
}

async function loadValueItem(ticker: string): Promise<ValueItem | null> {
  const state = await readJson(VALUE_STATE_KEY);
  if (!state) return null;
  const serious = state.seriousAlerts && typeof state.seriousAlerts === "object" ? state.seriousAlerts as Record<string, unknown> : {};
  const pools = [
    ...(Array.isArray(state.qualityPriceWatchlist) ? state.qualityPriceWatchlist : []),
    ...(Array.isArray(serious.buy) ? serious.buy : []),
    ...(Array.isArray(serious.sell) ? serious.sell : []),
    ...(Array.isArray(serious.watchOut) ? serious.watchOut : []),
  ].filter((item): item is ValueItem => Boolean(item) && typeof item === "object");
  return pools.find((item) => String(item.ticker ?? "").toUpperCase() === ticker.toUpperCase()) ?? null;
}

async function loadState(): Promise<{ state: SpecialistState; etag: string | null }> {
  const current = await readVersionedTextFromR2(SPECIALIST_STATE_KEY);
  if (!current.found || !current.text) return { state: { version: 1, updatedAt: new Date(0).toISOString(), processedEventIds: [] }, etag: null };
  const parsed = JSON.parse(current.text) as SpecialistState;
  return { state: parsed.version === 1 ? parsed : { version: 1, updatedAt: new Date(0).toISOString(), processedEventIds: [] }, etag: current.etag };
}

async function fetchSourceText(event: Pr262SensorEvent) {
  if (event.source === "market_price") return { text: "", bytes: 0, read: false };
  try {
    const response = await fetch(event.url, {
      headers: { Accept: "text/html,application/xhtml+xml,text/plain,application/xml", "user-agent": "SwingUp/1.0 support@swingup.app" },
      cache: "no-store",
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return { text: "", bytes: 0, read: false };
    const raw = (await response.text()).slice(0, 300_000);
    const text = raw.replace(/<script\b[\s\S]*?<\/script>/gi, " ").replace(/<style\b[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;|&amp;|&quot;|&#39;/g, " ").replace(/\s+/g, " ").trim();
    return { text, bytes: Buffer.byteLength(raw), read: text.length >= 200 };
  } catch {
    return { text: "", bytes: 0, read: false };
  }
}

async function yahooPrice(ticker: string) {
  try {
    const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}`);
    url.searchParams.set("interval", "5m");
    url.searchParams.set("range", "1d");
    const response = await fetch(url, { headers: { Accept: "application/json", "user-agent": "SwingUp/1.0 support@swingup.app" }, cache: "no-store", signal: AbortSignal.timeout(12_000) });
    if (!response.ok) return null;
    const body = await response.json() as { chart?: { result?: Array<{ meta?: { regularMarketPrice?: number } }> } };
    return num(body.chart?.result?.[0]?.meta?.regularMarketPrice);
  } catch {
    return null;
  }
}

function classify(event: Pr262SensorEvent, item: ValueItem | null, sourceText: string, currentPrice: number | null): Omit<TargetedSpecialistResult, "eventId" | "ticker" | "company" | "source" | "eventKind" | "eventObservedAt" | "checkedAt" | "fullSourceRead" | "sourceTextBytes" | "sourceFirst" | "currentPriceCheckedAfterSource"> {
  const fair = item?.fairValue ?? {};
  const base = num(fair.baseValue);
  const buyBelow = num(fair.buyBelowPrice);
  const strongBuyBelow = num(fair.strongBuyBelowPrice);
  const trimAbove = num(fair.trimAbovePrice);
  const quality = num(item?.scores?.businessQuality) ?? 0;
  const risk = num(item?.scores?.risk) ?? 100;
  const confidenceBase = num(item?.scores?.fairValueConfidence) ?? 0;
  const body = `${event.title} ${sourceText}`.toLowerCase();
  const positive = /raises? guidance|beats? expectations|record revenue|record profit|contract award|new contract|approval|acquisition completed|buyback|strategic partnership|strong demand|margin expansion|revenue growth/.test(body);
  const negative = /cuts? guidance|misses? expectations|recall|investigation|fraud|bankrupt|default|cyberattack|data breach|offering|dilution|going concern|material weakness|lawsuit|shutdown|customer loss|contract termination/.test(body);
  const belowStrong = currentPrice !== null && strongBuyBelow !== null && currentPrice <= strongBuyBelow;
  const belowBuy = currentPrice !== null && buyBelow !== null && currentPrice <= buyBelow;
  const aboveTrim = currentPrice !== null && trimAbove !== null && currentPrice >= trimAbove;
  const reasons: string[] = [];
  const blockers: string[] = [];
  let classification: TargetedSpecialistResult["classification"] = "research_only";

  if (!item) blockers.push("No stored company-first valuation was found for this ticker, so a targeted fundamental refresh is required before a Buy/Sell decision.");
  if (event.source !== "market_price" && sourceText.length < 200) blockers.push("The full source could not be read well enough for a decision-grade event conclusion.");
  if (belowStrong || belowBuy) reasons.push(`The current price is inside the stored ${belowStrong ? "strong-buy" : "buy"} valuation zone.`);
  if (positive) reasons.push("The newly read source contains a potentially positive business-value change.");
  if (negative) reasons.push("The newly read source contains a potentially negative or risk-increasing business change.");
  if (quality >= 70) reasons.push(`Stored business quality is ${quality}/100.`);

  if (item && (event.source === "market_price" || sourceText.length >= 200)) {
    if ((belowStrong || belowBuy) && quality >= 70 && risk <= 50 && !negative) classification = "buy_candidate";
    else if (aboveTrim && negative) classification = "sell_candidate";
    else if (negative) classification = "watch_out_candidate";
    else if (positive && belowBuy) classification = "buy_candidate";
  }

  if (classification !== "research_only") blockers.push("This is targeted specialist triage only; current-evidence safety and the full Committee still must pass before a Serious Signal. Historical analogues remain optional context.");
  const confidence = Math.max(0, Math.min(95, Math.round(confidenceBase * 0.45 + quality * 0.25 + (event.priority * 0.2) + ((positive || negative) ? 10 : 0) - (risk * 0.15))));
  return {
    currentPrice,
    storedBaseFairValue: base,
    storedBuyBelowPrice: buyBelow,
    storedStrongBuyBelowPrice: strongBuyBelow,
    storedTrimAbovePrice: trimAbove,
    classification,
    confidence,
    reasons,
    blockers,
  };
}

async function processEvent(event: Pr262SensorEvent): Promise<TargetedSpecialistResult> {
  const ticker = event.ticker!.toUpperCase();
  const item = await loadValueItem(ticker);
  const source = await fetchSourceText(event);
  // PRICE SECOND for event-driven signals. Market-price threshold events are already price-originated by definition.
  const currentPrice = event.source === "market_price"
    ? Number(event.title.match(/ at ([0-9.]+)/)?.[1] ?? Number.NaN)
    : await yahooPrice(ticker);
  const checkedAt = new Date().toISOString();
  return {
    eventId: event.id,
    ticker,
    company: String(item?.company ?? event.company ?? ticker),
    source: event.source,
    eventKind: event.kind,
    eventObservedAt: event.observedAt,
    checkedAt,
    fullSourceRead: source.read,
    sourceTextBytes: source.bytes,
    sourceFirst: event.source !== "market_price",
    currentPriceCheckedAfterSource: event.source !== "market_price",
    ...classify(event, item, source.text, Number.isFinite(currentPrice) ? currentPrice : null),
  };
}

export async function runPr262TargetedSpecialist(maximum = 3) {
  const [sensor, loaded] = await Promise.all([readPr262ChangeSensorState(), loadState()]);
  const processed = new Set(loaded.state.processedEventIds);
  const candidates = sensor.pending
    .filter((event) => event.priority >= 80 && Boolean(event.ticker) && !processed.has(event.id))
    .slice(0, Math.max(1, Math.min(5, maximum)));
  const results: TargetedSpecialistResult[] = [];
  for (const event of candidates) {
    const result = await processEvent(event);
    results.push(result);
    processed.add(event.id);
    const key = `${SPECIALIST_RUN_PREFIX}/${result.checkedAt.slice(0, 10)}/${safeSegment(result.ticker)}-${safeSegment(result.eventId)}.json`;
    await writeVersionedJsonToR2(key, { version: 1, kind: "pr262_targeted_specialist_result", result, safety: { aiCalls: 0, publishing: false, notifications: false, trades: false, databaseWrites: false } }, { createOnly: true });
  }
  const next: SpecialistState = { version: 1, updatedAt: new Date().toISOString(), processedEventIds: [...processed].slice(-5000) };
  const written = await writeVersionedJsonToR2(SPECIALIST_STATE_KEY, next, loaded.etag ? { expectedEtag: loaded.etag } : { createOnly: true });
  if (written.conflict) throw new Error("pr262_specialist_state_conflict");
  return {
    ok: true,
    mode: "pr262_targeted_specialist",
    checkedAt: next.updatedAt,
    eventsConsidered: candidates.length,
    results,
    candidateCount: results.filter((item) => item.classification !== "research_only").length,
    deepWorkPolicy: {
      exactTickerOnly: true,
      maximumCompaniesPerRun: Math.max(1, Math.min(5, maximum)),
      fullSourceReadOnlyForTriggeredCompany: true,
      priceCheckedAfterSourceForEventSignals: true,
      aiCalls: 0,
      fullMarketFundamentalRebuilds: 0,
      seriousSignalRequiresDownstreamHistoricalAndCommitteeGates: true,
    },
  };
}
