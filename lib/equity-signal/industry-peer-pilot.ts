import type { HistoricalAnalogHorizon, HistoricalSignalRecord } from "@/lib/equity-signal/historical-analogs";

export type PilotHistoricalGate = {
  passed: boolean;
  mode: "exact_company_history" | "same_industry_peer_history" | "same_sector_peer_history" | "insufficient_history";
  confidenceTier: "pilot_five_independent_cases";
  statisticallyEquivalentToThirtySamples: false;
  minimumRequiredEvents: 5;
  minimumObservedDirectionalHitRatePercent: 80;
  independentRealEventCount: number;
  distinctHistoricalTickers: number;
  observedDirectionalHitRatePercent: number;
  lowerQuartileDirectionAdjustedReturnPercent: number | null;
  selectedHorizon: HistoricalAnalogHorizon | null;
  currentSector: string | null;
  currentIndustry: string | null;
  matchedHistoricalTickers: string[];
  checks: {
    fiveIndependentRealEvents: boolean;
    sameDirectionHistoricalEvents: boolean;
    leakageSafeHistory: boolean;
    observedDirectionalHitRateAtLeast80: boolean;
    usableHistoricalHorizon: boolean;
    nonNegativeLowerQuartileOutcome: boolean;
    sameCompanyOrIndustryPeer: boolean;
  };
  blockers: string[];
  items: Array<{
    eventKey: string;
    ticker: string;
    signalObservedAt: string;
    outcomeObservedAt: string;
    horizon: HistoricalAnalogHorizon;
    directionAdjustedReturnPercent: number;
    hit: boolean;
    sector: string | null;
    industry: string | null;
    matchType: "exact_company" | "same_industry" | "same_sector";
    eventSourceUrl: string;
    priceSource: string;
  }>;
  directoryDiagnostics: {
    provider: "TradingView public US stock scanner";
    fetchedAt: string | null;
    primaryListings: number;
    pagesRequested: number;
    pagesFailed: number;
    errors: string[];
    cacheUsed: boolean;
  };
  warning: string;
};

type Json = Record<string, unknown>;
type IndustryProfile = { ticker: string; sector: string | null; industry: string | null; exchange: string };
type DirectoryCache = {
  expiresAt: number;
  fetchedAt: string;
  profiles: Map<string, IndustryProfile>;
  pagesRequested: number;
  pagesFailed: number;
  errors: string[];
};

const MINIMUM_EVENTS = 5;
const MINIMUM_HIT_RATE = 80;
const CACHE_MS = 24 * 60 * 60 * 1000;
const PAGE_SIZE = 1_000;
const MAX_LISTINGS = 20_000;
const COLUMNS = ["name", "description", "exchange", "country", "type", "is_primary", "sector", "industry"] as const;
const US_EXCHANGES = new Set(["NASDAQ", "NYSE", "AMEX", "NYSEAMERICAN"]);
const HORIZON_PLAN: Record<string, HistoricalAnalogHorizon[]> = {
  direct: ["7D", "3D", "1D", "30D", "90D"],
  second_order: ["30D", "7D", "3D", "1D", "90D"],
  third_order: ["90D", "30D", "7D", "3D", "1D"],
};
let directoryCache: DirectoryCache | null = null;

function object(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function finite(value: unknown) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function boolean(value: unknown) {
  return value === true || value === 1 || value === "true";
}

function normalized(value: string | null) {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function safeError(error: unknown) {
  return error instanceof Error ? error.message.replace(/\s+/g, " ").slice(0, 240) : "industry_directory_failure";
}

function parseProfile(value: unknown): IndustryProfile | null {
  const row = object(value);
  const symbol = text(row.s)?.toUpperCase();
  const data = Array.isArray(row.d) ? row.d : [];
  if (!symbol || data.length < COLUMNS.length) return null;
  const separator = symbol.indexOf(":");
  const ticker = separator >= 0 ? symbol.slice(separator + 1) : symbol;
  const exchange = (text(data[2]) ?? (separator >= 0 ? symbol.slice(0, separator) : "UNKNOWN")).toUpperCase().replace(/[^A-Z0-9]/g, "");
  const country = text(data[3]);
  const type = text(data[4]);
  const primary = boolean(data[5]);
  if (!ticker || type !== "stock" || !primary) return null;
  if (!(country?.toLowerCase().includes("united states") || US_EXCHANGES.has(exchange))) return null;
  return { ticker, exchange, sector: text(data[6]), industry: text(data[7]) };
}

async function fetchDirectoryPage(fetchImpl: typeof fetch, start: number) {
  try {
    const response = await fetchImpl("https://scanner.tradingview.com/america/scan", {
      method: "POST",
      cache: "no-store",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        origin: "https://www.tradingview.com",
        referer: "https://www.tradingview.com/",
        "user-agent": "Mozilla/5.0 (compatible; SwingUpIndustryPeers/1.0)",
      },
      body: JSON.stringify({
        filter: [
          { left: "type", operation: "equal", right: "stock" },
          { left: "is_primary", operation: "equal", right: true },
        ],
        options: { lang: "en" },
        markets: ["america"],
        symbols: { query: { types: [] }, tickers: [] },
        columns: [...COLUMNS],
        sort: { sortBy: "market_cap_basic", sortOrder: "desc" },
        range: [start, start + PAGE_SIZE - 1],
      }),
      signal: AbortSignal.timeout(45_000),
    });
    const payload = await response.json().catch(async () => await response.text().catch(() => null));
    if (!response.ok) throw new Error(`tradingview_industry_http_${response.status}`);
    const container = object(payload);
    const rawRows = Array.isArray(container.data) ? container.data : [];
    return {
      totalCount: Math.max(rawRows.length, Math.floor(finite(container.totalCount) ?? rawRows.length)),
      profiles: rawRows.flatMap((row) => parseProfile(row) ?? []),
      error: null as string | null,
    };
  } catch (error) {
    return { totalCount: 0, profiles: [] as IndustryProfile[], error: safeError(error) };
  }
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>) {
  const output = new Array<R>(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, items.length)) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await worker(items[index]);
    }
  }));
  return output;
}

async function industryDirectory(fetchImpl: typeof fetch) {
  if (directoryCache && directoryCache.expiresAt > Date.now()) return { cache: directoryCache, cacheUsed: true };
  const first = await fetchDirectoryPage(fetchImpl, 0);
  const target = Math.min(MAX_LISTINGS, first.totalCount);
  const starts = Array.from({ length: Math.max(0, Math.ceil(target / PAGE_SIZE) - 1) }, (_, index) => (index + 1) * PAGE_SIZE);
  const remaining = await mapWithConcurrency(starts, 6, (start) => fetchDirectoryPage(fetchImpl, start));
  const pages = [first, ...remaining];
  const profiles = new Map<string, IndustryProfile>();
  for (const page of pages) for (const profile of page.profiles) if (!profiles.has(profile.ticker)) profiles.set(profile.ticker, profile);
  directoryCache = {
    expiresAt: Date.now() + CACHE_MS,
    fetchedAt: new Date().toISOString(),
    profiles,
    pagesRequested: pages.length,
    pagesFailed: pages.filter((page) => page.error).length,
    errors: pages.flatMap((page) => page.error ?? []),
  };
  return { cache: directoryCache, cacheUsed: false };
}

function exactCompanyItems(candidate: Json) {
  const ticker = text(candidate.ticker)?.toUpperCase() ?? "";
  const analog = object(candidate.historicalAnalog);
  return (Array.isArray(analog.items) ? analog.items : []).flatMap((raw) => {
    const item = object(raw);
    const itemTicker = text(item.ticker)?.toUpperCase();
    const returnPercent = finite(item.directionAdjustedReturnPercent);
    const horizon = text(item.horizon) as HistoricalAnalogHorizon | null;
    const eventKey = text(item.eventKey) ?? text(item.recordId);
    const provenance = object(item.provenance);
    if (!ticker || itemTicker !== ticker || returnPercent === null || !horizon || !eventKey || !text(provenance.eventSourceUrl) || !text(provenance.priceSource)) return [];
    return [{
      eventKey,
      ticker: itemTicker,
      signalObservedAt: text(item.signalObservedAt) ?? "",
      outcomeObservedAt: text(item.outcomeObservedAt) ?? "",
      horizon,
      directionAdjustedReturnPercent: returnPercent,
      hit: item.hit === true,
      sector: null,
      industry: null,
      matchType: "exact_company" as const,
      eventSourceUrl: text(provenance.eventSourceUrl) ?? "",
      priceSource: text(provenance.priceSource) ?? "",
    }];
  });
}

function quantile25(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor((sorted.length - 1) * 0.25)] ?? null;
}

function summarizeGate(input: {
  mode: PilotHistoricalGate["mode"];
  items: PilotHistoricalGate["items"];
  selectedHorizon: HistoricalAnalogHorizon | null;
  currentSector: string | null;
  currentIndustry: string | null;
  directory: PilotHistoricalGate["directoryDiagnostics"];
}) {
  const unique = [...new Map(input.items.map((item) => [item.eventKey, item])).values()];
  const successes = unique.filter((item) => item.hit).length;
  const hitRate = unique.length ? (successes / unique.length) * 100 : 0;
  const lowerQuartile = quantile25(unique.map((item) => item.directionAdjustedReturnPercent));
  const distinctTickers = new Set(unique.map((item) => item.ticker)).size;
  const peerMode = input.mode === "same_industry_peer_history" || input.mode === "same_sector_peer_history";
  const checks = {
    fiveIndependentRealEvents: unique.length >= MINIMUM_EVENTS,
    sameDirectionHistoricalEvents: unique.length >= MINIMUM_EVENTS,
    leakageSafeHistory: unique.length > 0 && unique.every((item) => Number.isFinite(Date.parse(item.signalObservedAt)) && Number.isFinite(Date.parse(item.outcomeObservedAt)) && Date.parse(item.outcomeObservedAt) >= Date.parse(item.signalObservedAt)),
    observedDirectionalHitRateAtLeast80: hitRate >= MINIMUM_HIT_RATE,
    usableHistoricalHorizon: input.selectedHorizon !== null,
    nonNegativeLowerQuartileOutcome: lowerQuartile !== null && lowerQuartile >= 0,
    sameCompanyOrIndustryPeer: input.mode === "exact_company_history" || (peerMode && distinctTickers >= 2),
  };
  const blockers = [
    ...(!checks.fiveIndependentRealEvents ? [`Only ${unique.length} independent real events were available; five are required.`] : []),
    ...(!checks.leakageSafeHistory ? ["At least one event or outcome timestamp failed the no-future-information check."] : []),
    ...(!checks.observedDirectionalHitRateAtLeast80 ? [`Observed directional success was ${hitRate.toFixed(2)}%, below the 80% pilot requirement.`] : []),
    ...(!checks.usableHistoricalHorizon ? ["No common historical outcome horizon had five eligible events."] : []),
    ...(!checks.nonNegativeLowerQuartileOutcome ? ["The weaker quarter of historical outcomes was negative."] : []),
    ...(!checks.sameCompanyOrIndustryPeer ? ["The examples were not from the same company or a sufficiently broad same-industry peer group."] : []),
  ];
  return {
    passed: Object.values(checks).every(Boolean),
    mode: input.mode,
    confidenceTier: "pilot_five_independent_cases" as const,
    statisticallyEquivalentToThirtySamples: false as const,
    minimumRequiredEvents: MINIMUM_EVENTS as const,
    minimumObservedDirectionalHitRatePercent: MINIMUM_HIT_RATE as const,
    independentRealEventCount: unique.length,
    distinctHistoricalTickers: distinctTickers,
    observedDirectionalHitRatePercent: Math.round(hitRate * 100) / 100,
    lowerQuartileDirectionAdjustedReturnPercent: lowerQuartile,
    selectedHorizon: input.selectedHorizon,
    currentSector: input.currentSector,
    currentIndustry: input.currentIndustry,
    matchedHistoricalTickers: [...new Set(unique.map((item) => item.ticker))].sort(),
    checks,
    blockers,
    items: unique,
    directoryDiagnostics: input.directory,
    warning: "Pilot serious signal based on at least five independent real same-company or same-industry events. Four wins out of five pass the 80% pilot threshold; this is not equivalent to a 30-plus-sample certificate.",
  } satisfies PilotHistoricalGate;
}

function eligibleRecord(record: HistoricalSignalRecord, candidate: Json, now: Date) {
  const eventFamily = text(candidate.eventFamily);
  const direction = text(candidate.direction);
  const signalTime = Date.parse(record.signalObservedAt);
  const featureTime = Date.parse(record.featuresAsOf);
  return record.dataQuality === "real"
    && record.eventFamily === eventFamily
    && record.direction === direction
    && Boolean(record.provenance?.eventSourceUrl)
    && Boolean(record.provenance?.priceSource)
    && Number.isFinite(signalTime)
    && Number.isFinite(featureTime)
    && featureTime <= signalTime
    && signalTime < now.getTime();
}

export async function evaluateIndustryPeerPilotGate(input: {
  candidate: unknown;
  historicalSignals: HistoricalSignalRecord[];
  fetchImpl?: typeof fetch;
  now?: Date;
}) {
  const candidate = object(input.candidate);
  const now = input.now ?? new Date();
  const fetchImpl = input.fetchImpl ?? fetch;
  const ticker = text(candidate.ticker)?.toUpperCase() ?? "";
  const exact = exactCompanyItems(candidate);
  if (exact.length >= MINIMUM_EVENTS) {
    const horizons = HORIZON_PLAN[text(candidate.relationship) ?? "direct"] ?? HORIZON_PLAN.direct;
    const selected = horizons.find((horizon) => exact.filter((item) => item.horizon === horizon).length >= MINIMUM_EVENTS) ?? null;
    const items = selected ? exact.filter((item) => item.horizon === selected) : [];
    return summarizeGate({
      mode: "exact_company_history",
      items,
      selectedHorizon: selected,
      currentSector: null,
      currentIndustry: null,
      directory: { provider: "TradingView public US stock scanner", fetchedAt: null, primaryListings: 0, pagesRequested: 0, pagesFailed: 0, errors: [], cacheUsed: true },
    });
  }

  const directoryResult = await industryDirectory(fetchImpl);
  const directory = directoryResult.cache;
  const current = directory.profiles.get(ticker);
  const diagnostics = {
    provider: "TradingView public US stock scanner" as const,
    fetchedAt: directory.fetchedAt,
    primaryListings: directory.profiles.size,
    pagesRequested: directory.pagesRequested,
    pagesFailed: directory.pagesFailed,
    errors: directory.errors,
    cacheUsed: directoryResult.cacheUsed,
  };
  if (!current || (!current.industry && !current.sector)) {
    return summarizeGate({ mode: "insufficient_history", items: [], selectedHorizon: null, currentSector: current?.sector ?? null, currentIndustry: current?.industry ?? null, directory: diagnostics });
  }

  const records = input.historicalSignals.filter((record) => eligibleRecord(record, candidate, now));
  const horizons = HORIZON_PLAN[text(candidate.relationship) ?? "direct"] ?? HORIZON_PLAN.direct;
  let selectedHorizon: HistoricalAnalogHorizon | null = null;
  let selectedItems: PilotHistoricalGate["items"] = [];
  let selectedMode: PilotHistoricalGate["mode"] = "insufficient_history";
  for (const horizon of horizons) {
    const items = records.flatMap((record): PilotHistoricalGate["items"] => {
      const profile = directory.profiles.get(record.ticker.toUpperCase());
      const checkpoint = record.checkpoints[horizon];
      if (!profile || !checkpoint || Date.parse(checkpoint.observedAt) >= now.getTime()) return [];
      const sameIndustry = Boolean(current.industry && profile.industry && normalized(current.industry) === normalized(profile.industry));
      const sameSector = Boolean(current.sector && profile.sector && normalized(current.sector) === normalized(profile.sector));
      if (!sameIndustry && !sameSector) return [];
      const rawReturn = checkpoint.returnPercent;
      const directionAdjustedReturnPercent = record.direction === "downside" ? -rawReturn : rawReturn;
      return [{
        eventKey: record.eventKey,
        ticker: record.ticker.toUpperCase(),
        signalObservedAt: record.signalObservedAt,
        outcomeObservedAt: checkpoint.observedAt,
        horizon,
        directionAdjustedReturnPercent: Math.round(directionAdjustedReturnPercent * 100) / 100,
        hit: directionAdjustedReturnPercent > 0,
        sector: profile.sector,
        industry: profile.industry,
        matchType: sameIndustry ? "same_industry" : "same_sector",
        eventSourceUrl: record.provenance?.eventSourceUrl ?? "",
        priceSource: record.provenance?.priceSource ?? "",
      }];
    });
    const independent = [...new Map(items.map((item) => [item.eventKey, item])).values()];
    if (independent.length >= MINIMUM_EVENTS) {
      selectedHorizon = horizon;
      selectedItems = independent;
      selectedMode = independent.every((item) => item.matchType === "same_industry") ? "same_industry_peer_history" : "same_sector_peer_history";
      break;
    }
    if (independent.length > selectedItems.length) {
      selectedHorizon = horizon;
      selectedItems = independent;
      selectedMode = independent.every((item) => item.matchType === "same_industry") ? "same_industry_peer_history" : "same_sector_peer_history";
    }
  }
  return summarizeGate({ mode: selectedMode, items: selectedItems, selectedHorizon, currentSector: current.sector, currentIndustry: current.industry, directory: diagnostics });
}
