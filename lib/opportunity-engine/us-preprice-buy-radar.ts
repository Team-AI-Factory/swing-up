import crypto from "node:crypto";
import { buildImpactCandidates } from "@/lib/equity-signal/analysis";
import { articleEvidenceKey, buildArticleEvidenceReport } from "@/lib/equity-signal/article-evidence";
import { collectEventSources } from "@/lib/equity-signal/event-sources";
import { fetchMacroContext } from "@/lib/equity-signal/macro";
import type { EventReceipt } from "@/lib/equity-signal/types";
import { loadEquityUniverse } from "@/lib/equity-signal/universe";
import {
  getR2Config,
  readVersionedTextFromR2,
  writeVersionedJsonToR2,
} from "@/lib/r2-warehouse";
import { assessStrategicOptionality, type StrategicOptionalityAssessment } from "@/lib/opportunity-engine/strategic-optionality";
import type { UsValueCompanyAnalysis } from "@/lib/opportunity-engine/us-value-investing-engine";
import { readResumableUsValueState } from "@/lib/opportunity-engine/us-value-investing-resumable";

const BRANCH = "agent/combined-opportunity-engine" as const;
const R2_PREFIX = "branch-labs/pr-262/signal-operations/preprice-buy-radar" as const;
const LATEST_KEY = `${R2_PREFIX}/latest.json`;
const OUTBOX_PREFIX = "branch-labs/pr-262/serious-signal/outbox/preprice-buy" as const;
const RELATIONSHIP_INDEX_KEY = "branch-labs/pr-262/signal-operations/strategic-relationships/index.json";
const NORMALIZATION_PREFIX = "branch-labs/pr-262/signal-operations/long-term-normalization";
const WATCH_OUT_KEY = "branch-labs/pr-262/serious-signal/us-watch-out/latest.json";
const MAX_SOURCE_CANDIDATES = 100;
const MAX_DECISION_GRADE_READS = 40;
const MAX_PRICE_CONFIRMATIONS = 40;
const MAX_RELATIONSHIPS = 500;

type Json = Record<string, unknown>;

type Normalization = {
  buyQualityConfirmed?: boolean;
  durableEnoughForSeriousBuy?: boolean;
  oneTimeOrPeakRisk?: boolean;
  yearsAvailable?: number;
  blockers?: string[];
};

type StrategicRelationship = {
  publicTicker: string;
  publicCompany: string;
  relatedEntity: string;
  relationTypes: string[];
  confidence: number;
  sourceUrls: string[];
  firstObservedAt: string;
  lastObservedAt: string;
};

type RelationshipLedger = {
  version: 1;
  branch: typeof BRANCH;
  updatedAt: string;
  relationships: StrategicRelationship[];
};

type SourceTrigger = {
  ticker: string;
  company: string;
  eventFamily: string;
  relationship: "direct" | "strategic_second_order";
  direction: "upside" | "unknown";
  eventHeadline: string;
  whatHappened: string;
  eventObservedAt: string;
  causalChain: string[];
  receipts: EventReceipt[];
  primarySource: boolean;
  independentPublishers: number;
  eventTruth: number;
  mappingConfidence: number;
  materiality: number;
  transmissionConfidence: number;
  evidenceIndependence: number;
  contradictionPenalty: number;
  gatePassed: boolean;
  sourcePriority: number;
  relatedEntity: string | null;
};

type PriceCheck = {
  tradingViewPrice: number | null;
  yahooPrice: number | null;
  agreementPercent: number | null;
  passed: boolean;
  dailyChangePercent: number | null;
  relativeVolume: number | null;
  observedAt: string;
};

export type PrePriceBuyCandidate = {
  ticker: string;
  company: string;
  sourceObservedAt: string;
  sourceVerifiedAt: string;
  sourceLatencyMinutes: number | null;
  discoveryUsedPriceMovement: false;
  firstMoverStatus: "before_visible_move" | "early_repricing" | "already_repriced" | "price_unavailable";
  eventFamily: string;
  relationship: SourceTrigger["relationship"];
  relatedEntity: string | null;
  headline: string;
  causalChain: string[];
  currentPrice: number | null;
  dailyChangePercentAfterSourceCheck: number | null;
  conservativeFairValue: number | null;
  baseFairValue: number | null;
  optimisticFairValue: number | null;
  upsideToConservativePercent: number | null;
  upsideToBasePercent: number | null;
  businessQuality: number;
  risk: number;
  fairValueConfidence: number;
  fullContentDecisionGrade: boolean;
  sourceBasis: "full_article" | "official_structured_content" | "headline_only_blocked" | "missing";
  independentPriceCheck: PriceCheck;
  strategicOptionality: StrategicOptionalityAssessment;
  normalization: {
    available: boolean;
    buyQualityConfirmed: boolean | null;
    durableEnoughForSeriousBuy: boolean | null;
    oneTimeOrPeakRisk: boolean | null;
    yearsAvailable: number | null;
    blockers: string[];
  };
  classification: "serious_buy" | "buy_candidate" | "research_only";
  confidence: number;
  reasons: string[];
  blockers: string[];
};

export type PrePriceBuyRadarReport = {
  version: 1;
  ok: boolean;
  branch: typeof BRANCH;
  mode: "pr262_source_first_preprice_buy_radar";
  checkedAt: string;
  runtime: { commitSha: string | null; deploymentId: string | null };
  purpose: "detect material company information before price movement and then verify value and price";
  coverage: {
    storedCompaniesLoaded: number;
    sourceReceiptsRead: number;
    mappedSourceTriggers: number;
    strategicRelationshipTriggers: number;
    candidatesSentToFullContentReader: number;
    fullContentDecisionGrade: number;
    priceConfirmationsAfterContent: number;
    sourceFirst: true;
    priceUsedForDiscovery: false;
  };
  seriousBuys: PrePriceBuyCandidate[];
  buyCandidates: PrePriceBuyCandidate[];
  newSeriousBuys: Array<{
    fingerprint: string;
    ticker: string;
    company: string;
    sourceObservedAt: string;
    currentPrice: number | null;
    baseFairValue: number | null;
    potentialGainPercent: number | null;
    firstMoverStatus: PrePriceBuyCandidate["firstMoverStatus"];
    confidence: number;
    reasons: string[];
    outboxKey: string;
  }>;
  strategicRelationships: {
    key: string;
    total: number;
    addedOrUpdatedThisRun: number;
  };
  sourceHealth: Array<{ provider: string; status: string; recordsRead: number; error: string | null }>;
  methodology: {
    sourceFirst: true;
    secFilingsFirst: true;
    issuerAndNewsDiscoveryBeforePrice: true;
    priceMovementRequiredForDiscovery: false;
    headlineAloneCanTriggerSeriousBuy: false;
    fullContentRequired: true;
    analystExpectationsCanVetoBuy: false;
    currentPriceCheckedOnlyAfterSourceAnalysis: true;
    strategicOptionalityIncluded: true;
    unquantifiedStrategicRevenueAddedToBaseFairValue: false;
    maximumDeepReadsPerCycle: number;
  };
  warehouse: { latestKey: string; persisted: boolean; errors: string[] };
  safety: {
    databaseWrites: false;
    publishing: false;
    directUserNotifications: false;
    trades: false;
    productionWrites: false;
    nonUsScanning: false;
  };
};

function object(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function finite(value: unknown) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value.replace(/,/g, "")) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function rounded(value: number | null, digits = 2) {
  if (value === null || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function safeError(error: unknown) {
  return error instanceof Error ? error.message.replace(/\s+/g, " ").slice(0, 400) : "unknown_preprice_buy_radar_error";
}

function dateKey(value: string) {
  return value.replace(/[^0-9]/g, "").slice(0, 17);
}

async function readJson(key: string) {
  const current = await readVersionedTextFromR2(key);
  if (!current.found || !current.text) return null;
  return JSON.parse(current.text) as unknown;
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>) {
  const output = new Array<R>(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), Math.max(1, items.length)) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      output[index] = await worker(items[index]);
    }
  }));
  return output;
}

function companyKey(item: UsValueCompanyAnalysis) {
  return `${item.exchange.toUpperCase()}:${item.ticker.toUpperCase()}`;
}

async function loadAnalyses() {
  const state = await readResumableUsValueState();
  if (!state) return [] as UsValueCompanyAnalysis[];
  const batches = await mapWithConcurrency(state.completedBatchKeys, 4, async (key) => {
    try {
      const parsed = object(await readJson(key));
      return array(parsed.analyses) as UsValueCompanyAnalysis[];
    } catch {
      return [] as UsValueCompanyAnalysis[];
    }
  });
  const fallback = [...state.seriousAlerts.buy, ...state.qualityPriceWatchlist, ...state.seriousAlerts.sell, ...state.seriousAlerts.watchOut];
  const all = batches.flat().length ? batches.flat() : fallback;
  return [...new Map(all.map((item) => [companyKey(item), item])).values()];
}

async function loadNormalization(ticker: string): Promise<Normalization | null> {
  try {
    const value = object(await readJson(`${NORMALIZATION_PREFIX}/${ticker.toUpperCase()}/latest.json`));
    return Object.keys(value).length ? value as Normalization : null;
  } catch {
    return null;
  }
}

async function loadRelationships(): Promise<RelationshipLedger> {
  try {
    const value = object(await readJson(RELATIONSHIP_INDEX_KEY));
    if (value.version === 1 && Array.isArray(value.relationships)) return value as unknown as RelationshipLedger;
  } catch {}
  return { version: 1, branch: BRANCH, updatedAt: new Date(0).toISOString(), relationships: [] };
}

function normalized(value: string) {
  return value.toLowerCase().replace(/\b(?:incorporated|inc|corporation|corp|company|co|limited|ltd|plc|holdings?|group)\b/g, " ").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function receiptText(receipt: EventReceipt) {
  return `${receipt.title} ${receipt.summary ?? ""} ${receipt.publisher} ${receipt.companyHints.join(" ")} ${receipt.symbolHints.join(" ")}`;
}

function entityMentioned(receipt: EventReceipt, entity: string) {
  const haystack = normalized(receiptText(receipt));
  const needle = normalized(entity);
  return needle.length >= 3 && haystack.includes(needle);
}

function relationshipTypes(optional: StrategicOptionalityAssessment) {
  return [
    ...(optional.layers.equityInvestment ? ["equity_investment"] : []),
    ...(optional.layers.commercialRelationship ? ["commercial_relationship"] : []),
    ...(optional.layers.infrastructureDemand ? ["infrastructure_demand"] : []),
    ...(optional.layers.liquidityEvent ? ["liquidity_event"] : []),
  ];
}

function positiveFullContent(value: string, family: string) {
  const body = value.toLowerCase();
  const strongPositive = [
    /raises? (?:full.year |annual |quarterly )?guidance/,
    /guidance (?:raised|increased)/,
    /better than expected/,
    /beat(?:s|ing)? (?:analyst |consensus )?(?:expectations|estimates)/,
    /record (?:revenue|sales|bookings|backlog|operating income|free cash flow)/,
    /revenue (?:grew|growth|increased|rose)/,
    /operating income (?:grew|growth|increased|rose)/,
    /free cash flow (?:grew|growth|increased|rose|improved)/,
    /cloud revenue (?:grew|growth|increased|rose)/,
    /(?:contract|award|order|backlog).{0,40}(?:million|billion|multi.year|record)/,
    /(?:fda|food and drug administration).{0,50}(?:approved|approval|clearance|authorized)/,
    /(?:initial public offering|\bipo\b|direct listing|liquidity event).{0,80}(?:filed|plans?|target|expected|confidential)/,
    /(?:expands?|expanded) (?:its |the )?(?:strategic )?(?:collaboration|partnership|commercial arrangement)/,
  ];
  const severeNegative = [
    /cuts? (?:full.year |annual |quarterly )?guidance/,
    /guidance (?:cut|lowered|reduced)/,
    /miss(?:es|ed)? (?:analyst |consensus )?(?:expectations|estimates)/,
    /material weakness/,
    /going concern/,
    /bankruptcy|chapter 11/,
    /clinical hold|complete response letter|approval denied|rejected application/,
    /data breach|ransomware|cyberattack/,
  ];
  const positiveHits = strongPositive.filter((pattern) => pattern.test(body)).length;
  const negativeHits = severeNegative.filter((pattern) => pattern.test(body)).length;
  if (["regulatory_approval", "contract_award"].includes(family)) return positiveHits >= 1 && negativeHits === 0;
  if (family === "strategic_relationship") return positiveHits >= 1 && negativeHits === 0;
  return positiveHits >= 2 && negativeHits === 0;
}

function methodSpreadPercent(item: UsValueCompanyAnalysis) {
  const values = item.fairValue.methods.map((method) => method.value).filter((value) => Number.isFinite(value) && value > 0);
  if (values.length < 2 || !item.fairValue.baseValue) return null;
  return (Math.max(...values) - Math.min(...values)) / item.fairValue.baseValue * 100;
}

function firstMoverStatus(changePercent: number | null): PrePriceBuyCandidate["firstMoverStatus"] {
  if (changePercent === null) return "price_unavailable";
  const move = Math.abs(changePercent);
  if (move <= 1) return "before_visible_move";
  if (move <= 3) return "early_repricing";
  return "already_repriced";
}

async function fetchTradingViewPrice(item: UsValueCompanyAnalysis, fetchImpl: typeof fetch, observedAt: string) {
  try {
    const response = await fetchImpl("https://scanner.tradingview.com/america/scan", {
      method: "POST",
      cache: "no-store",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        origin: "https://www.tradingview.com",
        referer: "https://www.tradingview.com/",
        "user-agent": "Mozilla/5.0 (compatible; SwingUpPrePriceBuy/1.0)",
      },
      body: JSON.stringify({ symbols: { tickers: [item.tradingViewSymbol], query: { types: [] } }, columns: ["name", "close", "change", "relative_volume_10d_calc"], range: [0, 1] }),
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) return { price: null, change: null, relativeVolume: null };
    const payload = object(await response.json().catch(() => null));
    const row = object(array(payload.data)[0]);
    const data = array(row.d);
    return { price: finite(data[1]), change: finite(data[2]), relativeVolume: finite(data[3]), observedAt };
  } catch {
    return { price: null, change: null, relativeVolume: null, observedAt };
  }
}

async function fetchYahooPrice(ticker: string, fetchImpl: typeof fetch) {
  try {
    const response = await fetchImpl(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=5d`, {
      headers: { accept: "application/json", "user-agent": "Mozilla/5.0 (compatible; SwingUpPrePriceCrossCheck/1.0)" },
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) return null;
    const payload = object(await response.json());
    const result = object(array(object(payload.chart).result)[0]);
    const quote = object(array(object(result.indicators).quote)[0]);
    const closes = array(quote.close).map(finite).filter((value): value is number => value !== null && value > 0);
    return closes.at(-1) ?? null;
  } catch {
    return null;
  }
}

function strategicTriggers(receipts: EventReceipt[], relationships: StrategicRelationship[], analysisByTicker: Map<string, UsValueCompanyAnalysis>) {
  const triggers: SourceTrigger[] = [];
  for (const receipt of receipts) {
    for (const relation of relationships) {
      if (!entityMentioned(receipt, relation.relatedEntity)) continue;
      const item = analysisByTicker.get(relation.publicTicker.toUpperCase());
      if (!item) continue;
      const raw = receiptText(receipt).toLowerCase();
      const positive = /\b(?:ipo|initial public offering|direct listing|raises?|valuation|growth|expands?|partnership|collaboration|contract|launch|approval)\b/i.test(raw);
      if (!positive) continue;
      triggers.push({
        ticker: item.ticker,
        company: item.company,
        eventFamily: "strategic_relationship",
        relationship: "strategic_second_order",
        direction: "upside",
        eventHeadline: receipt.title,
        whatHappened: `${relation.relatedEntity} generated new information that may affect ${item.company}'s strategic asset value or commercial relationship.`,
        eventObservedAt: receipt.publishedAt,
        causalChain: [
          `${relation.relatedEntity} catalyst`,
          "strategic asset/commercial relationship value changes",
          `${item.company} future cash flow or asset value may change`,
        ],
        receipts: [receipt],
        primarySource: receipt.primarySource,
        independentPublishers: 1,
        eventTruth: receipt.primarySource ? 94 : 78,
        mappingConfidence: relation.confidence,
        materiality: 72,
        transmissionConfidence: 72,
        evidenceIndependence: receipt.primarySource ? 90 : 70,
        contradictionPenalty: 0,
        gatePassed: receipt.primarySource || receipt.official,
        sourcePriority: item.scores.businessQuality + Math.max(0, item.fairValue.upsideToBasePercent ?? 0) + 40,
        relatedEntity: relation.relatedEntity,
      });
    }
  }
  return triggers;
}

function mappedTriggers(mapped: ReturnType<typeof buildImpactCandidates>["candidates"], analysisByTicker: Map<string, UsValueCompanyAnalysis>) {
  return mapped.flatMap((candidate): SourceTrigger[] => {
    const item = analysisByTicker.get(candidate.ticker.toUpperCase());
    if (!item || candidate.relationship !== "direct") return [];
    if (candidate.direction === "downside") return [];
    const sourcePriority = (candidate.primarySource ? 80 : 0)
      + candidate.eventTruth * 0.5
      + candidate.mappingConfidence * 0.3
      + candidate.materiality * 0.4
      + candidate.evidenceIndependence * 0.3
      + item.scores.businessQuality
      - item.scores.risk
      + Math.max(0, item.fairValue.upsideToBasePercent ?? 0);
    return [{
      ticker: candidate.ticker,
      company: candidate.company,
      eventFamily: candidate.eventFamily,
      relationship: "direct",
      direction: candidate.direction === "upside" ? "upside" : "unknown",
      eventHeadline: candidate.eventHeadline,
      whatHappened: candidate.whatHappened,
      eventObservedAt: candidate.eventObservedAt,
      causalChain: candidate.causalChain,
      receipts: candidate.receipts,
      primarySource: candidate.primarySource,
      independentPublishers: candidate.independentPublishers,
      eventTruth: candidate.eventTruth,
      mappingConfidence: candidate.mappingConfidence,
      materiality: candidate.materiality,
      transmissionConfidence: candidate.transmissionConfidence,
      evidenceIndependence: candidate.evidenceIndependence,
      contradictionPenalty: candidate.contradictionPenalty,
      gatePassed: candidate.gatePassed,
      sourcePriority,
      relatedEntity: null,
    }];
  });
}

function uniqueTriggers(items: SourceTrigger[]) {
  const map = new Map<string, SourceTrigger>();
  for (const item of items) {
    const key = `${item.ticker.toUpperCase()}|${item.eventFamily}|${item.eventObservedAt}|${item.eventHeadline}`;
    const prior = map.get(key);
    if (!prior || item.sourcePriority > prior.sourcePriority) map.set(key, item);
  }
  return [...map.values()].sort((left, right) => right.sourcePriority - left.sourcePriority);
}

function candidateForArticle(trigger: SourceTrigger) {
  return {
    ticker: trigger.ticker,
    company: trigger.company,
    eventFamily: trigger.eventFamily,
    relationship: trigger.relationship === "direct" ? "direct" : "second_order",
    eventObservedAt: trigger.eventObservedAt,
    eventHeadline: trigger.eventHeadline,
    whatHappened: trigger.whatHappened,
    causalChain: trigger.causalChain,
    receipts: trigger.receipts,
  };
}

function decisionText(trigger: SourceTrigger, evidence: ReturnType<typeof object>) {
  const excerpts = array(evidence.excerpts).map(object).map((item) => text(item.excerpt) ?? "").filter(Boolean);
  const receiptSummaries = trigger.receipts.map((receipt) => `${receipt.title} ${receipt.summary ?? ""}`);
  return [...receiptSummaries, ...excerpts].join(" ").replace(/\s+/g, " ").trim().slice(0, 80_000);
}

async function updateRelationshipLedger(
  ledger: RelationshipLedger,
  additions: Array<{ item: UsValueCompanyAnalysis; optionality: StrategicOptionalityAssessment; sourceUrls: string[] }>,
  checkedAt: string,
) {
  const map = new Map(ledger.relationships.map((item) => [`${item.publicTicker.toUpperCase()}|${normalized(item.relatedEntity)}`, item]));
  let changed = 0;
  for (const addition of additions) {
    if (!addition.optionality.detected) continue;
    for (const relatedEntity of addition.optionality.relatedEntities) {
      const key = `${addition.item.ticker.toUpperCase()}|${normalized(relatedEntity)}`;
      const prior = map.get(key);
      const next: StrategicRelationship = {
        publicTicker: addition.item.ticker,
        publicCompany: addition.item.company,
        relatedEntity,
        relationTypes: [...new Set([...(prior?.relationTypes ?? []), ...relationshipTypes(addition.optionality)])],
        confidence: Math.max(prior?.confidence ?? 0, addition.optionality.confidence),
        sourceUrls: [...new Set([...(prior?.sourceUrls ?? []), ...addition.sourceUrls])].slice(-12),
        firstObservedAt: prior?.firstObservedAt ?? checkedAt,
        lastObservedAt: checkedAt,
      };
      map.set(key, next);
      changed += 1;
    }
  }
  const relationships = [...map.values()]
    .sort((left, right) => right.confidence - left.confidence || right.lastObservedAt.localeCompare(left.lastObservedAt))
    .slice(0, MAX_RELATIONSHIPS);
  const next: RelationshipLedger = { version: 1, branch: BRANCH, updatedAt: checkedAt, relationships };
  await writeVersionedJsonToR2(RELATIONSHIP_INDEX_KEY, next);
  return { ledger: next, changed };
}

function fingerprint(item: PrePriceBuyCandidate) {
  const ratio = item.currentPrice && item.baseFairValue ? Math.round((item.currentPrice / item.baseFairValue) * 20) / 20 : 0;
  return crypto.createHash("sha256")
    .update(`preprice_buy|${item.ticker}|${item.sourceObservedAt}|${item.eventFamily}|${ratio.toFixed(2)}`)
    .digest("hex")
    .slice(0, 24);
}

export async function runUsPrePriceBuyRadar(input: { fetchImpl?: typeof fetch; now?: Date } = {}): Promise<PrePriceBuyRadarReport> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const now = input.now ?? new Date();
  const checkedAt = now.toISOString();
  const warehouseErrors: string[] = [];
  if (!getR2Config().configured) throw new Error("cloudflare_r2_not_configured");

  // SOURCE FIRST: no live stock price is fetched before this source collection,
  // company mapping, event classification, and full-content selection step.
  const [analyses, universe, sourceResult, macroResult, relationships, watchOutValue] = await Promise.all([
    loadAnalyses(),
    loadEquityUniverse(fetchImpl, now),
    collectEventSources(fetchImpl, now),
    fetchMacroContext(fetchImpl, now),
    loadRelationships(),
    readJson(WATCH_OUT_KEY).catch(() => null),
  ]);
  const analysisByTicker = new Map(analyses.map((item) => [item.ticker.toUpperCase(), item]));
  const mapped = buildImpactCandidates(sourceResult.receipts, universe.snapshot, macroResult.context, now, []);
  const direct = mappedTriggers(mapped.candidates, analysisByTicker);
  const strategic = strategicTriggers(sourceResult.receipts, relationships.relationships, analysisByTicker);
  const sourceTriggers = uniqueTriggers([...direct, ...strategic])
    .filter((item) => item.primarySource || item.independentPublishers >= 2 || item.sourcePriority >= 220)
    .slice(0, MAX_SOURCE_CANDIDATES);

  const dynamicDeepReadLimit = Math.min(MAX_DECISION_GRADE_READS, sourceTriggers.length > 70 ? 40 : sourceTriggers.length > 30 ? 30 : 20);
  const articleInputs = sourceTriggers.slice(0, dynamicDeepReadLimit).map(candidateForArticle);
  const articleReport = await buildArticleEvidenceReport({ candidates: articleInputs, fetchImpl, maximumArticles: dynamicDeepReadLimit });
  const seriousWatchTickers = new Set(array(object(watchOutValue).seriousSignals).map(object).map((item) => text(item.ticker)?.toUpperCase()).filter((item): item is string => Boolean(item)));

  const decisionGrade = sourceTriggers.slice(0, dynamicDeepReadLimit).flatMap((trigger) => {
    const articleCandidate = candidateForArticle(trigger);
    const evidence = object(articleReport.candidates[articleEvidenceKey(articleCandidate)]);
    if (evidence.decisionGrade !== true) return [];
    const item = analysisByTicker.get(trigger.ticker.toUpperCase());
    if (!item) return [];
    const body = decisionText(trigger, evidence);
    if (!positiveFullContent(body, trigger.eventFamily) && trigger.direction !== "upside") return [];
    return [{ trigger, item, evidence, body }];
  });

  // PRICE SECOND: only companies whose source content is already decision-grade
  // now receive live and independent price confirmation.
  const confirmedInputs = decisionGrade.slice(0, MAX_PRICE_CONFIRMATIONS);
  const evaluated = await mapWithConcurrency(confirmedInputs, 5, async ({ trigger, item, evidence, body }): Promise<PrePriceBuyCandidate> => {
    const sourceVerifiedAt = new Date().toISOString();
    const [tv, yahoo, normalization] = await Promise.all([
      fetchTradingViewPrice(item, fetchImpl, sourceVerifiedAt),
      fetchYahooPrice(item.ticker, fetchImpl),
      loadNormalization(item.ticker),
    ]);
    const currentPrice = tv.price;
    const agreement = currentPrice && yahoo ? Math.abs(currentPrice - yahoo) / Math.max(currentPrice, yahoo) * 100 : null;
    const pricePassed = agreement !== null && agreement <= 2;
    const conservative = item.fairValue.conservativeValue;
    const base = item.fairValue.baseValue;
    const optimistic = item.fairValue.optimisticValue;
    const upsideToConservative = currentPrice && conservative ? (conservative / currentPrice - 1) * 100 : null;
    const upsideToBase = currentPrice && base ? (base / currentPrice - 1) * 100 : null;
    const spread = methodSpreadPercent(item);
    const durable = normalization?.buyQualityConfirmed === true
      && normalization?.durableEnoughForSeriousBuy !== false
      && normalization?.oneTimeOrPeakRisk !== true;
    const quality = item.scores.businessQuality >= 78
      && item.scores.balanceSheet >= 60
      && item.scores.risk <= 42
      && item.scores.fairValueConfidence >= 75
      && item.fairValue.methods.length >= 2
      && (spread ?? Infinity) <= 60;
    const valueMargin = (upsideToBase ?? -Infinity) >= 12 && (upsideToConservative ?? -Infinity) >= 5;
    const optionality = assessStrategicOptionality(body);
    const sourceStrong = trigger.primarySource
      || trigger.independentPublishers >= 2
      || trigger.relationship === "strategic_second_order";
    const positive = positiveFullContent(body, trigger.eventFamily) || trigger.direction === "upside";
    const noSevereWatchOut = !seriousWatchTickers.has(item.ticker.toUpperCase());
    const seriousBuy = Boolean(currentPrice)
      && sourceStrong
      && positive
      && quality
      && durable
      && pricePassed
      && valueMargin
      && noSevereWatchOut;
    const candidate = sourceStrong && positive && item.scores.businessQuality >= 70 && (upsideToBase ?? -Infinity) >= 5;
    const sourceLatencyMinutes = Number.isFinite(Date.parse(trigger.eventObservedAt))
      ? Math.max(0, (Date.parse(sourceVerifiedAt) - Date.parse(trigger.eventObservedAt)) / 60_000)
      : null;
    const status = firstMoverStatus(tv.change ?? null);
    const reasons = [
      `The source was detected at ${trigger.eventObservedAt} before live price movement was used for discovery.`,
      `Full source content was read and classified as decision-grade before the current price was requested.`,
      ...(trigger.primarySource ? ["A primary/official source supports the catalyst."] : [`${trigger.independentPublishers} independent publisher(s) support the event.`]),
      ...(quality ? [`Business quality is ${item.scores.businessQuality}/100, risk ${item.scores.risk}/100, and valuation confidence ${item.scores.fairValueConfidence}/100.`] : []),
      ...(durable ? ["Long-term SEC normalization supports repeatable earnings/cash generation and does not flag a one-time or peak-cycle distortion."] : []),
      ...(valueMargin ? [`After the source was analysed, the checked price still showed ${(upsideToBase ?? 0).toFixed(1)}% upside to base fair value and ${(upsideToConservative ?? 0).toFixed(1)}% to conservative fair value.`] : []),
      ...optionality.supportiveFactors,
      ...(status === "before_visible_move" ? ["At the later price check, the stock had not yet made a material visible daily move, so this qualifies as a leading-indicator setup rather than a reaction chase."] : []),
    ];
    const blockers = [
      ...(!sourceStrong ? ["The catalyst lacks a primary source or sufficient independent confirmation."] : []),
      ...(!positive ? ["Full content does not prove a positive business-value change."] : []),
      ...(!quality ? ["Quality, balance-sheet, risk, valuation-confidence, or valuation-agreement requirements are below the Buy standard."] : []),
      ...(!durable ? ["Long-term SEC normalization is missing or flags unstable/one-time earnings."] : []),
      ...(!pricePassed ? ["The independent current price cross-check did not agree within 2%."] : []),
      ...(!valueMargin ? ["After the source was read, the price did not retain at least 12% base upside and 5% conservative upside."] : []),
      ...(!noSevereWatchOut ? ["A current Serious Watch Out condition conflicts with immediate Buy promotion."] : []),
      ...optionality.risks,
    ];
    const confidence = Math.max(0, Math.min(98, Math.round(
      item.scores.businessQuality * 0.22
      + item.scores.fairValueConfidence * 0.25
      + trigger.eventTruth * 0.15
      + trigger.mappingConfidence * 0.12
      + trigger.materiality * 0.10
      + trigger.evidenceIndependence * 0.08
      + (durable ? 6 : 0)
      + (pricePassed ? 4 : 0)
      + (optionality.detected ? Math.min(4, optionality.optionalityScore / 25) : 0)
    )));
    return {
      ticker: item.ticker,
      company: item.company,
      sourceObservedAt: trigger.eventObservedAt,
      sourceVerifiedAt,
      sourceLatencyMinutes: rounded(sourceLatencyMinutes),
      discoveryUsedPriceMovement: false,
      firstMoverStatus: status,
      eventFamily: trigger.eventFamily,
      relationship: trigger.relationship,
      relatedEntity: trigger.relatedEntity,
      headline: trigger.eventHeadline,
      causalChain: trigger.causalChain,
      currentPrice: rounded(currentPrice),
      dailyChangePercentAfterSourceCheck: rounded(tv.change ?? null),
      conservativeFairValue: rounded(conservative),
      baseFairValue: rounded(base),
      optimisticFairValue: rounded(optimistic),
      upsideToConservativePercent: rounded(upsideToConservative),
      upsideToBasePercent: rounded(upsideToBase),
      businessQuality: item.scores.businessQuality,
      risk: item.scores.risk,
      fairValueConfidence: item.scores.fairValueConfidence,
      fullContentDecisionGrade: true,
      sourceBasis: (text(evidence.basis) ?? "missing") as PrePriceBuyCandidate["sourceBasis"],
      independentPriceCheck: {
        tradingViewPrice: rounded(currentPrice),
        yahooPrice: rounded(yahoo),
        agreementPercent: rounded(agreement),
        passed: pricePassed,
        dailyChangePercent: rounded(tv.change ?? null),
        relativeVolume: rounded(tv.relativeVolume ?? null),
        observedAt: sourceVerifiedAt,
      },
      strategicOptionality: optionality,
      normalization: {
        available: Boolean(normalization),
        buyQualityConfirmed: normalization?.buyQualityConfirmed ?? null,
        durableEnoughForSeriousBuy: normalization?.durableEnoughForSeriousBuy ?? null,
        oneTimeOrPeakRisk: normalization?.oneTimeOrPeakRisk ?? null,
        yearsAvailable: finite(normalization?.yearsAvailable),
        blockers: Array.isArray(normalization?.blockers) ? normalization!.blockers!.filter((value): value is string => typeof value === "string") : [],
      },
      classification: seriousBuy ? "serious_buy" : candidate ? "buy_candidate" : "research_only",
      confidence,
      reasons,
      blockers: [...new Set(blockers)],
    };
  });

  const relationshipUpdates = evaluated.map((candidate) => ({
    item: analysisByTicker.get(candidate.ticker.toUpperCase())!,
    optionality: candidate.strategicOptionality,
    sourceUrls: decisionGrade.find((item) => item.trigger.ticker.toUpperCase() === candidate.ticker.toUpperCase())?.trigger.receipts.map((receipt) => receipt.url) ?? [],
  })).filter((item) => Boolean(item.item));
  let updatedRelationships = relationships;
  let relationshipChanges = 0;
  try {
    const result = await updateRelationshipLedger(relationships, relationshipUpdates, checkedAt);
    updatedRelationships = result.ledger;
    relationshipChanges = result.changed;
  } catch (error) {
    warehouseErrors.push(`relationships:${safeError(error)}`);
  }

  const seriousBuys = evaluated.filter((item) => item.classification === "serious_buy").sort((left, right) => right.confidence - left.confidence);
  const buyCandidates = evaluated.filter((item) => item.classification === "buy_candidate").sort((left, right) => right.confidence - left.confidence);
  const newSeriousBuys: PrePriceBuyRadarReport["newSeriousBuys"] = [];
  for (const item of seriousBuys) {
    const id = fingerprint(item);
    const outboxKey = `${OUTBOX_PREFIX}/${item.ticker.toUpperCase()}/${id}.json`;
    try {
      const written = await writeVersionedJsonToR2(outboxKey, {
        version: 1,
        kind: "pr262_source_first_serious_buy",
        branch: BRANCH,
        fingerprint: id,
        checkedAt,
        signal: item,
        deliveryStatus: "pending_external_condition_watcher",
        safety: { publishing: false, directUserNotifications: false, trades: false, databaseWrites: false },
      }, { createOnly: true });
      if (written.written) newSeriousBuys.push({
        fingerprint: id,
        ticker: item.ticker,
        company: item.company,
        sourceObservedAt: item.sourceObservedAt,
        currentPrice: item.currentPrice,
        baseFairValue: item.baseFairValue,
        potentialGainPercent: item.upsideToBasePercent,
        firstMoverStatus: item.firstMoverStatus,
        confidence: item.confidence,
        reasons: item.reasons,
        outboxKey,
      });
    } catch (error) {
      warehouseErrors.push(`outbox:${item.ticker}:${safeError(error)}`);
    }
  }

  const report: PrePriceBuyRadarReport = {
    version: 1,
    ok: analyses.length > 0 && warehouseErrors.length === 0,
    branch: BRANCH,
    mode: "pr262_source_first_preprice_buy_radar",
    checkedAt,
    runtime: {
      commitSha: process.env.RAILWAY_GIT_COMMIT_SHA?.trim() || null,
      deploymentId: process.env.RAILWAY_DEPLOYMENT_ID?.trim() || null,
    },
    purpose: "detect material company information before price movement and then verify value and price",
    coverage: {
      storedCompaniesLoaded: analyses.length,
      sourceReceiptsRead: sourceResult.receipts.length,
      mappedSourceTriggers: direct.length,
      strategicRelationshipTriggers: strategic.length,
      candidatesSentToFullContentReader: articleInputs.length,
      fullContentDecisionGrade: decisionGrade.length,
      priceConfirmationsAfterContent: evaluated.length,
      sourceFirst: true,
      priceUsedForDiscovery: false,
    },
    seriousBuys,
    buyCandidates,
    newSeriousBuys,
    strategicRelationships: {
      key: RELATIONSHIP_INDEX_KEY,
      total: updatedRelationships.relationships.length,
      addedOrUpdatedThisRun: relationshipChanges,
    },
    sourceHealth: sourceResult.providers.map((provider) => ({ provider: provider.provider, status: provider.status, recordsRead: provider.recordsRead, error: provider.error })),
    methodology: {
      sourceFirst: true,
      secFilingsFirst: true,
      issuerAndNewsDiscoveryBeforePrice: true,
      priceMovementRequiredForDiscovery: false,
      headlineAloneCanTriggerSeriousBuy: false,
      fullContentRequired: true,
      analystExpectationsCanVetoBuy: false,
      currentPriceCheckedOnlyAfterSourceAnalysis: true,
      strategicOptionalityIncluded: true,
      unquantifiedStrategicRevenueAddedToBaseFairValue: false,
      maximumDeepReadsPerCycle: dynamicDeepReadLimit,
    },
    warehouse: { latestKey: LATEST_KEY, persisted: false, errors: warehouseErrors },
    safety: {
      databaseWrites: false,
      publishing: false,
      directUserNotifications: false,
      trades: false,
      productionWrites: false,
      nonUsScanning: false,
    },
  };
  try {
    await writeVersionedJsonToR2(LATEST_KEY, report);
    await writeVersionedJsonToR2(`${R2_PREFIX}/runs/${checkedAt.slice(0, 10)}/${dateKey(checkedAt)}.json`, report, { createOnly: true }).catch(() => {});
    report.warehouse.persisted = true;
    await writeVersionedJsonToR2(LATEST_KEY, report).catch(() => {});
  } catch (error) {
    report.ok = false;
    report.warehouse.errors.push(safeError(error));
  }
  return report;
}

export async function readLatestUsPrePriceBuyRadar() {
  try {
    const value = await readJson(LATEST_KEY);
    return value ? value as PrePriceBuyRadarReport : null;
  } catch {
    return null;
  }
}

export const US_PREPRICE_BUY_POLICY = Object.freeze({
  branch: BRANCH,
  sourceFirst: true,
  secFilingsFirst: true,
  issuerAndNewsBeforePrice: true,
  priceMovementRequiredForDiscovery: false,
  fullContentRequired: true,
  maximumDeepReadsPerCycle: MAX_DECISION_GRADE_READS,
  strategicOptionalityIncluded: true,
  unquantifiedStrategicRevenueAddedToBaseFairValue: false,
  analystExpectationsCanVetoBuy: false,
  publishing: false,
  directUserNotifications: false,
  trades: false,
});
