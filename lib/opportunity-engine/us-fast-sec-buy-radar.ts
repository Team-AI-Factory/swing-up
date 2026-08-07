import crypto from "node:crypto";
import { articleEvidenceForCandidate, buildArticleEvidenceReport } from "@/lib/equity-signal/article-evidence";
import { loadEquityUniverse } from "@/lib/equity-signal/universe";
import {
  getR2Config,
  readVersionedTextFromR2,
  writeVersionedJsonToR2,
} from "@/lib/r2-warehouse";
import { assessStrategicOptionality } from "@/lib/opportunity-engine/strategic-optionality";
import type { UsValueCompanyAnalysis } from "@/lib/opportunity-engine/us-value-investing-engine";
import { readResumableUsValueState } from "@/lib/opportunity-engine/us-value-investing-resumable";

const BRANCH = "agent/combined-opportunity-engine" as const;
const R2_PREFIX = "branch-labs/pr-262/signal-operations/fast-sec-buy" as const;
const LATEST_KEY = `${R2_PREFIX}/latest.json`;
const SEEN_PREFIX = `${R2_PREFIX}/seen`;
const OUTBOX_PREFIX = "branch-labs/pr-262/serious-signal/outbox/fast-sec-buy" as const;
const NORMALIZATION_PREFIX = "branch-labs/pr-262/signal-operations/long-term-normalization";
const SEC_AGENT = "SwingUp/1.0 support@swingup.app";
const FAST_FORMS = ["8-K", "6-K"] as const;
const MAX_RECEIPT_AGE_MS = 45 * 60 * 1000;
const MAX_FILINGS_PER_RUN = 20;

type Json = Record<string, unknown>;

type FastSecReceipt = {
  id: string;
  form: typeof FAST_FORMS[number];
  cik: string;
  company: string;
  title: string;
  url: string;
  publishedAt: string;
};

type Normalization = {
  buyQualityConfirmed?: boolean;
  durableEnoughForSeriousBuy?: boolean;
  oneTimeOrPeakRisk?: boolean;
  yearsAvailable?: number;
  blockers?: string[];
};

export type FastSecBuyCandidate = {
  ticker: string;
  company: string;
  form: string;
  filingPublishedAt: string;
  filingReadAt: string;
  sourceLatencySeconds: number | null;
  filingUrl: string;
  fullFilingOrExhibitRead: boolean;
  discoveryUsedPriceMovement: false;
  currentPrice: number | null;
  dailyMoveAfterFilingReadPercent: number | null;
  firstMoverStatus: "before_visible_move" | "early_repricing" | "already_repriced" | "price_unavailable";
  conservativeFairValue: number | null;
  baseFairValue: number | null;
  optimisticFairValue: number | null;
  upsideToConservativePercent: number | null;
  upsideToBasePercent: number | null;
  businessQuality: number;
  risk: number;
  fairValueConfidence: number;
  classification: "serious_buy" | "buy_candidate" | "research_only";
  confidence: number;
  reasons: string[];
  blockers: string[];
  strategicOptionality: ReturnType<typeof assessStrategicOptionality>;
};

export type FastSecBuyReport = {
  version: 1;
  ok: boolean;
  branch: typeof BRANCH;
  mode: "pr262_fast_official_sec_leading_buy";
  checkedAt: string;
  runtime: { commitSha: string | null; deploymentId: string | null };
  coverage: {
    forms: string[];
    officialFeedEntriesRead: number;
    freshEntries: number;
    exactCikMappings: number;
    filingsDeepRead: number;
    decisionGradeFilings: number;
    priceChecksAfterFilingRead: number;
  };
  seriousBuys: FastSecBuyCandidate[];
  buyCandidates: FastSecBuyCandidate[];
  newSeriousBuys: Array<{
    fingerprint: string;
    ticker: string;
    company: string;
    filingPublishedAt: string;
    currentPrice: number | null;
    baseFairValue: number | null;
    potentialGainPercent: number | null;
    firstMoverStatus: FastSecBuyCandidate["firstMoverStatus"];
    outboxKey: string;
  }>;
  policy: {
    officialSecOnly: true;
    discoveryBeforePrice: true;
    priceMoveRequiredForDiscovery: false;
    actualFilingAndExhibitsRequired: true;
    maximumFreshFilingsPerRun: number;
    noPaidNewsApi: true;
  };
  warehouse: { persisted: boolean; latestKey: string; errors: string[] };
  safety: { databaseWrites: false; publishing: false; directUserNotifications: false; trades: false; productionWrites: false; nonUsScanning: false };
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
  return error instanceof Error ? error.message.replace(/\s+/g, " ").slice(0, 400) : "unknown_fast_sec_buy_error";
}

function dateKey(value: string) {
  return value.replace(/[^0-9]/g, "").slice(0, 17);
}

function decodeXml(value: string) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function xmlTag(block: string, tag: string) {
  const pattern = new RegExp(`<(?:(?:[a-z0-9_-]+):)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:(?:[a-z0-9_-]+):)?${tag}>`, "i");
  return decodeXml(block.match(pattern)?.[1] ?? "");
}

function xmlLink(block: string) {
  const href = block.match(/<link\b[^>]*\bhref=["']([^"']+)["'][^>]*>/i)?.[1];
  return decodeXml(href ?? xmlTag(block, "link"));
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
      const value = object(await readJson(key));
      return array(value.analyses) as UsValueCompanyAnalysis[];
    } catch {
      return [] as UsValueCompanyAnalysis[];
    }
  });
  const fallback = [...state.seriousAlerts.buy, ...state.qualityPriceWatchlist, ...state.seriousAlerts.sell, ...state.seriousAlerts.watchOut];
  const all = batches.flat().length ? batches.flat() : fallback;
  return [...new Map(all.map((item) => [companyKey(item), item])).values()];
}

async function fetchSecForm(form: typeof FAST_FORMS[number], fetchImpl: typeof fetch, now: Date) {
  const url = new URL("https://www.sec.gov/cgi-bin/browse-edgar");
  url.searchParams.set("action", "getcurrent");
  url.searchParams.set("output", "atom");
  url.searchParams.set("owner", "include");
  url.searchParams.set("count", "100");
  url.searchParams.set("type", form);
  const response = await fetchImpl(url, {
    headers: { accept: "application/atom+xml,text/xml", "user-agent": SEC_AGENT },
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`sec_current_${form}_http_${response.status}`);
  const body = await response.text();
  return [...body.matchAll(/<entry\b[\s\S]*?<\/entry>/gi)].flatMap((match): FastSecReceipt[] => {
    const block = match[0];
    const title = xmlTag(block, "title");
    const urlValue = xmlLink(block);
    const publishedRaw = xmlTag(block, "updated") || xmlTag(block, "published") || xmlTag(block, "filing-date");
    const published = Date.parse(publishedRaw);
    if (!title || !urlValue || !Number.isFinite(published)) return [];
    const age = now.getTime() - published;
    if (age < -5 * 60_000 || age > 48 * 60 * 60_000) return [];
    const cikRaw = (xmlTag(block, "cik-number") || title.match(/\((\d{7,10})\)/)?.[1] || "").replace(/\D/g, "");
    if (!cikRaw) return [];
    const cik = cikRaw.padStart(10, "0");
    const company = xmlTag(block, "company-name") || title.replace(/^.*? - /, "").replace(/\s*\(\d{7,10}\).*$/, "").trim();
    const id = crypto.createHash("sha256").update(`${form}|${cik}|${urlValue}|${publishedRaw}`).digest("hex").slice(0, 24);
    return [{ id, form, cik, company, title, url: urlValue, publishedAt: new Date(published).toISOString() }];
  });
}

function articleCandidate(receipt: FastSecReceipt, ticker: string, company: string) {
  return {
    ticker,
    company,
    eventFamily: "earnings_guidance",
    relationship: "direct",
    eventObservedAt: receipt.publishedAt,
    eventHeadline: receipt.title,
    whatHappened: `A new official SEC ${receipt.form} filing was published for ${company}.`,
    causalChain: ["new official filing", "operating/guidance facts change", "future cash flow and fair value may change"],
    receipts: [{
      title: receipt.title,
      summary: `Official SEC ${receipt.form} filing by ${receipt.company}.`,
      url: receipt.url,
      publisher: "U.S. Securities and Exchange Commission",
      publishedAt: receipt.publishedAt,
      channel: "sec_current_filings",
      official: true,
      primarySource: true,
      scheduled: false,
      symbolHints: [ticker],
      companyHints: [company, `CIK${receipt.cik}`],
      rawEventType: receipt.form,
    }],
  };
}

function positiveEarningsText(value: string) {
  const body = value.toLowerCase();
  const positive = [
    /raises? (?:full.year |annual |quarterly )?guidance/,
    /guidance (?:raised|increased)/,
    /better than expected/,
    /beat(?:s|ing)? (?:analyst |consensus )?(?:expectations|estimates)/,
    /record (?:revenue|sales|bookings|backlog|operating income|free cash flow)/,
    /revenue (?:grew|growth|increased|rose)/,
    /operating income (?:grew|growth|increased|rose)/,
    /free cash flow (?:grew|growth|increased|rose|improved)/,
    /cloud revenue (?:grew|growth|increased|rose)/,
    /remaining performance obligations?.{0,80}(?:grew|growth|increased|rose|record)/,
  ].filter((pattern) => pattern.test(body)).length;
  const negative = [
    /cuts? (?:full.year |annual |quarterly )?guidance/,
    /guidance (?:cut|lowered|reduced)/,
    /miss(?:es|ed)? (?:analyst |consensus )?(?:expectations|estimates)/,
    /going concern|bankruptcy|material weakness/,
  ].filter((pattern) => pattern.test(body)).length;
  return { passed: positive >= 2 && negative === 0, positiveHits: positive, negativeHits: negative };
}

async function loadNormalization(ticker: string): Promise<Normalization | null> {
  try {
    const value = object(await readJson(`${NORMALIZATION_PREFIX}/${ticker.toUpperCase()}/latest.json`));
    return Object.keys(value).length ? value as Normalization : null;
  } catch {
    return null;
  }
}

function methodSpreadPercent(item: UsValueCompanyAnalysis) {
  const values = item.fairValue.methods.map((method) => method.value).filter((value) => Number.isFinite(value) && value > 0);
  if (values.length < 2 || !item.fairValue.baseValue) return null;
  return (Math.max(...values) - Math.min(...values)) / item.fairValue.baseValue * 100;
}

async function fetchPrices(item: UsValueCompanyAnalysis, fetchImpl: typeof fetch) {
  const observedAt = new Date().toISOString();
  let tvPrice: number | null = null;
  let change: number | null = null;
  try {
    const response = await fetchImpl("https://scanner.tradingview.com/america/scan", {
      method: "POST",
      cache: "no-store",
      headers: { accept: "application/json", "content-type": "application/json", origin: "https://www.tradingview.com", referer: "https://www.tradingview.com/", "user-agent": "Mozilla/5.0 (compatible; SwingUpFastSecBuy/1.0)" },
      body: JSON.stringify({ symbols: { tickers: [item.tradingViewSymbol], query: { types: [] } }, columns: ["name", "close", "change"], range: [0, 1] }),
      signal: AbortSignal.timeout(10_000),
    });
    const payload = object(await response.json().catch(() => null));
    const row = object(array(payload.data)[0]);
    const data = array(row.d);
    tvPrice = finite(data[1]);
    change = finite(data[2]);
  } catch {}
  let yahooPrice: number | null = null;
  try {
    const response = await fetchImpl(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(item.ticker)}?interval=1d&range=5d`, {
      headers: { accept: "application/json", "user-agent": "Mozilla/5.0 (compatible; SwingUpFastSecCrossCheck/1.0)" },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    const payload = object(await response.json());
    const result = object(array(object(payload.chart).result)[0]);
    const quote = object(array(object(result.indicators).quote)[0]);
    const closes = array(quote.close).map(finite).filter((value): value is number => value !== null && value > 0);
    yahooPrice = closes.at(-1) ?? null;
  } catch {}
  const agreement = tvPrice && yahooPrice ? Math.abs(tvPrice - yahooPrice) / Math.max(tvPrice, yahooPrice) * 100 : null;
  return { observedAt, tvPrice, yahooPrice, change, agreement, passed: agreement !== null && agreement <= 2 };
}

function firstMover(change: number | null): FastSecBuyCandidate["firstMoverStatus"] {
  if (change === null) return "price_unavailable";
  const abs = Math.abs(change);
  return abs <= 1 ? "before_visible_move" : abs <= 3 ? "early_repricing" : "already_repriced";
}

function fingerprint(candidate: FastSecBuyCandidate) {
  return crypto.createHash("sha256")
    .update(`fast_sec_buy|${candidate.ticker}|${candidate.filingPublishedAt}|${candidate.baseFairValue ?? 0}`)
    .digest("hex")
    .slice(0, 24);
}

export async function runUsFastSecBuyRadar(input: { fetchImpl?: typeof fetch; now?: Date } = {}): Promise<FastSecBuyReport> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const now = input.now ?? new Date();
  const checkedAt = now.toISOString();
  const errors: string[] = [];
  if (!getR2Config().configured) throw new Error("cloudflare_r2_not_configured");

  const [analyses, universe, formResults] = await Promise.all([
    loadAnalyses(),
    loadEquityUniverse(fetchImpl, now),
    Promise.allSettled(FAST_FORMS.map((form) => fetchSecForm(form, fetchImpl, now))),
  ]);
  const entriesRead = formResults.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  for (const result of formResults) if (result.status === "rejected") errors.push(safeError(result.reason));
  const fresh = entriesRead
    .filter((receipt) => now.getTime() - Date.parse(receipt.publishedAt) <= MAX_RECEIPT_AGE_MS)
    .sort((left, right) => right.publishedAt.localeCompare(left.publishedAt));
  const universeByCik = new Map(universe.snapshot.entries.filter((entry) => entry.cik).map((entry) => [entry.cik!, entry]));
  const analysisByTicker = new Map(analyses.map((item) => [item.ticker.toUpperCase(), item]));
  const mapped = fresh.flatMap((receipt) => {
    const entry = universeByCik.get(receipt.cik);
    const item = entry ? analysisByTicker.get(entry.ticker.toUpperCase()) : null;
    return item ? [{ receipt, item }] : [];
  }).slice(0, MAX_FILINGS_PER_RUN);

  const articleCandidates = mapped.map(({ receipt, item }) => articleCandidate(receipt, item.ticker, item.company));
  const evidenceReport = await buildArticleEvidenceReport({ candidates: articleCandidates, fetchImpl, maximumArticles: Math.min(40, articleCandidates.length * 2 || 1) });
  const decisionGrade = mapped.flatMap(({ receipt, item }, index) => {
    const candidate = articleCandidates[index];
    const evidence = articleEvidenceForCandidate(evidenceReport, candidate);
    if (!evidence?.decisionGrade) return [];
    const filingText = evidence.excerpts.map((row) => row.excerpt).join(" ");
    const direction = positiveEarningsText(filingText);
    if (!direction.passed) return [];
    return [{ receipt, item, evidence, filingText, direction }];
  });

  const evaluated = await mapWithConcurrency(decisionGrade, 4, async ({ receipt, item, filingText, direction }): Promise<FastSecBuyCandidate> => {
    const readAt = new Date().toISOString();
    const [prices, normalization] = await Promise.all([fetchPrices(item, fetchImpl), loadNormalization(item.ticker)]);
    const currentPrice = prices.tvPrice;
    const conservative = item.fairValue.conservativeValue;
    const base = item.fairValue.baseValue;
    const optimistic = item.fairValue.optimisticValue;
    const upsideBase = currentPrice && base ? (base / currentPrice - 1) * 100 : null;
    const upsideConservative = currentPrice && conservative ? (conservative / currentPrice - 1) * 100 : null;
    const spread = methodSpreadPercent(item);
    const durable = normalization?.buyQualityConfirmed === true && normalization?.oneTimeOrPeakRisk !== true;
    const quality = item.scores.businessQuality >= 78
      && item.scores.balanceSheet >= 60
      && item.scores.risk <= 42
      && item.scores.fairValueConfidence >= 75
      && item.fairValue.methods.length >= 2
      && (spread ?? Infinity) <= 60;
    const valueMargin = (upsideBase ?? -Infinity) >= 12 && (upsideConservative ?? -Infinity) >= 5;
    const optionality = assessStrategicOptionality(filingText);
    const serious = Boolean(currentPrice) && prices.passed && durable && quality && valueMargin;
    const researchCandidate = item.scores.businessQuality >= 70 && (upsideBase ?? -Infinity) >= 5;
    const latency = Number.isFinite(Date.parse(receipt.publishedAt)) ? Math.max(0, (Date.parse(readAt) - Date.parse(receipt.publishedAt)) / 1_000) : null;
    const status = firstMover(prices.change);
    const reasons = [
      `Official SEC ${receipt.form} detected at ${receipt.publishedAt}; no stock-price move was required to discover it.`,
      `The filing/earnings exhibit was read before the current stock price was requested.`,
      `The filing contained ${direction.positiveHits} positive operating/guidance signals and no severe negative earnings signal in the decision text.`,
      ...(durable ? ["Existing five-year SEC normalization supports repeatable profit and cash generation rather than a one-quarter spike."] : []),
      ...(valueMargin ? [`After reading the filing, the price still offered ${(upsideBase ?? 0).toFixed(1)}% upside to base fair value and ${(upsideConservative ?? 0).toFixed(1)}% to conservative fair value.`] : []),
      ...optionality.supportiveFactors,
    ];
    const blockers = [
      ...(!prices.passed ? ["Independent price sources did not agree within 2% after the filing was read."] : []),
      ...(!durable ? ["Five-year SEC normalization is missing or flags unstable/one-time earnings."] : []),
      ...(!quality ? ["Quality, balance-sheet, risk, or valuation-agreement gates are below the Serious Buy standard."] : []),
      ...(!valueMargin ? ["The post-filing price does not retain at least 12% base upside and 5% conservative upside."] : []),
      ...optionality.risks,
    ];
    const confidence = Math.max(0, Math.min(98, Math.round(item.scores.businessQuality * 0.3 + item.scores.fairValueConfidence * 0.3 + (durable ? 15 : 0) + (prices.passed ? 10 : 0) + Math.min(15, direction.positiveHits * 3))));
    return {
      ticker: item.ticker,
      company: item.company,
      form: receipt.form,
      filingPublishedAt: receipt.publishedAt,
      filingReadAt: readAt,
      sourceLatencySeconds: rounded(latency),
      filingUrl: receipt.url,
      fullFilingOrExhibitRead: true,
      discoveryUsedPriceMovement: false,
      currentPrice: rounded(currentPrice),
      dailyMoveAfterFilingReadPercent: rounded(prices.change),
      firstMoverStatus: status,
      conservativeFairValue: rounded(conservative),
      baseFairValue: rounded(base),
      optimisticFairValue: rounded(optimistic),
      upsideToConservativePercent: rounded(upsideConservative),
      upsideToBasePercent: rounded(upsideBase),
      businessQuality: item.scores.businessQuality,
      risk: item.scores.risk,
      fairValueConfidence: item.scores.fairValueConfidence,
      classification: serious ? "serious_buy" : researchCandidate ? "buy_candidate" : "research_only",
      confidence,
      reasons,
      blockers: [...new Set(blockers)],
      strategicOptionality: optionality,
    };
  });

  const seriousBuys = evaluated.filter((item) => item.classification === "serious_buy").sort((left, right) => right.confidence - left.confidence);
  const buyCandidates = evaluated.filter((item) => item.classification === "buy_candidate").sort((left, right) => right.confidence - left.confidence);
  const newSeriousBuys: FastSecBuyReport["newSeriousBuys"] = [];
  for (const item of seriousBuys) {
    const id = fingerprint(item);
    const outboxKey = `${OUTBOX_PREFIX}/${item.ticker.toUpperCase()}/${id}.json`;
    const seenKey = `${SEEN_PREFIX}/${receiptDay(item.filingPublishedAt)}/${item.ticker.toUpperCase()}/${id}.json`;
    try {
      const written = await writeVersionedJsonToR2(outboxKey, { version: 1, kind: "pr262_fast_sec_serious_buy", branch: BRANCH, fingerprint: id, checkedAt, signal: item }, { createOnly: true });
      await writeVersionedJsonToR2(seenKey, { fingerprint: id, ticker: item.ticker, filingPublishedAt: item.filingPublishedAt }, { createOnly: true }).catch(() => {});
      if (written.written) newSeriousBuys.push({ fingerprint: id, ticker: item.ticker, company: item.company, filingPublishedAt: item.filingPublishedAt, currentPrice: item.currentPrice, baseFairValue: item.baseFairValue, potentialGainPercent: item.upsideToBasePercent, firstMoverStatus: item.firstMoverStatus, outboxKey });
    } catch (error) {
      errors.push(`outbox:${item.ticker}:${safeError(error)}`);
    }
  }

  const report: FastSecBuyReport = {
    version: 1,
    ok: analyses.length > 0 && formResults.some((result) => result.status === "fulfilled") && errors.length === 0,
    branch: BRANCH,
    mode: "pr262_fast_official_sec_leading_buy",
    checkedAt,
    runtime: { commitSha: process.env.RAILWAY_GIT_COMMIT_SHA?.trim() || null, deploymentId: process.env.RAILWAY_DEPLOYMENT_ID?.trim() || null },
    coverage: {
      forms: [...FAST_FORMS],
      officialFeedEntriesRead: entriesRead.length,
      freshEntries: fresh.length,
      exactCikMappings: mapped.length,
      filingsDeepRead: evidenceReport.diagnostics.urlsFetched,
      decisionGradeFilings: decisionGrade.length,
      priceChecksAfterFilingRead: evaluated.length,
    },
    seriousBuys,
    buyCandidates,
    newSeriousBuys,
    policy: {
      officialSecOnly: true,
      discoveryBeforePrice: true,
      priceMoveRequiredForDiscovery: false,
      actualFilingAndExhibitsRequired: true,
      maximumFreshFilingsPerRun: MAX_FILINGS_PER_RUN,
      noPaidNewsApi: true,
    },
    warehouse: { persisted: false, latestKey: LATEST_KEY, errors },
    safety: { databaseWrites: false, publishing: false, directUserNotifications: false, trades: false, productionWrites: false, nonUsScanning: false },
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

function receiptDay(value: string) {
  return value.slice(0, 10);
}

export async function readLatestUsFastSecBuyRadar() {
  try {
    const value = await readJson(LATEST_KEY);
    return value ? value as FastSecBuyReport : null;
  } catch {
    return null;
  }
}

export const US_FAST_SEC_BUY_POLICY = Object.freeze({
  branch: BRANCH,
  forms: FAST_FORMS,
  officialSecOnly: true,
  noPaidNewsApi: true,
  discoveryBeforePrice: true,
  priceMoveRequiredForDiscovery: false,
  actualFilingAndExhibitsRequired: true,
  maximumReceiptAgeMinutes: MAX_RECEIPT_AGE_MS / 60_000,
  maximumFreshFilingsPerRun: MAX_FILINGS_PER_RUN,
  publishing: false,
  directUserNotifications: false,
  trades: false,
});
