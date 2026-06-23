import type { RawSignal } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { redactSecrets } from "@/lib/redact-secrets";

export const GENERIC_NEWS_TYPES = [
  "genericNoise",
  "macroShock",
  "sectorShock",
  "regulationShock",
  "geopoliticalShock",
  "supplyChainShock",
  "commodityShock",
  "currencyShock",
  "rateInflationShock",
  "creditLiquidityShock",
  "legalInvestigationShock",
  "healthRegulatoryShock",
  "technologyPlatformShift",
  "consumerDemandShift",
  "defenceSecurityShock",
  "climateWeatherShock",
  "policyElectionShock",
] as const;

export type GenericNewsType = (typeof GENERIC_NEWS_TYPES)[number];

type GenericRawSignal = Pick<RawSignal, "id" | "source" | "ticker" | "title" | "summary" | "sourceUrl" | "receivedAt" | "payload">;

export type GenericNewsClassification = {
  rawSignalId: string | null;
  source: string;
  title: string;
  sourceUrl: string | null;
  receivedAt: string;
  genericNewsType: GenericNewsType;
  seriousnessScore: number;
  ripplePotentialScore: number;
  affectedAssetTypes: string[];
  affectedSectors: string[];
  affectedCountries: string[];
  affectedCommodities: string[];
  affectedCurrencies: string[];
  affectedCompanies: string[];
  affectedTickers: string[];
  confidence: number;
  whyItMayMatter: string;
  whyItMayBeNoise: string;
  clearMechanism: boolean;
  freshSourceUrl: boolean;
  broadMarketCommentary: boolean;
  rippleCandidate: boolean;
  rejectedReason: string | null;
  deepChecksPlanned: string[];
};

type Rule = {
  type: GenericNewsType;
  terms: string[];
  seriousness: number;
  ripple: number;
  sectors?: string[];
  countries?: string[];
  commodities?: string[];
  currencies?: string[];
  companies?: string[];
  tickers?: string[];
  assetTypes?: string[];
  why: string;
};

const RULES: Rule[] = [
  { type: "rateInflationShock", terms: ["interest rate", "rate decision", "fed", "federal reserve", "cpi", "inflation", "yields", "jobs report"], seriousness: 72, ripple: 74, sectors: ["Banks", "REITs", "Growth technology", "Small caps"], currencies: ["USD"], tickers: ["JPM", "BAC", "IWM", "QQQ", "VNQ"], assetTypes: ["equity", "ETF", "currency", "macro"], why: "Rates and inflation can reprice borrowing costs, growth valuations, banks, real estate, and the dollar." },
  { type: "commodityShock", terms: ["oil", "gas", "opec", "sanction", "pipeline", "refinery", "lng", "crude"], seriousness: 76, ripple: 78, sectors: ["Energy", "Airlines", "Shipping", "Consumer staples"], commodities: ["Oil", "Natural gas"], currencies: ["USD"], tickers: ["XOM", "CVX", "OXY", "XLE", "DAL", "UAL"], assetTypes: ["equity", "ETF", "commodity", "currency"], why: "Energy supply shocks can move oil, input costs, transport margins, inflation expectations, and energy producers." },
  { type: "regulationShock", terms: ["export control", "tariff", "ban", "regulation", "antitrust", "ftc", "doj", "eu commission", "sanctions"], seriousness: 74, ripple: 77, sectors: ["Semiconductors", "Software", "Technology", "Industrials"], countries: ["United States", "China", "European Union"], tickers: ["NVDA", "AMD", "TSM", "ASML", "MU", "SMH", "SOXX"], assetTypes: ["equity", "ETF"], why: "Policy restrictions can change which companies may sell, source, or operate in key markets." },
  { type: "supplyChainShock", terms: ["shipping route", "port", "supply chain", "cyberattack", "canal", "red sea", "logistics", "freight"], seriousness: 73, ripple: 76, sectors: ["Retail", "Autos", "Logistics", "Energy", "Industrials"], commodities: ["Oil"], tickers: ["AMZN", "WMT", "TGT", "FDX", "UPS", "TSLA", "XOM"], assetTypes: ["equity", "ETF", "commodity", "macro"], why: "Transport disruption can delay inventory, raise freight costs, and ripple into inflation and margins." },
  { type: "healthRegulatoryShock", terms: ["fda", "safety warning", "recall", "clinical hold", "drug warning", "medical device"], seriousness: 73, ripple: 70, sectors: ["Healthcare", "Pharma", "Medical devices"], tickers: ["PFE", "MRNA", "LLY", "JNJ", "XLV", "IBB"], assetTypes: ["equity", "ETF"], why: "Health regulator actions can affect sales, liability, approvals, and peer valuations." },
  { type: "geopoliticalShock", terms: ["war", "missile", "invasion", "military escalation", "border attack", "geopolitical", "sanction"], seriousness: 80, ripple: 78, sectors: ["Defense", "Energy", "Shipping", "Airlines"], commodities: ["Oil", "Gold"], currencies: ["USD"], tickers: ["LMT", "RTX", "NOC", "XOM", "GLD", "XLE"], assetTypes: ["equity", "ETF", "commodity", "currency"], why: "Escalation can shift defense demand, energy supply risk, safe-haven flows, and shipping costs." },
  { type: "technologyPlatformShift", terms: ["ai regulation", "platform shift", "app store", "cloud outage", "ai chip", "semiconductor", "data center"], seriousness: 69, ripple: 72, sectors: ["AI infrastructure", "Software", "Semiconductors", "Cloud"], tickers: ["MSFT", "GOOGL", "META", "NVDA", "AMD", "AVGO"], assetTypes: ["equity", "ETF"], why: "Platform or AI infrastructure changes can redirect demand and regulatory risk across technology leaders." },
  { type: "legalInvestigationShock", terms: ["investigation", "lawsuit", "subpoena", "fraud probe", "criminal probe", "class action"], seriousness: 70, ripple: 66, sectors: ["Financials", "Technology", "Healthcare"], assetTypes: ["equity"], why: "Major legal probes can change liability, business practices, and sector valuation discounts." },
  { type: "climateWeatherShock", terms: ["hurricane", "wildfire", "drought", "flood", "heat wave", "winter storm"], seriousness: 66, ripple: 65, sectors: ["Insurance", "Utilities", "Agriculture", "Energy"], commodities: ["Natural gas", "Wheat", "Corn"], tickers: ["XLU", "XLE", "ADM", "AIG"], assetTypes: ["equity", "ETF", "commodity"], why: "Severe weather can disrupt production, insured losses, utilities, crops, and energy demand." },
  { type: "creditLiquidityShock", terms: ["credit crunch", "bank run", "liquidity", "default", "debt ceiling", "downgrade"], seriousness: 78, ripple: 78, sectors: ["Banks", "Credit", "REITs", "Small caps"], currencies: ["USD"], tickers: ["JPM", "BAC", "KRE", "HYG", "IWM", "VNQ"], assetTypes: ["equity", "ETF", "currency", "macro"], why: "Liquidity stress can affect lending, risk appetite, funding costs, and weaker balance sheets first." },
];

const NOISE_TERMS = ["stocks mixed", "stock market today", "market recap", "10 stocks", "to watch", "opinion", "etf strategy", "markets end", "wall street mixed"];
const BROAD_SOURCES = new Set(["GDELT", "Google News RSS", "Marketaux Catalyst", "FRED Macro", "Frankfurter FX", "CoinGecko"]);

function includesAny(text: string, terms: string[]) {
  return terms.some((term) => text.includes(term));
}
function uniq(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}
function scoreClamp(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function classifyGenericNews(signal: GenericRawSignal): GenericNewsClassification {
  const text = `${signal.title} ${signal.summary} ${JSON.stringify(signal.payload ?? {})}`.toLowerCase();
  const matched = RULES.filter((rule) => includesAny(text, rule.terms));
  const best = matched.sort((a, b) => b.seriousness + b.ripple - (a.seriousness + a.ripple))[0];
  const broadMarketCommentary = includesAny(text, NOISE_TERMS) && !best;
  const freshSourceUrl = Boolean(signal.sourceUrl && /^https?:\/\//i.test(signal.sourceUrl));
  const affectedSectors = uniq(matched.flatMap((rule) => rule.sectors ?? []));
  const affectedTickers = uniq([...(signal.ticker ? [signal.ticker] : []), ...matched.flatMap((rule) => rule.tickers ?? [])]).slice(0, 14);
  const affectedCountries = uniq(matched.flatMap((rule) => rule.countries ?? []));
  const affectedCommodities = uniq(matched.flatMap((rule) => rule.commodities ?? []));
  const affectedCurrencies = uniq(matched.flatMap((rule) => rule.currencies ?? []));
  const affectedAssetTypes = uniq(matched.flatMap((rule) => rule.assetTypes ?? ["equity"]));
  const affectedCompanies = uniq(affectedTickers.map((ticker) => ({ NVDA: "Nvidia", AMD: "Advanced Micro Devices", TSM: "TSMC", ASML: "ASML", MU: "Micron", XOM: "Exxon Mobil", CVX: "Chevron", OXY: "Occidental", MSFT: "Microsoft", GOOGL: "Alphabet", META: "Meta", JPM: "JPMorgan", BAC: "Bank of America" })[ticker] ?? ticker));
  const clearMechanism = Boolean(best?.why && (affectedSectors.length || affectedCountries.length || affectedCommodities.length || affectedTickers.length));
  const seriousnessScore = scoreClamp((best?.seriousness ?? 18) + (freshSourceUrl ? 4 : -8) + (broadMarketCommentary ? -25 : 0));
  const ripplePotentialScore = scoreClamp((best?.ripple ?? 15) + Math.min(12, affectedTickers.length * 2) + (clearMechanism ? 6 : -10) + (broadMarketCommentary ? -25 : 0));
  const rippleCandidate = seriousnessScore >= 68 && ripplePotentialScore >= 68 && clearMechanism && freshSourceUrl && !broadMarketCommentary;
  const rejectedReason = rippleCandidate ? null : broadMarketCommentary ? "broad_market_commentary_or_listicle" : !freshSourceUrl ? "specific_fresh_source_url_required" : !clearMechanism ? "no_clear_impact_mechanism_or_asset_mapping" : "seriousness_or_ripple_score_below_threshold";
  return redactSecrets({
    rawSignalId: signal.id ?? null,
    source: signal.source,
    title: signal.title,
    sourceUrl: signal.sourceUrl,
    receivedAt: signal.receivedAt.toISOString(),
    genericNewsType: best?.type ?? "genericNoise",
    seriousnessScore,
    ripplePotentialScore,
    affectedAssetTypes,
    affectedSectors,
    affectedCountries,
    affectedCommodities,
    affectedCurrencies,
    affectedCompanies,
    affectedTickers,
    confidence: scoreClamp((matched.length ? 58 : 35) + matched.length * 8 + (freshSourceUrl ? 7 : 0)),
    whyItMayMatter: best?.why ?? "No clear market mechanism was found beyond broad commentary.",
    whyItMayBeNoise: broadMarketCommentary ? "The headline looks like a recap, listicle, or vague market commentary." : rippleCandidate ? "It still needs independent proof before any alert can move forward." : "The mapping, mechanism, source specificity, or score is not strong enough yet.",
    clearMechanism,
    freshSourceUrl,
    broadMarketCommentary,
    rippleCandidate,
    rejectedReason,
    deepChecksPlanned: rippleCandidate ? ["targeted_google_news_proof", "marketaux_ticker_proof", "sec_or_regulator_check_if_relevant", "fmp_price_fundamental_context_if_relevant"].slice(0, 4) : [],
  });
}

export async function runGenericNewsTriage(input: { maxGenericItemsToScan?: number; maxRippleCandidates?: number; maxDeepChecks?: number; confirmRun?: boolean; freshnessWindowHours?: number }) {
  const maxGenericItemsToScan = Math.min(Math.max(input.maxGenericItemsToScan ?? 50, 1), 100);
  const maxRippleCandidates = Math.min(Math.max(input.maxRippleCandidates ?? 10, 0), 25);
  const maxDeepChecks = Math.min(Math.max(input.maxDeepChecks ?? 5, 0), 10);
  const since = new Date(Date.now() - (input.freshnessWindowHours ?? 72) * 60 * 60 * 1000);
  const signals = process.env.DATABASE_URL ? await prisma.rawSignal.findMany({ where: { receivedAt: { gte: since }, OR: [{ source: { in: Array.from(BROAD_SOURCES) } }, { ticker: null }] }, orderBy: [{ receivedAt: "desc" }], take: maxGenericItemsToScan }) : [];
  const classifications = signals.map(classifyGenericNews);
  const rippleCandidates = classifications.filter((item) => item.rippleCandidate).slice(0, maxRippleCandidates);
  const deepChecksTriggered = rippleCandidates.slice(0, maxDeepChecks).flatMap((item) => item.deepChecksPlanned.map((check) => ({ rawSignalId: item.rawSignalId, check, tickers: item.affectedTickers.slice(0, 5) })));
  const callsSavedByTriage = Math.max(0, classifications.reduce((sum, item) => sum + Math.max(1, item.affectedTickers.length || 1), 0) - deepChecksTriggered.length);
  const noise = classifications.filter((item) => !item.rippleCandidate);
  return redactSecrets({
    enabled: true,
    broadSourcesUsed: Array.from(new Set(signals.map((signal) => signal.source))),
    genericItemsScannedToday: classifications.length,
    seriousGenericSignalsFound: classifications.filter((item) => item.seriousnessScore >= 68).length,
    rippleCandidatesCreated: rippleCandidates.length,
    genericSignalsRejectedAsNoise: noise.length,
    topGenericSignalTypes: topCounts(classifications.map((item) => item.genericNewsType)),
    topAffectedSectors: topCounts(classifications.flatMap((item) => item.affectedSectors)),
    topAffectedTickers: topCounts(rippleCandidates.flatMap((item) => item.affectedTickers)),
    affectedTickersFromGenericNews: uniq(rippleCandidates.flatMap((item) => item.affectedTickers)).slice(0, 25),
    topGenericSignal: rippleCandidates[0] ?? classifications[0] ?? null,
    exampleRejectedAsNoise: noise[0] ?? null,
    examplePromotedIntoRippleCandidate: rippleCandidates[0] ?? null,
    deepChecksTriggeredByGenericNews: deepChecksTriggered,
    callsSavedByTriage,
    callsSavedByGenericTriage: callsSavedByTriage,
    genericNewsDidNotBypassProofGate: true,
    openAiCalled: false,
    publishAttempted: false,
    telegramAttempted: false,
    classifications,
    nextRecommendedFix: rippleCandidates.length ? "Run targeted proof checks only for the top mapped tickers; keep Stage 2 locked until at least 2 clean proof types match." : "Keep broad scanning GDELT/Google/Marketaux and tune keyword maps if serious generic items are repeatedly missed.",
  });
}

function topCounts(values: string[]) {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, count]) => ({ name, count }));
}
