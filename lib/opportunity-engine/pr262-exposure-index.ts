import { readVersionedTextFromR2, writeVersionedJsonToR2 } from "@/lib/r2-warehouse";
import { pr262StorageKey, resolvePr262StoragePrefix } from "@/lib/opportunity-engine/pr262-storage";

const VALUE_STATE_KEY = pr262StorageKey("value-investing/resumable/state.json");
const EQUITY_UNIVERSE_KEY = pr262StorageKey("equity-universe/v1.json");
const EXPOSURE_INDEX_KEY = pr262StorageKey("sensor/exposure-index-v1.json");
const VALUE_BATCH_PREFIX = `${resolvePr262StoragePrefix()}value-investing/resumable/`;
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
  currentPrice: number | null;
  businessQuality: number;
  risk: number;
  buyBelowPrice: number | null;
  strongBuyBelowPrice: number | null;
  trimAbovePrice: number | null;
  baseFairValue: number | null;
};

export type Pr262ExposureIndex = {
  version: 2;
  valueCycleId: string;
  builtAt: string;
  valueCoverage: {
    complete: boolean;
    totalCompanies: number;
    companiesStored: number;
    completedBatches: number;
    totalBatches: number;
  };
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

function integer(value: unknown, minimum = 0) {
  return typeof value === "number" && Number.isInteger(value) && value >= minimum ? value : null;
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
  const coverage = object(item.valueCoverage);
  const totalCompanies = integer(coverage.totalCompanies, 1);
  const companiesStored = integer(coverage.companiesStored, 1);
  const completedBatches = integer(coverage.completedBatches, 1);
  const totalBatches = integer(coverage.totalBatches, 1);
  const entries = Array.isArray(item.entries) ? item.entries : [];
  const tickers = new Set<string>();
  return item.version === 2
    && typeof item.valueCycleId === "string"
    && Boolean(item.valueCycleId.trim())
    && typeof item.builtAt === "string"
    && Number.isFinite(Date.parse(item.builtAt))
    && coverage.complete === true
    && totalCompanies !== null
    && companiesStored === totalCompanies
    && completedBatches !== null
    && totalBatches === completedBatches
    && entries.length === totalCompanies
    && entries.every((raw) => {
      const entry = object(raw);
      const ticker = text(entry.ticker)?.toUpperCase() ?? "";
      const valid = Boolean(ticker)
        && entry.ticker === ticker
        && Boolean(text(entry.company))
        && Boolean(text(entry.tradingViewSymbol))
        && !tickers.has(ticker);
      if (valid) tickers.add(ticker);
      return valid;
    });
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

  const totalCompanies = integer(valueState.totalCompanies, 1);
  const companiesStored = integer(valueState.companiesStored, 1);
  const batchSize = integer(valueState.batchSize, 1);
  const totalBatches = integer(valueState.totalBatches, 1);
  const universeFingerprint = text(valueState.universeFingerprint);
  const rawBatchKeys = Array.isArray(valueState.completedBatchKeys) ? valueState.completedBatchKeys : [];
  const batchKeys = rawBatchKeys.filter((key): key is string => typeof key === "string" && key.startsWith(VALUE_BATCH_PREFIX));
  if (valueState.status !== "complete"
    || totalCompanies === null
    || companiesStored === null
    || companiesStored !== totalCompanies
    || batchSize === null
    || totalBatches === null
    || totalBatches !== Math.ceil(totalCompanies / batchSize)
    || !universeFingerprint
    || rawBatchKeys.length !== totalBatches
    || batchKeys.length !== totalBatches
    || new Set(batchKeys).size !== totalBatches) {
    throw new Error("pr262_exposure_value_cycle_incomplete");
  }

  if (validIndex(cached.value)
    && cached.value.valueCycleId === cycleId
    && cached.value.valueCoverage.totalCompanies === totalCompanies
    && cached.value.valueCoverage.companiesStored === companiesStored
    && cached.value.valueCoverage.completedBatches === batchKeys.length
    && cached.value.valueCoverage.totalBatches === totalBatches
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

  const entries = new Map<string, Pr262ExposureEntry>();
  const batchIndexes = new Set<number>();
  let analysesRead = 0;
  for (let offset = 0; offset < batchKeys.length; offset += 4) {
    const keys = batchKeys.slice(offset, offset + 4);
    const batches = await Promise.all(keys.map((key) => readJson(key)));
    for (let batchOffset = 0; batchOffset < batches.length; batchOffset += 1) {
      const loaded = batches[batchOffset];
      const key = keys[batchOffset];
      const batch = object(loaded.value);
      const metadata = object(batch.batch);
      const batchIndex = integer(metadata.batchIndex);
      const startIndex = integer(metadata.startIndex);
      const endIndexExclusive = integer(metadata.endIndexExclusive);
      const companyCount = integer(metadata.companyCount, 1);
      if (batch.version !== 1
        || batch.kind !== "us_value_investing_company_batch"
        || batch.cycleId !== cycleId
        || batch.universeFingerprint !== universeFingerprint
        || batchIndex === null
        || batchIndex >= totalBatches
        || batchIndexes.has(batchIndex)
        || key !== `${VALUE_BATCH_PREFIX}cycles/${cycleId}/batches/batch-${String(batchIndex).padStart(3, "0")}.json`
        || startIndex === null
        || endIndexExclusive === null
        || companyCount === null
        || startIndex !== batchIndex * batchSize
        || endIndexExclusive !== Math.min(totalCompanies, startIndex + batchSize)
        || companyCount !== endIndexExclusive - startIndex
        || !Array.isArray(batch.analyses)
        || batch.analyses.length !== companyCount) {
        throw new Error("pr262_exposure_value_batch_invalid");
      }
      batchIndexes.add(batchIndex);
      analysesRead += batch.analyses.length;
      for (const raw of batch.analyses) {
        const analysis = object(raw);
        const ticker = text(analysis.ticker)?.toUpperCase();
        const company = text(analysis.company);
        const tradingViewSymbol = text(analysis.tradingViewSymbol);
        if (!ticker || analysis.ticker !== ticker || !company || !tradingViewSymbol || entries.has(ticker)) {
          throw new Error("pr262_exposure_value_analysis_invalid");
        }
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
          currentPrice: finite(analysis.currentPrice),
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
  if (batchIndexes.size !== totalBatches
    || analysesRead !== totalCompanies
    || entries.size !== totalCompanies) {
    throw new Error("pr262_exposure_value_coverage_mismatch");
  }

  const payload: Pr262ExposureIndex = {
    version: 2,
    valueCycleId: cycleId,
    builtAt: now.toISOString(),
    valueCoverage: {
      complete: true,
      totalCompanies,
      companiesStored,
      completedBatches: batchKeys.length,
      totalBatches,
    },
    entries: [...entries.values()].sort((left, right) =>
      (right.marketCap ?? 0) - (left.marketCap ?? 0) || right.businessQuality - left.businessQuality || left.ticker.localeCompare(right.ticker)),
  };
  const written = await writeVersionedJsonToR2(
    EXPOSURE_INDEX_KEY,
    payload,
    cached.etag ? { expectedEtag: cached.etag } : { createOnly: true },
  );
  if (!written.conflict) return payload;
  const concurrent = await readJson(EXPOSURE_INDEX_KEY);
  if (validIndex(concurrent.value)
    && concurrent.value.valueCycleId === cycleId
    && concurrent.value.valueCoverage.totalCompanies === totalCompanies
    && concurrent.value.valueCoverage.companiesStored === companiesStored
    && concurrent.value.valueCoverage.completedBatches === totalBatches
    && concurrent.value.valueCoverage.totalBatches === totalBatches) return concurrent.value;
  throw new Error("pr262_exposure_index_conflict");
}

export const PR262_EXPOSURE_INDEX_KEY = EXPOSURE_INDEX_KEY;
