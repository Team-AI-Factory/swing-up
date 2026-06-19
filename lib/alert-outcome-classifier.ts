export type AlertOutcome = "tracking" | "win" | "neutral" | "loss" | "missing_data";
export type ResultWindow = "result1D" | "result3D" | "result7D" | "result30D" | "result90D";

type PricePointInput = {
  price?: unknown;
  close?: unknown;
  value?: unknown;
  capturedAt?: unknown;
  captured_at?: unknown;
  date?: unknown;
  timestamp?: unknown;
};

export type OutcomePreviewInput = {
  alertId?: unknown;
  id?: unknown;
  ticker?: unknown;
  priceAtAlert?: unknown;
  alertPrice?: unknown;
  entryPrice?: unknown;
  publishedAt?: unknown;
  alertTime?: unknown;
  latestPrice?: unknown;
  priceSnapshots?: PricePointInput[];
  snapshots?: PricePointInput[];
  pricePoints?: PricePointInput[];
};

type NormalizedPoint = { price: number; capturedAt: Date | null };

type WindowResult = {
  windowDays: number;
  price: number | null;
  returnPct: number | null;
  status: AlertOutcome;
  observedAt: string | null;
};

export type OutcomePreview = {
  ok: boolean;
  alertId: string;
  ticker: string;
  priceAtAlert: number | null;
  latestPrice: number | null;
  result1D: WindowResult;
  result3D: WindowResult;
  result7D: WindowResult;
  result30D: WindowResult;
  result90D: WindowResult;
  maxGain: number | null;
  maxDrawdown: number | null;
  outcomePreview: AlertOutcome;
  trackingStatus: string;
  simpleExplanation: string;
  warnings: string[];
};

const WINDOWS = [1, 3, 7, 30, 90] as const;
const WIN_THRESHOLD = 5;
const LOSS_THRESHOLD = -5;
const NEUTRAL_BAND = 2;

function text(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function numberValue(value: unknown) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function dateValue(value: unknown) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}

function pct(from: number, to: number) {
  return round(((to - from) / from) * 100);
}

function classifyReturn(returnPct: number | null): AlertOutcome {
  if (returnPct == null) return "missing_data";
  if (returnPct >= WIN_THRESHOLD) return "win";
  if (returnPct <= LOSS_THRESHOLD) return "loss";
  if (Math.abs(returnPct) <= NEUTRAL_BAND) return "neutral";
  return "tracking";
}

function normalizePoints(input: OutcomePreviewInput): NormalizedPoint[] {
  const raw = input.priceSnapshots ?? input.snapshots ?? input.pricePoints ?? [];
  return raw
    .map((point) => ({
      price: numberValue(point.price ?? point.close ?? point.value),
      capturedAt: dateValue(point.capturedAt ?? point.captured_at ?? point.date ?? point.timestamp),
    }))
    .filter((point): point is NormalizedPoint => point.price != null)
    .sort((a, b) => (a.capturedAt?.getTime() ?? 0) - (b.capturedAt?.getTime() ?? 0));
}

function nearestPoint(points: NormalizedPoint[], alertDate: Date | null, days: number) {
  if (!points.length) return null;
  if (!alertDate) return points[Math.min(days - 1, points.length - 1)] ?? null;
  const target = alertDate.getTime() + days * 24 * 60 * 60 * 1000;
  const tolerance = 18 * 60 * 60 * 1000;
  return points.reduce<NormalizedPoint | null>((best, point) => {
    if (!point.capturedAt) return best;
    const delta = Math.abs(point.capturedAt.getTime() - target);
    if (delta > tolerance) return best;
    if (!best?.capturedAt) return point;
    return delta < Math.abs(best.capturedAt.getTime() - target) ? point : best;
  }, null);
}

function resultFor(points: NormalizedPoint[], base: number | null, alertDate: Date | null, days: number): WindowResult {
  const point = nearestPoint(points, alertDate, days);
  const returnPct = base && point ? pct(base, point.price) : null;
  return {
    windowDays: days,
    price: point?.price ?? null,
    returnPct,
    status: classifyReturn(returnPct),
    observedAt: point?.capturedAt?.toISOString() ?? null,
  };
}

function deriveOutcome(results: WindowResult[], latestReturn: number | null, warnings: string[]): AlertOutcome {
  if (warnings.includes("Missing priceAtAlert; cannot calculate outcome movement.")) return "missing_data";
  const available = results.filter((result) => result.returnPct != null);
  if (!available.length && latestReturn == null) return "missing_data";
  const final = [...available].reverse().find((result) => result.status !== "missing_data");
  const status = final?.status ?? classifyReturn(latestReturn);
  return status === "missing_data" ? "tracking" : status;
}

export function mockOutcomePreviewInput(): OutcomePreviewInput {
  const start = new Date("2026-06-01T14:30:00.000Z");
  const priceSnapshots = [0, 1, 3, 7, 30, 90].map((day, index) => ({
    price: [100, 102.5, 104.2, 108.1, 106.7, 112.3][index],
    capturedAt: new Date(start.getTime() + day * 24 * 60 * 60 * 1000).toISOString(),
  }));
  return { alertId: "mock-alert-outcome-1", ticker: "MOCK", priceAtAlert: 100, publishedAt: start.toISOString(), priceSnapshots };
}

export function classifyAlertOutcome(input: OutcomePreviewInput): OutcomePreview {
  const warnings: string[] = [];
  const alertId = text(input.alertId ?? input.id, "mock-alert-preview");
  const ticker = text(input.ticker, "UNKNOWN").toUpperCase();
  const points = normalizePoints(input);
  const firstPoint = points[0];
  const priceAtAlert = numberValue(input.priceAtAlert ?? input.alertPrice ?? input.entryPrice) ?? firstPoint?.price ?? null;
  const latestPrice = numberValue(input.latestPrice) ?? points.at(-1)?.price ?? null;
  const alertDate = dateValue(input.publishedAt ?? input.alertTime) ?? firstPoint?.capturedAt ?? null;

  if (!priceAtAlert) warnings.push("Missing priceAtAlert; cannot calculate outcome movement.");
  if (!points.length && !latestPrice) warnings.push("Missing price snapshot data; preview is limited.");
  if (points.some((point) => !point.capturedAt)) warnings.push("Some price points are missing timestamps, so time-window matching may be limited.");

  const results = WINDOWS.map((days) => resultFor(points, priceAtAlert, alertDate, days));
  const returns = priceAtAlert ? points.map((point) => pct(priceAtAlert, point.price)) : [];
  const maxGain = returns.length ? Math.max(...returns) : null;
  const maxDrawdown = returns.length ? Math.min(...returns) : null;
  const latestReturn = priceAtAlert && latestPrice ? pct(priceAtAlert, latestPrice) : null;
  const outcomePreview = deriveOutcome(results, latestReturn, warnings);
  const availableWindows = results.filter((result) => result.returnPct != null).length;
  const trackingStatus = outcomePreview === "missing_data" ? "missing price data" : availableWindows < WINDOWS.length ? "tracking with partial windows" : "all configured windows available";
  const simpleExplanation = outcomePreview === "missing_data"
    ? "There is not enough price evidence to classify this alert preview. No ledger records were updated."
    : `${ticker} is reviewed from ${priceAtAlert} to ${latestPrice ?? "the latest available snapshot"}. The preview uses observed price snapshots only and does not publish or predict an alert.`;

  return {
    ok: true,
    alertId,
    ticker,
    priceAtAlert,
    latestPrice,
    result1D: results[0],
    result3D: results[1],
    result7D: results[2],
    result30D: results[3],
    result90D: results[4],
    maxGain,
    maxDrawdown,
    outcomePreview,
    trackingStatus,
    simpleExplanation,
    warnings,
  };
}
