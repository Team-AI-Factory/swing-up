export type PriceTrackingWindow = "alert" | "1D" | "3D" | "7D" | "30D" | "90D";
export type PriceTrackingStatus = "tracking" | "complete" | "missing_data";
export type PriceOutcomePreview = "win" | "neutral" | "loss" | "tracking";

export type PriceSnapshotInput = {
  timestamp?: string;
  capturedAt?: string;
  price?: number;
  close?: number;
  value?: number;
};

export type PriceSnapshotAlertInput = {
  alertId?: string;
  ticker?: string;
  alertTime?: string;
  publishedAt?: string;
  priceAtAlert?: number;
};

export type PriceSnapshotPreviewInput = {
  alert?: PriceSnapshotAlertInput;
  snapshots?: PriceSnapshotInput[];
};

export type PriceSnapshotPreview = {
  ok: true;
  alertId: string;
  ticker: string;
  priceAtAlert: number | null;
  latestPrice: number | null;
  priceAfter1D: number | null;
  priceAfter3D: number | null;
  priceAfter7D: number | null;
  priceAfter30D: number | null;
  priceAfter90D: number | null;
  maxGain: number | null;
  maxDrawdown: number | null;
  trackingStatus: PriceTrackingStatus;
  outcomePreview: PriceOutcomePreview;
  warnings: string[];
  simpleExplanation: string;
};

type NormalizedSnapshot = { timestamp: string; timeMs: number; price: number };

const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOWS: Array<{ key: Exclude<PriceTrackingWindow, "alert">; days: number }> = [
  { key: "1D", days: 1 },
  { key: "3D", days: 3 },
  { key: "7D", days: 7 },
  { key: "30D", days: 30 },
  { key: "90D", days: 90 },
];

export const mockPriceSnapshotInput: PriceSnapshotPreviewInput = {
  alert: {
    alertId: "mock-alert-price-001",
    ticker: "MOCK",
    alertTime: "2026-01-01T14:30:00.000Z",
    priceAtAlert: 100,
  },
  snapshots: [
    { timestamp: "2026-01-01T14:30:00.000Z", price: 100 },
    { timestamp: "2026-01-02T14:30:00.000Z", price: 103 },
    { timestamp: "2026-01-04T14:30:00.000Z", price: 98 },
    { timestamp: "2026-01-08T14:30:00.000Z", price: 109 },
    { timestamp: "2026-01-31T14:30:00.000Z", price: 112 },
    { timestamp: "2026-04-01T14:30:00.000Z", price: 107 },
  ],
};

function asCleanString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asFinitePositiveNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function normalizeSnapshots(snapshots: unknown, warnings: string[]): NormalizedSnapshot[] {
  if (!Array.isArray(snapshots)) {
    warnings.push("No snapshot array was provided; price tracking cannot be completed.");
    return [];
  }

  return snapshots
    .map((snapshot): NormalizedSnapshot | null => {
      if (!snapshot || typeof snapshot !== "object") return null;
      const input = snapshot as PriceSnapshotInput;
      const timestamp = asCleanString(input.timestamp) ?? asCleanString(input.capturedAt);
      const price = asFinitePositiveNumber(input.price) ?? asFinitePositiveNumber(input.close) ?? asFinitePositiveNumber(input.value);
      const timeMs = timestamp ? Date.parse(timestamp) : Number.NaN;
      if (!timestamp || Number.isNaN(timeMs) || price === null) return null;
      return { timestamp: new Date(timeMs).toISOString(), timeMs, price };
    })
    .filter((snapshot): snapshot is NormalizedSnapshot => snapshot !== null)
    .sort((a, b) => a.timeMs - b.timeMs);
}

function priceAtOrAfter(snapshots: NormalizedSnapshot[], targetMs: number): number | null {
  return snapshots.find((snapshot) => snapshot.timeMs >= targetMs)?.price ?? null;
}

function percentChange(from: number, to: number): number {
  return Math.round(((to - from) / from) * 10000) / 100;
}

function buildExplanation(status: PriceTrackingStatus, outcome: PriceOutcomePreview) {
  if (status === "missing_data") return "Preview-only tracker could not find enough mock price snapshots to summarize the alert window.";
  if (status === "tracking") return "Preview-only tracker has partial mock snapshot coverage and will remain in tracking until later windows have data.";
  return `Preview-only tracker found mock snapshot coverage through 90D and currently labels the sample outcome as ${outcome}. This does not predict future price movement.`;
}

export function buildPriceSnapshotPreview(input: PriceSnapshotPreviewInput): PriceSnapshotPreview {
  const warnings: string[] = ["Preview only; no real alert is published and no public ledger outcome is changed."];
  const alert = input.alert ?? {};
  const alertId = asCleanString(alert.alertId) ?? "mock-alert-preview";
  const ticker = (asCleanString(alert.ticker) ?? "MOCK").toUpperCase();
  const alertTime = asCleanString(alert.alertTime) ?? asCleanString(alert.publishedAt);
  const alertMs = alertTime ? Date.parse(alertTime) : Number.NaN;

  if (!alertTime || Number.isNaN(alertMs)) warnings.push("Missing or invalid alert time; window prices cannot be aligned.");

  const snapshots = normalizeSnapshots(input.snapshots, warnings);
  const priceAtAlert = asFinitePositiveNumber(alert.priceAtAlert) ?? (Number.isNaN(alertMs) ? null : priceAtOrAfter(snapshots, alertMs));
  if (priceAtAlert === null) warnings.push("Missing price at alert; gain and drawdown percentages cannot be calculated.");

  const pricesByWindow = Object.fromEntries(
    WINDOWS.map(({ key, days }) => [key, !Number.isNaN(alertMs) ? priceAtOrAfter(snapshots, alertMs + days * DAY_MS) : null]),
  ) as Record<Exclude<PriceTrackingWindow, "alert">, number | null>;

  const latestPrice = snapshots.at(-1)?.price ?? null;
  const comparableSnapshots = priceAtAlert === null || Number.isNaN(alertMs) ? [] : snapshots.filter((snapshot) => snapshot.timeMs >= alertMs);
  const maxGain = priceAtAlert === null || !comparableSnapshots.length ? null : Math.max(...comparableSnapshots.map((snapshot) => percentChange(priceAtAlert, snapshot.price)));
  const maxDrawdown = priceAtAlert === null || !comparableSnapshots.length ? null : Math.min(...comparableSnapshots.map((snapshot) => percentChange(priceAtAlert, snapshot.price)));

  const hasCoreData = priceAtAlert !== null && latestPrice !== null && snapshots.length > 0 && !Number.isNaN(alertMs);
  const hasAnyFutureWindow = Object.values(pricesByWindow).some((price) => price !== null);
  const hasAllWindows = Object.values(pricesByWindow).every((price) => price !== null);
  const trackingStatus: PriceTrackingStatus = !hasCoreData || !hasAnyFutureWindow ? "missing_data" : hasAllWindows ? "complete" : "tracking";
  const outcomePreview: PriceOutcomePreview = trackingStatus !== "complete" || maxGain === null || maxDrawdown === null ? "tracking" : maxGain >= 5 ? "win" : maxDrawdown <= -5 ? "loss" : "neutral";

  if (trackingStatus !== "complete") warnings.push("Not enough mock snapshot coverage exists for every tracking window yet.");

  return {
    ok: true,
    alertId,
    ticker,
    priceAtAlert,
    latestPrice,
    priceAfter1D: pricesByWindow["1D"],
    priceAfter3D: pricesByWindow["3D"],
    priceAfter7D: pricesByWindow["7D"],
    priceAfter30D: pricesByWindow["30D"],
    priceAfter90D: pricesByWindow["90D"],
    maxGain,
    maxDrawdown,
    trackingStatus,
    outcomePreview,
    warnings,
    simpleExplanation: buildExplanation(trackingStatus, outcomePreview),
  };
}
