import { readVersionedTextFromR2, writeVersionedJsonToR2 } from "@/lib/r2-warehouse";
import { pr262StorageKey } from "@/lib/opportunity-engine/pr262-storage";

const STATE_KEY = pr262StorageKey("sensor/provider-budgets-v1.json");
const DAY_MS = 24 * 60 * 60_000;
const HOUR_MS = 60 * 60_000;
const MINUTE_MS = 60_000;

type LegacyReservation = { provider?: unknown; quotaKey?: unknown; cadenceKey?: unknown; at?: unknown };
type BudgetState = {
  version: 2;
  updatedAt: string;
  hourlyCounts: Record<string, Record<string, number>>;
  lastCadenceAt: Record<string, string>;
};
type Policy = { provider: string; quotaKey: string; cadenceKey: string; maximumPer24Hours: number; minimumIntervalMs: number };

function emptyState(): BudgetState {
  return { version: 2, updatedAt: new Date(0).toISOString(), hourlyCounts: {}, lastCadenceAt: {} };
}

function policyFor(request: RequestInfo | URL): Policy | null {
  let url: URL;
  try { url = request instanceof URL ? request : new URL(typeof request === "string" ? request : request.url); } catch { return null; }
  const host = url.hostname.toLowerCase();
  const path = url.pathname.toLowerCase();
  if (["sec.gov", "www.sec.gov"].includes(host) && path === "/cgi-bin/browse-edgar") {
    const form = (url.searchParams.get("type") ?? "ALL").toUpperCase();
    return { provider: "sec_edgar", quotaKey: "sensor_sec_current_filings", cadenceKey: `sensor_sec:${form}`, maximumPer24Hours: 650, minimumIntervalMs: 4.5 * MINUTE_MS };
  }
  if (host === "data.sec.gov" && path.startsWith("/submissions/")) {
    return { provider: "sec_edgar", quotaKey: "sensor_sec_submissions", cadenceKey: `sensor_sec_submission:${path}`, maximumPer24Hours: 190, minimumIntervalMs: 29 * MINUTE_MS };
  }
  if (host === "news.google.com") return { provider: "google_news", quotaKey: "sensor_google_news", cadenceKey: "sensor_google_news", maximumPer24Hours: 300, minimumIntervalMs: 4.5 * MINUTE_MS };
  if (host === "api.gdeltproject.org") return { provider: "gdelt", quotaKey: "sensor_gdelt", cadenceKey: "sensor_gdelt", maximumPer24Hours: 100, minimumIntervalMs: 14 * MINUTE_MS };
  if (host === "api.marketaux.com") return { provider: "marketaux", quotaKey: "sensor_marketaux", cadenceKey: "sensor_marketaux", maximumPer24Hours: 96, minimumIntervalMs: 14 * MINUTE_MS };
  if (host === "api.commerce.gov") return { provider: "commerce", quotaKey: "sensor_commerce", cadenceKey: "sensor_commerce", maximumPer24Hours: 52, minimumIntervalMs: 29 * MINUTE_MS };
  if (host === "www.alphavantage.co") {
    const fn = (url.searchParams.get("function") ?? "unknown").toUpperCase();
    const symbol = (url.searchParams.get("symbol") ?? "all").toUpperCase();
    const cadenceSubject = fn === "GLOBAL_QUOTE" ? symbol : "all";
    const minimumIntervalMs = fn === "EARNINGS_CALENDAR" ? 23 * 60 * MINUTE_MS : fn === "GLOBAL_QUOTE" ? 59 * MINUTE_MS : 74 * MINUTE_MS;
    return { provider: "alpha_vantage", quotaKey: "sensor_alpha_vantage", cadenceKey: `sensor_alpha:${fn}:${cadenceSubject}`, maximumPer24Hours: 20, minimumIntervalMs };
  }
  if (host === "financialmodelingprep.com") return { provider: "fmp", quotaKey: "sensor_fmp", cadenceKey: "sensor_fmp_news", maximumPer24Hours: 10, minimumIntervalMs: 119 * MINUTE_MS };
  if (host === "www.federalregister.gov") return { provider: "federal_register", quotaKey: "sensor_federal_register", cadenceKey: "sensor_federal_register", maximumPer24Hours: 52, minimumIntervalMs: 29 * MINUTE_MS };
  if (host === "api.fda.gov") return { provider: "openfda", quotaKey: "sensor_openfda", cadenceKey: "sensor_openfda", maximumPer24Hours: 1, minimumIntervalMs: 23 * 60 * MINUTE_MS };
  if (host === "www.nyse.com" && path === "/api/trade-halts/current") return { provider: "nyse", quotaKey: "sensor_trade_halts", cadenceKey: "sensor_trade_halts:nyse", maximumPer24Hours: 300, minimumIntervalMs: 4.5 * MINUTE_MS };
  if (["m.nasdaqtrader.com", "www.nasdaqtrader.com", "nasdaqtrader.com"].includes(host) && path === "/rss.aspx") return { provider: "nasdaq_trader", quotaKey: "sensor_trade_halts_fallback", cadenceKey: `sensor_trade_halts:${host}`, maximumPer24Hours: 48, minimumIntervalMs: 29 * MINUTE_MS };
  if (host === "fred.stlouisfed.org" || host === "api.stlouisfed.org") {
    const series = (url.searchParams.get("series_id") ?? url.searchParams.get("id") ?? path).toUpperCase();
    return { provider: "fred", quotaKey: "sensor_fred", cadenceKey: `sensor_fred:${series}`, maximumPer24Hours: 48, minimumIntervalMs: 11 * 60 * MINUTE_MS };
  }
  if (host === "api.frankfurter.app") return { provider: "frankfurter", quotaKey: "sensor_frankfurter", cadenceKey: "sensor_frankfurter", maximumPer24Hours: 2, minimumIntervalMs: 11.5 * 60 * MINUTE_MS };
  if (["www.federalreserve.gov", "www.bls.gov", "apps.bea.gov", "www.whitehouse.gov", "www.cisa.gov", "www.state.gov", "www.defense.gov", "www.fda.gov"].includes(host)
    || (host === "www.sec.gov" && path.startsWith("/news/"))) {
    return { provider: "official_government", quotaKey: "sensor_official_government", cadenceKey: `sensor_official:${host}${path}`, maximumPer24Hours: 1_200, minimumIntervalMs: 14 * MINUTE_MS };
  }
  if (host === "scanner.tradingview.com") return { provider: "tradingview", quotaKey: "sensor_tradingview", cadenceKey: "sensor_tradingview_watch", maximumPer24Hours: 300, minimumIntervalMs: 4.5 * MINUTE_MS };
  return null;
}

function hourKey(ms: number) {
  return new Date(Math.floor(ms / HOUR_MS) * HOUR_MS).toISOString().slice(0, 13);
}

function addCount(state: BudgetState, quotaKey: string, atMs: number, amount = 1) {
  const key = hourKey(atMs);
  const buckets = state.hourlyCounts[quotaKey] ??= {};
  buckets[key] = Math.max(0, Number(buckets[key]) || 0) + amount;
}

function prune(state: BudgetState, nowMs: number) {
  const oldestHour = Math.floor((nowMs - DAY_MS) / HOUR_MS) * HOUR_MS;
  for (const [quotaKey, buckets] of Object.entries(state.hourlyCounts)) {
    for (const key of Object.keys(buckets)) {
      const parsed = Date.parse(`${key}:00:00.000Z`);
      if (!Number.isFinite(parsed) || parsed < oldestHour) delete buckets[key];
    }
    if (!Object.keys(buckets).length) delete state.hourlyCounts[quotaKey];
  }
  for (const [cadenceKey, value] of Object.entries(state.lastCadenceAt)) {
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed) || nowMs - parsed > 2 * DAY_MS) delete state.lastCadenceAt[cadenceKey];
  }
}

function quotaCount(state: BudgetState, quotaKey: string) {
  return Object.values(state.hourlyCounts[quotaKey] ?? {}).reduce((sum, value) => sum + Math.max(0, Number(value) || 0), 0);
}

function rollingBudgetNextEligibleAt(state: BudgetState, policy: Policy) {
  const requiredExpiryCount = Math.max(1, quotaCount(state, policy.quotaKey) - policy.maximumPer24Hours + 1);
  let expiredCount = 0;
  const buckets = Object.entries(state.hourlyCounts[policy.quotaKey] ?? {})
    .map(([key, value]) => ({ at: Date.parse(`${key}:00:00.000Z`), count: Math.max(0, Number(value) || 0) }))
    .filter((entry) => Number.isFinite(entry.at) && entry.count > 0)
    .sort((left, right) => left.at - right.at);
  for (const bucket of buckets) {
    expiredCount += bucket.count;
    if (expiredCount >= requiredExpiryCount) {
      // Counts are intentionally compacted into hourly buckets. Waiting until
      // the end of the oldest required bucket guarantees every request in that
      // bucket is outside the rolling 24-hour window without storing a large
      // per-request ledger.
      return new Date(bucket.at + DAY_MS + HOUR_MS).toISOString();
    }
  }
  return null;
}

function budgetGuardError(policy: Policy, reason: "minimum_interval" | "rolling_24h_budget", nextEligibleAt: string | null) {
  const retry = nextEligibleAt ? `;next_retry_at=${nextEligibleAt}` : "";
  return new Error(`pr262_sensor_budget_guard:${policy.provider}:${reason}${retry}`);
}

function migrate(raw: unknown, nowMs: number): BudgetState {
  const value = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  if (value.version === 2) {
    const state: BudgetState = {
      version: 2,
      updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : new Date(0).toISOString(),
      hourlyCounts: value.hourlyCounts && typeof value.hourlyCounts === "object" && !Array.isArray(value.hourlyCounts) ? value.hourlyCounts as Record<string, Record<string, number>> : {},
      lastCadenceAt: value.lastCadenceAt && typeof value.lastCadenceAt === "object" && !Array.isArray(value.lastCadenceAt) ? value.lastCadenceAt as Record<string, string> : {},
    };
    prune(state, nowMs);
    return state;
  }

  const state = emptyState();
  const reservations = Array.isArray(value.reservations) ? value.reservations as LegacyReservation[] : [];
  for (const reservation of reservations) {
    if (typeof reservation.quotaKey !== "string" || typeof reservation.cadenceKey !== "string" || typeof reservation.at !== "string") continue;
    const at = Date.parse(reservation.at);
    if (!Number.isFinite(at) || nowMs - at < 0 || nowMs - at > DAY_MS) continue;
    addCount(state, reservation.quotaKey, at);
    const previous = Date.parse(state.lastCadenceAt[reservation.cadenceKey] ?? "");
    if (!Number.isFinite(previous) || at > previous) state.lastCadenceAt[reservation.cadenceKey] = new Date(at).toISOString();
  }
  prune(state, nowMs);
  return state;
}

async function load(now: Date) {
  const current = await readVersionedTextFromR2(STATE_KEY);
  if (!current.found || !current.text) return { state: emptyState(), etag: current.etag, corrupt: false };
  try { return { state: migrate(JSON.parse(current.text), now.getTime()), etag: current.etag, corrupt: false }; }
  catch { return { state: emptyState(), etag: current.etag, corrupt: true }; }
}

export async function createPr262SensorBudgetedFetch(input: { now?: Date; fetchImpl?: typeof fetch; signal?: AbortSignal } = {}) {
  const now = input.now ?? new Date();
  const rawFetch = input.fetchImpl ?? fetch;
  let loaded = await load(now);
  let state = loaded.state;
  const blocked: Array<{ provider: string; reason: string; nextEligibleAt: string | null }> = [];
  let reservationTail: Promise<void> = Promise.resolve();

  const reserveBeforeNetwork = async (policy: Policy, currentMs: number) => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      loaded = await load(new Date(currentMs));
      if (loaded.corrupt) throw new Error("pr262_sensor_provider_budget_state_invalid");
      const candidate = loaded.state;
      prune(candidate, currentMs);
      const used = quotaCount(candidate, policy.quotaKey);
      if (used >= policy.maximumPer24Hours) {
        const nextEligibleAt = rollingBudgetNextEligibleAt(candidate, policy);
        blocked.push({ provider: policy.provider, reason: "rolling_24h_budget", nextEligibleAt });
        throw budgetGuardError(policy, "rolling_24h_budget", nextEligibleAt);
      }
      const last = Date.parse(candidate.lastCadenceAt[policy.cadenceKey] ?? "");
      if (Number.isFinite(last) && currentMs - last < policy.minimumIntervalMs) {
        const nextEligibleAt = new Date(last + policy.minimumIntervalMs).toISOString();
        blocked.push({ provider: policy.provider, reason: "minimum_interval", nextEligibleAt });
        throw budgetGuardError(policy, "minimum_interval", nextEligibleAt);
      }
      addCount(candidate, policy.quotaKey, currentMs);
      candidate.lastCadenceAt[policy.cadenceKey] = new Date(currentMs).toISOString();
      candidate.updatedAt = new Date(currentMs).toISOString();
      const written = await writeVersionedJsonToR2(
        STATE_KEY,
        candidate,
        loaded.etag ? { expectedEtag: loaded.etag } : { createOnly: true },
      );
      if (!written.conflict) {
        state = candidate;
        loaded = { state: candidate, etag: written.etag, corrupt: false };
        return;
      }
    }
    throw new Error("pr262_sensor_provider_budget_reservation_conflict");
  };

  const fetchImpl: typeof fetch = async (request, init) => {
    const policy = policyFor(request);
    const signal = input.signal
      ? init?.signal ? AbortSignal.any([input.signal, init.signal]) : input.signal
      : init?.signal;
    if (!policy) return rawFetch(request, { ...init, signal });
    signal?.throwIfAborted();
    const currentMs = Date.now();
    // Source reads run concurrently, but their compact R2 budget ledger is one
    // shared document. Serialize only this short reservation step so parallel
    // providers do not exhaust CAS retries by colliding with one another.
    const reservation = reservationTail.then(() => reserveBeforeNetwork(policy, currentMs));
    reservationTail = reservation.then(() => undefined, () => undefined);
    await reservation;
    return rawFetch(request, { ...init, signal });
  };

  const flush = async () => {
    return {
      persisted: true,
      key: STATE_KEY,
      reservationsPersistedBeforeNetwork: true,
      hourlyBucketCount: Object.values(state.hourlyCounts).reduce((sum, buckets) => sum + Object.keys(buckets).length, 0),
    };
  };

  return {
    fetchImpl,
    flush,
    summary: () => ({
      hourlyBucketCount: Object.values(state.hourlyCounts).reduce((sum, buckets) => sum + Object.keys(buckets).length, 0),
      blocked: blocked.slice(-50),
      policiesAreHardNetworkGuards: true,
      freeTierHeadroomReserved: true,
      compactR2Ledger: true,
      reservationsPersistedBeforeNetwork: true,
    }),
  };
}
