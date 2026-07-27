import { scanTradingViewGlobalStocks, type GlobalResearchCandidate } from "./global-market-scanner-v3";

export type GlobalResearchAction = "buy" | "sell" | "watch_out";

export type GlobalDeepResearchCase = {
  action: GlobalResearchAction;
  tradingViewSymbol: string;
  symbol: string;
  company: string;
  exchange: string;
  country: string | null;
  currency: string | null;
  observedAt: string;
  currentPrice: number;
  currentPriceSource: "TradingView public stock scanner";
  secondSourcePrice: number | null;
  priceAgreementPercent: number | null;
  marketCap: number | null;
  targetConsensus: number | null;
  targetLow: number | null;
  targetHigh: number | null;
  targetUpsidePercent: number | null;
  analystCount: number | null;
  analystGradeBalance: number | null;
  consensusRevenueGrowthPercent: number | null;
  consensusEps: number | null;
  currentNewsCount: number;
  currentNewsSentiment: number | null;
  currentNews: Array<{ title: string; source: string | null; publishedAt: string | null; url: string }>;
  providersAttempted: string[];
  providersUsed: string[];
  providerErrors: string[];
  themes: string[];
  evidenceScore: number;
  researchDisposition: "advance_to_committee_research" | "watch_for_more_evidence" | "reject_or_deprioritize";
  seriousSignal: false;
  blockedReasons: string[];
  receipts: Array<{ source: string; url: string; observedAt: string | null; fields: string[] }>;
};

export type GlobalDeepResearchResult = {
  ok: boolean;
  checkedAt: string;
  universe: {
    primaryListingsFetched: number;
    eligibleListings: number;
    exchanges: number;
    countries: number;
    coveragePercent: number;
  };
  requested: { perAction: number; totalCandidates: number };
  results: {
    buy: GlobalDeepResearchCase[];
    sell: GlobalDeepResearchCase[];
    watchOut: GlobalDeepResearchCase[];
  };
  summary: {
    researched: number;
    advanced: number;
    watched: number;
    rejected: number;
    seriousSignals: 0;
    providerErrors: number;
  };
  safety: {
    databaseWrites: false;
    publishing: false;
    notifications: false;
    seriousSignalsUnlocked: false;
    reason: "Live research does not become a serious directional alert until an independent historical certificate passes.";
  };
};

type Json = Record<string, unknown>;
type FmpResearch = {
  quote: number | null;
  marketCap: number | null;
  targetConsensus: number | null;
  targetLow: number | null;
  targetHigh: number | null;
  analystCount: number | null;
  gradeBalance: number | null;
  estimatedRevenue: number | null;
  estimatedEps: number | null;
  observedAt: string;
  receipts: GlobalDeepResearchCase["receipts"];
  errors: string[];
};
type NewsResearch = {
  articles: GlobalDeepResearchCase["currentNews"];
  sentiment: number | null;
  receipt: GlobalDeepResearchCase["receipts"][number] | null;
  errors: string[];
};

const object = (value: unknown): Json => value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
const rows = (value: unknown): Json[] => Array.isArray(value) ? value.filter((item): item is Json => Boolean(item) && typeof item === "object" && !Array.isArray(item)) : [];
const text = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : null;
const finite = (value: unknown): number | null => {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value.replace(/[,%$]/g, "")) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
};
const unique = <T>(values: T[]) => [...new Set(values)];
const clamp = (value: number) => Math.max(0, Math.min(100, Math.round(value)));
const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const safeError = (error: unknown) => error instanceof Error ? error.message.replace(/apikey=[^&\s]+/gi, "apikey=[redacted]").replace(/api_token=[^&\s]+/gi, "api_token=[redacted]").replace(/\s+/g, " ").slice(0, 260) : "provider_error";

async function fetchJson(url: URL, headers: Record<string, string> = {}) {
  const response = await fetch(url, { cache: "no-store", headers: { accept: "application/json", ...headers }, signal: AbortSignal.timeout(25_000) });
  const payload = await response.json().catch(async () => await response.text().catch(() => null));
  const message = JSON.stringify(payload ?? "").toLowerCase();
  if (!response.ok || /subscription|plan required|payment required|invalid api|limit reached|rate limit/.test(message)) throw new Error(`provider_http_${response.status}:${url.hostname}:${message.slice(0, 140)}`);
  return payload;
}

function firstNumber(row: Json | null, names: string[]) {
  if (!row) return null;
  for (const name of names) {
    const value = finite(row[name]);
    if (value !== null) return value;
  }
  return null;
}

function firstDate(row: Json | null, names: string[]) {
  if (!row) return null;
  for (const name of names) {
    const value = text(row[name]);
    if (value && Number.isFinite(Date.parse(value))) return new Date(value).toISOString();
  }
  return null;
}

async function fmpCall(path: string, symbol: string) {
  const key = process.env.FMP_API_KEY?.trim();
  if (!key) return null;
  const url = new URL(`https://financialmodelingprep.com/stable/${path}`);
  url.searchParams.set("symbol", symbol);
  if (path === "analyst-estimates") {
    url.searchParams.set("period", "annual");
    url.searchParams.set("page", "0");
    url.searchParams.set("limit", "5");
  }
  url.searchParams.set("apikey", key);
  const payload = await fetchJson(url, { apikey: key, "user-agent": "SwingUpDeepResearch/1.0" });
  return { payload, safeUrl: url.toString().replace(key, "[redacted]") };
}

async function fetchFmpResearch(candidate: GlobalResearchCandidate): Promise<FmpResearch> {
  const observedAt = new Date().toISOString();
  if (!process.env.FMP_API_KEY?.trim()) return { quote: null, marketCap: null, targetConsensus: null, targetLow: null, targetHigh: null, analystCount: null, gradeBalance: null, estimatedRevenue: null, estimatedEps: null, observedAt, receipts: [], errors: ["FMP_API_KEY is unavailable"] };
  const errors: string[] = [];
  const endpointNames = ["quote", "analyst-estimates", "price-target-consensus", "grades-summary"] as const;
  const settled = await Promise.allSettled(endpointNames.map((endpoint) => fmpCall(endpoint, candidate.symbol)));
  const values = new Map<string, Awaited<ReturnType<typeof fmpCall>>>();
  settled.forEach((result, index) => {
    const endpoint = endpointNames[index];
    if (result.status === "fulfilled") values.set(endpoint, result.value);
    else errors.push(`FMP ${endpoint}: ${safeError(result.reason)}`);
  });
  const quoteResult = values.get("quote");
  const estimateResult = values.get("analyst-estimates");
  const targetResult = values.get("price-target-consensus");
  const gradeResult = values.get("grades-summary");
  const quote = rows(quoteResult?.payload)[0] ?? null;
  const estimates = rows(estimateResult?.payload).sort((left, right) => String(left.date ?? left.calendarYear ?? "").localeCompare(String(right.date ?? right.calendarYear ?? "")));
  const estimate = estimates.find((row) => {
    const date = firstDate(row, ["date", "fiscalDateEnding"]);
    return date ? Date.parse(date) >= Date.now() - 180 * 86_400_000 : true;
  }) ?? estimates.at(-1) ?? null;
  const target = rows(targetResult?.payload)[0] ?? null;
  const grade = rows(gradeResult?.payload)[0] ?? null;
  const strongBuy = firstNumber(grade, ["strongBuy"]) ?? 0;
  const buy = firstNumber(grade, ["buy"]) ?? 0;
  const hold = firstNumber(grade, ["hold"]) ?? 0;
  const sell = firstNumber(grade, ["sell"]) ?? 0;
  const strongSell = firstNumber(grade, ["strongSell"]) ?? 0;
  const totalGrades = strongBuy + buy + hold + sell + strongSell;
  const gradeBalance = totalGrades > 0 ? ((strongBuy * 2 + buy - sell - strongSell * 2) / (totalGrades * 2)) * 100 : null;
  const receipts = endpointNames.flatMap((endpoint) => {
    const value = values.get(endpoint);
    return value?.safeUrl ? [{ source: `FMP ${endpoint}`, url: value.safeUrl, observedAt, fields: [endpoint] }] : [];
  });
  return {
    quote: firstNumber(quote, ["price"]),
    marketCap: firstNumber(quote, ["marketCap"]),
    targetConsensus: firstNumber(target, ["targetConsensus", "targetPriceConsensus", "priceTargetConsensus", "targetMedian"]),
    targetLow: firstNumber(target, ["targetLow", "targetPriceLow"]),
    targetHigh: firstNumber(target, ["targetHigh", "targetPriceHigh"]),
    analystCount: firstNumber(estimate, ["numberAnalystEstimatedRevenue", "numberAnalystsEstimatedRevenue", "numberAnalystsEstimatedEps", "numberAnalystEstimatedEps"]),
    gradeBalance,
    estimatedRevenue: firstNumber(estimate, ["estimatedRevenueAvg", "estimatedRevenueAverage", "revenueAvg", "estimatedRevenue"]),
    estimatedEps: firstNumber(estimate, ["estimatedEpsAvg", "estimatedEPSAvg", "epsAvg"]),
    observedAt: firstDate(target, ["lastUpdated", "date", "publishedDate"]) ?? observedAt,
    receipts,
    errors,
  };
}

async function fetchNews(candidate: GlobalResearchCandidate): Promise<NewsResearch> {
  const key = process.env.MARKETAUX_API_KEY?.trim();
  if (!key) return { articles: [], sentiment: null, receipt: null, errors: ["MARKETAUX_API_KEY is unavailable"] };
  const url = new URL("https://api.marketaux.com/v1/news/all");
  url.searchParams.set("symbols", candidate.symbol);
  url.searchParams.set("filter_entities", "true");
  url.searchParams.set("language", "en");
  url.searchParams.set("limit", "5");
  url.searchParams.set("api_token", key);
  try {
    const payload = object(await fetchJson(url));
    const articles = rows(payload.data).flatMap((article) => {
      const title = text(article.title);
      const articleUrl = text(article.url);
      if (!title || !articleUrl) return [];
      const publishedAt = firstDate(article, ["published_at", "publishedAt"]);
      const age = publishedAt ? (Date.now() - Date.parse(publishedAt)) / 86_400_000 : Number.POSITIVE_INFINITY;
      if (age > 14) return [];
      return [{ title, source: text(article.source), publishedAt, url: articleUrl }];
    });
    const sentimentValues = rows(payload.data).flatMap((article) => rows(article.entities).map((entity) => finite(entity.sentiment_score)).filter((value): value is number => value !== null));
    const sentiment = sentimentValues.length ? sentimentValues.reduce((sum, value) => sum + value, 0) / sentimentValues.length : null;
    return {
      articles,
      sentiment,
      receipt: { source: "Marketaux current company news", url: url.toString().replace(key, "[redacted]"), observedAt: new Date().toISOString(), fields: ["current company news", "sentiment"] },
      errors: [],
    };
  } catch (error) {
    return { articles: [], sentiment: null, receipt: null, errors: [`Marketaux: ${safeError(error)}`] };
  }
}

function priceAgreement(left: number, right: number | null) {
  if (!right || right <= 0) return null;
  const midpoint = (left + right) / 2;
  return midpoint > 0 ? (Math.abs(left - right) / midpoint) * 100 : null;
}

function scoreEvidence(candidate: GlobalResearchCandidate, fmp: FmpResearch, news: NewsResearch) {
  const agreement = priceAgreement(candidate.price, fmp.quote);
  let score = 35;
  if (fmp.quote !== null) score += 15;
  if (agreement !== null && agreement <= 2) score += 15;
  else if (agreement !== null && agreement <= 5) score += 8;
  if (fmp.targetConsensus !== null) score += 10;
  if ((fmp.analystCount ?? 0) >= 3) score += 8;
  if (fmp.gradeBalance !== null) score += 7;
  if (news.articles.length) score += 5;
  if (!fmp.errors.length) score += 3;
  if (agreement !== null && agreement > 5) score -= 30;
  return clamp(score);
}

function buildCase(action: GlobalResearchAction, candidate: GlobalResearchCandidate, fmp: FmpResearch, news: NewsResearch): GlobalDeepResearchCase {
  const agreement = priceAgreement(candidate.price, fmp.quote);
  const targetUpside = fmp.targetConsensus && candidate.price > 0 ? ((fmp.targetConsensus / candidate.price) - 1) * 100 : null;
  const estimatedRevenueGrowth = null;
  const themes = action === "buy" ? candidate.buyResearchThemes : action === "sell" ? candidate.sellResearchThemes : candidate.watchOutResearchThemes;
  const evidenceScore = scoreEvidence(candidate, fmp, news);
  const contradictions = [
    ...(agreement !== null && agreement > 5 ? [`TradingView and FMP current prices disagree by ${agreement.toFixed(2)}%.`] : []),
  ];
  const supportive = action === "buy"
    ? candidate.opportunityPriority >= 70
    : action === "sell"
      ? candidate.riskPriority >= 70
      : candidate.riskPriority >= 70 || news.sentiment !== null && news.sentiment < -0.2;
  const blockedReasons = unique([
    "No independently certified Buy/Sell outcome rule exists for this opportunity family.",
    ...(fmp.quote === null ? ["A second current price source was unavailable."] : []),
    ...(agreement !== null && agreement > 5 ? ["Current price sources conflict."] : []),
    ...contradictions,
  ]);
  const disposition = evidenceScore >= 80 && supportive && contradictions.length === 0
    ? "advance_to_committee_research"
    : evidenceScore >= 55
      ? "watch_for_more_evidence"
      : "reject_or_deprioritize";
  return {
    action,
    tradingViewSymbol: candidate.tradingViewSymbol,
    symbol: candidate.symbol,
    company: candidate.description,
    exchange: candidate.exchange,
    country: candidate.country,
    currency: candidate.currency,
    observedAt: new Date().toISOString(),
    currentPrice: candidate.price,
    currentPriceSource: "TradingView public stock scanner",
    secondSourcePrice: fmp.quote,
    priceAgreementPercent: agreement,
    marketCap: fmp.marketCap ?? candidate.marketCap,
    targetConsensus: fmp.targetConsensus,
    targetLow: fmp.targetLow,
    targetHigh: fmp.targetHigh,
    targetUpsidePercent: targetUpside,
    analystCount: fmp.analystCount,
    analystGradeBalance: fmp.gradeBalance,
    consensusRevenueGrowthPercent: estimatedRevenueGrowth,
    consensusEps: fmp.estimatedEps,
    currentNewsCount: news.articles.length,
    currentNewsSentiment: news.sentiment,
    currentNews: news.articles,
    providersAttempted: ["TradingView", "FMP", "Marketaux"],
    providersUsed: unique(["TradingView", ...(fmp.receipts.length ? ["FMP"] : []), ...(news.articles.length ? ["Marketaux"] : [])]),
    providerErrors: unique([...fmp.errors, ...news.errors]),
    themes,
    evidenceScore,
    researchDisposition: disposition,
    seriousSignal: false,
    blockedReasons,
    receipts: [...fmp.receipts, ...(news.receipt ? [news.receipt] : [])],
  };
}

async function researchCandidate(action: GlobalResearchAction, candidate: GlobalResearchCandidate) {
  const fmp = await fetchFmpResearch(candidate);
  const news = action === "watch_out" || candidate.riskPriority >= 75 ? await fetchNews(candidate) : { articles: [], sentiment: null, receipt: null, errors: [] };
  await sleep(200);
  return buildCase(action, candidate, fmp, news);
}

export async function runGlobalDeepResearch(options?: { perAction?: number }): Promise<GlobalDeepResearchResult> {
  const perAction = Math.max(1, Math.min(options?.perAction ?? 5, 15));
  const scan = await scanTradingViewGlobalStocks({ maximumListings: 150_000, pageSize: 1_000, pageConcurrency: 8, deepQueueSize: Math.max(50, perAction * 5), minimumPrice: 0.25, minimumMarketCap: 25_000_000, maximumCertifiedChecks: 10, historyConcurrency: 2 });
  const selected = {
    buy: scan.candidates.buyResearch.slice(0, perAction),
    sell: scan.candidates.sellResearch.slice(0, perAction),
    watchOut: scan.candidates.watchOutResearch.slice(0, perAction),
  };
  const buy: GlobalDeepResearchCase[] = [];
  const sell: GlobalDeepResearchCase[] = [];
  const watchOut: GlobalDeepResearchCase[] = [];
  for (const candidate of selected.buy) buy.push(await researchCandidate("buy", candidate));
  for (const candidate of selected.sell) sell.push(await researchCandidate("sell", candidate));
  for (const candidate of selected.watchOut) watchOut.push(await researchCandidate("watch_out", candidate));
  const all = [...buy, ...sell, ...watchOut];
  return {
    ok: true,
    checkedAt: new Date().toISOString(),
    universe: { primaryListingsFetched: scan.universe.primaryListingsFetched, eligibleListings: scan.universe.eligibleListings, exchanges: scan.universe.exchanges, countries: scan.universe.countries, coveragePercent: scan.universe.coveragePercent },
    requested: { perAction, totalCandidates: all.length },
    results: { buy, sell, watchOut },
    summary: {
      researched: all.length,
      advanced: all.filter((row) => row.researchDisposition === "advance_to_committee_research").length,
      watched: all.filter((row) => row.researchDisposition === "watch_for_more_evidence").length,
      rejected: all.filter((row) => row.researchDisposition === "reject_or_deprioritize").length,
      seriousSignals: 0,
      providerErrors: all.reduce((sum, row) => sum + row.providerErrors.length, 0),
    },
    safety: { databaseWrites: false, publishing: false, notifications: false, seriousSignalsUnlocked: false, reason: "Live research does not become a serious directional alert until an independent historical certificate passes." },
  };
}
