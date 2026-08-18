import { readVersionedTextFromR2, writeVersionedJsonToR2 } from "@/lib/r2-warehouse";

const VALUE_STATE_KEY = "branch-labs/pr-262/value-investing/resumable/state.json";
const EQUITY_UNIVERSE_KEY = "branch-labs/pr-262/equity-universe/v1.json";
const EXPOSURE_INDEX_KEY = "branch-labs/pr-262/sensor/exposure-index-v1.json";
const INDEX_TTL_MS = 24 * 60 * 60_000;

type Json = Record<string, unknown>;

export type Pr262ExposureEntry = {
  ticker: string;
  tradingViewSymbol: string;
  company: string;
  cik: string | null;
  exchange: string | null;
  sector: string | null;
  industry: string | null;
  marketCap: number | null;
  businessQuality: number;
  risk: number;
  buyBelowPrice: number | null;
  strongBuyBelowPrice: number | null;
  trimAbovePrice: number | null;
  baseFairValue: number | null;
};

export type Pr262ExposureIndex = {
  version: 1;
  valueCycleId: string;
  builtAt: string;
  entries: Pr262ExposureEntry[];
};

function object(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function finite(value: unknown) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value.replace(/,/g, "")) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeCik(value: unknown) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits || digits.length > 10 || /^0+$/.test(digits)) return null;
  return digits.padStart(10, "0");
}

async function readJson(key: string) {
  const current = await readVersionedTextFromR2(key);
  if (!current.found || !current.text) return { value: null as unknown, etag: current.etag };
  return { value: JSON.parse(current.text) as unknown, etag: current.etag };
}

function validIndex(value: unknown): value is Pr262ExposureIndex {
  const item = object(value);
  return item.version === 1
    && typeof item.valueCycleId === "string"
    && typeof item.builtAt === "string"
    && Number.isFinite(Date.parse(item.builtAt))
    && Array.isArray(item.entries);
}

export async function loadPr262ExposureIndex(now = new Date()): Promise<Pr262ExposureIndex> {
  const [cached, valueLoaded, universeLoaded] = await Promise.all([
    readJson(EXPOSURE_INDEX_KEY),
    readJson(VALUE_STATE_KEY),
    readJson(EQUITY_UNIVERSE_KEY),
  ]);
  const valueState = object(valueLoaded.value);
  const cycleId = text(valueState.cycleId) ?? "";
  if (!cycleId) throw new Error("pr262_exposure_value_cycle_missing");

  if (validIndex(cached.value)
    && cached.value.valueCycleId === cycleId
    && now.getTime() - Date.parse(cached.value.builtAt) >= 0
    && now.getTime() - Date.parse(cached.value.builtAt) < INDEX_TTL_MS) {
    return cached.value;
  }

  const universe = object(universeLoaded.value);
  const universeEntries = Array.isArray(universe.entries) ? universe.entries.map(object) : [];
  const cikByTicker = new Map<string, { cik: string | null; exchange: string | null }>();
  for (const entry of universeEntries) {
    const ticker = text(entry.ticker)?.toUpperCase();
    if (!ticker) continue;
    cikByTicker.set(ticker, { cik: normalizeCik(entry.cik), exchange: text(entry.exchange) });
  }

  const batchKeys = Array.isArray(valueState.completedBatchKeys)
    ? valueState.completedBatchKeys.filter((key): key is string => typeof key === "string" && key.startsWith("branch-labs/pr-262/value-investing/resumable/"))
    : [];
  if (!batchKeys.length) throw new Error("pr262_exposure_value_batches_missing");

  const entries = new Map<string, Pr262ExposureEntry>();
  for (let offset = 0; offset < batchKeys.length; offset += 4) {
    const keys = batchKeys.slice(offset, offset + 4);
    const batches = await Promise.all(keys.map((key) => readJson(key)));
    for (const loaded of batches) {
      const batch = object(loaded.value);
      if (batch.cycleId !== cycleId || !Array.isArray(batch.analyses)) continue;
      for (const raw of batch.analyses) {
        const analysis = object(raw);
        const ticker = text(analysis.ticker)?.toUpperCase();
        const company = text(analysis.company);
        const tradingViewSymbol = text(analysis.tradingViewSymbol);
        if (!ticker || !company || !tradingViewSymbol) continue;
        const scores = object(analysis.scores);
        const fairValue = object(analysis.fairValue);
        const universeEntry = cikByTicker.get(ticker);
        entries.set(ticker, {
          ticker,
          tradingViewSymbol,
          company,
          cik: universeEntry?.cik ?? null,
          exchange: text(analysis.exchange) ?? universeEntry?.exchange ?? null,
          sector: text(analysis.sector),
          industry: text(analysis.industry),
          marketCap: finite(analysis.marketCap),
          businessQuality: finite(scores.businessQuality) ?? 0,
          risk: finite(scores.risk) ?? 100,
          buyBelowPrice: finite(fairValue.buyBelowPrice),
          strongBuyBelowPrice: finite(fairValue.strongBuyBelowPrice),
          trimAbovePrice: finite(fairValue.trimAbovePrice),
          baseFairValue: finite(fairValue.baseValue),
        });
      }
    }
  }

  const payload: Pr262ExposureIndex = {
    version: 1,
    valueCycleId: cycleId,
    builtAt: now.toISOString(),
    entries: [...entries.values()].sort((left, right) =>
      (right.marketCap ?? 0) - (left.marketCap ?? 0) || right.businessQuality - left.businessQuality || left.ticker.localeCompare(right.ticker)),
  };
  if (!payload.entries.length) throw new Error("pr262_exposure_index_empty");

  const written = await writeVersionedJsonToR2(
    EXPOSURE_INDEX_KEY,
    payload,
    cached.etag ? { expectedEtag: cached.etag } : { createOnly: true },
  );
  if (!written.conflict) return payload;
  const concurrent = await readJson(EXPOSURE_INDEX_KEY);
  if (validIndex(concurrent.value) && concurrent.value.valueCycleId === cycleId) return concurrent.value;
  throw new Error("pr262_exposure_index_conflict");
}

export const PR262_EXPOSURE_INDEX_KEY = EXPOSURE_INDEX_KEY;
