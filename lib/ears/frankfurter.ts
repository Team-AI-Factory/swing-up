import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";

export const FRANKFURTER_SOURCE = "Frankfurter FX";

const FRANKFURTER_LATEST_URL = "https://api.frankfurter.app/latest";
const BASE_CURRENCY = "EUR";
const TRACKED_CURRENCIES = ["USD", "EUR", "GBP", "JPY", "CHF", "CAD", "AUD", "CNY", "HKD", "SGD", "THB"] as const;
const QUOTE_CURRENCIES = TRACKED_CURRENCIES.filter((currency) => currency !== BASE_CURRENCY);
const COOLDOWN_MS = 15 * 60_000;
const STRONG_MOVE_THRESHOLD = 0.0075;
const REFERENCE_UPDATE_MS = 6 * 60 * 60_000;
const REQUEST_TIMEOUT_MS = 10_000;

export type FrankfurterRunOptions = { dryRun?: boolean; force?: boolean };
export type FrankfurterRunResult = {
  ok: boolean;
  source: typeof FRANKFURTER_SOURCE;
  dryRun: boolean;
  skipped: boolean;
  skipReason: string | null;
  base: string;
  date: string | null;
  pairsChecked: number;
  signalsCreated: number;
  strongMoves: number;
  referenceUpdates: number;
  rateLimited: boolean;
  responseTimeMs: number;
  errors: string[];
};

type FrankfurterLatestResponse = {
  amount?: number;
  base?: string;
  date?: string;
  rates?: Record<string, number>;
};

type FxPairSnapshot = {
  pair: string;
  base: string;
  quote: string;
  rate: number;
  previousRate: number | null;
  pctChange: number | null;
  strongMove: boolean;
};

function safeError(error: unknown) {
  return error instanceof Error
    ? error.message.split("\n")[0]?.slice(0, 180) || "Frankfurter FX request failed"
    : "Frankfurter FX request failed";
}

function isRateLimitMessage(message: string) {
  const lower = message.toLowerCase();
  return lower.includes("429") || lower.includes("rate limit") || lower.includes("too many requests");
}

function parseDryNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

async function fetchLatestRates(signal: AbortSignal) {
  const symbols = QUOTE_CURRENCIES.join(",");
  const response = await fetch(`${FRANKFURTER_LATEST_URL}?from=${BASE_CURRENCY}&to=${symbols}`, {
    cache: "no-store",
    signal,
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(`Frankfurter FX request failed with status ${response.status}`);
  }

  const body = (await response.json()) as FrankfurterLatestResponse;
  if (!body.rates || body.base !== BASE_CURRENCY) {
    throw new Error("Frankfurter FX returned an unexpected latest-rates payload");
  }

  return body;
}

function buildRateTable(rates: Record<string, number>) {
  const table: Record<string, number> = { [BASE_CURRENCY]: 1 };
  for (const currency of QUOTE_CURRENCIES) {
    const rate = parseDryNumber(rates[currency]);
    if (rate) table[currency] = rate;
  }
  return table;
}

function deriveRate(table: Record<string, number>, base: string, quote: string) {
  const baseToEur = table[base];
  const quoteToEur = table[quote];
  if (!baseToEur || !quoteToEur) return null;
  return quoteToEur / baseToEur;
}

function selectedPairs(table: Record<string, number>) {
  const pairs = [
    ["EUR", "USD"],
    ["EUR", "GBP"],
    ["EUR", "JPY"],
    ["USD", "JPY"],
    ["USD", "CHF"],
    ["USD", "CAD"],
    ["AUD", "USD"],
    ["USD", "CNY"],
    ["USD", "HKD"],
    ["USD", "SGD"],
    ["USD", "THB"],
  ];

  return pairs.flatMap(([base, quote]) => {
    const rate = deriveRate(table, base, quote);
    return rate ? [{ pair: `${base}${quote}`, base, quote, rate }] : [];
  });
}

function hasDatabaseUrl() {
  return Boolean(process.env.DATABASE_URL);
}

async function latestSavedFxSignal() {
  if (!hasDatabaseUrl()) return null;

  return prisma.rawSignal.findFirst({
    where: { source: FRANKFURTER_SOURCE, signalType: "fx_context" },
    orderBy: { receivedAt: "desc" },
    select: { receivedAt: true, payload: true },
  });
}

function previousRatesFromPayload(payload: Prisma.JsonValue) {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload) || !("rates" in payload)) return new Map<string, number>();
  const rates = (payload as { rates?: unknown }).rates;
  if (!Array.isArray(rates)) return new Map<string, number>();

  return new Map(
    rates.flatMap((item) => {
      if (typeof item !== "object" || item === null || Array.isArray(item)) return [];
      const pair = (item as { pair?: unknown }).pair;
      const rate = (item as { rate?: unknown }).rate;
      return typeof pair === "string" && typeof rate === "number" ? [[pair, rate] as const] : [];
    }),
  );
}

async function existingTodaySignal(date: string) {
  if (!hasDatabaseUrl()) return false;

  const existing = await prisma.rawSignal.findFirst({
    where: { source: FRANKFURTER_SOURCE, signalType: "fx_context", title: { contains: date } },
    select: { id: true },
  });
  return Boolean(existing);
}

async function getExistingHealth() {
  if (!hasDatabaseUrl()) return null;

  return prisma.sourceHealth.findUnique({ where: { source: FRANKFURTER_SOURCE }, select: { checkedAt: true, notes: true } });
}

function isCooldownActive(checkedAt?: Date | null) {
  return checkedAt ? Date.now() - checkedAt.getTime() < COOLDOWN_MS : false;
}

async function updateFrankfurterSourceHealth(status: "connected" | "degraded" | "error", startedAt: number, errorMessage: string | null, notes: string) {
  if (!hasDatabaseUrl()) return;

  const now = new Date();
  await prisma.sourceHealth.upsert({
    where: { source: FRANKFURTER_SOURCE },
    create: {
      source: FRANKFURTER_SOURCE,
      status,
      checkedAt: now,
      lastSuccessAt: status === "connected" || status === "degraded" ? now : null,
      responseTimeMs: Date.now() - startedAt,
      errorMessage,
      usage: "Public Frankfurter latest FX rates; no API key required",
      notes,
    },
    update: {
      status,
      checkedAt: now,
      lastSuccessAt: status === "connected" || status === "degraded" ? now : undefined,
      responseTimeMs: Date.now() - startedAt,
      errorMessage,
      usage: "Public Frankfurter latest FX rates; no API key required",
      notes,
    },
  });
}

async function createFxSignal(snapshots: FxPairSnapshot[], date: string, dryRun: boolean) {
  const strongMoves = snapshots.filter((snapshot) => snapshot.strongMove);
  const importanceHint = strongMoves.length ? "medium" : "low";
  const title = strongMoves.length ? `Frankfurter FX strong context ${date}` : `Frankfurter FX reference update ${date}`;
  const summary = strongMoves.length
    ? `Frankfurter latest rates show ${strongMoves.length} tracked FX pair move above ${(STRONG_MOVE_THRESHOLD * 100).toFixed(2)}%. This is market context, not a direct stock alert.`
    : "Frankfurter latest rates captured as low-importance FX market context, not a direct stock alert.";

  if (dryRun || !hasDatabaseUrl()) return false;

  await prisma.rawSignal.create({
    data: {
      source: FRANKFURTER_SOURCE,
      ticker: strongMoves[0]?.pair ?? "EURUSD",
      signalType: "fx_context",
      title,
      summary,
      sourceUrl: `${FRANKFURTER_LATEST_URL}?from=${BASE_CURRENCY}&to=${QUOTE_CURRENCIES.join(",")}`,
      processedStatus: "new",
      importanceHint,
      payload: {
        base: BASE_CURRENCY,
        date,
        trackedCurrencies: TRACKED_CURRENCIES,
        threshold: STRONG_MOVE_THRESHOLD,
        rates: snapshots,
        note: "FX is market context only. This ear does not create final alerts.",
      } satisfies Prisma.InputJsonValue,
    },
  });
  return true;
}

export async function runFrankfurterIngestion(options: FrankfurterRunOptions = {}): Promise<FrankfurterRunResult> {
  const startedAt = Date.now();
  const errors: string[] = [];
  const dryRun = Boolean(options.dryRun);
  const existingHealth = await getExistingHealth();

  if (!options.force && isCooldownActive(existingHealth?.checkedAt)) {
    return {
      ok: true,
      source: FRANKFURTER_SOURCE,
      dryRun,
      skipped: true,
      skipReason: "cooldown_active",
      base: BASE_CURRENCY,
      date: null,
      pairsChecked: 0,
      signalsCreated: 0,
      strongMoves: 0,
      referenceUpdates: 0,
      rateLimited: false,
      responseTimeMs: Date.now() - startedAt,
      errors,
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const latest = await fetchLatestRates(controller.signal);
    const table = buildRateTable(latest.rates ?? {});
    const previous = await latestSavedFxSignal();
    const previousRates = previousRatesFromPayload(previous?.payload ?? {});
    const snapshots = selectedPairs(table).map((current) => {
      const previousRate = previousRates.get(current.pair) ?? null;
      const pctChange = previousRate ? (current.rate - previousRate) / previousRate : null;
      return { ...current, previousRate, pctChange, strongMove: Math.abs(pctChange ?? 0) >= STRONG_MOVE_THRESHOLD };
    });
    const strongMoves = snapshots.filter((snapshot) => snapshot.strongMove).length;
    const lastSavedAt = previous?.receivedAt?.getTime() ?? 0;
    const referenceDue = Date.now() - lastSavedAt >= REFERENCE_UPDATE_MS;
    const alreadySavedForDate = latest.date ? await existingTodaySignal(latest.date) : false;
    const shouldSave = Boolean(strongMoves || (referenceDue && !alreadySavedForDate));
    const created = shouldSave ? await createFxSignal(snapshots, latest.date ?? new Date().toISOString().slice(0, 10), dryRun) : false;

    await updateFrankfurterSourceHealth(
      "connected",
      startedAt,
      null,
      shouldSave
        ? `Frankfurter FX latest rates connected; useful_context=${strongMoves ? "strong_move" : "reference_update"}.`
        : "Frankfurter FX latest rates connected; no useful new raw signal needed during this run.",
    );

    return {
      ok: true,
      source: FRANKFURTER_SOURCE,
      dryRun,
      skipped: false,
      skipReason: null,
      base: latest.base ?? BASE_CURRENCY,
      date: latest.date ?? null,
      pairsChecked: snapshots.length,
      signalsCreated: created ? 1 : 0,
      strongMoves,
      referenceUpdates: shouldSave && !strongMoves ? 1 : 0,
      rateLimited: false,
      responseTimeMs: Date.now() - startedAt,
      errors,
    };
  } catch (error) {
    const safe = safeError(error);
    const rateLimited = isRateLimitMessage(safe);
    errors.push(rateLimited ? "Frankfurter FX rate-limited this server." : safe);
    await updateFrankfurterSourceHealth(
      rateLimited ? "degraded" : "error",
      startedAt,
      errors[0],
      rateLimited ? "Frankfurter FX is temporarily degraded by rate limiting." : "Frankfurter FX latest rates failed on a hard request error.",
    );

    return {
      ok: rateLimited,
      source: FRANKFURTER_SOURCE,
      dryRun,
      skipped: false,
      skipReason: null,
      base: BASE_CURRENCY,
      date: null,
      pairsChecked: 0,
      signalsCreated: 0,
      strongMoves: 0,
      referenceUpdates: 0,
      rateLimited,
      responseTimeMs: Date.now() - startedAt,
      errors,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function getFrankfurterSourceHealth() {
  if (!hasDatabaseUrl()) {
    return {
      source: FRANKFURTER_SOURCE,
      status: "not_configured",
      lastChecked: null,
      lastSuccess: null,
      responseTimeMs: null,
      lastError: null,
      usage: "Public Frankfurter latest FX rates; no API key required",
      notes: "DATABASE_URL is not configured, so Frankfurter FX source health cannot be persisted in this environment.",
      cooldownActive: false,
    };
  }

  const row = await prisma.sourceHealth.findUnique({ where: { source: FRANKFURTER_SOURCE } });

  return row
    ? {
        source: row.source,
        status: row.status,
        lastChecked: row.checkedAt.toISOString(),
        lastSuccess: row.lastSuccessAt?.toISOString() ?? null,
        responseTimeMs: row.responseTimeMs,
        lastError: row.errorMessage ? row.errorMessage.slice(0, 240) : null,
        usage: row.usage,
        notes: row.notes,
        cooldownActive: isCooldownActive(row.checkedAt),
      }
    : {
        source: FRANKFURTER_SOURCE,
        status: "stubbed",
        lastChecked: null,
        lastSuccess: null,
        responseTimeMs: null,
        lastError: null,
        usage: "Public Frankfurter latest FX rates; no API key required",
        notes: "Frankfurter FX has not been checked yet.",
        cooldownActive: false,
      };
}
