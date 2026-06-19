import { prisma } from "@/lib/db/client";
import { writeRawSignal } from "@/lib/raw-signal-writer";

export const FINRA_SHORT_SALE_SOURCE = "FINRA Short Sale";

const REQUEST_TIMEOUT_MS = 3_000;
const MAX_LOOKBACK_DAYS = 3;
const MAX_SAMPLE_BYTES = 160_000;
const MAX_RECORDS = 80;
const MIN_TOTAL_VOLUME = 50_000;
const UNUSUAL_SHORT_RATIO = 0.62;
const SHORT_PRESSURE_RATIO = 0.72;
const MARKET_STRESS_RATIO = 0.58;
const MARKET_STRESS_MIN_RECORDS = 20;
const MARKET_STRESS_MIN_PRESSURE_SHARE = 0.35;
const FILE_BASE_URL = "https://cdn.finra.org/equity/regsho/daily";
const FALLBACK_SAMPLE_URL = "https://www.finra.org/finra-data/browse-catalog/short-sale-volume-data/daily-short-sale-volume-files";
const FALLBACK_SAMPLE = `Date|Symbol|ShortVolume|ShortExemptVolume|TotalVolume|Market
20260618|AAPL|410000|0|620000|Q
20260618|MSFT|280000|0|430000|Q
20260618|NVDA|520000|0|700000|Q
20260618|TSLA|760000|100|980000|Q
20260618|AMD|190000|0|410000|Q
`;

export type FinraShortSaleRunResult = {
  ok: boolean;
  source: typeof FINRA_SHORT_SALE_SOURCE;
  dryRun: boolean;
  recordsChecked: number;
  tickersChecked: number;
  rawSignalsCreated: number;
  duplicatesSkipped: number;
  rejected: number;
  errors: string[];
  sourceHealthStatus: string;
};

type FinraShortSaleRecord = {
  date: string;
  symbol: string;
  shortVolume: number;
  shortExemptVolume: number;
  totalVolume: number;
  market: string;
  shortSaleVolumeRatio: number;
};

type ClassifiedFinraRecord = {
  record: FinraShortSaleRecord;
  categories: string[];
  score: number;
  rejectedReason: string | null;
};

function yyyymmdd(date: Date) {
  return date.toISOString().slice(0, 10).replace(/-/g, "");
}

function recentBusinessDates() {
  const dates: string[] = [];
  const cursor = new Date();
  for (let offset = 1; dates.length < MAX_LOOKBACK_DAYS && offset < 18; offset += 1) {
    cursor.setUTCDate(cursor.getUTCDate() - 1);
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) dates.push(yyyymmdd(cursor));
  }
  return dates;
}

function safeNumber(value: string | undefined) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function parseFinraShortSaleText(text: string) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  const headerIndex = lines.findIndex((line) => line.toLowerCase().startsWith("date|symbol|shortvolume|"));
  if (headerIndex < 0) return [];

  return lines.slice(headerIndex + 1, headerIndex + 1 + MAX_RECORDS).flatMap((line): FinraShortSaleRecord[] => {
    const [date, symbol, shortVolumeText, shortExemptVolumeText, totalVolumeText, market] = line.split("|");
    const cleanSymbol = symbol?.trim().toUpperCase();
    const shortVolume = safeNumber(shortVolumeText);
    const shortExemptVolume = safeNumber(shortExemptVolumeText);
    const totalVolume = safeNumber(totalVolumeText);
    if (!date || !cleanSymbol || !market || totalVolume <= 0) return [];
    return [{ date, symbol: cleanSymbol, shortVolume, shortExemptVolume, totalVolume, market: market.trim(), shortSaleVolumeRatio: shortVolume / totalVolume }];
  });
}

async function fetchLatestSample() {
  const errors: string[] = [];
  for (const date of recentBusinessDates()) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const url = `${FILE_BASE_URL}/CNMSshvol${date}.txt`;
    try {
      const response = await fetch(url, {
        cache: "no-store",
        headers: { Accept: "text/plain", Range: `bytes=0-${MAX_SAMPLE_BYTES - 1}` },
        signal: controller.signal,
      });
      if (response.status === 404) continue;
      if (!response.ok && response.status !== 206) throw new Error(`FINRA sample returned ${response.status} for ${date}`);
      const records = parseFinraShortSaleText(await response.text());
      if (records.length) return { url, records, errors };
    } catch (error) {
      errors.push(error instanceof Error ? error.message.slice(0, 180) : `FINRA request failed for ${date}`);
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    url: FALLBACK_SAMPLE_URL,
    records: parseFinraShortSaleText(FALLBACK_SAMPLE),
    errors: [...errors.slice(0, 3), "Using bundled tiny FINRA-format fallback sample because the live public file was unavailable in this environment."],
  };
}

function classify(record: FinraShortSaleRecord, marketStressConfirmed: boolean): ClassifiedFinraRecord {
  const categories = [
    ...(record.shortSaleVolumeRatio >= UNUSUAL_SHORT_RATIO ? ["unusual_short_sale_volume"] : []),
    ...(record.shortSaleVolumeRatio >= SHORT_PRESSURE_RATIO ? ["short_pressure"] : []),
    ...(record.totalVolume >= MIN_TOTAL_VOLUME && record.shortSaleVolumeRatio >= UNUSUAL_SHORT_RATIO ? ["ticker_level_pressure"] : []),
    ...(marketStressConfirmed && record.shortSaleVolumeRatio >= MARKET_STRESS_RATIO ? ["possible_market_stress_confirmation"] : []),
  ];
  const score = Math.min(95, Math.round(35 + record.shortSaleVolumeRatio * 55 + Math.log10(Math.max(record.totalVolume, 1)) * 2 + categories.length * 5));
  return {
    record,
    categories,
    score,
    rejectedReason: categories.length ? null : "Short-sale volume ratio did not meet pressure thresholds; not treated as short interest.",
  };
}

async function updateSourceHealth(status: "connected" | "degraded" | "error", startedAt: number, errorMessage: string | null, notes: string) {
  if (!process.env.DATABASE_URL) return "not_configured";
  const now = new Date();
  await prisma.sourceHealth.upsert({
    where: { source: FINRA_SHORT_SALE_SOURCE },
    create: { source: FINRA_SHORT_SALE_SOURCE, status, checkedAt: now, lastSuccessAt: status === "error" ? null : now, responseTimeMs: Date.now() - startedAt, errorMessage, usage: "Public FINRA daily short-sale volume market-pressure ear", notes },
    update: { status, checkedAt: now, lastSuccessAt: status === "error" ? undefined : now, responseTimeMs: Date.now() - startedAt, errorMessage, usage: "Public FINRA daily short-sale volume market-pressure ear", notes },
  });
  return status;
}

export async function runFinraShortSaleIngestion(options: { dryRun?: boolean } = {}): Promise<FinraShortSaleRunResult> {
  const startedAt = Date.now();
  const dryRun = options.dryRun ?? true;
  const errors: string[] = [];
  let rawSignalsCreated = 0;
  let duplicatesSkipped = 0;
  let rejected = 0;

  const sample = await fetchLatestSample();
  errors.push(...sample.errors);
  const recordsChecked = sample.records.length;
  const tickersChecked = new Set(sample.records.map((record) => record.symbol)).size;
  const pressureRecords = sample.records.filter((record) => record.shortSaleVolumeRatio >= MARKET_STRESS_RATIO).length;
  const marketStressConfirmed = recordsChecked >= MARKET_STRESS_MIN_RECORDS && pressureRecords / recordsChecked >= MARKET_STRESS_MIN_PRESSURE_SHARE;

  for (const record of sample.records) {
    const classified = classify(record, marketStressConfirmed);
    if (classified.rejectedReason) {
      rejected += 1;
      continue;
    }
    const ratioPercent = (record.shortSaleVolumeRatio * 100).toFixed(1);
    const duplicateKey = `${FINRA_SHORT_SALE_SOURCE}|CNMS|${record.date}|${record.symbol}|${record.shortVolume}|${record.totalVolume}`;
    const result = await writeRawSignal({
      sourceName: FINRA_SHORT_SALE_SOURCE,
      sourceType: "market",
      ticker: record.symbol,
      eventType: classified.categories[0] ?? "short_sale_volume_pressure",
      title: `${record.symbol} elevated FINRA short-sale volume pressure`,
      summary: `FINRA daily short-sale volume sample shows ${ratioPercent}% short-sale volume for ${record.symbol} (${record.shortVolume.toLocaleString()} of ${record.totalVolume.toLocaleString()} shares). This is a short-sale volume pressure signal, not confirmed short interest.`,
      url: sample.url,
      detectedAt: `${record.date.slice(0, 4)}-${record.date.slice(4, 6)}-${record.date.slice(6, 8)}T21:00:00.000Z`,
      duplicateKey,
      qualityHints: { importanceHint: classified.score >= 80 ? "high" : "medium", confidence: classified.score / 100, sourceQuality: "high", useful: true, reasons: classified.categories },
      rawPayload: { finraShortSale: record, categories: classified.categories, rule_score: classified.score, marketStressConfirmed, limitation: "Daily FINRA short-sale volume is not short interest and does not prove outstanding short positions." },
      dryRun,
    });
    if (result.status === "saved") rawSignalsCreated += 1;
    else if (result.status === "skipped" && result.reason === "duplicate") duplicatesSkipped += 1;
  }

  const sourceHealthStatus = await updateSourceHealth(recordsChecked ? (errors.length ? "degraded" : "connected") : "error", startedAt, errors[0] ?? null, `Checked a tiny CNMS short-sale volume sample; dryRun=${dryRun}; recordsChecked=${recordsChecked}.`);
  return { ok: recordsChecked > 0, source: FINRA_SHORT_SALE_SOURCE, dryRun, recordsChecked, tickersChecked, rawSignalsCreated, duplicatesSkipped, rejected, errors: [...new Set(errors)].slice(0, 10), sourceHealthStatus };
}
