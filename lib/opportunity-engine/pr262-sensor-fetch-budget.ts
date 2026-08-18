import { readVersionedTextFromR2, writeVersionedJsonToR2 } from "@/lib/r2-warehouse";

const STATE_KEY = "branch-labs/pr-262/sensor/provider-budgets-v1.json";
const DAY_MS = 24 * 60 * 60_000;
const MINUTE_MS = 60_000;

type Reservation = { provider: string; quotaKey: string; cadenceKey: string; at: string };
type BudgetState = { version: 1; updatedAt: string; reservations: Reservation[] };
type Policy = { provider: string; quotaKey: string; cadenceKey: string; maximumPer24Hours: number; minimumIntervalMs: number };

function emptyState(): BudgetState {
  return { version: 1, updatedAt: new Date(0).toISOString(), reservations: [] };
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
  if (host === "news.google.com") return { provider: "google_news", quotaKey: "sensor_google_news", cadenceKey: "sensor_google_news", maximumPer24Hours: 280, minimumIntervalMs: 4.5 * MINUTE_MS };
  if (host === "api.gdeltproject.org") return { provider: "gdelt", quotaKey: "sensor_gdelt", cadenceKey: "sensor_gdelt", maximumPer24Hours: 90, minimumIntervalMs: 14 * MINUTE_MS };
  if (host === "api.marketaux.com") return { provider: "marketaux", quotaKey: "sensor_marketaux", cadenceKey: "sensor_marketaux", maximumPer24Hours: 90, minimumIntervalMs: 19 * MINUTE_MS };
  if (host === "api.commerce.gov") return { provider: "commerce", quotaKey: "sensor_commerce", cadenceKey: "sensor_commerce", maximumPer24Hours: 46, minimumIntervalMs: 29 * MINUTE_MS };
  if (host === "www.alphavantage.co") {
    const fn = (url.searchParams.get("function") ?? "unknown").toUpperCase();
    return { provider: "alpha_vantage", quotaKey: "sensor_alpha_vantage", cadenceKey: `sensor_alpha:${fn}`, maximumPer24Hours: 8, minimumIntervalMs: fn === "EARNINGS_CALENDAR" ? 23 * 60 * MINUTE_MS : 179 * MINUTE_MS };
  }
  if (host === "financialmodelingprep.com") return { provider: "fmp", quotaKey: "sensor_fmp", cadenceKey: "sensor_fmp_news", maximumPer24Hours: 8, minimumIntervalMs: 179 * MINUTE_MS };
  if (host === "www.federalregister.gov") return { provider: "federal_register", quotaKey: "sensor_federal_register", cadenceKey: "sensor_federal_register", maximumPer24Hours: 46, minimumIntervalMs: 29 * MINUTE_MS };
  if (host === "api.fda.gov") return { provider: "openfda", quotaKey: "sensor_openfda", cadenceKey: "sensor_openfda", maximumPer24Hours: 4, minimumIntervalMs: 6 * 60 * MINUTE_MS };
  if (host === "www.nyse.com" && path === "/api/trade-halts/current") return { provider: "nyse", quotaKey: "sensor_trade_halts", cadenceKey: "sensor_trade_halts:nyse", maximumPer24Hours: 280, minimumIntervalMs: 4.5 * MINUTE_MS };
  if (["m.nasdaqtrader.com", "www.nasdaqtrader.com", "nasdaqtrader.com"].includes(host) && path === "/rss.aspx") return { provider: "nasdaq_trader", quotaKey: "sensor_trade_halts_fallback", cadenceKey: `sensor_trade_halts:${host}`, maximumPer24Hours: 48, minimumIntervalMs: 29 * MINUTE_MS };
  if (host === "fred.stlouisfed.org" || host === "api.stlouisfed.org") {
    const series = (url.searchParams.get("series_id") ?? url.searchParams.get("id") ?? path).toUpperCase();
    return { provider: "fred", quotaKey: "sensor_fred", cadenceKey: `sensor_fred:${series}`, maximumPer24Hours: 48, minimumIntervalMs: 11 * 60 * MINUTE_MS };
  }
  if (host === "api.frankfurter.app") return { provider: "frankfurter", quotaKey: "sensor_frankfurter", cadenceKey: "sensor_frankfurter", maximumPer24Hours: 2, minimumIntervalMs: 11.5 * 60 * MINUTE_MS };
  if (["www.federalreserve.gov", "www.bls.gov", "apps.bea.gov", "www.whitehouse.gov", "www.cisa.gov", "www.state.gov", "www.defense.gov"].includes(host)
    || (host === "www.sec.gov" && path.startsWith("/news/"))) {
    return { provider: "official_government", quotaKey: "sensor_official_government", cadenceKey: `sensor_official:${host}${path}`, maximumPer24Hours: 1_100, minimumIntervalMs: 14 * MINUTE_MS };
  }
  if (host === "scanner.tradingview.com") return { provider: "tradingview", quotaKey: "sensor_tradingview", cadenceKey: "sensor_tradingview_watch", maximumPer24Hours: 280, minimumIntervalMs: 4.5 * MINUTE_MS };
  return null;
}

async function load(now: Date) {
  const current = await readVersionedTextFromR2(STATE_KEY);
  if (!current.found || !current.text) return { state: emptyState(), etag: current.etag };
  let parsed = emptyState();
  try {
    const raw = JSON.parse(current.text) as Partial<BudgetState>;
    parsed = {
      version: 1,
      updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : new Date(0).toISOString(),
      reservations: Array.isArray(raw.reservations) ? raw.reservations.filter((item): item is Reservation => Boolean(item && typeof item.at === "string" && typeof item.quotaKey === "string" && typeof item.cadenceKey === "string" && typeof item.provider === "string")) : [],
    };
  } catch {}
  parsed.reservations = parsed.reservations.filter((item) => {
    const at = Date.parse(item.at);
    return Number.isFinite(at) && now.getTime() - at >= 0 && now.getTime() - at < DAY_MS;
  });
  return { state: parsed, etag: current.etag };
}

export async function createPr262SensorBudgetedFetch(input: { now?: Date; fetchImpl?: typeof fetch } = {}) {
  const now = input.now ?? new Date();
  const rawFetch = input.fetchImpl ?? fetch;
  const loaded = await load(now);
  const state = loaded.state;
  const blocked: Array<{ provider: string; reason: string; nextEligibleAt: string | null }> = [];
  let dirty = false;

  const fetchImpl: typeof fetch = async (request, init) => {
    const policy = policyFor(request);
    if (!policy) return rawFetch(request, init);
    const current = new Date();
    const window = state.reservations.filter((item) => item.quotaKey === policy.quotaKey && current.getTime() - Date.parse(item.at) < DAY_MS);
    if (window.length >= policy.maximumPer24Hours) {
      const oldest = window.map((item) => Date.parse(item.at)).filter(Number.isFinite).sort((a, b) => a - b)[0];
      const nextEligibleAt = Number.isFinite(oldest) ? new Date(oldest + DAY_MS).toISOString() : null;
      blocked.push({ provider: policy.provider, reason: "rolling_24h_budget", nextEligibleAt });
      throw new Error(`pr262_sensor_budget_guard:${policy.provider}:rolling_24h_budget`);
    }
    const latest = state.reservations
      .filter((item) => item.cadenceKey === policy.cadenceKey)
      .map((item) => Date.parse(item.at))
      .filter(Number.isFinite)
      .sort((a, b) => b - a)[0];
    if (Number.isFinite(latest) && current.getTime() - latest < policy.minimumIntervalMs) {
      const nextEligibleAt = new Date(latest + policy.minimumIntervalMs).toISOString();
      blocked.push({ provider: policy.provider, reason: "minimum_interval", nextEligibleAt });
      throw new Error(`pr262_sensor_budget_guard:${policy.provider}:minimum_interval`);
    }
    state.reservations.push({ provider: policy.provider, quotaKey: policy.quotaKey, cadenceKey: policy.cadenceKey, at: current.toISOString() });
    dirty = true;
    return rawFetch(request, init);
  };

  const flush = async () => {
    if (!dirty) return { persisted: false, key: STATE_KEY, reservationCount: state.reservations.length };
    state.updatedAt = new Date().toISOString();
    state.reservations = state.reservations.filter((item) => Date.now() - Date.parse(item.at) < DAY_MS).slice(-4_000);
    const written = await writeVersionedJsonToR2(STATE_KEY, state, loaded.etag ? { expectedEtag: loaded.etag } : { createOnly: true });
    if (written.conflict) throw new Error("pr262_sensor_provider_budget_state_conflict");
    return { persisted: true, key: STATE_KEY, reservationCount: state.reservations.length };
  };

  return {
    fetchImpl,
    flush,
    summary: () => ({
      reservationsThisWindow: state.reservations.length,
      blocked: blocked.slice(-50),
      policiesAreHardNetworkGuards: true,
      freeTierHeadroomReserved: true,
    }),
  };
}
