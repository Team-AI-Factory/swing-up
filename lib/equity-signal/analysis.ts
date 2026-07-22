import crypto from "node:crypto";
import { canonicalEventIdentity, computeEventFirstStrength, eventFirstGate, matchesEquityText, normalizeEquitySymbol, selectBalancedReceipts } from "@/lib/branch-signal-lab-policy";
import { analyzeHistoricalAnalogs, type HistoricalSignalRecord } from "@/lib/equity-signal/historical-analogs";
import type { EquityUniverseEntry, EquityUniverseSnapshot } from "@/lib/equity-signal/universe";
import type { EventFamily, EventReceipt, ImpactCandidate, MacroContext } from "@/lib/equity-signal/types";

type ClassifiedEvent = {
  family: EventFamily;
  direction: "upside" | "downside" | "unknown";
  materiality: number;
  transmission: number;
  rumour: boolean;
  terms: string[];
};

type MappedEvent = { receipt: EventReceipt; classification: ClassifiedEvent; equity: EquityUniverseEntry; relationship: "direct" | "second_order" | "third_order"; mappingConfidence: number; causalChain: string[] };

const NOISE = /\b(price target|technical analysis|stock picks?|stocks? to buy|should you buy|prediction|opinion|sponsored|top \d+ stocks?)\b/i;
const RUMOUR = /\b(rumou?r|reportedly considering|unconfirmed|sources? say|may be planning|could announce|speculation)\b/i;
const GENERIC_COMPANY_TOKENS = new Set(["american", "capital", "company", "corp", "digital", "energy", "financial", "first", "freedom", "general", "global", "group", "health", "holding", "holdings", "international", "national", "resources", "royal", "services", "systems", "technology", "technologies", "trust", "united", "world"]);
const ACTIVE_CONFLICT = /\b(military strikes?|airstrikes?|missile (?:attack|launch|strike)|invasion|armed conflict|shipping attack|red sea attack|hostilities|troops? (?:invade|deploy|mobilize)|war (?:erupts|escalates|breaks out|begins|widens|intensifies)|(?:declares?|declaration of) war|ceasefire (?:breaks|collapses)|conflict (?:erupts|escalates|widens|intensifies))\b/i;

function classify(receipt: EventReceipt): ClassifiedEvent {
  const value = `${receipt.title} ${receipt.summary ?? ""} ${receipt.rawEventType ?? ""}`.toLowerCase();
  const rumour = RUMOUR.test(value) && !receipt.primarySource;
  const hit = (pattern: RegExp) => pattern.test(value);
  if (hit(/\b(secondary offering|public offering|share offering|at-the-market offering|dilution|bankruptcy|chapter 11)\b/)) return { family: "financing_dilution", direction: "downside", materiality: 88, transmission: 91, rumour, terms: ["new supply or solvency pressure"] };
  if (hit(/\b(cyberattack|ransomware|data breach|security breach|systems? outage|hack(?:ed|ing)?)\b/)) return { family: "cyber_incident", direction: "downside", materiality: 82, transmission: 84, rumour, terms: ["operational disruption", "remediation and trust cost"] };
  if (hit(/\b(fda|food and drug administration).{0,45}\b(approv(?:e|ed|al)|clearance|authoriz(?:e|ed|ation))\b|\b(phase (?:2|3|ii|iii)).{0,40}\b(met|positive|success)\b/)) return { family: "regulatory_approval", direction: "upside", materiality: 92, transmission: 94, rumour, terms: ["official approval or positive pivotal result"] };
  if (hit(/\b(recall|clinical hold|complete response letter|approval denied|rejected application)\b/)) return { family: "regulatory_enforcement", direction: "downside", materiality: 90, transmission: 93, rumour, terms: ["regulatory setback or recall"] };
  if (hit(/\b(sec charges?|doj charges?|ftc sues|investigation|subpoena|enforcement action|antitrust suit|fine[ds]?|sanctioned)\b/)) return { family: "regulatory_enforcement", direction: "downside", materiality: 82, transmission: 85, rumour, terms: ["enforcement or legal burden"] };
  if (hit(/\b(beat(?:s|ing)? expectations|raises? guidance|guidance raised|record revenue|profit surge|better than expected|upgrades? outlook)\b/)) return { family: "earnings_guidance", direction: "upside", materiality: 82, transmission: 88, rumour, terms: ["earnings or guidance positive surprise"] };
  if (hit(/\b(miss(?:es|ed)? expectations|cuts? guidance|guidance cut|profit warning|revenue warning|worse than expected|downgrades? outlook)\b/)) return { family: "earnings_guidance", direction: "downside", materiality: 84, transmission: 89, rumour, terms: ["earnings or guidance negative surprise"] };
  if (hit(/\b(contract award|awarded (?:a |the )?contract|wins? contract|selected by|purchase order|multi-year deal)\b/)) return { family: "contract_award", direction: "upside", materiality: 77, transmission: 84, rumour, terms: ["incremental contracted revenue"] };
  if (hit(/\b(product launch|launches|unveils|announces? (?:a )?new (?:product|platform|model|chip)|keynote|developer conference|investor day)\b/)) return { family: hit(/conference|keynote|investor day/) ? "live_conference" : "product_launch", direction: "upside", materiality: 68, transmission: 72, rumour, terms: ["new product or commercial catalyst"] };
  if (hit(/\b(ai breakthrough|artificial intelligence breakthrough|new ai model|foundation model|quantum breakthrough|technology breakthrough|scientific breakthrough)\b/)) return { family: hit(/\bai\b|artificial intelligence/) ? "ai_breakthrough" : "technology_breakthrough", direction: "upside", materiality: 76, transmission: 78, rumour, terms: ["technical capability improvement", "potential demand or cost advantage"] };
  if (hit(/\b(acquisition completed|merger approved|definitive merger agreement|to be acquired|acquire[sd]? for \$)\b/)) return { family: "merger_acquisition", direction: "upside", materiality: 89, transmission: 86, rumour, terms: ["transaction value crystallisation"] };
  if (hit(/\b(ceo resigns?|chief executive resigns?|cfo resigns?|removes? (?:its )?ceo|leadership shakeup)\b/)) return { family: "leadership_change", direction: "downside", materiality: 67, transmission: 72, rumour, terms: ["leadership uncertainty"] };
  if (hit(/\b(federal reserve|fomc|interest rate|rate hike|rate cut|treasury yields?)\b/)) {
    const direction = hit(/\b(rate hike|raises? rates?|higher for longer|hawkish|yield(?:s)? (?:jump|surge|rise))\b/) ? "downside" : hit(/\b(rate cut|cuts? rates?|dovish|yield(?:s)? (?:fall|drop))\b/) ? "upside" : "unknown";
    return { family: "macro_rates", direction, materiality: 82, transmission: 78, rumour, terms: ["discount-rate and financing-cost transmission"] };
  }
  if (hit(/\b(cpi|pce|inflation|consumer prices?|producer prices?)\b/)) {
    const direction = hit(/\b(hotter|accelerat|above expectations|inflation rises?|prices? surge)\b/) ? "downside" : hit(/\b(cooler|decelerat|below expectations|inflation falls?|disinflation)\b/) ? "upside" : "unknown";
    return { family: "macro_inflation", direction, materiality: 78, transmission: 73, rumour, terms: ["inflation surprise", "policy-rate repricing"] };
  }
  if (hit(/\b(payrolls?|jobs report|unemployment|jobless claims?|employment report)\b/)) return { family: "macro_employment", direction: "unknown", materiality: 72, transmission: 65, rumour, terms: ["growth and policy expectations"] };
  if (hit(ACTIVE_CONFLICT)) return { family: "geopolitical_conflict", direction: "downside", materiality: 88, transmission: 82, rumour, terms: ["risk-off shock", "energy and logistics disruption"] };
  if (hit(/\b(sanctions?|export controls?|tariffs?|trade restrictions?|import ban|capital controls?)\b/)) return { family: "sanctions_trade", direction: "downside", materiality: 83, transmission: 80, rumour, terms: ["market-access or supply-chain restriction"] };
  if (hit(/\b(oil|crude|opec|natural gas|lng|pipeline)\b.*\b(surge|spike|cut|disruption|embargo|shortage)\b/)) return { family: "energy_commodity", direction: "upside", materiality: 80, transmission: 82, rumour, terms: ["commodity price and input-cost shock"] };
  if (receipt.official && ["white_house", "treasury", "federal_register"].includes(receipt.channel)) return { family: "government_announcement", direction: "unknown", materiality: 65, transmission: 60, rumour: false, terms: ["official government action"] };
  if (receipt.rawEventType === "4" || /\bform 4\b/.test(value)) return { family: "insider_ownership", direction: "unknown", materiality: 55, transmission: 55, rumour: false, terms: ["insider transaction filing"] };
  return { family: "other_material", direction: "unknown", materiality: 45, transmission: 45, rumour, terms: [] };
}

function normalized(value: string) {
  return value.toLowerCase().replace(/\b(?:incorporated|inc|corporation|corp|company|co|limited|ltd|plc|holdings?|group)\b/g, " ").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function normalizedExact(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function companyKeys(value: string) {
  return [...new Set([normalizedExact(value), normalized(value)])]
    .filter((key) => key.length >= 5)
    .filter((key) => key.includes(" ") || !GENERIC_COMPANY_TOKENS.has(key));
}

function buildIndex(entries: EquityUniverseEntry[]) {
  const ticker = new Map(entries.map((entry) => [entry.ticker, entry]));
  const cik = new Map(entries.flatMap((entry) => entry.cik ? [[entry.cik, entry] as const] : []));
  const aliases = new Map<string, EquityUniverseEntry[]>();
  const tokens = new Map<string, EquityUniverseEntry[]>();
  for (const entry of entries) {
    for (const alias of [entry.name, ...entry.aliases]) {
      for (const key of companyKeys(alias)) aliases.set(key, [...(aliases.get(key) ?? []), entry]);
      const first = normalizedExact(alias).split(" ").find((token) => token.length >= 4 && !GENERIC_COMPANY_TOKENS.has(token));
      if (first) tokens.set(first, [...(tokens.get(first) ?? []), entry]);
    }
  }
  return { ticker, cik, aliases, tokens };
}

function mapDirect(receipt: EventReceipt, index: ReturnType<typeof buildIndex>) {
  const mapped = new Map<string, { equity: EquityUniverseEntry; confidence: number }>();
  for (const hint of receipt.symbolHints) {
    const symbol = normalizeEquitySymbol(hint);
    const equity = symbol ? index.ticker.get(symbol) : null;
    if (equity) mapped.set(equity.ticker, { equity, confidence: 99 });
  }
  for (const hint of receipt.companyHints) {
    const cikMatch = hint.match(/^CIK(\d{10})$/i)?.[1];
    const byCik = cikMatch ? index.cik.get(cikMatch) : null;
    if (byCik) mapped.set(byCik.ticker, { equity: byCik, confidence: 100 });
    for (const key of companyKeys(hint)) for (const equity of index.aliases.get(key) ?? []) mapped.set(equity.ticker, { equity, confidence: 98 });
  }
  const sourceText = `${receipt.title} ${receipt.summary ?? ""}`;
  const sourceTokens = new Set(normalized(sourceText).split(" ").filter((token) => token.length >= 4));
  const possible = new Map<string, EquityUniverseEntry>();
  for (const token of sourceTokens) for (const equity of index.tokens.get(token) ?? []) possible.set(equity.ticker, equity);
  for (const equity of possible.values()) if (matchesEquityText(sourceText, equity)) mapped.set(equity.ticker, { equity, confidence: Math.max(mapped.get(equity.ticker)?.confidence ?? 0, 96) });
  return [...mapped.values()];
}

const RIPPLE_RULES: Array<{ families: EventFamily[]; require?: RegExp; tickers: string[]; direction: "upside" | "downside"; chain: string[] }> = [
  { families: ["geopolitical_conflict"], tickers: ["XOM", "CVX", "COP", "OXY", "LMT", "NOC", "RTX", "GD"], direction: "upside", chain: ["conflict escalation", "energy/defence demand and risk premium", "producer/contractor earnings sensitivity"] },
  { families: ["geopolitical_conflict", "energy_commodity"], tickers: ["DAL", "UAL", "AAL", "CCL", "RCL"], direction: "downside", chain: ["energy or route disruption", "fuel/logistics cost increase", "transport and travel margin pressure"] },
  { families: ["energy_commodity"], tickers: ["XOM", "CVX", "COP", "OXY", "EOG", "SLB", "HAL"], direction: "upside", chain: ["oil/gas supply shock", "higher realised commodity price", "energy cash-flow sensitivity"] },
  { families: ["sanctions_trade"], require: /\b(chip|semiconductor|china|taiwan|export control)\b/i, tickers: ["NVDA", "AMD", "AVGO", "QCOM", "MU", "AMAT", "LRCX", "KLAC", "TSM", "ASML"], direction: "downside", chain: ["technology trade restriction", "addressable-market or supply constraint", "semiconductor revenue/cost exposure"] },
  { families: ["sanctions_trade"], require: /\b(steel|aluminum|tariff|import)\b/i, tickers: ["NUE", "STLD", "CLF", "X"], direction: "upside", chain: ["import restriction", "domestic pricing support", "producer margin sensitivity"] },
  { families: ["macro_rates", "macro_inflation"], tickers: ["NVDA", "AMD", "CRM", "SNOW", "PLTR", "TSLA"], direction: "downside", chain: ["higher expected rates", "higher discount rate", "long-duration valuation pressure"] },
  { families: ["macro_rates", "macro_inflation"], tickers: ["JPM", "BAC", "WFC", "C", "GS", "MS"], direction: "upside", chain: ["higher expected rates", "net-interest-margin repricing", "large-bank earnings sensitivity"] },
  { families: ["cyber_incident"], require: /\b(widespread|critical infrastructure|government|multiple companies|supply chain)\b/i, tickers: ["CRWD", "PANW", "FTNT", "ZS", "OKTA"], direction: "upside", chain: ["broad cyber incident", "security spending urgency", "cybersecurity demand sensitivity"] },
  { families: ["ai_breakthrough", "technology_breakthrough"], require: /\b(ai|artificial intelligence|data center|accelerator|model)\b/i, tickers: ["NVDA", "AMD", "AVGO", "TSM", "ASML", "MU", "ANET", "VRT"], direction: "upside", chain: ["AI capability or adoption catalyst", "compute/network/power demand", "infrastructure supplier revenue sensitivity"] },
];

function rippleMappings(receipt: EventReceipt, classification: ClassifiedEvent, index: ReturnType<typeof buildIndex>) {
  const value = `${receipt.title} ${receipt.summary ?? ""}`;
  return RIPPLE_RULES.flatMap((rule): MappedEvent[] => {
    if (!rule.families.includes(classification.family) || (rule.require && !rule.require.test(value))) return [];
    if (classification.family === "macro_rates" || classification.family === "macro_inflation") {
      if (classification.direction === "unknown") return [];
      const direction = classification.direction === "downside" ? rule.direction : rule.direction === "upside" ? "downside" : "upside";
      return rule.tickers.flatMap((ticker) => index.ticker.get(ticker) ? [{ receipt, classification: { ...classification, direction }, equity: index.ticker.get(ticker)!, relationship: "second_order", mappingConfidence: 96, causalChain: rule.chain }] : []);
    }
    return rule.tickers.flatMap((ticker) => index.ticker.get(ticker) ? [{ receipt, classification: { ...classification, direction: rule.direction }, equity: index.ticker.get(ticker)!, relationship: "second_order", mappingConfidence: 96, causalChain: rule.chain }] : []);
  });
}

function eventTokens(receipt: EventReceipt) {
  return new Set(normalized(receipt.title).split(" ").filter((token) => token.length > 3 && !["announces", "company", "after", "with", "from", "will", "that"].includes(token)));
}

function similarity(left: EventReceipt, right: EventReceipt) {
  const a = eventTokens(left);
  const b = eventTokens(right);
  const common = [...a].filter((token) => b.has(token)).length;
  return common / Math.max(1, new Set([...a, ...b]).size);
}

function related(left: MappedEvent, right: MappedEvent) {
  return left.equity.ticker === right.equity.ticker
    && left.classification.family === right.classification.family
    && left.classification.direction === right.classification.direction
    && Math.abs(Date.parse(left.receipt.publishedAt) - Date.parse(right.receipt.publishedAt)) <= 18 * 60 * 60 * 1000
    && (similarity(left.receipt, right.receipt) >= 0.28 || left.receipt.rawEventType && left.receipt.rawEventType === right.receipt.rawEventType);
}

function candidateFromCluster(cluster: MappedEvent[], macro: MacroContext, historicalSignals: HistoricalSignalRecord[], now: Date): ImpactCandidate {
  const anchor = cluster.find((item) => item.receipt.primarySource) ?? cluster[0];
  const receipts = selectBalancedReceipts(cluster.map((item) => item.receipt), 12);
  const publishers = new Set(receipts.map((receipt) => receipt.publisher.toLowerCase()));
  const primarySource = receipts.some((receipt) => receipt.primarySource);
  const classification = anchor.classification;
  const eventTruth = primarySource ? 96 : publishers.size >= 3 ? 90 : publishers.size >= 2 ? 82 : 58;
  const evidenceIndependence = primarySource && publishers.size >= 2 ? 100 : primarySource ? 88 : publishers.size >= 3 ? 92 : publishers.size >= 2 ? 78 : 35;
  const fresh = now.getTime() - Math.max(...receipts.map((receipt) => Date.parse(receipt.publishedAt))) <= 24 * 60 * 60 * 1000;
  const mappingConfidence = Math.max(...cluster.map((item) => item.mappingConfidence));
  const materiality = Math.max(...cluster.map((item) => item.classification.materiality));
  const transmissionConfidence = Math.max(...cluster.map((item) => item.classification.transmission));
  const rumour = cluster.every((item) => item.classification.rumour);
  const eventKey = crypto.createHash("sha256").update(`${anchor.equity.ticker}|${anchor.classification.direction}|${classification.family}|${canonicalEventIdentity(anchor.receipt)}`).digest("hex").slice(0, 20);
  const historicalAnalog = analyzeHistoricalAnalogs({
    eventKey,
    eventFamily: classification.family,
    direction: anchor.classification.direction === "downside" ? "downside" : "upside",
    relationship: anchor.relationship,
    causalChain: anchor.causalChain,
    macroRegime: macro.regime,
    asOf: now.toISOString(),
    featuresAsOf: now.toISOString(),
  }, historicalSignals);
  const historicalContradiction = historicalAnalog.available && historicalAnalog.conservativeHitProbabilityPercent < 45
    ? Math.min(60, Math.round((45 - historicalAnalog.conservativeHitProbabilityPercent) * 4))
    : 0;
  const contradiction = historicalContradiction;
  const historicalSupport = historicalAnalog.historicalSupport;
  const pricedInPenalty = 0;
  const gate = eventFirstGate({ eventTruth, mappingConfidence, materiality, transmissionConfidence, fresh, primarySource, independentPublishers: publishers.size, unresolvedSevereContradiction: false, rumour });
  const score = computeEventFirstStrength({ eventTruth, mappingConfidence, materiality, transmissionConfidence, historicalSupport, evidenceIndependence, contradictionPenalty: contradiction, pricedInPenalty, rumour });
  const direction = anchor.classification.direction === "downside" ? "downside" : "upside";
  return {
    ticker: anchor.equity.ticker,
    company: anchor.equity.name,
    cik: anchor.equity.cik,
    eventFamily: classification.family,
    direction,
    relationship: anchor.relationship,
    eventHeadline: anchor.receipt.title,
    whatHappened: `${anchor.receipt.primarySource ? "Official source" : `${publishers.size} independent publisher(s)`}: ${anchor.receipt.summary || anchor.receipt.title}`,
    eventObservedAt: anchor.receipt.publishedAt,
    receipts,
    primarySource,
    independentPublishers: publishers.size,
    mappingConfidence,
    eventTruth,
    materiality,
    transmissionConfidence,
    historicalSupport,
    evidenceIndependence,
    contradictionPenalty: contradiction,
    pricedInPenalty,
    rumour,
    causalChain: anchor.causalChain,
    falsifiers: ["The official event is corrected, withdrawn, or shown to be immaterial.", "The stated causal link does not affect revenue, costs, financing, or valuation in the expected horizon.", "Fresh market data shows the opportunity was already fully repriced before a safe entry."],
    timeHorizon: anchor.relationship === "direct" ? "hours_to_10_trading_days" : "1_to_20_trading_days",
    score,
    gateChecks: { ...gate.checks, historicallySupportedKnockOn: anchor.relationship === "direct" || (historicalAnalog.leakageSafe && historicalAnalog.sampleSize >= 3 && historicalAnalog.conservativeHitProbabilityPercent >= 52) },
    gatePassed: gate.passed && score >= 72 && (anchor.relationship === "direct" || (historicalAnalog.leakageSafe && historicalAnalog.sampleSize >= 3 && historicalAnalog.conservativeHitProbabilityPercent >= 52)),
    quote: null,
    fundamentals: null,
    historicalAnalog: { ...historicalAnalog, source: "Cloudflare R2 point-in-time forward outcome memory" },
    priceForecast: { status: "insufficient_history", horizon: null, probabilityDirectionCorrectPercent: null, sampleSize: historicalAnalog.sampleSize, medianReturnPercent: null, pessimisticReturnPercent: null, optimisticReturnPercent: null, medianPrice: null, lowPrice: null, highPrice: null, forecastExpiresAt: null, basedOnMarketRelativeOutcomes: false, warning: "No numeric target is shown until real, leakage-safe historical outcomes are available." },
  };
}

export function buildImpactCandidates(receipts: EventReceipt[], universe: EquityUniverseSnapshot, macro: MacroContext, now: Date, historicalSignals: HistoricalSignalRecord[] = []) {
  const index = buildIndex(universe.entries);
  const mapped: MappedEvent[] = [];
  let noiseRejected = 0;
  let directionUnknown = 0;
  let unmapped = 0;
  for (const receipt of receipts) {
    if (NOISE.test(receipt.title) && !receipt.primarySource) { noiseRejected += 1; continue; }
    const classification = classify(receipt);
    const direct = mapDirect(receipt, index);
    if (classification.direction !== "unknown") {
      for (const value of direct) mapped.push({ receipt, classification, equity: value.equity, relationship: "direct", mappingConfidence: value.confidence, causalChain: [classification.terms[0] || "verified company event", "revenue/cost/capital or valuation impact", `${value.equity.ticker} expected ${classification.direction} sensitivity`] });
      mapped.push(...rippleMappings(receipt, classification, index));
    } else directionUnknown += 1;
    if (!direct.length && !rippleMappings(receipt, classification, index).length) unmapped += 1;
  }
  const clusters: MappedEvent[][] = [];
  for (const item of mapped) {
    const existing = clusters.find((cluster) => related(cluster[0], item));
    if (existing) existing.push(item); else clusters.push([item]);
  }
  const candidates = clusters.map((cluster) => candidateFromCluster(cluster, macro, historicalSignals, now));
  for (const candidate of candidates) {
    const severeContradiction = candidates.some((other) => other !== candidate
      && other.ticker === candidate.ticker
      && other.eventFamily === candidate.eventFamily
      && other.direction !== candidate.direction
      && Math.abs(Date.parse(other.eventObservedAt) - Date.parse(candidate.eventObservedAt)) <= 18 * 60 * 60 * 1000);
    if (!severeContradiction) continue;
    candidate.contradictionPenalty = 70;
    candidate.gateChecks.noSevereContradiction = false;
    candidate.gatePassed = false;
    candidate.score = computeEventFirstStrength({ eventTruth: candidate.eventTruth, mappingConfidence: candidate.mappingConfidence, materiality: candidate.materiality, transmissionConfidence: candidate.transmissionConfidence, historicalSupport: candidate.historicalSupport, evidenceIndependence: candidate.evidenceIndependence, contradictionPenalty: candidate.contradictionPenalty, pricedInPenalty: candidate.pricedInPenalty, rumour: candidate.rumour });
  }
  candidates.sort((left, right) => right.score - left.score || right.eventTruth - left.eventTruth).splice(100);
  const unique = [...new Map(candidates.map((candidate) => [`${candidate.ticker}|${candidate.direction}|${candidate.eventFamily}|${canonicalEventIdentity(candidate.receipts[0])}`, candidate])).values()];
  return {
    candidates: unique,
    diagnostics: { receiptsConsidered: receipts.length, noiseRejected, directionUnknown, unmapped, mappedRelationships: mapped.length, eventClusters: clusters.length, directCandidates: unique.filter((candidate) => candidate.relationship === "direct").length, rippleCandidates: unique.filter((candidate) => candidate.relationship !== "direct").length, gatePassed: unique.filter((candidate) => candidate.gatePassed).length },
  };
}

export function fingerprintCandidate(candidate: ImpactCandidate) {
  return crypto.createHash("sha256").update(`${candidate.ticker}|${candidate.direction}|${candidate.eventFamily}|${canonicalEventIdentity(candidate.receipts[0])}`).digest("hex").slice(0, 20);
}
