import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";

export const FRED_SOURCE = "FRED Macro";

const FRED_GRAPH_CSV_URL = "https://fred.stlouisfed.org/graph/fredgraph.csv";
const REQUEST_TIMEOUT_MS = 10_000;

const SERIES = [
  { id: "FEDFUNDS", label: "Federal funds rate", kind: "policy_rate" },
  { id: "CPIAUCSL", label: "Consumer Price Index", kind: "inflation_proxy" },
  { id: "UNRATE", label: "Unemployment rate", kind: "labor_market" },
  { id: "GDPC1", label: "Real GDP", kind: "growth_proxy" },
  { id: "DGS10", label: "10-year Treasury yield", kind: "treasury_yield" },
] as const;

type FredPoint = { seriesId: string; label: string; kind: string; date: string | null; value: number | null; sourceUrl: string };
export type FredRunResult = { ok: boolean; source: typeof FRED_SOURCE; dryRun: boolean; status: "complete" | "partial"; observations: FredPoint[]; warnings: string[]; responseTimeMs: number; persisted: boolean };

function safeError(error: unknown) {
  return error instanceof Error ? error.message.split("\n")[0]?.slice(0, 180) || "FRED request failed" : "FRED request failed";
}

function parseLatest(csv: string, seriesId: string) {
  const rows = csv.trim().split(/\r?\n/).slice(1);
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const [date, rawValue] = rows[index]?.split(",") ?? [];
    const value = Number(rawValue);
    if (date && Number.isFinite(value)) return { date, value };
  }
  throw new Error(`FRED returned no usable observations for ${seriesId}`);
}

async function fetchSeries(series: (typeof SERIES)[number], signal: AbortSignal): Promise<FredPoint> {
  const url = `${FRED_GRAPH_CSV_URL}?id=${encodeURIComponent(series.id)}`;
  const response = await fetch(url, { cache: "no-store", signal, headers: { Accept: "text/csv" } });
  if (!response.ok) throw new Error(`FRED ${series.id} request failed with status ${response.status}`);
  const latest = parseLatest(await response.text(), series.id);
  return { seriesId: series.id, label: series.label, kind: series.kind, date: latest.date, value: latest.value, sourceUrl: url };
}

async function updateFredHealth(status: "connected" | "degraded" | "error", startedAt: number, errorMessage: string | null, notes: string) {
  if (!process.env.DATABASE_URL) return;
  await prisma.sourceHealth.upsert({
    where: { source: FRED_SOURCE },
    create: { source: FRED_SOURCE, status, checkedAt: new Date(), lastSuccessAt: status === "error" ? null : new Date(), responseTimeMs: Date.now() - startedAt, errorMessage, usage: "FRED macro series; FRED_API_KEY detected for production readiness, fredgraph CSV used for tiny smoke checks", notes },
    update: { status, checkedAt: new Date(), lastSuccessAt: status === "error" ? undefined : new Date(), responseTimeMs: Date.now() - startedAt, errorMessage, usage: "FRED macro series; FRED_API_KEY detected for production readiness, fredgraph CSV used for tiny smoke checks", notes },
  });
}

async function persistFredSnapshot(result: Omit<FredRunResult, "persisted">) {
  if (!process.env.DATABASE_URL || result.dryRun) return false;
  try {
    await prisma.macroSentimentSnapshot.create({
      data: { snapshotType: "fred_macro", status: result.status, summary: `FRED macro snapshot captured ${result.observations.length}/${SERIES.length} supported series.`, dataFreshness: result.observations, sourceReceipts: result.observations.map(({ label, sourceUrl, date }) => ({ source: FRED_SOURCE, label, sourceUrl, date })), payload: result as Prisma.InputJsonObject },
    });
    return true;
  } catch {
    return false;
  }
}

export async function runFredIngestion(options: { dryRun?: boolean } = {}): Promise<FredRunResult> {
  const startedAt = Date.now();
  const warnings: string[] = [];
  const observations: FredPoint[] = [];
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const settled = await Promise.allSettled(SERIES.map((series) => fetchSeries(series, controller.signal)));
    settled.forEach((item) => item.status === "fulfilled" ? observations.push(item.value) : warnings.push(safeError(item.reason)));
  } finally {
    clearTimeout(timeout);
  }
  const status: FredRunResult["status"] = observations.length === SERIES.length ? "complete" : "partial";
  const ok = observations.length > 0;
  const responseTimeMs = Date.now() - startedAt;
  await updateFredHealth(ok ? (status === "complete" ? "connected" : "degraded") : "error", startedAt, warnings[0] ?? null, ok ? `${process.env.FRED_API_KEY?.trim() ? "FRED_API_KEY detected. " : "FRED_API_KEY missing. "}FRED macro snapshot ${status}; observations=${observations.length}/${SERIES.length}.` : "FRED macro snapshot failed without usable observations.").catch(() => undefined);
  const base: Omit<FredRunResult, "persisted"> = { ok, source: FRED_SOURCE, dryRun: Boolean(options.dryRun), status, observations, warnings, responseTimeMs };
  return { ...base, persisted: await persistFredSnapshot(base) };
}
