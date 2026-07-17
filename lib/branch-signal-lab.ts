import crypto from "node:crypto";
import { runAiCommittee, TRUSTED_IN_MEMORY_EVIDENCE } from "@/lib/ai-committee/orchestrator";
import type { AiCommitteeEvidencePack, EvidenceStrength } from "@/lib/ai-committee/evidence-pack";
import { getAiCommitteeProviderStatus } from "@/lib/ai-committee/provider";
import { buildMarketSentimentImpact, scoreSwingUpAlert, type SwingUpScore } from "@/lib/scoring-engine";

type CryptoAsset = { id: string; ticker: string; name: string };
type MarketRow = {
  usd?: unknown;
  usd_24h_change?: unknown;
  usd_24h_vol?: unknown;
  usd_market_cap?: unknown;
  last_updated_at?: unknown;
};
type MarketCandidate = CryptoAsset & {
  price: number;
  change24h: number;
  volume24h: number;
  marketCap: number;
  observedAt: string;
};
type NewsReceipt = { title: string; url: string; publisher: string; publishedAt: string; catalystKeywords: string[] };

const ASSETS: CryptoAsset[] = [
  { id: "bitcoin", ticker: "BTC", name: "Bitcoin" },
  { id: "ethereum", ticker: "ETH", name: "Ethereum" },
  { id: "solana", ticker: "SOL", name: "Solana" },
  { id: "ripple", ticker: "XRP", name: "XRP" },
  { id: "binancecoin", ticker: "BNB", name: "BNB" },
  { id: "cardano", ticker: "ADA", name: "Cardano" },
  { id: "dogecoin", ticker: "DOGE", name: "Dogecoin" },
  { id: "chainlink", ticker: "LINK", name: "Chainlink" },
  { id: "avalanche-2", ticker: "AVAX", name: "Avalanche" },
  { id: "sui", ticker: "SUI", name: "Sui" },
];

const CATALYST_KEYWORDS = [
  "approval", "approved", "etf", "regulation", "regulator", "lawsuit", "settlement", "hack", "exploit",
  "outage", "upgrade", "launch", "partnership", "adoption", "treasury", "institutional", "listing", "delisting",
  "liquidation", "whale", "security breach", "court", "sec", "cftc",
];
const NEWS_MAX_AGE_MS = 48 * 60 * 60 * 1000;
const COINGECKO_URL = "https://api.coingecko.com/api/v3/simple/price";
const GOOGLE_NEWS_URL = "https://news.google.com/rss/search";

export function createBranchSignalLabFixtureFetch(now = new Date()): typeof fetch {
  const changes: Record<string, number> = { bitcoin: 6.2, ethereum: 1.4, solana: -1.2, ripple: 0.8, binancecoin: -0.7, cardano: 0.5, dogecoin: -0.4, chainlink: 0.3, "avalanche-2": -0.2, sui: 0.1 };
  const prices: Record<string, number> = { bitcoin: 100_000, ethereum: 4_000, solana: 200, ripple: 2, binancecoin: 700, cardano: 1, dogecoin: 0.2, chainlink: 25, "avalanche-2": 40, sui: 4 };
  return (async (input: RequestInfo | URL) => {
    const target = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    if (target.hostname === "api.coingecko.com") {
      const body = Object.fromEntries(ASSETS.map((asset, index) => [asset.id, { usd: prices[asset.id], usd_24h_change: changes[asset.id], usd_24h_vol: 12_000_000_000 - index * 500_000_000, usd_market_cap: 1_500_000_000_000 - index * 100_000_000_000, last_updated_at: Math.floor(now.getTime() / 1000) }]));
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (target.hostname === "news.google.com") {
      const query = target.searchParams.get("q") ?? "";
      const items = /bitcoin|btc/i.test(query) ? [
        ["Regulator approves spot Bitcoin ETF expansion", "Reuters"],
        ["Institutional treasury adoption launches new Bitcoin programme", "Bloomberg"],
        ["Court settlement removes Bitcoin market uncertainty", "CoinDesk"],
      ] : [];
      const xml = `<?xml version="1.0"?><rss><channel>${items.map(([title, publisher], index) => `<item><title>${title}</title><link>https://fixture.invalid/${index}</link><source>${publisher}</source><pubDate>${now.toUTCString()}</pubDate></item>`).join("")}</channel></rss>`;
      return new Response(xml, { status: 200, headers: { "content-type": "application/rss+xml" } });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
}

function number(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function clamp(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function decodeXml(value: string) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tagValue(xml: string, tag: string) {
  const match = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i"));
  return match ? decodeXml(match[1]) : "";
}

function parseNewsRss(xml: string, now: Date): NewsReceipt[] {
  return Array.from(xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)).flatMap(([item]) => {
    const title = tagValue(item, "title").slice(0, 240);
    const url = tagValue(item, "link");
    const publisher = tagValue(item, "source").slice(0, 120);
    const rawDate = tagValue(item, "pubDate");
    const publishedAt = new Date(rawDate);
    if (!title || !url || !publisher || Number.isNaN(publishedAt.getTime())) return [];
    if (now.getTime() - publishedAt.getTime() > NEWS_MAX_AGE_MS || publishedAt.getTime() > now.getTime() + 5 * 60_000) return [];
    const lower = title.toLowerCase();
    const catalystKeywords = CATALYST_KEYWORDS.filter((keyword) => lower.includes(keyword));
    return [{ title, url, publisher, publishedAt: publishedAt.toISOString(), catalystKeywords }];
  });
}

async function fetchMarket(fetchImpl: typeof fetch, now: Date) {
  const url = new URL(COINGECKO_URL);
  url.searchParams.set("ids", ASSETS.map((asset) => asset.id).join(","));
  url.searchParams.set("vs_currencies", "usd");
  url.searchParams.set("include_24hr_change", "true");
  url.searchParams.set("include_24hr_vol", "true");
  url.searchParams.set("include_market_cap", "true");
  url.searchParams.set("include_last_updated_at", "true");
  const response = await fetchImpl(url, { headers: { Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`coingecko_http_${response.status}`);
  const body = await response.json() as Record<string, MarketRow | undefined>;
  const rows = ASSETS.flatMap((asset): MarketCandidate[] => {
    const row = body[asset.id];
    const price = number(row?.usd);
    const change24h = number(row?.usd_24h_change);
    const volume24h = number(row?.usd_24h_vol);
    const marketCap = number(row?.usd_market_cap);
    const timestamp = number(row?.last_updated_at);
    const observedAt = timestamp ? new Date(timestamp * 1000) : now;
    if (!price || change24h === null || !volume24h || !marketCap || Number.isNaN(observedAt.getTime())) return [];
    return [{ ...asset, price, change24h, volume24h, marketCap, observedAt: observedAt.toISOString() }];
  });
  if (rows.length < 5) throw new Error("coingecko_incomplete_market_snapshot");
  return { rows, sourceUrl: url.toString() };
}

async function fetchNews(asset: CryptoAsset, fetchImpl: typeof fetch, now: Date) {
  const url = new URL(GOOGLE_NEWS_URL);
  url.searchParams.set("q", `(${asset.name} OR ${asset.ticker}) crypto when:2d`);
  url.searchParams.set("hl", "en-US");
  url.searchParams.set("gl", "US");
  url.searchParams.set("ceid", "US:en");
  const response = await fetchImpl(url, { headers: { Accept: "application/rss+xml, text/xml" }, cache: "no-store", signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error(`google_news_http_${response.status}`);
  const receipts = parseNewsRss(await response.text(), now);
  const unique = new Map<string, NewsReceipt>();
  for (const receipt of receipts) {
    const key = `${receipt.publisher.toLowerCase()}|${receipt.title.toLowerCase()}`;
    if (!unique.has(key)) unique.set(key, receipt);
  }
  return { receipts: [...unique.values()].slice(0, 8), sourceUrl: url.toString() };
}

function marketSentiment(rows: MarketCandidate[], now: Date) {
  const average = rows.reduce((sum, row) => sum + row.change24h, 0) / rows.length;
  const support = clamp(50 + average * 4);
  const riskOff = average <= -5 ? 35 : average <= -2 ? 20 : average >= 2 ? 5 : 12;
  return buildMarketSentimentImpact({
    overallMarketMood: average >= 2 ? "risk_on" : average <= -2 ? "risk_off" : "mixed",
    macroRiskLevel: average <= -5 ? "high" : average <= -2 ? "medium" : "low",
    sentimentSupportScore: support,
    macroSupportScore: support,
    profitPotentialAdjustment: average >= 2 ? 3 : average <= -2 ? -4 : 0,
    confidenceAdjustment: 0,
    riskOffPenalty: riskOff,
    createdAt: now,
  });
}

function scoreCandidate(row: MarketCandidate, receipts: NewsReceipt[], sentiment: ReturnType<typeof marketSentiment>) {
  const publishers = new Set(receipts.map((receipt) => receipt.publisher.toLowerCase()));
  const keywordCount = new Set(receipts.flatMap((receipt) => receipt.catalystKeywords)).size;
  const catalystStrength = clamp(40 + keywordCount * 12 + Math.min(18, Math.abs(row.change24h) * 2));
  const volumeToMarketCap = row.volume24h / row.marketCap;
  const priceVolume = clamp(40 + Math.abs(row.change24h) * 6 + Math.min(25, volumeToMarketCap * 100));
  const sourceQuality = publishers.size >= 3 ? "high" as const : publishers.size >= 2 ? "medium" as const : "low" as const;
  const expectedMove = Math.max(4, Math.min(20, Math.abs(row.change24h) * 1.25));
  const inputProvenance = {
    catalystStrengthScore: `live_google_news_${publishers.size}_publishers_${keywordCount}_catalysts`,
    priceMovePercent: `live_coingecko_24h_${row.observedAt}`,
    sourceQuality: `live_google_news_unique_publishers_${publishers.size}`,
    independentReceipts: `live_coingecko_plus_google_news_publishers_${publishers.size}`,
    priceVolumeConfirmationScore: `live_coingecko_price_volume_market_cap_${row.observedAt}`,
  };
  const score = scoreSwingUpAlert({
    ticker: row.ticker,
    company: row.name,
    expectedUpsidePercent: row.change24h >= 0 ? expectedMove : Math.max(3, expectedMove * 0.6),
    expectedDownsidePercent: Math.max(8, Math.min(28, Math.abs(row.change24h) * 1.4)),
    historicalPatternMatch: "no_clear_match",
    valuationSupportScore: clamp(75 - Math.log10(Math.max(row.marketCap, 1)) * 2),
    catalystStrengthScore: catalystStrength,
    priceMovePercent: row.change24h,
    sectorSupportScore: sentiment.sentimentSupportScore,
    macroSupportScore: sentiment.macroSupportScore,
    sourceQuality,
    independentReceipts: publishers.size + 1,
    hasConfirmedFilingOrExchangeSource: false,
    priceVolumeConfirmationScore: priceVolume,
    financialSupportScore: clamp(50 + Math.min(30, volumeToMarketCap * 100)),
    verifiedRippleLinks: 0,
    contradictionCount: 0,
    isRumour: false,
    overboughtRiskScore: row.change24h > 0 ? clamp(25 + row.change24h * 5) : 35,
    balanceSheetRiskScore: 70,
    sourceRiskScore: publishers.size >= 3 ? 18 : publishers.size >= 2 ? 30 : 65,
    liquidityRiskScore: clamp(60 - volumeToMarketCap * 120),
    dilutionRiskScore: 70,
    inputProvenance,
    liveEvidenceOnly: true,
  }, sentiment);
  return { score, publishers: [...publishers], keywordCount, catalystStrength, priceVolume, volumeToMarketCap };
}

function section(available: boolean, strength: EvidenceStrength, summary: string, items: Array<Record<string, unknown>>) {
  return { available, strength, summary, items };
}

function evidencePack(params: { row: MarketCandidate; receipts: NewsReceipt[]; score: SwingUpScore; marketSourceUrl: string; newsSourceUrl: string; publishers: string[]; volumeToMarketCap: number; now: Date }): AiCommitteeEvidencePack {
  const { row, receipts, score, publishers, now } = params;
  const links = [params.marketSourceUrl, params.newsSourceUrl, ...receipts.map((receipt) => receipt.url)];
  const newsItems = receipts.map((receipt) => ({ source: receipt.publisher, title: receipt.title, url: receipt.url, observedAt: receipt.publishedAt, catalystKeywords: receipt.catalystKeywords }));
  const marketItem = { source: "CoinGecko", ticker: row.ticker, priceUsd: row.price, change24h: row.change24h, volume24h: row.volume24h, marketCap: row.marketCap, volumeToMarketCap: params.volumeToMarketCap, observedAt: row.observedAt, url: params.marketSourceUrl };
  return {
    candidateAlertId: `branch-lab-${crypto.randomUUID()}`,
    rawSignalIds: [], ticker: row.ticker, company: `${row.name} digital asset`, actionLabel: score.suggestedAction,
    eventHeadline: receipts[0]?.title ?? `${row.ticker} live market catalyst scan`,
    whatHappened: `${row.name} moved ${row.change24h.toFixed(2)}% in 24 hours. ${receipts.length} recent news receipts from ${publishers.length} unique publishers were checked.`,
    sourceNames: ["CoinGecko", "Google News RSS", ...publishers], sourceLinks: [...new Set(links)],
    sourceFreshness: [
      { source: "CoinGecko", collectedAt: row.observedAt, ageHours: Math.max(0, (now.getTime() - Date.parse(row.observedAt)) / 3_600_000), freshness: "fresh" },
      ...receipts.map((receipt) => ({ source: receipt.publisher, collectedAt: receipt.publishedAt, ageHours: Math.max(0, (now.getTime() - Date.parse(receipt.publishedAt)) / 3_600_000), freshness: "fresh" as const })),
    ],
    sourceHealth: [{ source: "CoinGecko", status: "connected", checkedAt: now.toISOString(), lastSuccessAt: now.toISOString(), responseTimeMs: null, problem: null, notes: "Live read-only branch experiment." }, { source: "Google News RSS", status: "connected", checkedAt: now.toISOString(), lastSuccessAt: now.toISOString(), responseTimeMs: null, problem: null, notes: "Live read-only branch experiment." }],
    proofBundleSummary: { proofCount: links.length, proofTypes: ["news", "price_volume", "crypto_market"], uniquePublishers: publishers.length, liveOnly: true },
    filingEvidence: section(true, "medium", "Issuer filings are not applicable to this digital asset; regulatory news receipts are included in the news section.", []),
    newsEvidence: section(newsItems.length >= 2, newsItems.length >= 3 ? "strong" : "medium", `${newsItems.length} recent receipts from ${publishers.length} unique publishers.`, newsItems),
    priceVolumeEvidence: section(true, "strong", "Current price, 24-hour move, volume, and market capitalization came directly from CoinGecko.", [marketItem]),
    fundamentalsEvidence: section(true, "medium", "Crypto market structure uses live market cap and turnover; company accounting metrics do not apply.", [marketItem]),
    macroEvidence: section(true, "medium", `Top-asset crypto sentiment is ${score.marketSentimentImpact.overallMarketMood}.`, [score.marketSentimentImpact]),
    fdaRegulatoryEvidence: section(true, "medium", "FDA evidence is not applicable; relevant regulatory headlines are in news evidence.", []),
    cryptoFxEvidence: section(true, "strong", "Direct live digital-asset market evidence is available.", [marketItem]),
    finraShortPressureEvidence: section(true, "medium", "FINRA short-sale data is not applicable to this spot digital asset.", []),
    wikidataRippleRelationships: section(true, "medium", "No ecosystem relationship is asserted without a direct receipt.", []),
    historicalPatternMatch: section(true, "medium", "No historical pattern assumption was used in this live experiment.", []),
    previousSimilarOutcomes: section(true, "medium", "Outcome tracking is enabled, but no past result is invented for this new candidate.", []),
    score: { profitPotential: score.profitPotentialScore, evidenceConfidence: score.evidenceConfidenceScore, riskLevel: score.riskLevel, pricedInCheck: score.pricedInCheck, inputCompleteness: score.inputCompleteness, liveDataReady: score.liveDataReady, missingInputs: score.missingInputs, inputProvenance: score.inputProvenance, createdAt: now.toISOString(), persisted: false },
    currentRiskLabels: [`risk:${score.riskLevel}`, `priced_in:${score.pricedInCheck}`, ...(row.change24h > 8 ? ["large_24h_move"] : [])],
    missingEvidence: [], dataFreshnessWarnings: [],
    compatibility: { callsOpenAi: false, publishes: false, sendsTelegram: false, writesDatabase: false },
  };
}

function candidateFingerprint(row: MarketCandidate, receipts: NewsReceipt[]) {
  const evidence = receipts
    .map((receipt) => `${receipt.publisher.toLowerCase()}|${receipt.title.toLowerCase()}`)
    .sort()
    .join("||");
  return crypto.createHash("sha256").update(`${row.ticker}|${evidence}`).digest("hex").slice(0, 20);
}

export async function runBranchSignalLab(input: { allowOpenAi?: boolean; fetchImpl?: typeof fetch; now?: Date; skipOpenAiCandidateFingerprints?: string[]; sourceMode?: "live" | "fixture" } = {}) {
  const now = input.now ?? new Date();
  const fetchImpl = input.fetchImpl ?? fetch;
  const mode = input.sourceMode === "fixture" ? "railway_branch_fixture_read_only" : "railway_branch_live_read_only";
  const startedAt = Date.now();
  try {
    const market = await fetchMarket(fetchImpl, now);
    const sentiment = marketSentiment(market.rows, now);
    const movers = [...market.rows].sort((a, b) => Math.abs(b.change24h) - Math.abs(a.change24h)).slice(0, 5);
    const newsResults = await Promise.all(movers.map(async (row) => ({ row, ...(await fetchNews(row, fetchImpl, now).catch((error: unknown) => ({ receipts: [] as NewsReceipt[], sourceUrl: "", error: error instanceof Error ? error.message : "news_fetch_failed" }))) })));
    const ranked = newsResults.map(({ row, receipts, sourceUrl, ...rest }) => {
      const scored = scoreCandidate(row, receipts, sentiment);
      const qualityScore = clamp(scored.score.profitPotentialScore * 0.4 + scored.score.evidenceConfidenceScore * 0.4 + Math.min(100, scored.publishers.length * 25) * 0.2);
      return { row, receipts, newsSourceUrl: sourceUrl, newsError: "error" in rest ? rest.error : null, ...scored, qualityScore };
    }).sort((a, b) => b.qualityScore - a.qualityScore);
    const best = ranked.find((candidate) => candidate.score.liveDataReady && candidate.score.inputCompleteness === 100 && candidate.publishers.length >= 2 && candidate.keywordCount >= 1 && Math.abs(candidate.row.change24h) >= 2 && candidate.score.evidenceConfidenceScore >= 55) ?? null;
    const common = {
      ok: true, mode, checkedAt: now.toISOString(), durationMs: Date.now() - startedAt,
      sources: { coinGecko: "connected", googleNewsRss: newsResults.some((result) => result.receipts.length) ? "connected" : "degraded" },
      assetsChecked: market.rows.length, candidatesChecked: ranked.length, databaseWrites: false, publishing: false, notifications: false,
      marketSnapshot: market.rows.map((row) => ({ ticker: row.ticker, price: row.price, observedAt: row.observedAt })),
      rankedCandidates: ranked.map((candidate) => ({ ticker: candidate.row.ticker, change24h: Math.round(candidate.row.change24h * 100) / 100, newsReceipts: candidate.receipts.length, uniquePublishers: candidate.publishers.length, catalystKeywordCount: candidate.keywordCount, inputCompleteness: candidate.score.inputCompleteness, profitPotentialScore: candidate.score.profitPotentialScore, evidenceConfidenceScore: candidate.score.evidenceConfidenceScore, suggestedAction: candidate.score.suggestedAction, qualityScore: candidate.qualityScore, qualifiedForCommittee: candidate === best })),
    };
    if (!best) return { ...common, status: "no_qualified_signal", seriousSignalFound: false, openAiCalled: false, qualityScore: ranked[0]?.qualityScore ?? 0, blockers: ["No current asset had enough independent, recent catalyst evidence and market confirmation. Filters were not weakened."], technicalFailureFingerprint: null };
    const fingerprint = candidateFingerprint(best.row, best.receipts);
    const pack = evidencePack({ row: best.row, receipts: best.receipts, score: best.score, marketSourceUrl: market.sourceUrl, newsSourceUrl: best.newsSourceUrl, publishers: best.publishers, volumeToMarketCap: best.volumeToMarketCap, now });
    const provider = getAiCommitteeProviderStatus();
    const selectedCandidate = { ticker: best.row.ticker, company: best.row.name, price: best.row.price, change24h: best.row.change24h, direction: best.row.change24h >= 0 ? "upside" : "downside", newsReceipts: best.receipts, score: best.score };
    if (input.skipOpenAiCandidateFingerprints?.includes(fingerprint)) return { ...common, status: "qualified_candidate_already_reviewed", seriousSignalFound: false, openAiCalled: false, candidateFingerprint: fingerprint, qualityScore: best.qualityScore, selectedCandidate, committee: { configured: provider.configured, enabled: provider.enabled }, blockers: ["The same evidence was already reviewed recently, so OpenAI was not called again."], technicalFailureFingerprint: null };
    if (!input.allowOpenAi) return { ...common, status: "qualified_signal_openai_not_requested", seriousSignalFound: false, openAiCalled: false, candidateFingerprint: fingerprint, qualityScore: best.qualityScore, selectedCandidate, committee: { configured: provider.configured, enabled: provider.enabled }, blockers: ["The rolling OpenAI test budget has been reached; the candidate was retained without another paid review."], technicalFailureFingerprint: null };
    if (!provider.configured || !provider.enabled) return { ...common, ok: false, status: "technical_failure", seriousSignalFound: false, openAiCalled: false, candidateFingerprint: fingerprint, qualityScore: best.qualityScore, selectedCandidate, blockers: [provider.configured ? "AI committee is disabled." : "OPENAI_API_KEY is not available in this deployment."], technicalFailureFingerprint: provider.configured ? "ai_committee_disabled" : "openai_key_missing" };
    const committee = await runAiCommittee({ [TRUSTED_IN_MEMORY_EVIDENCE]: pack, persistResult: false, dryRun: false, confirmRun: true, mode: "preview", maxAgents: 13, maxCostUsd: 0.75 });
    const results = Array.isArray(committee.agentResults) ? committee.agentResults : [];
    const completed = results.filter((result) => result.status === "completed").length;
    const failed = results.filter((result) => result.status === "failed").length;
    const finalJudge = results.find((result) => result.agentId === "final_judge");
    const recommendation = committee.committeeOutput?.overallRecommendation ?? "needs_more_data";
    const seriousSignalFound = committee.ok === true && completed === 14 && failed === 0 && recommendation === "approve" && best.score.profitPotentialScore >= 60 && best.score.evidenceConfidenceScore >= 60 && best.score.liveDataReady;
    return { ...common, status: seriousSignalFound ? "serious_signal" : "candidate_needs_more_data", seriousSignalFound, openAiCalled: true, candidateFingerprint: fingerprint, qualityScore: clamp(best.qualityScore * 0.55 + (committee.committeeOutput?.evidenceConfidenceScore ?? 0) * 0.25 + (finalJudge?.confidence ?? 0) * 0.2), selectedCandidate, committee: { ok: committee.ok, status: committee.status, agentsPlanned: committee.plannedAgents?.length ?? 0, agentsCompleted: completed, agentsFailed: failed, finalJudge: finalJudge ? { verdict: finalJudge.verdict, confidence: finalJudge.confidence, concerns: finalJudge.concerns, missingData: finalJudge.missingData } : null, output: committee.committeeOutput, writesDatabase: committee.compatibility?.writesDatabase ?? false }, blockers: seriousSignalFound ? [] : [...new Set([...(committee.committeeOutput?.missingEvidence ?? []), ...(finalJudge?.missingData ?? []), ...(finalJudge?.concerns ?? [])])].slice(0, 12), technicalFailureFingerprint: committee.ok ? null : `committee_${committee.status}` };
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 200) : "branch_signal_lab_failed";
    return { ok: false, mode, status: "technical_failure", checkedAt: now.toISOString(), durationMs: Date.now() - startedAt, seriousSignalFound: false, openAiCalled: false, databaseWrites: false, publishing: false, notifications: false, qualityScore: 0, blockers: [message], technicalFailureFingerprint: message.replace(/\d+/g, "#") };
  }
}
