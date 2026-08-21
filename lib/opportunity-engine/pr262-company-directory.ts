import crypto from "node:crypto";
import { readVersionedTextFromR2, writeVersionedJsonToR2 } from "@/lib/r2-warehouse";
import { readPr262ChangeSensorState, type Pr262SensorEvent } from "@/lib/opportunity-engine/pr262-change-sensor";
import { pr262StorageKey, resolvePr262StoragePrefix } from "@/lib/opportunity-engine/pr262-storage";

const VALUE_STATE_KEY = pr262StorageKey("value-investing/resumable/state.json");
const EQUITY_UNIVERSE_KEY = pr262StorageKey("equity-universe/v1.json");
const DIRECTORY_KEY = pr262StorageKey("sensor/company-directory-v1.json");
const SENSOR_STATE_KEY = pr262StorageKey("sensor/state-v1.json");
const VALUE_BATCH_PREFIX = `${resolvePr262StoragePrefix()}value-investing/resumable/`;
const DIRECTORY_TTL_MS = 24 * 60 * 60 * 1000;
const EQUITY_UNIVERSE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export type Pr262CompanyDirectoryEntry = {
  ticker: string;
  tradingViewSymbol: string;
  company: string;
  cik: string;
  isPrimaryListing: boolean;
  exchange: string;
  securityType: "common_stock" | "adr";
  batchKey: string;
  analysisIndex: number;
  valueCycleId: string;
  universeRefreshedAt: string;
};

type Directory = {
  version: 5;
  cycleId: string;
  updatedAt: string;
  universeRefreshedAt: string;
  batchKeys: string[];
  recordsRead: number;
  entriesWithCik: number;
  entriesDigest: string;
  entries: Pr262CompanyDirectoryEntry[];
};

type Json = Record<string, unknown>;

export type Pr262DirectoryResolution = {
  entry: Pr262CompanyDirectoryEntry | null;
  status: "mapped" | "unmapped" | "ambiguous";
  method: string;
  reason: string;
};

export type Pr262ResolvedSensorCompany = {
  event: Pr262SensorEvent;
  directoryEntry: Pr262CompanyDirectoryEntry;
  valueAnalysis: Json;
};

function object(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
}

function normalizeCik(value: unknown) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits || digits.length > 10 || /^0+$/.test(digits)) return null;
  return digits.padStart(10, "0");
}

function authoritativeDirectoryEntry(value: unknown): value is Pr262CompanyDirectoryEntry {
  const entry = object(value);
  return entry.isPrimaryListing === true
    && (entry.securityType === "common_stock" || entry.securityType === "adr")
    && typeof entry.cik === "string"
    && normalizeCik(entry.cik) === entry.cik
    && typeof entry.ticker === "string"
    && Boolean(entry.ticker.trim())
    && entry.ticker === entry.ticker.trim().toUpperCase()
    && typeof entry.company === "string"
    && Boolean(entry.company.trim())
    && typeof entry.tradingViewSymbol === "string"
    && Boolean(entry.tradingViewSymbol.trim())
    && typeof entry.exchange === "string"
    && Boolean(entry.exchange.trim())
    && typeof entry.batchKey === "string"
    && entry.batchKey.startsWith(VALUE_BATCH_PREFIX)
    && Number.isInteger(entry.analysisIndex)
    && Number(entry.analysisIndex) >= 0
    && typeof entry.valueCycleId === "string"
    && Boolean(entry.valueCycleId.trim())
    && typeof entry.universeRefreshedAt === "string"
    && Number.isFinite(Date.parse(entry.universeRefreshedAt));
}

function directoryEntriesDigest(entries: Pr262CompanyDirectoryEntry[]) {
  return crypto.createHash("sha256").update(JSON.stringify(entries.map((entry) => ({
    ticker: entry.ticker,
    company: entry.company,
    tradingViewSymbol: entry.tradingViewSymbol,
    cik: entry.cik,
    exchange: entry.exchange,
    securityType: entry.securityType,
    batchKey: entry.batchKey,
    analysisIndex: entry.analysisIndex,
    valueCycleId: entry.valueCycleId,
    universeRefreshedAt: entry.universeRefreshedAt,
  })))).digest("hex");
}

function validDirectoryEntries(value: unknown): value is Pr262CompanyDirectoryEntry[] {
  if (!Array.isArray(value) || !value.length || !value.every(authoritativeDirectoryEntry)) return false;
  return new Set(value.map((entry) => entry.ticker)).size === value.length;
}

async function readJson(key: string) {
  const current = await readVersionedTextFromR2(key);
  if (!current.found || !current.text) return { value: null as unknown, etag: current.etag };
  return { value: JSON.parse(current.text) as unknown, etag: current.etag };
}

async function buildDirectory() {
  const [value, universeLoaded] = await Promise.all([readJson(VALUE_STATE_KEY), readJson(EQUITY_UNIVERSE_KEY)]);
  const state = object(value.value);
  const cycleId = typeof state.cycleId === "string" ? state.cycleId : "";
  const universe = object(universeLoaded.value);
  const universeRefreshedAt = typeof universe.refreshedAt === "string" ? universe.refreshedAt : "";
  const universeRefreshedMs = Date.parse(universeRefreshedAt);
  const universeAgeMs = Date.now() - universeRefreshedMs;
  const constructionModes = ["nasdaq_plus_sec", "partial_nasdaq_plus_sec", "sec_official_fallback"];
  if (universe.version !== 1
    || universe.scope !== "active_us_exchange_listed_common_equities_and_adrs"
    || !constructionModes.includes(String(universe.constructionMode))
    || !Array.isArray(universe.entries)
    || universe.entries.length === 0) {
    throw new Error("pr262_authoritative_equity_universe_missing");
  }
  if (!Number.isFinite(universeRefreshedMs) || universeAgeMs < -5 * 60_000 || universeAgeMs > EQUITY_UNIVERSE_MAX_AGE_MS) {
    throw new Error("pr262_authoritative_equity_universe_stale");
  }
  const universeByTicker = new Map<string, {
    cik: string;
    exchange: string;
    securityType: "common_stock" | "adr";
  }>();
  for (const raw of universe.entries) {
    const item = object(raw);
    const ticker = typeof item.ticker === "string" ? item.ticker.trim().toUpperCase() : "";
    const securityType = item.securityType === "common_stock" || item.securityType === "adr" ? item.securityType : null;
    const exchange = typeof item.exchange === "string" && item.exchange.trim() ? item.exchange.trim() : null;
    const cik = normalizeCik(item.cik);
    const sourceNames = Array.isArray(item.sourceNames) ? item.sourceNames.filter((source): source is string => typeof source === "string") : [];
    if (!ticker || !securityType || !exchange || !cik || !sourceNames.includes("SEC company_tickers_exchange")) continue;
    universeByTicker.set(ticker, {
      cik,
      exchange,
      securityType,
    });
  }
  if (!universeByTicker.size) throw new Error("pr262_authoritative_equity_universe_empty");
  const keys = Array.isArray(state.completedBatchKeys)
    ? state.completedBatchKeys.filter((item): item is string => typeof item === "string")
    : [];
  if (!cycleId || !keys.length) throw new Error("pr262_value_analysis_batches_unavailable");
  if (keys.some((key) => !key.startsWith(VALUE_BATCH_PREFIX))) {
    throw new Error("pr262_value_analysis_batch_key_outside_storage_namespace");
  }
  const current = await readJson(DIRECTORY_KEY);
  const existing = object(current.value);
  const updatedAt = typeof existing.updatedAt === "string" ? Date.parse(existing.updatedAt) : 0;
  const directoryAgeMs = Date.now() - updatedAt;
  const existingBatchKeys = Array.isArray(existing.batchKeys) ? existing.batchKeys.filter((item): item is string => typeof item === "string") : [];
  if (
    existing.version === 5
    && existing.cycleId === cycleId
    && existing.universeRefreshedAt === universeRefreshedAt
    && directoryAgeMs >= -5 * 60_000
    && directoryAgeMs < DIRECTORY_TTL_MS
    && existingBatchKeys.length === keys.length
    && existingBatchKeys.every((key, index) => key === keys[index])
    && Number.isInteger(existing.recordsRead)
    && Number(existing.recordsRead) > 0
    && validDirectoryEntries(existing.entries)
    && Number(existing.entriesWithCik) === existing.entries.length
    && typeof existing.entriesDigest === "string"
    && existing.entriesDigest === directoryEntriesDigest(existing.entries)
    && existing.entries.every((entry) => authoritativeDirectoryEntry(entry)
      && entry.valueCycleId === cycleId
      && entry.universeRefreshedAt === universeRefreshedAt
      && keys.includes(entry.batchKey))
  ) {
    return existing as unknown as Directory;
  }

  const entries = new Map<string, Pr262CompanyDirectoryEntry>();
  let recordsRead = 0;
  for (let index = 0; index < keys.length; index += 4) {
    const chunk = keys.slice(index, index + 4);
    const batches = await Promise.all(chunk.map((key) => readJson(key)));
    for (let batchOffset = 0; batchOffset < batches.length; batchOffset += 1) {
      const batch = batches[batchOffset];
      const batchKey = chunk[batchOffset];
      const batchValue = object(batch.value);
      if (batchValue.kind !== "us_value_investing_company_batch"
        || batchValue.cycleId !== cycleId
        || !Array.isArray(batchValue.analyses)) {
        throw new Error("pr262_value_analysis_batch_invalid");
      }
      const analyses = batchValue.analyses;
      recordsRead += analyses.length;
      for (let analysisIndex = 0; analysisIndex < analyses.length; analysisIndex += 1) {
        const raw = analyses[analysisIndex];
        const item = object(raw);
        const ticker = typeof item.ticker === "string" ? item.ticker.trim().toUpperCase() : "";
        const company = typeof item.company === "string" ? item.company.trim() : "";
        const tradingViewSymbol = typeof item.tradingViewSymbol === "string" ? item.tradingViewSymbol.trim() : "";
        if (!ticker || !company) continue;
        const universeEntry = universeByTicker.get(ticker);
        if (!universeEntry) continue;
        entries.set(ticker, {
          ticker,
          company,
          tradingViewSymbol,
          cik: universeEntry.cik,
          isPrimaryListing: true,
          exchange: universeEntry.exchange,
          securityType: universeEntry.securityType,
          batchKey,
          analysisIndex,
          valueCycleId: cycleId,
          universeRefreshedAt,
        });
      }
    }
  }
  const rows = [...entries.values()].sort((left, right) => left.ticker.localeCompare(right.ticker));
  if (!rows.length || rows.some((entry) => !authoritativeDirectoryEntry(entry))) {
    throw new Error("pr262_authoritative_company_directory_empty_or_invalid");
  }
  const directory: Directory = {
    version: 5,
    cycleId,
    updatedAt: new Date().toISOString(),
    universeRefreshedAt,
    batchKeys: keys,
    recordsRead,
    entriesWithCik: rows.filter((entry) => Boolean(entry.cik)).length,
    entriesDigest: directoryEntriesDigest(rows),
    entries: rows,
  };
  const written = await writeVersionedJsonToR2(
    DIRECTORY_KEY,
    directory,
    current.etag ? { expectedEtag: current.etag } : { createOnly: true },
  );
  if (!written.conflict) return directory;
  const concurrent = await readJson(DIRECTORY_KEY);
  const concurrentValue = object(concurrent.value);
  const concurrentBatchKeys = Array.isArray(concurrentValue.batchKeys)
    ? concurrentValue.batchKeys.filter((item): item is string => typeof item === "string")
    : [];
  if (concurrentValue.version === 5
    && concurrentValue.cycleId === cycleId
    && concurrentValue.universeRefreshedAt === universeRefreshedAt
    && concurrentBatchKeys.length === keys.length
    && concurrentBatchKeys.every((key, index) => key === keys[index])
    && Number.isInteger(concurrentValue.recordsRead)
    && Number(concurrentValue.recordsRead) > 0
    && validDirectoryEntries(concurrentValue.entries)
    && Number(concurrentValue.entriesWithCik) === concurrentValue.entries.length
    && typeof concurrentValue.entriesDigest === "string"
    && concurrentValue.entriesDigest === directoryEntriesDigest(concurrentValue.entries)
    && concurrentValue.entries.every((entry) => authoritativeDirectoryEntry(entry)
      && entry.valueCycleId === cycleId
      && entry.universeRefreshedAt === universeRefreshedAt
      && keys.includes(entry.batchKey))) {
    return concurrentValue as unknown as Directory;
  }
  throw new Error("pr262_company_directory_state_conflict");
}

export function resolvePr262SensorDirectoryEntry(
  event: Pick<Pr262SensorEvent, "source" | "cik" | "ticker" | "title">,
  entries: Pr262CompanyDirectoryEntry[],
): Pr262DirectoryResolution {
  const authoritativeEntries = entries.filter(authoritativeDirectoryEntry);
  if (event.source === "sec") {
    const cik = normalizeCik(event.cik);
    if (!cik) {
      return {
        entry: null,
        status: "unmapped",
        method: "sec_cik_missing_fail_closed",
        reason: "The SEC item has no official issuer CIK, so ticker mapping is blocked.",
      };
    }
    const matches = authoritativeEntries.filter((entry) => entry.cik === cik);
    if (matches.length === 1) {
      return {
        entry: matches[0],
        status: "mapped",
        method: "official_sec_cik_exact",
        reason: "The filing issuer CIK exactly matches one stored U.S. listing.",
      };
    }
    if (matches.length > 1) {
      const primary = matches.filter((entry) => entry.isPrimaryListing);
      if (primary.length === 1) {
        return {
          entry: primary[0],
          status: "mapped",
          method: "official_sec_cik_exact_primary_listing",
          reason: "The filing issuer CIK exactly matches the stored primary U.S. listing.",
        };
      }
      return {
        entry: null,
        status: "ambiguous",
        method: "sec_cik_ambiguous_fail_closed",
        reason: "The issuer CIK maps to several stored listings and no single primary listing is proven.",
      };
    }
    return {
      entry: null,
      status: "unmapped",
      method: "sec_cik_unknown_fail_closed",
      reason: "The official issuer CIK is not present in the stored company directory.",
    };
  }

  const explicit = typeof event.ticker === "string" && event.ticker
    ? authoritativeEntries.find((entry) => entry.ticker === event.ticker?.toUpperCase()) ?? null
    : null;
  if (explicit) {
    return {
      entry: explicit,
      status: "mapped",
      method: "structured_ticker_exact",
      reason: "A structured ticker exactly matches the stored directory.",
    };
  }
  if (typeof event.ticker === "string" && event.ticker.trim()) {
    return {
      entry: null,
      status: "unmapped",
      method: "structured_ticker_unknown_fail_closed",
      reason: "The structured ticker is not present in the stored company directory, so a company-name fallback is not allowed.",
    };
  }
  return {
    entry: null,
    status: "unmapped",
    method: "structured_ticker_required_fail_closed",
    reason: "Non-SEC items require an explicit structured ticker; company-name text is never used for mapping.",
  };
}

export async function readPr262ResolvedSensorCompany(eventId: string): Promise<Pr262ResolvedSensorCompany | null> {
  const id = eventId.trim();
  if (!id) throw new Error("pr262_sensor_event_id_required");
  const [directory, sensor] = await Promise.all([buildDirectory(), readPr262ChangeSensorState()]);
  const event = sensor.pending.find((item) => item.id === id);
  if (!event) return null;
  const resolution = resolvePr262SensorDirectoryEntry(event, directory.entries);
  if (!resolution.entry) return null;
  const batch = await readJson(resolution.entry.batchKey);
  const batchValue = object(batch.value);
  if (batchValue.cycleId !== resolution.entry.valueCycleId || !Array.isArray(batchValue.analyses)) {
    throw new Error("pr262_value_analysis_pointer_stale");
  }
  const valueAnalysis = object(batchValue.analyses[resolution.entry.analysisIndex]);
  if (String(valueAnalysis.ticker ?? "").trim().toUpperCase() !== resolution.entry.ticker) {
    throw new Error("pr262_value_analysis_pointer_mismatch");
  }
  return {
    event: {
      ...event,
      ticker: resolution.entry.ticker,
      company: resolution.entry.company,
      tradingViewSymbol: resolution.entry.tradingViewSymbol,
      mappingStatus: "mapped",
      mappingMethod: resolution.method,
      mappingReason: resolution.reason,
    },
    directoryEntry: resolution.entry,
    valueAnalysis,
  };
}

function sameMapping(event: Json, next: Json) {
  return event.ticker === next.ticker
    && event.company === next.company
    && event.tradingViewSymbol === next.tradingViewSymbol
    && event.mappingStatus === next.mappingStatus
    && event.mappingMethod === next.mappingMethod
    && event.mappingReason === next.mappingReason;
}

export async function enrichPr262SensorCompanyMappings() {
  const [directory, sensorLoaded] = await Promise.all([buildDirectory(), readJson(SENSOR_STATE_KEY)]);
  const sensor = object(sensorLoaded.value);
  const pending = Array.isArray(sensor.pending) ? sensor.pending.map(object) : [];
  let mapped = 0;
  let failClosed = 0;
  let changed = 0;
  const nextPending = pending.map((event) => {
    const source = typeof event.source === "string" ? event.source : "";
    const resolution = resolvePr262SensorDirectoryEntry({
      source: source as Pr262SensorEvent["source"],
      cik: typeof event.cik === "string" || typeof event.cik === "number" ? String(event.cik) : null,
      ticker: typeof event.ticker === "string" ? event.ticker : null,
      title: typeof event.title === "string" ? event.title : "",
    }, directory.entries);
    if (resolution.entry) {
      mapped += 1;
      const next = {
        ...event,
        ticker: resolution.entry.ticker,
        company: resolution.entry.company,
        tradingViewSymbol: resolution.entry.tradingViewSymbol,
        mappingStatus: resolution.status,
        mappingMethod: resolution.method,
        mappingReason: resolution.reason,
      };
      if (!sameMapping(event, next)) changed += 1;
      return next;
    }
    if (source === "sec") failClosed += 1;
    const next = {
      ...event,
      ...(source === "sec"
        ? { ticker: null, company: null, tradingViewSymbol: "" }
        : { company: null, tradingViewSymbol: "" }),
      mappingStatus: resolution.status,
      mappingMethod: resolution.method,
      mappingReason: resolution.reason,
    };
    if (!sameMapping(event, next)) changed += 1;
    return next;
  });
  if (changed > 0) {
    const next = { ...sensor, pending: nextPending, updatedAt: new Date().toISOString() };
    const written = await writeVersionedJsonToR2(
      SENSOR_STATE_KEY,
      next,
      sensorLoaded.etag ? { expectedEtag: sensorLoaded.etag } : { createOnly: true },
    );
    if (written.conflict) throw new Error("pr262_sensor_mapping_state_conflict");
  }
  return {
    mapped,
    failClosed,
    changed,
    directoryCompanies: directory.entries.length,
    directoryCompaniesWithCik: directory.entriesWithCik,
    directoryRecordsRead: directory.recordsRead,
    directoryUpdatedAt: directory.updatedAt,
    universeRefreshedAt: directory.universeRefreshedAt,
    authoritativeUniverseFresh: true,
    secMappingPolicy: "official_cik_only_fail_closed",
  };
}
