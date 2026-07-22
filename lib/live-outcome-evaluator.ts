import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { fetchLiveCryptoPriceSeries, resolveLiveCryptoAsset, type LivePricePoint } from "@/lib/live-crypto-market";

type EvaluatorInput = { dryRun?: unknown; confirmUpdate?: unknown; ledgerId?: unknown; limit?: unknown };
type OutcomeLabel = "tracking" | "win" | "neutral" | "loss" | "needs_more_data";
type Checkpoint = { days: 1 | 3 | 7 | 30 | 90; key: "result1D" | "result3D" | "result7D" | "result30D" | "result90D" };

const DAY_MS = 24 * 60 * 60 * 1000;
const CHECKPOINTS: Checkpoint[] = [
  { days: 1, key: "result1D" },
  { days: 3, key: "result3D" },
  { days: 7, key: "result7D" },
  { days: 30, key: "result30D" },
  { days: 90, key: "result90D" },
];

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function bool(value: unknown, fallback: boolean) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value.toLowerCase() === "true" ? true : value.toLowerCase() === "false" ? false : fallback;
  return fallback;
}

function limitValue(value: unknown) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 25) : 10;
}

function rounded(value: number) {
  return Math.round(value * 100) / 100;
}

function returnPct(from: number, to: number) {
  return rounded(((to - from) / from) * 100);
}

function nearest(points: LivePricePoint[], target: Date, toleranceHours = 36) {
  const tolerance = toleranceHours * 60 * 60 * 1000;
  return points.reduce<LivePricePoint | null>((best, point) => {
    const delta = Math.abs(point.capturedAt.getTime() - target.getTime());
    if (delta > tolerance) return best;
    return !best || delta < Math.abs(best.capturedAt.getTime() - target.getTime()) ? point : best;
  }, null);
}

export function evaluateLiveOutcomeSeries(input: { publishedAt: Date; now: Date; points: LivePricePoint[] }) {
  const points = [...input.points].sort((a, b) => a.capturedAt.getTime() - b.capturedAt.getTime());
  const priceAtAlertPoint = nearest(points, input.publishedAt);
  const priceAtAlert = priceAtAlertPoint?.price ?? null;
  const due = CHECKPOINTS.filter((checkpoint) => input.now.getTime() >= input.publishedAt.getTime() + checkpoint.days * DAY_MS);
  const checkpoints = Object.fromEntries(CHECKPOINTS.map((checkpoint) => {
    const point = due.includes(checkpoint) ? nearest(points, new Date(input.publishedAt.getTime() + checkpoint.days * DAY_MS)) : null;
    return [checkpoint.key, {
      days: checkpoint.days,
      due: due.includes(checkpoint),
      price: point?.price ?? null,
      observedAt: point?.capturedAt.toISOString() ?? null,
      returnPct: priceAtAlert && point ? returnPct(priceAtAlert, point.price) : null,
    }];
  })) as Record<Checkpoint["key"], { days: number; due: boolean; price: number | null; observedAt: string | null; returnPct: number | null }>;
  const observed = points.filter((point) => point.capturedAt >= input.publishedAt && point.capturedAt <= input.now);
  const returns = priceAtAlert ? observed.map((point) => returnPct(priceAtAlert, point.price)) : [];
  const dueFound = due.filter((checkpoint) => checkpoints[checkpoint.key].returnPct !== null).length;
  const coverage = due.length ? rounded((dueFound / due.length) * 100) : priceAtAlert ? 100 : 0;
  const ninetyDay = checkpoints.result90D.returnPct;
  let outcome: OutcomeLabel = "tracking";
  if (!priceAtAlert || dueFound < due.length) outcome = "needs_more_data";
  else if (ninetyDay !== null) outcome = ninetyDay >= 5 ? "win" : ninetyDay <= -5 ? "loss" : "neutral";
  return {
    priceAtAlert,
    priceAtAlertObservedAt: priceAtAlertPoint?.capturedAt.toISOString() ?? null,
    latestPrice: observed.at(-1)?.price ?? priceAtAlert,
    latestObservedAt: observed.at(-1)?.capturedAt.toISOString() ?? priceAtAlertPoint?.capturedAt.toISOString() ?? null,
    checkpoints,
    maxGain: returns.length ? Math.max(...returns) : null,
    maxDrawdown: returns.length ? Math.min(...returns) : null,
    checkpointCoverage: coverage,
    outcome,
    dueCheckpointCount: due.length,
    completedCheckpointCount: dueFound,
  };
}

async function persistHistoricalOutcome(params: {
  alert: { ticker: string; company: string; event: string; publishedAt: Date | null };
  result: ReturnType<typeof evaluateLiveOutcomeSeries>;
  sourceUrl: string | null;
}) {
  const eventDate = params.alert.publishedAt ?? new Date();
  const existing = await prisma.historicalEvent.findFirst({
    where: { ticker: params.alert.ticker, eventDate, title: params.alert.event },
  });
  const data = {
    ticker: params.alert.ticker,
    companyName: params.alert.company,
    eventType: "swing_up_alert",
    eventDate,
    title: params.alert.event,
    summary: params.alert.event,
    source: "Swing Up verified public ledger",
    sourceUrl: params.sourceUrl,
    sourceReceipts: params.sourceUrl ? [params.sourceUrl] : [],
    priceBefore: params.result.priceAtAlert == null ? null : new Prisma.Decimal(params.result.priceAtAlert),
    priceAfter1d: params.result.checkpoints.result1D.price == null ? null : new Prisma.Decimal(params.result.checkpoints.result1D.price),
    priceAfter3d: params.result.checkpoints.result3D.price == null ? null : new Prisma.Decimal(params.result.checkpoints.result3D.price),
    priceAfter7d: params.result.checkpoints.result7D.price == null ? null : new Prisma.Decimal(params.result.checkpoints.result7D.price),
    priceAfter30d: params.result.checkpoints.result30D.price == null ? null : new Prisma.Decimal(params.result.checkpoints.result30D.price),
    priceAfter90d: params.result.checkpoints.result90D.price == null ? null : new Prisma.Decimal(params.result.checkpoints.result90D.price),
    maxGain: params.result.maxGain == null ? null : new Prisma.Decimal(params.result.maxGain),
    maxDrawdown: params.result.maxDrawdown == null ? null : new Prisma.Decimal(params.result.maxDrawdown),
    outcomeLabel: params.result.outcome,
    forwardReturns: Object.fromEntries(Object.entries(params.result.checkpoints).map(([key, value]) => [key, value.returnPct])),
    notes: `Outcome built only from verified CoinGecko prices. Checkpoint coverage ${params.result.checkpointCoverage}%.`,
  };
  if (existing) return prisma.historicalEvent.update({ where: { id: existing.id }, data });
  return prisma.historicalEvent.create({ data });
}

export async function runLiveOutcomeEvaluator(input: EvaluatorInput = {}) {
  const dryRun = bool(input.dryRun, true);
  const confirmUpdate = bool(input.confirmUpdate, false);
  const ledgerId = typeof input.ledgerId === "string" ? input.ledgerId.trim() : "";
  if (!dryRun && !confirmUpdate) return { ok: false, dryRun, error: "confirmUpdate=true is required for live database writes.", checked: 0, updated: 0, results: [] };
  const rows = await prisma.publicLedger.findMany({
    where: ledgerId ? { id: ledgerId } : undefined,
    include: { alert: true },
    orderBy: { createdAt: "asc" },
    take: ledgerId ? 1 : limitValue(input.limit),
  });
  const now = new Date();
  const results: Array<Record<string, unknown>> = [];
  let updated = 0;
  for (const row of rows) {
    const entry = record(row.entry);
    const alert = row.alert;
    const ticker = String(entry.ticker ?? alert?.ticker ?? "").trim().toUpperCase();
    const publishedAt = alert?.publishedAt ?? row.createdAt;
    const explicitAssetId = typeof entry.coingeckoId === "string" ? entry.coingeckoId : null;
    const asset = resolveLiveCryptoAsset(ticker, explicitAssetId);
    if (!alert || !asset) {
      results.push({ ledgerId: row.id, ticker: ticker || null, ok: false, outcome: "needs_more_data", error: alert ? "unsupported_crypto_asset" : "alert_relation_missing" });
      continue;
    }
    const rangeEnd = new Date(Math.min(now.getTime(), publishedAt.getTime() + 91 * DAY_MS));
    const series = await fetchLiveCryptoPriceSeries(ticker, new Date(publishedAt.getTime() - 12 * 60 * 60 * 1000), rangeEnd, asset.id);
    if (!series.ok) {
      results.push({ ledgerId: row.id, ticker, assetId: asset.id, ok: false, outcome: "needs_more_data", error: series.error, rateLimited: series.rateLimited });
      continue;
    }
    const result = evaluateLiveOutcomeSeries({ publishedAt, now, points: series.points });
    const nextEntry: Prisma.InputJsonObject = {
      ...entry,
      ticker,
      assetType: "crypto",
      coingeckoId: asset.id,
      priceProvider: series.provider,
      priceSourceUrl: series.sourceUrl,
      priceDataQuality: "live",
      priceAtAlert: result.priceAtAlert,
      latestPrice: result.latestPrice,
      latestPriceObservedAt: result.latestObservedAt,
      result1D: result.checkpoints.result1D.returnPct,
      result3D: result.checkpoints.result3D.returnPct,
      result7D: result.checkpoints.result7D.returnPct,
      result30D: result.checkpoints.result30D.returnPct,
      result90D: result.checkpoints.result90D.returnPct,
      checkpointPrices: result.checkpoints,
      checkpointCoverage: result.checkpointCoverage,
      maxGain: result.maxGain,
      maxDrawdown: result.maxDrawdown,
      outcome: result.outcome,
      tracking: result.outcome === "tracking" || result.outcome === "needs_more_data",
      outcomeUpdatedAt: now.toISOString(),
      result: result.outcome === "needs_more_data" ? "Verified live price history is incomplete; no outcome was inferred." : `Verified CoinGecko outcome is ${result.outcome}; checkpoint coverage ${result.checkpointCoverage}%.`,
    };
    if (!dryRun) {
      const snapshotPoints = [
        result.priceAtAlert && result.priceAtAlertObservedAt ? { price: result.priceAtAlert, capturedAt: new Date(result.priceAtAlertObservedAt) } : null,
        ...Object.values(result.checkpoints).filter((checkpoint) => checkpoint.price !== null && checkpoint.observedAt).map((checkpoint) => ({ price: checkpoint.price!, capturedAt: new Date(checkpoint.observedAt!) })),
      ].filter((point): point is { price: number; capturedAt: Date } => Boolean(point));
      await prisma.priceSnapshot.createMany({
        data: snapshotPoints.map((point) => ({ alertId: alert.id, ticker, price: new Prisma.Decimal(point.price), capturedAt: point.capturedAt, provider: series.provider, providerAssetId: asset.id, currency: series.currency, sourceUrl: series.sourceUrl, dataQuality: "live" })),
        skipDuplicates: true,
      });
      await prisma.publicLedger.update({ where: { id: row.id }, data: { entry: nextEntry } });
      await persistHistoricalOutcome({ alert: { ticker: alert.ticker, company: alert.company, event: alert.event, publishedAt }, result, sourceUrl: series.sourceUrl });
      updated += 1;
    }
    results.push({ ledgerId: row.id, alertId: alert.id, ticker, assetId: asset.id, ok: true, dryRun, outcome: result.outcome, checkpointCoverage: result.checkpointCoverage, maxGain: result.maxGain, maxDrawdown: result.maxDrawdown, checkpoints: result.checkpoints, sourceUrl: series.sourceUrl });
  }
  return { ok: results.every((result) => result.ok !== false), dryRun, checked: rows.length, updated, provider: "coingecko", realPricesOnly: true, results };
}
