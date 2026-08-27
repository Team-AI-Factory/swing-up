type JsonRecord = Record<string, unknown>;

export type ProviderAuditStatus =
  | "connected"
  | "partial"
  | "missing_key"
  | "plan_restricted"
  | "rate_limited"
  | "invalid_key"
  | "unavailable";

export type ProviderEndpointAudit = {
  endpoint: string;
  status: ProviderAuditStatus;
  httpStatus: number | null;
  latencyMs: number;
  recordCount: number;
  sampleKeys: string[];
  usefulFields: string[];
  error: string | null;
};

export type ProviderAuditResult = {
  provider: "FMP" | "Alpha Vantage" | "Marketaux" | "Polygon";
  configured: boolean;
  status: ProviderAuditStatus;
  endpoints: ProviderEndpointAudit[];
  usableFor: string[];
};

const text = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : null;
const rows = (value: unknown): JsonRecord[] => Array.isArray(value)
  ? value.filter((item): item is JsonRecord => Boolean(item) && typeof item === "object" && !Array.isArray(item))
  : value && typeof value === "object" ? [value as JsonRecord] : [];

function safeError(value: unknown) {
  const message = value instanceof Error ? value.message : String(value ?? "provider_request_failed");
  return message.replace(/[A-Za-z0-9_\-]{24,}/g, "[redacted]").slice(0, 220);
}

function classify(httpStatus: number | null, body: unknown): ProviderAuditStatus {
  const message = JSON.stringify(body ?? "").toLowerCase();
  if (httpStatus === 401 || /invalid.*api|invalid.*key|api key.*invalid|apikey.*invalid/.test(message)) return "invalid_key";
  if (httpStatus === 429 || /limit reach|rate limit|too many requests|frequency|quota/.test(message)) return "rate_limited";
  if (httpStatus === 403 || /subscription|premium|upgrade|plan required|not available under your current plan/.test(message)) return "plan_restricted";
  if (httpStatus !== null && httpStatus >= 400) return "unavailable";
  return rows(body).length ? "connected" : "partial";
}

function findUsefulFields(body: unknown, patterns: RegExp[]) {
  const keys = Object.keys(rows(body)[0] ?? {});
  return keys.filter((key) => patterns.some((pattern) => pattern.test(key))).slice(0, 20);
}

async function auditEndpoint(params: {
  endpoint: string;
  url: URL;
  headers?: Record<string, string>;
  usefulPatterns: RegExp[];
}): Promise<ProviderEndpointAudit> {
  const startedAt = Date.now();
  try {
    const response = await fetch(params.url, {
      headers: { Accept: "application/json", ...params.headers },
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = await response.text().catch(() => null);
    }
    const status = classify(response.status, body);
    return {
      endpoint: params.endpoint,
      status,
      httpStatus: response.status,
      latencyMs: Date.now() - startedAt,
      recordCount: rows(body).length,
      sampleKeys: Object.keys(rows(body)[0] ?? {}).slice(0, 25),
      usefulFields: findUsefulFields(body, params.usefulPatterns),
      error: status === "connected" || status === "partial" ? null : safeError(typeof body === "string" ? body : JSON.stringify(body).slice(0, 500)),
    };
  } catch (error) {
    return {
      endpoint: params.endpoint,
      status: "unavailable",
      httpStatus: null,
      latencyMs: Date.now() - startedAt,
      recordCount: 0,
      sampleKeys: [],
      usefulFields: [],
      error: safeError(error),
    };
  }
}

function aggregate(provider: ProviderAuditResult["provider"], configured: boolean, endpoints: ProviderEndpointAudit[], usableFor: string[]): ProviderAuditResult {
  if (!configured) return { provider, configured, status: "missing_key", endpoints: [], usableFor: [] };
  const connected = endpoints.filter((endpoint) => endpoint.status === "connected");
  const status: ProviderAuditStatus = connected.length === endpoints.length
    ? "connected"
    : connected.length
      ? "partial"
      : endpoints.find((endpoint) => endpoint.status === "rate_limited")?.status
        ?? endpoints.find((endpoint) => endpoint.status === "plan_restricted")?.status
        ?? endpoints.find((endpoint) => endpoint.status === "invalid_key")?.status
        ?? "unavailable";
  return { provider, configured, status, endpoints, usableFor: connected.length ? usableFor : [] };
}

async function auditFmp(ticker: string): Promise<ProviderAuditResult> {
  const key = process.env.FMP_API_KEY?.trim();
  if (!key) return aggregate("FMP", false, [], []);
  const base = (process.env.FMP_BASE_URL?.trim() || "https://financialmodelingprep.com").replace(/\/api\/v3\/?$/, "");
  const definitions = [
    { endpoint: "quote", path: "/stable/quote", params: { symbol: ticker }, patterns: [/price/i, /volume/i, /marketCap/i, /change/i] },
    { endpoint: "analyst-estimates", path: "/stable/analyst-estimates", params: { symbol: ticker, period: "annual", page: "0", limit: "4" }, patterns: [/revenue/i, /eps/i, /analyst/i, /date/i] },
    { endpoint: "price-target-consensus", path: "/stable/price-target-consensus", params: { symbol: ticker }, patterns: [/target/i, /consensus/i, /median/i, /high/i, /low/i] },
    { endpoint: "grades-summary", path: "/stable/grades-summary", params: { symbol: ticker }, patterns: [/buy/i, /hold/i, /sell/i, /rating/i] },
  ];
  const endpoints: ProviderEndpointAudit[] = [];
  for (const definition of definitions) {
    const url = new URL(`${base}${definition.path}`);
    for (const [name, value] of Object.entries(definition.params)) url.searchParams.set(name, value);
    url.searchParams.set("apikey", key);
    endpoints.push(await auditEndpoint({ endpoint: definition.endpoint, url, headers: { apikey: key }, usefulPatterns: definition.patterns }));
  }
  return aggregate("FMP", true, endpoints, ["real-time quote", "analyst estimates", "price-target range", "analyst rating distribution"]);
}

async function auditAlphaVantage(ticker: string): Promise<ProviderAuditResult> {
  const key = process.env.ALPHA_VANTAGE_API_KEY?.trim();
  if (!key) return aggregate("Alpha Vantage", false, [], []);
  const base = "https://www.alphavantage.co/query";
  const definitions = [
    { endpoint: "GLOBAL_QUOTE", params: { function: "GLOBAL_QUOTE", symbol: ticker }, patterns: [/price/i, /volume/i, /change/i] },
    { endpoint: "OVERVIEW", params: { function: "OVERVIEW", symbol: ticker }, patterns: [/AnalystTargetPrice/i, /ForwardPE/i, /Quarterly/i, /MarketCapitalization/i, /Beta/i] },
  ];
  const endpoints: ProviderEndpointAudit[] = [];
  for (const definition of definitions) {
    const url = new URL(base);
    for (const [name, value] of Object.entries(definition.params)) url.searchParams.set(name, value);
    url.searchParams.set("apikey", key);
    endpoints.push(await auditEndpoint({ endpoint: definition.endpoint, url, usefulPatterns: definition.patterns }));
  }
  return aggregate("Alpha Vantage", true, endpoints, ["second-source quote", "forward valuation", "analyst target", "company overview"]);
}

async function auditMarketaux(ticker: string): Promise<ProviderAuditResult> {
  const key = process.env.MARKETAUX_API_KEY?.trim();
  if (!key) return aggregate("Marketaux", false, [], []);
  const url = new URL("https://api.marketaux.com/v1/news/all");
  url.searchParams.set("symbols", ticker);
  url.searchParams.set("filter_entities", "true");
  url.searchParams.set("language", "en");
  url.searchParams.set("limit", "1");
  url.searchParams.set("api_token", key);
  const endpoint = await auditEndpoint({ endpoint: "company-news", url, usefulPatterns: [/data/i, /entities/i, /sentiment/i, /published/i, /source/i] });
  return aggregate("Marketaux", true, [endpoint], ["independent news", "entity match", "news sentiment"]);
}

async function auditPolygon(ticker: string): Promise<ProviderAuditResult> {
  const key = process.env.POLYGON_API_KEY?.trim();
  if (!key) return aggregate("Polygon", false, [], []);
  const url = new URL(`https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(ticker)}/prev`);
  url.searchParams.set("adjusted", "true");
  url.searchParams.set("apiKey", key);
  const endpoint = await auditEndpoint({ endpoint: "previous-close", url, usefulPatterns: [/results/i, /close/i, /volume/i, /status/i] });
  return aggregate("Polygon", true, [endpoint], ["independent price and volume"]);
}

export async function auditRailwayProviders(ticker = "MSFT") {
  const normalizedTicker = ticker.trim().toUpperCase().replace(/[^A-Z0-9.\-]/g, "").slice(0, 12) || "MSFT";
  const providers = await Promise.all([
    auditFmp(normalizedTicker),
    auditAlphaVantage(normalizedTicker),
    auditMarketaux(normalizedTicker),
    auditPolygon(normalizedTicker),
  ]);
  return {
    ok: true,
    ticker: normalizedTicker,
    checkedAt: new Date().toISOString(),
    providers,
    connectedProviders: providers.filter((provider) => provider.status === "connected" || provider.status === "partial").map((provider) => provider.provider),
    missingProviders: providers.filter((provider) => provider.status === "missing_key").map((provider) => provider.provider),
    safety: { databaseWrites: false, r2Writes: false, publishing: false, notifications: false, payments: false, openAiCalls: false },
    secretsRedacted: true,
  };
}
