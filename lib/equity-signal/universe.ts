import { getR2Config, readVersionedTextFromR2, writeVersionedJsonToR2 } from "@/lib/r2-warehouse";
import { normalizeEquitySymbol } from "@/lib/branch-signal-lab-policy";

export type EquityUniverseEntry = {
  ticker: string;
  name: string;
  exchange: string | null;
  cik: string | null;
  aliases: string[];
  securityType: "common_stock" | "adr";
  sourceNames: string[];
};

export type EquityUniverseSnapshot = {
  version: 1;
  scope: "active_us_exchange_listed_common_equities_and_adrs";
  refreshedAt: string;
  entries: EquityUniverseEntry[];
  coverage: {
    nasdaqRows: number;
    otherExchangeRows: number;
    eligibleEquities: number;
    cikMapped: number;
    cikMappedPercent: number;
    adrCount: number;
    excludedByReason: Record<string, number>;
  };
  sources: Array<{ name: string; url: string; status: string; records: number; error: string | null }>;
};

const CACHE_KEY = "branch-labs/pr-261/equity-universe/v1.json";
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const NASDAQ_LISTED_URL = "https://www.nasdaqtrader.com/dynamic/symdir/nasdaqlisted.txt";
const OTHER_LISTED_URL = "https://www.nasdaqtrader.com/dynamic/symdir/otherlisted.txt";
const SEC_TICKERS_URL = "https://www.sec.gov/files/company_tickers_exchange.json";

type SecRow = { cik: string; name: string; ticker: string; exchange: string | null };
type ParsedDirectory = { entries: EquityUniverseEntry[]; rows: number; excluded: Record<string, number> };

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

function increment(record: Record<string, number>, key: string) {
  record[key] = (record[key] ?? 0) + 1;
}

function companyAliases(name: string) {
  const normalized = name
    .replace(/\b(?:common stock|ordinary shares?|american depositary shares?|ads|adr|class [a-z])\b/gi, " ")
    .replace(/\b(?:incorporated|inc\.?|corporation|corp\.?|company|co\.?|limited|ltd\.?|plc|holdings?|group)\b/gi, " ")
    .replace(/[^A-Za-z0-9&.-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return [...new Set([name.trim(), normalized].filter((value) => value.length >= 4))];
}

function securityClassification(name: string, etf: string, testIssue: string) {
  const lower = name.toLowerCase();
  if (testIssue.toUpperCase() === "Y") return { eligible: false as const, reason: "test_issue" };
  if (etf.toUpperCase() === "Y") return { eligible: false as const, reason: "etf" };
  if (/\b(?:warrant|right|unit|preferred|preference|depositary preferred|note|notes|bond|debenture|contingent value right|beneficial interest|closed.end fund|income fund|trust units?)\b/i.test(lower)) {
    return { eligible: false as const, reason: "non_common_equity" };
  }
  if (/\b(?:etf|exchange traded fund|index fund|portfolio|fund shares?)\b/i.test(lower)) return { eligible: false as const, reason: "fund" };
  const adr = /\b(?:american depositary|depositary shares?|ads|adr)\b/i.test(name);
  return { eligible: true as const, securityType: adr ? "adr" as const : "common_stock" as const };
}

function parsePipeDirectory(text: string, kind: "nasdaq" | "other"): ParsedDirectory {
  const lines = text.split(/\r?\n/).filter(Boolean);
  const headers = (lines.shift() ?? "").split("|").map((value) => value.trim());
  const index = (name: string) => headers.indexOf(name);
  const symbolColumn = kind === "nasdaq" ? index("Symbol") : index("ACT Symbol");
  const nameColumn = index("Security Name");
  const etfColumn = index("ETF");
  const testColumn = index("Test Issue");
  const exchangeColumn = kind === "nasdaq" ? -1 : index("Exchange");
  const entries: EquityUniverseEntry[] = [];
  const excluded: Record<string, number> = {};
  let rows = 0;
  for (const line of lines) {
    if (/^File Creation Time/i.test(line)) continue;
    const values = line.split("|");
    const ticker = normalizeEquitySymbol(values[symbolColumn]);
    const name = clean(values[nameColumn]);
    if (!ticker || !name) continue;
    rows += 1;
    const classification = securityClassification(name, clean(values[etfColumn]), clean(values[testColumn]));
    if (!classification.eligible) {
      increment(excluded, classification.reason);
      continue;
    }
    const exchangeCode = kind === "nasdaq" ? "NASDAQ" : clean(values[exchangeColumn]);
    const exchange = ({ A: "NYSE American", N: "NYSE", P: "NYSE Arca", Z: "Cboe BZX", V: "IEXG" } as Record<string, string>)[exchangeCode] ?? (exchangeCode || null);
    entries.push({ ticker, name, exchange, cik: null, aliases: companyAliases(name), securityType: classification.securityType, sourceNames: [kind === "nasdaq" ? "Nasdaq Trader nasdaqlisted" : "Nasdaq Trader otherlisted"] });
  }
  return { entries, rows, excluded };
}

function parseSecRows(body: unknown): SecRow[] {
  if (!body || typeof body !== "object" || Array.isArray(body)) return [];
  const record = body as Record<string, unknown>;
  const fields = Array.isArray(record.fields) ? record.fields.map(String) : [];
  const data = Array.isArray(record.data) ? record.data : [];
  const positions = { cik: fields.indexOf("cik"), name: fields.indexOf("name"), ticker: fields.indexOf("ticker"), exchange: fields.indexOf("exchange") };
  return data.flatMap((value): SecRow[] => {
    if (!Array.isArray(value)) return [];
    const ticker = normalizeEquitySymbol(value[positions.ticker]);
    const name = clean(value[positions.name]);
    const rawCik = clean(value[positions.cik]);
    if (!ticker || !name || !/^\d+$/.test(rawCik)) return [];
    return [{ cik: rawCik.padStart(10, "0"), name, ticker, exchange: clean(value[positions.exchange]) || null }];
  });
}

function mergeEntries(nasdaq: ParsedDirectory, other: ParsedDirectory, secRows: SecRow[]): EquityUniverseEntry[] {
  const sec = new Map(secRows.map((entry) => [entry.ticker, entry]));
  const merged = new Map<string, EquityUniverseEntry>();
  for (const source of [...nasdaq.entries, ...other.entries]) {
    const filing = sec.get(source.ticker);
    const current = merged.get(source.ticker);
    const next: EquityUniverseEntry = {
      ticker: source.ticker,
      name: filing?.name || source.name,
      exchange: source.exchange || filing?.exchange || null,
      cik: filing?.cik ?? null,
      aliases: [...new Set([...source.aliases, ...(filing ? companyAliases(filing.name) : [])])],
      securityType: source.securityType,
      sourceNames: [...new Set([...source.sourceNames, ...(filing ? ["SEC company_tickers_exchange"] : [])])],
    };
    if (!current || (!current.cik && next.cik)) merged.set(source.ticker, next);
  }
  return [...merged.values()].sort((left, right) => left.ticker.localeCompare(right.ticker));
}

async function responseText(fetchImpl: typeof fetch, url: string, accept: string) {
  const response = await fetchImpl(url, { headers: { Accept: accept, "user-agent": "SwingUp/1.0 support@swingup.app" }, cache: "no-store", signal: AbortSignal.timeout(25_000) });
  if (!response.ok) throw new Error(`http_${response.status}`);
  return response.text();
}

async function cachedSnapshot() {
  if (!getR2Config().configured) return { snapshot: null as EquityUniverseSnapshot | null, etag: null as string | null };
  try {
    const object = await readVersionedTextFromR2(CACHE_KEY);
    if (!object.found || !object.text) return { snapshot: null, etag: object.etag };
    const snapshot = JSON.parse(object.text) as EquityUniverseSnapshot;
    if (!snapshot || snapshot.version !== 1 || !Array.isArray(snapshot.entries)) return { snapshot: null, etag: object.etag };
    return { snapshot, etag: object.etag };
  } catch {
    return { snapshot: null, etag: null };
  }
}

export async function loadEquityUniverse(fetchImpl: typeof fetch, now = new Date()) {
  const cached = await cachedSnapshot();
  if (cached.snapshot && now.getTime() - Date.parse(cached.snapshot.refreshedAt) < CACHE_MAX_AGE_MS) {
    return { snapshot: cached.snapshot, cache: "cloudflare_r2" as const, refreshed: false, r2Write: false };
  }
  const settled = await Promise.allSettled([
    responseText(fetchImpl, NASDAQ_LISTED_URL, "text/plain"),
    responseText(fetchImpl, OTHER_LISTED_URL, "text/plain"),
    responseText(fetchImpl, SEC_TICKERS_URL, "application/json"),
  ]);
  const source = (index: number, name: string, url: string) => settled[index].status === "fulfilled"
    ? { name, url, status: "connected", records: 0, error: null }
    : { name, url, status: "temporarily_unavailable", records: 0, error: settled[index].reason instanceof Error ? settled[index].reason.message : "request_failed" };
  if (settled[0].status !== "fulfilled" || settled[1].status !== "fulfilled") {
    if (cached.snapshot) return { snapshot: cached.snapshot, cache: "cloudflare_r2_stale_fallback" as const, refreshed: false, r2Write: false };
    throw new Error("official_equity_universe_unavailable");
  }
  const nasdaq = parsePipeDirectory(settled[0].value, "nasdaq");
  const other = parsePipeDirectory(settled[1].value, "other");
  const secRows = settled[2].status === "fulfilled" ? parseSecRows(JSON.parse(settled[2].value) as unknown) : [];
  const entries = mergeEntries(nasdaq, other, secRows);
  const excludedByReason = { ...nasdaq.excluded };
  for (const [reason, count] of Object.entries(other.excluded)) excludedByReason[reason] = (excludedByReason[reason] ?? 0) + count;
  const cikMapped = entries.filter((entry) => entry.cik).length;
  const sources = [
    { ...source(0, "Nasdaq Trader nasdaqlisted", NASDAQ_LISTED_URL), records: nasdaq.rows },
    { ...source(1, "Nasdaq Trader otherlisted", OTHER_LISTED_URL), records: other.rows },
    { ...source(2, "SEC company_tickers_exchange", SEC_TICKERS_URL), records: secRows.length },
  ];
  const snapshot: EquityUniverseSnapshot = {
    version: 1,
    scope: "active_us_exchange_listed_common_equities_and_adrs",
    refreshedAt: now.toISOString(),
    entries,
    coverage: {
      nasdaqRows: nasdaq.rows,
      otherExchangeRows: other.rows,
      eligibleEquities: entries.length,
      cikMapped,
      cikMappedPercent: entries.length ? Math.round((cikMapped / entries.length) * 10_000) / 100 : 0,
      adrCount: entries.filter((entry) => entry.securityType === "adr").length,
      excludedByReason,
    },
    sources,
  };
  let r2Write = false;
  if (getR2Config().configured) {
    try {
      const result = await writeVersionedJsonToR2(CACHE_KEY, snapshot, cached.etag ? { expectedEtag: cached.etag } : { createOnly: true });
      r2Write = result.written;
      if (result.conflict) {
        const winner = await cachedSnapshot();
        if (winner.snapshot) return { snapshot: winner.snapshot, cache: "cloudflare_r2_race_winner" as const, refreshed: false, r2Write: false };
      }
    } catch {}
  }
  return { snapshot, cache: "live_official_sources" as const, refreshed: true, r2Write };
}

export const EQUITY_UNIVERSE_SOURCE_URLS = [NASDAQ_LISTED_URL, OTHER_LISTED_URL, SEC_TICKERS_URL] as const;
