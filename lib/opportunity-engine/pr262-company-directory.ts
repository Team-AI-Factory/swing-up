import { readVersionedTextFromR2, writeVersionedJsonToR2 } from "@/lib/r2-warehouse";

const VALUE_STATE_KEY = "branch-labs/pr-262/value-investing/resumable/state.json";
const DIRECTORY_KEY = "branch-labs/pr-262/sensor/company-directory-v1.json";
const SENSOR_STATE_KEY = "branch-labs/pr-262/sensor/state-v1.json";
const DIRECTORY_TTL_MS = 24 * 60 * 60 * 1000;

type DirectoryEntry = { ticker: string; tradingViewSymbol: string; company: string; normalizedCompany: string };
type Directory = { version: 1; cycleId: string; updatedAt: string; entries: DirectoryEntry[] };
type Json = Record<string, unknown>;

function object(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
}

function normalized(value: string) {
  return value.toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\b(incorporated|inc|corporation|corp|company|co|limited|ltd|plc|holdings|holding|group)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function readJson(key: string) {
  const current = await readVersionedTextFromR2(key);
  if (!current.found || !current.text) return { value: null as unknown, etag: current.etag };
  return { value: JSON.parse(current.text) as unknown, etag: current.etag };
}

async function buildDirectory() {
  const value = await readJson(VALUE_STATE_KEY);
  const state = object(value.value);
  const cycleId = typeof state.cycleId === "string" ? state.cycleId : "unknown";
  const current = await readJson(DIRECTORY_KEY);
  const existing = object(current.value);
  const existingEntries = Array.isArray(existing.entries) ? existing.entries : [];
  const updatedAt = typeof existing.updatedAt === "string" ? Date.parse(existing.updatedAt) : 0;
  if (existing.version === 1 && existing.cycleId === cycleId && Date.now() - updatedAt < DIRECTORY_TTL_MS && existingEntries.length > 0) {
    return existing as unknown as Directory;
  }

  const keys = Array.isArray(state.completedBatchKeys) ? state.completedBatchKeys.filter((item): item is string => typeof item === "string") : [];
  const entries = new Map<string, DirectoryEntry>();
  for (let index = 0; index < keys.length; index += 4) {
    const chunk = keys.slice(index, index + 4);
    const batches = await Promise.all(chunk.map((key) => readJson(key).catch(() => ({ value: null, etag: null }))));
    for (const batch of batches) {
      const analyses = Array.isArray(object(batch.value).analyses) ? object(batch.value).analyses as unknown[] : [];
      for (const raw of analyses) {
        const item = object(raw);
        const ticker = typeof item.ticker === "string" ? item.ticker.trim().toUpperCase() : "";
        const company = typeof item.company === "string" ? item.company.trim() : "";
        const tradingViewSymbol = typeof item.tradingViewSymbol === "string" ? item.tradingViewSymbol.trim() : "";
        if (!ticker || !company) continue;
        entries.set(ticker, { ticker, company, tradingViewSymbol, normalizedCompany: normalized(company) });
      }
    }
  }
  const directory: Directory = { version: 1, cycleId, updatedAt: new Date().toISOString(), entries: [...entries.values()] };
  await writeVersionedJsonToR2(DIRECTORY_KEY, directory);
  return directory;
}

function resolveTicker(title: string, directory: Directory) {
  const titleNormalized = normalized(title);
  const explicit = title.match(/(?:\$|NASDAQ:\s*|NYSE:\s*)([A-Z][A-Z0-9.-]{0,9})\b/i)?.[1]?.toUpperCase();
  if (explicit && directory.entries.some((entry) => entry.ticker === explicit)) return directory.entries.find((entry) => entry.ticker === explicit) ?? null;
  const matches = directory.entries
    .filter((entry) => entry.normalizedCompany.length >= 4 && titleNormalized.includes(entry.normalizedCompany))
    .sort((left, right) => right.normalizedCompany.length - left.normalizedCompany.length);
  return matches[0] ?? null;
}

export async function enrichPr262SensorCompanyMappings() {
  const [directory, sensorLoaded] = await Promise.all([buildDirectory(), readJson(SENSOR_STATE_KEY)]);
  const sensor = object(sensorLoaded.value);
  const pending = Array.isArray(sensor.pending) ? sensor.pending.map(object) : [];
  let mapped = 0;
  const nextPending = pending.map((event) => {
    if (typeof event.ticker === "string" && event.ticker.trim()) return event;
    const title = typeof event.title === "string" ? event.title : "";
    if (!title) return event;
    const match = resolveTicker(title, directory);
    if (!match) return event;
    mapped += 1;
    return { ...event, ticker: match.ticker, company: match.company, tradingViewSymbol: match.tradingViewSymbol, mappingMethod: "stored_company_directory_name_match" };
  });
  if (mapped > 0) {
    const next = { ...sensor, pending: nextPending, updatedAt: new Date().toISOString() };
    const written = await writeVersionedJsonToR2(SENSOR_STATE_KEY, next, sensorLoaded.etag ? { expectedEtag: sensorLoaded.etag } : { createOnly: true });
    if (written.conflict) throw new Error("pr262_sensor_mapping_state_conflict");
  }
  return { mapped, directoryCompanies: directory.entries.length, directoryUpdatedAt: directory.updatedAt };
}
