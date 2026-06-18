import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { COINGECKO_SOURCE } from "@/lib/ears/coingecko";
import { FRANKFURTER_SOURCE } from "@/lib/ears/frankfurter";
import { FRED_SOURCE, runFredIngestion } from "@/lib/ears/fred";

type Mood = "bullish" | "neutral" | "bearish" | "risk_off";
type Risk = "low" | "medium" | "high" | "extreme";

type NumericPayload = { change24h?: unknown; pctChange?: unknown };

function clamp(value: number, min: number, max: number) { return Math.max(min, Math.min(max, Math.round(value))); }
function asNumber(value: unknown) { return typeof value === "number" && Number.isFinite(value) ? value : null; }
function avg(values: number[]) { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null; }

async function recentRawSignals(source: string) {
  if (!process.env.DATABASE_URL) return [];
  const since = new Date(Date.now() - 36 * 60 * 60 * 1000);
  try { return await prisma.rawSignal.findMany({ where: { source, receivedAt: { gte: since } }, orderBy: { receivedAt: "desc" }, take: 20 }); } catch { return []; }
}

function cryptoMoodFromSignals(signals: Awaited<ReturnType<typeof recentRawSignals>>) {
  const moves = signals.map((signal) => asNumber((signal.payload as NumericPayload | null)?.change24h)).filter((value): value is number => value !== null);
  const average = avg(moves);
  if (average === null) return { mood: "neutral" as Mood, score: 50, warning: "No recent CoinGecko crypto move receipts were available." };
  if (average >= 3) return { mood: "bullish" as Mood, score: 65 };
  if (average <= -5) return { mood: "risk_off" as Mood, score: 32 };
  if (average <= -2) return { mood: "bearish" as Mood, score: 42 };
  return { mood: "neutral" as Mood, score: 54 };
}

function fxPressureFromSignals(signals: Awaited<ReturnType<typeof recentRawSignals>>) {
  const moves = signals.map((signal) => asNumber((signal.payload as NumericPayload | null)?.pctChange)).filter((value): value is number => value !== null);
  const maxAbsMove = moves.length ? Math.max(...moves.map(Math.abs)) : null;
  if (maxAbsMove === null) return { pressure: "unknown", penalty: 4, warning: "No recent Frankfurter FX move receipts were available." };
  if (maxAbsMove >= 1.5) return { pressure: "high", penalty: 14 };
  if (maxAbsMove >= 0.75) return { pressure: "medium", penalty: 8 };
  return { pressure: "low", penalty: 2 };
}

function macroFromFred(fred: Awaited<ReturnType<typeof runFredIngestion>>) {
  const byId = Object.fromEntries(fred.observations.map((item) => [item.seriesId, item.value]));
  let pressure = 0;
  const fedFunds = asNumber(byId.FEDFUNDS);
  const unemployment = asNumber(byId.UNRATE);
  const tenYear = asNumber(byId.DGS10);
  if (fedFunds !== null && fedFunds > 4.5) pressure += 18;
  if (unemployment !== null && unemployment > 5) pressure += 14;
  if (tenYear !== null && tenYear > 4.5) pressure += 12;
  if (fred.status === "partial") pressure += 6;
  const risk: Risk = pressure >= 36 ? "extreme" : pressure >= 24 ? "high" : pressure >= 12 ? "medium" : "low";
  return { risk, score: clamp(72 - pressure, 0, 100), penalty: clamp(pressure / 2, 0, 100) };
}

export async function getMarketSentimentSnapshot() {
  const fred = await runFredIngestion({ dryRun: true }).catch((error) => ({ ok: false, source: FRED_SOURCE as typeof FRED_SOURCE, dryRun: true, status: "partial" as const, observations: [], warnings: [error instanceof Error ? error.message : "FRED macro data unavailable"], responseTimeMs: 0, persisted: false }));
  const [cryptoSignals, fxSignals] = await Promise.all([recentRawSignals(COINGECKO_SOURCE), recentRawSignals(FRANKFURTER_SOURCE)]);
  const crypto = cryptoMoodFromSignals(cryptoSignals);
  const fx = fxPressureFromSignals(fxSignals);
  const macro = macroFromFred(fred);
  const warnings = [...fred.warnings, crypto.warning, fx.warning].filter(Boolean) as string[];
  const sentimentSupportScore = clamp((crypto.score + (100 - fx.penalty)) / 2, 0, 100);
  const riskOffPenalty = clamp(macro.penalty + fx.penalty + (crypto.mood === "risk_off" ? 16 : 0), 0, 100);
  const overallMarketMood: Mood = riskOffPenalty >= 35 ? "risk_off" : sentimentSupportScore >= 62 ? "bullish" : sentimentSupportScore <= 44 ? "bearish" : "neutral";
  const confidenceAdjustment = clamp((macro.score + sentimentSupportScore) / 10 - 10 - riskOffPenalty / 10, -20, 20);
  const profitPotentialAdjustment = clamp((sentimentSupportScore - 50) / 5 - riskOffPenalty / 8, -20, 20);
  const summary = macro.risk === "high" || macro.risk === "extreme"
    ? "Market conditions show elevated macro pressure. Sentiment is only a scoring input, so high-upside alerts should receive extra receipt and risk checks."
    : "Market conditions are mixed. Macro and sentiment inputs can adjust scores, but they do not replace company-specific receipts.";
  const sourceReceipts = [
    ...fred.observations.map((item) => ({ source: FRED_SOURCE, label: item.label, date: item.date, value: item.value, sourceUrl: item.sourceUrl })),
    ...cryptoSignals.slice(0, 5).map((signal) => ({ source: signal.source, title: signal.title, receivedAt: signal.receivedAt, sourceUrl: signal.sourceUrl })),
    ...fxSignals.slice(0, 5).map((signal) => ({ source: signal.source, title: signal.title, receivedAt: signal.receivedAt, sourceUrl: signal.sourceUrl })),
  ];
  const payload = { ok: true, status: warnings.length ? "partial" : "complete", overallMarketMood, macroRiskLevel: macro.risk, sectorMood: null, cryptoMood: crypto.mood, fxPressure: fx.pressure, macroSupportScore: macro.score, sentimentSupportScore, riskOffPenalty, profitPotentialAdjustment, confidenceAdjustment, summary, dataFreshness: { fredObservations: fred.observations.length, recentCryptoSignals: cryptoSignals.length, recentFxSignals: fxSignals.length, generatedAt: new Date().toISOString(), warnings }, sourceReceipts, warnings };
  if (process.env.DATABASE_URL) {
    await prisma.macroSentimentSnapshot.create({ data: { snapshotType: "market_sentiment", status: payload.status, overallMarketMood, macroRiskLevel: macro.risk, macroSupportScore: macro.score, sentimentSupportScore, riskOffPenalty, confidenceAdjustment, profitPotentialAdjustment, summary, dataFreshness: payload.dataFreshness as Prisma.InputJsonObject, sourceReceipts: sourceReceipts as Prisma.InputJsonArray, payload: payload as Prisma.InputJsonObject } }).catch(() => undefined);
  }
  return payload;
}
