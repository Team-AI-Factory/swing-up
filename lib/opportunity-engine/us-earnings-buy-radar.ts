import crypto from "node:crypto";
import { loadEquityUniverse } from "@/lib/equity-signal/universe";
import {
  getR2Config,
  readVersionedTextFromR2,
  writeVersionedJsonToR2,
} from "@/lib/r2-warehouse";
import type { UsValueCompanyAnalysis } from "@/lib/opportunity-engine/us-value-investing-engine";
import { readResumableUsValueState } from "@/lib/opportunity-engine/us-value-investing-resumable";
import { pr262StorageKey } from "@/lib/opportunity-engine/pr262-storage";

const BRANCH = "agent/combined-opportunity-engine" as const;
const R2_PREFIX = pr262StorageKey("signal-operations/earnings-buy-radar");
const LATEST_KEY = `${R2_PREFIX}/latest.json`;
const OUTBOX_PREFIX = pr262StorageKey("research-candidates/outbox/earnings-buy");
const NORMALIZATION_PREFIX = pr262StorageKey("signal-operations/long-term-normalization");
const SEC_AGENT = "SwingUp/1.0 support@swingup.app";
const MAX_COMPANIES_FOR_LIVE_QUOTES = 1_500;
const MAX_OFFICIAL_EARNINGS_CHECKS = 24;
const EARNINGS_DISCOVERY_DAYS = 14;
const IMMEDIATE_ACTION_MAX_AGE_DAYS = 7;

type Json = Record<string, unknown>;

type LiveQuote = {
  ticker: string;
  price: number;
  changePercent: number | null;
  relativeVolume: number | null;
  marketCap: number | null;
  observedAt: string;
};

type OfficialEarningsReceipt = {
  ticker: string;
  cik: string;
  filingDate: string;
  form: "8-K" | "6-K";
  accessionNumber: string;
  primaryDocument: string;
  primaryUrl: string;
  exhibitUrl: string | null;
  sourceText: string;
  item202Confirmed: boolean;
  earningsLanguageConfirmed: boolean;
  ageDays: number;
};

type Normalization = {
  observedAt?: string;
  buyQualityConfirmed?: boolean;
  durableEnoughForSeriousBuy?: boolean;
  oneTimeOrPeakRisk?: boolean;
  yearsAvailable?: number;
  earningsStabilityPercent?: number;
  freeCashFlowStabilityPercent?: number;
  latestCashConversion?: number | null;
  blockers?: string[];
};

export type EarningsBuyRadarCandidate = {
  ticker: string;
  company: string;
  currentPrice: number;
  dailyChangePercent: number | null;
  relativeVolume: number | null;
  conservativeFairValue: number | null;
  baseFairValue: number | null;
  optimisticFairValue: number | null;
  upsideToBasePercent: number | null;
  upsideToConservativePercent: number | null;
  businessQuality: number;
  risk: number;
  fairValueConfidence: number;
  revenueGrowthPercent: number | null;
  earningsGrowthPercent: number | null;
  officialEarnings: OfficialEarningsReceipt | null;
  independentPrice: {
    source: "Yahoo public chart";
    price: number | null;
    agreementPercent: number | null;
    passed: boolean;
  };
  normalization: {
    available: boolean;
    buyQualityConfirmed: boolean | null;
    oneTimeOrPeakRisk: boolean | null;
    yearsAvailable: number | null;
    earningsStabilityPercent: number | null;
    freeCashFlowStabilityPercent: number | null;
    latestCashConversion: number | null;
    blockers: string[];
  };
  classification: "serious_buy" | "buy_candidate" | "not_buy";
  confidence: number;
  reasons: string[];
  blockers: string[];
};

export type EarningsBuyRadarReport = {
  version: 1;
  ok: boolean;
  branch: typeof BRANCH;
  mode: "pr262_direct_sec_earnings_buy_radar";
  checkedAt: string;
  runtime: { commitSha: string | null; deploymentId: string | null };
  purpose: "detect earnings-strengthened Buy opportunities without depending on the generic news queue";
  coverage: {
    storedCompaniesLoaded: number;
    highQualityCompaniesRanked: number;
    liveQuotesFetched: number;
    officialEarningsChecks: number;
    officialEarningsReceiptsFound: number;
    directNewsQueueDependency: false;
  };
  seriousBuys: EarningsBuyRadarCandidate[];
  buyCandidates: EarningsBuyRadarCandidate[];
  retrospectiveMissAudit: EarningsBuyRadarCandidate[];
  newSeriousBuys: Array<{
    fingerprint: string;
    ticker: string;
    company: string;
    currentPrice: number;
    baseFairValue: number | null;
    potentialGainPercent: number | null;
    confidence: number;
    reasons: string[];
    outboxKey: string;
  }>;
  methodology: {
    earningsHeadlineAloneCanTriggerBuy: false;
    analystExpectationsCanVetoBuy: false;
    officialSecOrIssuerEvidenceRequired: true;
    independentPriceCrossCheckRequired: true;
    fiveYearNormalizationRequiredForSeriousBuy: true;
    currentPriceMustRemainBelowConservativeValue: true;
    immediateActionEventFreshnessDays: number;
    discoveryLookbackDays: number;
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
  return error instanceof Error ? error.message.replace(/\s+/g, " ").slice(0, 400) : "unknown_earnings_buy_radar_error";
}

function companyKey(item: UsValueCompanyAnalysis) {
  return `${item.exchange.toUpperCase()}:${item.ticker.toUpperCase()}`;
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

async function fetchLiveQuotes(items: UsValueCompanyAnalysis[], fetchImpl: typeof fetch, observedAt: string) {
  const chunks = Array.from({ length: Math.ceil(items.length / 400) }, (_, index) => items.slice(index * 400, (index + 1) * 400));
  const rows = await mapWithConcurrency(chunks, 4, async (chunk) => {
    const response = await fetchImpl("https://scanner.tradingview.com/america/scan", {
      method: "POST",
      cache: "no-store",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        origin: "https://www.tradingview.com",
        referer: "https://www.tradingview.com/",
        "user-agent": "Mozilla/5.0 (compatible; SwingUpEarningsBuyRadar/1.0)",
      },
      body: JSON.stringify({
        symbols: { tickers: chunk.map((item) => item.tradingViewSymbol), query: { types: [] } },
        columns: ["name", "close", "change", "relative_volume_10d_calc", "market_cap_basic"],
        range: [0, chunk.length],
      }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!response.ok) throw new Error(`tradingview_earnings_buy_http_${response.status}`);
    const payload = object(await response.json().catch(() => null));
    return array(payload.data).flatMap((raw): LiveQuote[] => {
      const row = object(raw);
      const symbol = text(row.s)?.toUpperCase();
      const data = array(row.d);
      if (!symbol || data.length < 5) return [];
      const ticker = symbol.includes(":") ? symbol.split(":").at(-1)! : symbol;
      const price = finite(data[1]);
      if (price === null || price <= 0) return [];
      return [{ ticker, price, changePercent: finite(data[2]), relativeVolume: finite(data[3]), marketCap: finite(data[4]), observedAt }];
    });
  });
  return new Map(rows.flat().map((row) => [row.ticker.toUpperCase(), row]));
}

function stripHtml(input: string) {
  return input
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

async function secText(fetchImpl: typeof fetch, url: string) {
  const response = await fetchImpl(url, {
    headers: { accept: "text/html,application/json;q=0.9,*/*;q=0.8", "user-agent": SEC_AGENT },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`sec_http_${response.status}`);
  const body = await response.text();
  return body.slice(0, 500_000);
}

async function findEarningsReceipt(ticker: string, cik: string, now: Date, fetchImpl: typeof fetch): Promise<OfficialEarningsReceipt | null> {
  const submissionsUrl = `https://data.sec.gov/submissions/CIK${cik}.json`;
  const submissions = object(JSON.parse(await secText(fetchImpl, submissionsUrl)));
  const recent = object(object(submissions.filings).recent);
  const forms = array(recent.form).map(text);
  const dates = array(recent.filingDate).map(text);
  const accessions = array(recent.accessionNumber).map(text);
  const primaryDocs = array(recent.primaryDocument).map(text);
  for (let index = 0; index < forms.length; index += 1) {
    const form = forms[index];
    const filingDate = dates[index];
    const accessionNumber = accessions[index];
    const primaryDocument = primaryDocs[index];
    if (!form || !["8-K", "6-K"].includes(form) || !filingDate || !accessionNumber || !primaryDocument) continue;
    const filingMs = Date.parse(`${filingDate}T23:59:59Z`);
    const ageDays = (now.getTime() - filingMs) / 86_400_000;
    if (ageDays < -1 || ageDays > EARNINGS_DISCOVERY_DAYS) continue;
    const cikNoLeading = String(Number(cik));
    const accessionPath = accessionNumber.replace(/-/g, "");
    const archiveBase = `https://www.sec.gov/Archives/edgar/data/${cikNoLeading}/${accessionPath}`;
    const primaryUrl = `${archiveBase}/${primaryDocument}`;
    const primaryRaw = await secText(fetchImpl, primaryUrl).catch(() => "");
    const primaryText = stripHtml(primaryRaw);
    const item202Confirmed = /item\s*2\.02|results of operations and financial condition/i.test(primaryText);
    const primaryEarnings = /quarter(?:ly)? results|financial results|earnings|revenue|net sales|operating income/i.test(primaryText);
    if (!item202Confirmed && !(form === "6-K" && primaryEarnings)) continue;

    let exhibitUrl: string | null = null;
    let exhibitText = "";
    try {
      const indexPayload = object(JSON.parse(await secText(fetchImpl, `${archiveBase}/index.json`)));
      const items = array(object(indexPayload.directory).item).map(object);
      const exhibitName = items
        .map((item) => text(item.name))
        .find((name) => name && /(?:ex(?:hibit)?[-_.]?99|99[-_.]?1|earnings|results|press)/i.test(name));
      if (exhibitName) {
        exhibitUrl = `${archiveBase}/${exhibitName}`;
        exhibitText = stripHtml(await secText(fetchImpl, exhibitUrl).catch(() => ""));
      }
    } catch {}
    const sourceText = `${primaryText} ${exhibitText}`.replace(/\s+/g, " ").trim().slice(0, 80_000);
    const earningsLanguageConfirmed = /quarter(?:ly)? results|financial results|earnings|revenue|net sales|operating income|cloud revenue|aws/i.test(sourceText);
    if (!earningsLanguageConfirmed) continue;
    return {
      ticker,
      cik,
      filingDate,
      form: form as "8-K" | "6-K",
      accessionNumber,
      primaryDocument,
      primaryUrl,
      exhibitUrl,
      sourceText,
      item202Confirmed,
      earningsLanguageConfirmed,
      ageDays: rounded(Math.max(0, ageDays), 1) ?? 0,
    };
  }
  return null;
}

async function yahooPrice(ticker: string, fetchImpl: typeof fetch) {
  try {
    const response = await fetchImpl(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=5d`, {
      headers: { accept: "application/json", "user-agent": "Mozilla/5.0 (compatible; SwingUpEarningsBuyRadar/1.0)" },
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) throw new Error(`yahoo_http_${response.status}`);
    const payload = object(await response.json());
    const result = object(array(object(payload.chart).result)[0]);
    const quote = object(array(object(result.indicators).quote)[0]);
    const closes = array(quote.close).map(finite).filter((value): value is number => value !== null && value > 0);
    return closes.at(-1) ?? null;
  } catch {
    return null;
  }
}

async function loadNormalization(ticker: string): Promise<Normalization | null> {
  try {
    const value = object(await readJson(`${NORMALIZATION_PREFIX}/${ticker.toUpperCase()}/latest.json`));
    return Object.keys(value).length ? value as Normalization : null;
  } catch {
    return null;
  }
}

function growthScore(item: UsValueCompanyAnalysis) {
  const revenue = Math.max(item.fundamentals.revenueGrowthTtmPercent ?? -Infinity, item.fundamentals.revenueGrowthFyPercent ?? -Infinity);
  const earnings = Math.max(item.fundamentals.netIncomeGrowthTtmPercent ?? -Infinity, item.fundamentals.epsGrowthTtmPercent ?? -Infinity);
  return {
    revenue: Number.isFinite(revenue) ? revenue : null,
    earnings: Number.isFinite(earnings) ? earnings : null,
  };
}

function evaluateCandidate(
  item: UsValueCompanyAnalysis,
  quote: LiveQuote,
  receipt: OfficialEarningsReceipt | null,
  normalization: Normalization | null,
  yahoo: number | null,
): EarningsBuyRadarCandidate {
  const conservative = item.fairValue.conservativeValue;
  const base = item.fairValue.baseValue;
  const optimistic = item.fairValue.optimisticValue;
  const upsideToBase = base && base > 0 ? (base / quote.price - 1) * 100 : null;
  const upsideToConservative = conservative && conservative > 0 ? (conservative / quote.price - 1) * 100 : null;
  const agreement = yahoo && yahoo > 0 ? Math.abs(quote.price - yahoo) / Math.max(quote.price, yahoo) * 100 : null;
  const pricePassed = agreement !== null && agreement <= 2;
  const growth = growthScore(item);
  const eventFresh = receipt !== null && receipt.ageDays <= IMMEDIATE_ACTION_MAX_AGE_DAYS;
  const operatingGrowth = (growth.revenue ?? -Infinity) >= 10 && (growth.earnings ?? -Infinity) >= 12;
  const durable = normalization?.buyQualityConfirmed === true && normalization?.oneTimeOrPeakRisk !== true;
  const belowConservative = (upsideToConservative ?? -Infinity) >= 5;
  const baseMargin = (upsideToBase ?? -Infinity) >= 12;
  const quality = item.scores.businessQuality >= 80
    && item.scores.balanceSheet >= 60
    && item.scores.risk <= 40
    && item.scores.fairValueConfidence >= 75
    && item.fairValue.methods.length >= 2;
  const strongReaction = (quote.changePercent ?? -Infinity) >= 3;
  const seriousBuy = Boolean(receipt)
    && eventFresh
    && receipt!.earningsLanguageConfirmed
    && quality
    && operatingGrowth
    && durable
    && pricePassed
    && belowConservative
    && baseMargin;

  const reasons = [
    ...(receipt ? [`Official ${receipt.form} earnings evidence was found from ${receipt.filingDate}; this lane did not depend on the generic news queue.`] : []),
    ...(strongReaction ? [`The stock reacted +${(quote.changePercent ?? 0).toFixed(1)}% in the live market, so the system investigated the cause directly.`] : []),
    ...(operatingGrowth ? [`Revenue growth is ${growth.revenue?.toFixed(1)}% and earnings growth is ${growth.earnings?.toFixed(1)}% on the stored company fundamentals.`] : []),
    ...(baseMargin ? [`The current price remains ${(upsideToBase ?? 0).toFixed(1)}% below base fair value even after the reaction.`] : []),
    ...(belowConservative ? [`The price is also ${(upsideToConservative ?? 0).toFixed(1)}% below the lowest accepted fair-value estimate.`] : []),
    ...(durable ? ["Five-year SEC normalization indicates repeatable profit and free-cash-flow quality rather than a one-quarter spike."] : []),
  ];
  const blockers = [
    ...(!receipt ? ["No recent official SEC earnings filing was confirmed in the direct earnings lookback."] : []),
    ...(receipt && !eventFresh ? [`The earnings event is ${receipt.ageDays.toFixed(1)} days old, outside the 7-day immediate-action window; it remains a retrospective miss audit only.`] : []),
    ...(!quality ? ["Business quality, balance-sheet, risk, valuation confidence, or valuation-method depth is below the Serious Buy standard."] : []),
    ...(!operatingGrowth ? ["Current revenue and earnings growth do not both clear the operating-acceleration gate."] : []),
    ...(!durable ? ["Five-year SEC normalization is missing, unstable, or flags one-time/peak-cycle earnings risk."] : []),
    ...(!pricePassed ? ["Independent Yahoo and TradingView prices do not currently agree within 2%, or the second price is unavailable."] : []),
    ...(!belowConservative ? ["The current price is not at least 5% below the lowest accepted fair-value estimate."] : []),
    ...(!baseMargin ? ["The current price does not retain at least 12% upside to base fair value after the earnings reaction."] : []),
  ];
  const confidence = Math.round(Math.max(0, Math.min(98,
    item.scores.fairValueConfidence * 0.35
    + item.scores.businessQuality * 0.25
    + (durable ? 20 : 0)
    + (pricePassed ? 10 : 0)
    + (receipt ? 10 : 0),
  )));
  const candidate = Boolean(receipt) && quality && operatingGrowth && (upsideToBase ?? -Infinity) >= 5;
  return {
    ticker: item.ticker,
    company: item.company,
    currentPrice: rounded(quote.price) ?? quote.price,
    dailyChangePercent: rounded(quote.changePercent),
    relativeVolume: rounded(quote.relativeVolume),
    conservativeFairValue: rounded(conservative),
    baseFairValue: rounded(base),
    optimisticFairValue: rounded(optimistic),
    upsideToBasePercent: rounded(upsideToBase),
    upsideToConservativePercent: rounded(upsideToConservative),
    businessQuality: item.scores.businessQuality,
    risk: item.scores.risk,
    fairValueConfidence: item.scores.fairValueConfidence,
    revenueGrowthPercent: rounded(growth.revenue),
    earningsGrowthPercent: rounded(growth.earnings),
    officialEarnings: receipt,
    independentPrice: {
      source: "Yahoo public chart",
      price: rounded(yahoo),
      agreementPercent: rounded(agreement),
      passed: pricePassed,
    },
    normalization: {
      available: Boolean(normalization),
      buyQualityConfirmed: normalization?.buyQualityConfirmed ?? null,
      oneTimeOrPeakRisk: normalization?.oneTimeOrPeakRisk ?? null,
      yearsAvailable: finite(normalization?.yearsAvailable),
      earningsStabilityPercent: finite(normalization?.earningsStabilityPercent),
      freeCashFlowStabilityPercent: finite(normalization?.freeCashFlowStabilityPercent),
      latestCashConversion: finite(normalization?.latestCashConversion),
      blockers: Array.isArray(normalization?.blockers) ? normalization!.blockers!.filter((value): value is string => typeof value === "string") : [],
    },
    classification: seriousBuy ? "serious_buy" : candidate ? "buy_candidate" : "not_buy",
    confidence,
    reasons,
    blockers: [...new Set(blockers)],
  };
}

function fingerprint(item: EarningsBuyRadarCandidate) {
  const ratio = item.baseFairValue && item.baseFairValue > 0 ? Math.round((item.currentPrice / item.baseFairValue) * 20) / 20 : 0;
  const filing = item.officialEarnings?.accessionNumber ?? "no-filing";
  return crypto.createHash("sha256").update(`earnings_buy|${item.ticker}|${filing}|${ratio.toFixed(2)}`).digest("hex").slice(0, 24);
}

export async function runUsEarningsBuyRadar(input: { fetchImpl?: typeof fetch; now?: Date } = {}): Promise<EarningsBuyRadarReport> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const now = input.now ?? new Date();
  const checkedAt = now.toISOString();
  const warehouseErrors: string[] = [];
  if (!getR2Config().configured) throw new Error("cloudflare_r2_not_configured");

  const [analyses, universe] = await Promise.all([loadAnalyses(), loadEquityUniverse(fetchImpl, now)]);
  const cikByTicker = new Map(universe.snapshot.entries.filter((entry) => entry.cik).map((entry) => [entry.ticker.toUpperCase(), entry.cik!]));
  const highQuality = analyses
    .filter((item) => item.scores.businessQuality >= 75 && item.scores.risk <= 45 && item.fairValue.baseValue !== null && (item.marketCap ?? 0) >= 500_000_000)
    .sort((left, right) => {
      const leftGap = left.fairValue.upsideToBasePercent ?? -100;
      const rightGap = right.fairValue.upsideToBasePercent ?? -100;
      return (right.scores.businessQuality * 2 + rightGap - right.scores.risk) - (left.scores.businessQuality * 2 + leftGap - left.scores.risk);
    })
    .slice(0, MAX_COMPANIES_FOR_LIVE_QUOTES);
  const quotes = await fetchLiveQuotes(highQuality, fetchImpl, checkedAt);
  const ranked = highQuality
    .flatMap((item) => {
      const quote = quotes.get(item.ticker.toUpperCase());
      if (!quote || !cikByTicker.has(item.ticker.toUpperCase())) return [];
      const base = item.fairValue.baseValue;
      const liveUpside = base && base > 0 ? (base / quote.price - 1) * 100 : -Infinity;
      const nearValue = liveUpside >= 5;
      const reacted = (quote.changePercent ?? -Infinity) >= 2.5;
      if (!nearValue && !reacted) return [];
      const priority = Math.max(0, quote.changePercent ?? 0) * 5 + Math.max(0, liveUpside) * 2 + item.scores.businessQuality - item.scores.risk;
      return [{ item, quote, priority }];
    })
    .sort((left, right) => right.priority - left.priority)
    .slice(0, MAX_OFFICIAL_EARNINGS_CHECKS);

  const evaluated = await mapWithConcurrency(ranked, 3, async ({ item, quote }) => {
    const ticker = item.ticker.toUpperCase();
    const cik = cikByTicker.get(ticker)!;
    const [receipt, normalization, yahoo] = await Promise.all([
      findEarningsReceipt(ticker, cik, now, fetchImpl).catch(() => null),
      loadNormalization(ticker),
      yahooPrice(ticker, fetchImpl),
    ]);
    return evaluateCandidate(item, quote, receipt, normalization, yahoo);
  });

  const seriousBuys = evaluated.filter((item) => item.classification === "serious_buy").sort((left, right) => right.confidence - left.confidence);
  const buyCandidates = evaluated.filter((item) => item.classification === "buy_candidate").sort((left, right) => right.confidence - left.confidence);
  const retrospectiveMissAudit = evaluated
    .filter((item) => item.officialEarnings && item.officialEarnings.ageDays > IMMEDIATE_ACTION_MAX_AGE_DAYS)
    .sort((left, right) => (right.dailyChangePercent ?? -Infinity) - (left.dailyChangePercent ?? -Infinity));
  const newSeriousBuys: EarningsBuyRadarReport["newSeriousBuys"] = [];
  for (const item of seriousBuys) {
    const id = fingerprint(item);
    const outboxKey = `${OUTBOX_PREFIX}/${item.ticker.toUpperCase()}/${id}.json`;
    const payload = {
      version: 1,
      kind: "pr262_direct_earnings_research_candidate",
      branch: BRANCH,
      fingerprint: id,
      checkedAt,
      signal: item,
      deliveryStatus: "pending_external_condition_watcher",
      safety: { publishing: false, directUserNotifications: false, trades: false, databaseWrites: false },
    };
    try {
      const written = await writeVersionedJsonToR2(outboxKey, payload, { createOnly: true });
      if (written.written) newSeriousBuys.push({
        fingerprint: id,
        ticker: item.ticker,
        company: item.company,
        currentPrice: item.currentPrice,
        baseFairValue: item.baseFairValue,
        potentialGainPercent: item.upsideToBasePercent,
        confidence: item.confidence,
        reasons: item.reasons,
        outboxKey,
      });
    } catch (error) {
      warehouseErrors.push(`outbox:${item.ticker}:${safeError(error)}`);
    }
  }

  const report: EarningsBuyRadarReport = {
    version: 1,
    ok: analyses.length > 0 && warehouseErrors.length === 0,
    branch: BRANCH,
    mode: "pr262_direct_sec_earnings_buy_radar",
    checkedAt,
    runtime: {
      commitSha: process.env.RAILWAY_GIT_COMMIT_SHA?.trim() || null,
      deploymentId: process.env.RAILWAY_DEPLOYMENT_ID?.trim() || null,
    },
    purpose: "detect earnings-strengthened Buy opportunities without depending on the generic news queue",
    coverage: {
      storedCompaniesLoaded: analyses.length,
      highQualityCompaniesRanked: highQuality.length,
      liveQuotesFetched: quotes.size,
      officialEarningsChecks: ranked.length,
      officialEarningsReceiptsFound: evaluated.filter((item) => item.officialEarnings).length,
      directNewsQueueDependency: false,
    },
    seriousBuys,
    buyCandidates,
    retrospectiveMissAudit,
    newSeriousBuys,
    methodology: {
      earningsHeadlineAloneCanTriggerBuy: false,
      analystExpectationsCanVetoBuy: false,
      officialSecOrIssuerEvidenceRequired: true,
      independentPriceCrossCheckRequired: true,
      fiveYearNormalizationRequiredForSeriousBuy: true,
      currentPriceMustRemainBelowConservativeValue: true,
      immediateActionEventFreshnessDays: IMMEDIATE_ACTION_MAX_AGE_DAYS,
      discoveryLookbackDays: EARNINGS_DISCOVERY_DAYS,
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
    await writeVersionedJsonToR2(`${R2_PREFIX}/runs/${checkedAt.slice(0, 10)}/${checkedAt.replace(/[^0-9]/g, "").slice(0, 17)}.json`, report, { createOnly: true }).catch(() => {});
    report.warehouse.persisted = true;
    await writeVersionedJsonToR2(LATEST_KEY, report).catch(() => {});
  } catch (error) {
    report.ok = false;
    report.warehouse.errors.push(safeError(error));
  }
  return report;
}

export async function readLatestUsEarningsBuyRadar() {
  try {
    const latest = await readJson(LATEST_KEY);
    return latest ? latest as EarningsBuyRadarReport : null;
  } catch {
    return null;
  }
}

export const US_EARNINGS_BUY_RADAR_POLICY = Object.freeze({
  branch: BRANCH,
  directNewsQueueDependency: false,
  officialEarningsEvidenceRequired: true,
  analystExpectationsCanVetoBuy: false,
  fiveYearNormalizationRequiredForSeriousBuy: true,
  currentPriceMustRemainBelowConservativeValue: true,
  immediateActionEventFreshnessDays: IMMEDIATE_ACTION_MAX_AGE_DAYS,
  discoveryLookbackDays: EARNINGS_DISCOVERY_DAYS,
  buyPriority: true,
  publishing: false,
  directUserNotifications: false,
  trades: false,
});
