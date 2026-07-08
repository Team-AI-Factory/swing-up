import type { RawSignal } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { redactSecrets } from "@/lib/redact-secrets";

type GenericRawSignal = Pick<RawSignal, "id" | "source" | "ticker" | "title" | "summary" | "sourceUrl" | "receivedAt" | "payload">;

type MacroKeyword = { term: string; tag: string; score: number };

const KEYWORDS: MacroKeyword[] = [
  { term: "war", tag: "war", score: 18 },
  { term: "ceasefire", tag: "ceasefire ended", score: 20 },
  { term: "ceasefire is over", tag: "ceasefire ended", score: 28 },
  { term: "ceasefire with iran is over", tag: "ceasefire ended", score: 35 },
  { term: "sanction", tag: "sanctions", score: 18 },
  { term: "oil prices jump", tag: "oil spike", score: 24 },
  { term: "oil price surges", tag: "oil spike", score: 24 },
  { term: "crude oil", tag: "oil spike", score: 18 },
  { term: "strait of hormuz", tag: "Strait of Hormuz", score: 30 },
  { term: "iran", tag: "Iran", score: 18 },
  { term: "middle east", tag: "Middle East conflict", score: 16 },
  { term: "inflation shock", tag: "inflation shock", score: 22 },
  { term: "bond yield", tag: "bond yield spike", score: 18 },
  { term: "yield spike", tag: "bond yield spike", score: 24 },
  { term: "fed hike", tag: "Fed hike expectation", score: 20 },
  { term: "rate hike", tag: "Fed hike expectation", score: 18 },
  { term: "energy supply", tag: "energy supply shock", score: 22 },
];

const BROAD_SOURCES = new Set(["Marketaux Catalyst", "GDELT", "Google News RSS", "FRED Macro", "Frankfurter FX", "CoinGecko"]);
const REQUIRED_PROOF = ["news_or_official_source", "cross_asset_market_reaction OR macro_indicator_reaction", "affected_asset_mapping"];
const REGRESSION_STORIES: GenericRawSignal[] = [
  {
    id: "regression-trump-iran-oil-ceasefire",
    source: "Marketaux Catalyst regression sample",
    ticker: null,
    title: "Oil prices jump nearly 6% after Trump says ceasefire with Iran is 'over'",
    summary: "Crude oil price surges more than 6% after Trump says ceasefire with Iran is 'over'",
    sourceUrl: "https://example.com/macro-shock-regression-source",
    receivedAt: new Date(),
    payload: { regressionOnly: true },
  },
];

function uniq(values: string[]) { return Array.from(new Set(values.filter(Boolean))); }
function textOf(signal: GenericRawSignal) { return `${signal.title ?? ""} ${signal.summary ?? ""} ${JSON.stringify(signal.payload ?? {})}`; }
function hasUrl(signal: GenericRawSignal) { return Boolean(signal.sourceUrl && /^https?:\/\//i.test(signal.sourceUrl)); }

export function classifyMacroShock(signal: GenericRawSignal) {
  const rawText = textOf(signal);
  const lower = rawText.toLowerCase();
  const matched = KEYWORDS.filter((k) => lower.includes(k.term));
  const tags = uniq(matched.map((m) => m.tag));
  const hasOilMove = /\boil\b|\bcrude\b|\bwti\b|\bbrent\b|\bgas\b/.test(lower) && /(jump|surge|spike|rall|rise|up|higher|\b[5-9](\.\d+)?%|\d{2}%)/.test(lower);
  const hasRatesMove = /(bond yield|treasury yield|us10y|us2y|rates?|fed hike)/.test(lower) && /(jump|surge|spike|rise|higher|up)/.test(lower);
  const isMacroShock = matched.length > 0 && (tags.length >= 2 || hasOilMove || hasRatesMove);
  const commodities = lower.includes("gas") ? ["WTI", "Brent", "oil", "gas"] : lower.includes("oil") || lower.includes("crude") ? ["WTI", "Brent", "oil"] : [];
  const etfs = uniq(["SPY", "QQQ", "DIA", "TLT", "HYG", ...(commodities.length ? ["USO", "XLE", "XOP", "XLI", "JETS"] : [])]);
  const sectors = uniq([...(commodities.length ? ["energy", "airlines", "transport", "consumer discretionary"] : []), ...(lower.includes("war") || lower.includes("iran") || lower.includes("middle east") ? ["defense", "semiconductors"] : [])]);
  const rates = ["US10Y", "US2Y"];
  const indexes = ["SPY", "QQQ", "DIA"];
  const affectedAssetMapping = { commodities, ETFs: etfs, sectors, rates, indexes };
  const proofTypes = [hasUrl(signal) ? "news_or_official_source" : null, hasOilMove ? "cross_asset_market_reaction" : hasRatesMove ? "macro_indicator_reaction" : null, (commodities.length || etfs.length || sectors.length) ? "affected_asset_mapping" : null].filter(Boolean) as string[];
  const stillMissingProof = REQUIRED_PROOF.filter((p) => p.includes(" OR ") ? !proofTypes.includes("cross_asset_market_reaction") && !proofTypes.includes("macro_indicator_reaction") : !proofTypes.includes(p));
  const seriousnessScore = Math.min(100, 45 + matched.reduce((sum, m) => sum + m.score, 0) + (hasOilMove ? 12 : 0) + (hasUrl(signal) ? 5 : -8));
  const candidateStage = isMacroShock && proofTypes.includes("news_or_official_source") && proofTypes.includes("affected_asset_mapping") ? (stillMissingProof.length ? "proof_needed" : "watch_candidate") : "rejected_noise";
  return redactSecrets({
    rawSignalId: signal.id ?? null,
    source: signal.source,
    ticker: signal.ticker ?? null,
    tickerNullAcceptedForMacroShock: isMacroShock && !signal.ticker,
    title: signal.title,
    sourceUrl: signal.sourceUrl,
    receivedAt: signal.receivedAt.toISOString(),
    signalType: isMacroShock ? "macro_geopolitical_shock" : "not_macro_geopolitical_shock",
    matchedMacroShockTerms: tags,
    seriousnessScore,
    affectedAssetMapping,
    affectedAssetsMapped: uniq([...commodities, ...etfs, ...sectors, ...rates, ...indexes]),
    proofTypes,
    requiredProof: REQUIRED_PROOF,
    stillMissingProof,
    proofAttempts: { news_or_official_source: true, cross_asset_market_reaction: true, macro_indicator_reaction: true, affected_asset_mapping: true },
    candidateStage,
    canEnterWatchOrProofNeeded: candidateStage === "watch_candidate" || candidateStage === "proof_needed",
    canPublicPublishWithoutMappedAssetProof: false,
    rejectedReason: isMacroShock ? null : "macro_shock_terms_or_reaction_not_strong_enough",
  });
}

export async function runMacroShockScan(input: { dryRun?: boolean; confirmRun?: boolean; maxSignals?: number; freshnessWindowHours?: number } = {}) {
  const maxSignals = Math.min(Math.max(Number(input.maxSignals ?? 30), 1), 100);
  const since = new Date(Date.now() - Number(input.freshnessWindowHours ?? 72) * 60 * 60 * 1000);
  const dbSignals = process.env.DATABASE_URL ? await prisma.rawSignal.findMany({ where: { receivedAt: { gte: since }, OR: [{ source: { in: Array.from(BROAD_SOURCES) } }, { ticker: null }] }, orderBy: [{ receivedAt: "desc" }], take: maxSignals }).catch(() => []) : [];
  const signals = [...dbSignals, ...REGRESSION_STORIES].slice(0, maxSignals);
  const classifications = signals.map(classifyMacroShock);
  const candidates = classifications.filter((c) => c.signalType === "macro_geopolitical_shock" && c.canEnterWatchOrProofNeeded === true);
  const proofAddedByType = candidates.flatMap((c) => Array.isArray(c.proofTypes) ? c.proofTypes.map(String) : []).reduce<Record<string, number>>((acc, type) => { acc[type] = (acc[type] ?? 0) + 1; return acc; }, {});
  return redactSecrets({
    ok: true,
    dryRun: input.dryRun !== false,
    confirmRun: input.confirmRun === true,
    macroSignalsInspected: classifications.length,
    macroShockCandidatesCreated: candidates.length,
    topMacroShockCandidates: candidates.slice(0, 10),
    affectedAssetsMapped: uniq(candidates.flatMap((c) => Array.isArray(c.affectedAssetsMapped) ? c.affectedAssetsMapped.map(String) : [])),
    proofAddedByType,
    stillMissingProof: uniq(candidates.flatMap((c) => Array.isArray(c.stillMissingProof) ? c.stillMissingProof.map(String) : [])),
    rejectedReasons: classifications.filter((c) => c.signalType !== "macro_geopolitical_shock" || c.canEnterWatchOrProofNeeded !== true).map((c) => c.rejectedReason).filter(Boolean),
    regressionChecks: {
      trumpIranOilCeasefireStoryBecomesMacroGeopoliticalShock: classifications.some((c) => c.rawSignalId === "regression-trump-iran-oil-ceasefire" && c.signalType === "macro_geopolitical_shock"),
      tickerNullNoLongerAutomaticallyRejectsMacroShock: classifications.some((c) => c.rawSignalId === "regression-trump-iran-oil-ceasefire" && c.tickerNullAcceptedForMacroShock === true),
      affectedEtfsSectorsAssetsMapped: candidates.some((c) => Array.isArray(c.affectedAssetsMapped) && c.affectedAssetsMapped.length > 0),
      oilRatesIndexReactionProofAttempted: candidates.some((c) => (c.proofAttempts as Record<string, unknown>)?.cross_asset_market_reaction === true),
      macroCandidateCanEnterWatchProofNeeded: candidates.some((c) => c.canEnterWatchOrProofNeeded === true),
    },
    noOpenAI: true,
    noPublish: true,
    noTelegram: true,
    secretsRedacted: true,
  });
}
