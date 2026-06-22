import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import {
  writeRawSignal,
  type WriteRawSignalResult,
} from "@/lib/raw-signal-writer";
import { catalystImpactScores } from "@/lib/catalyst-impact-scoring";

export const FMP_SOURCE = "FMP Catalyst";
export const DEFAULT_FMP_TICKERS = [
  "NVDA",
  "AAPL",
  "MSFT",
  "TSLA",
  "AMZN",
  "META",
  "GOOGL",
  "AMD",
  "SHOP",
  "PLTR",
] as const;

const FMP_BASE_URL = (
  process.env.FMP_BASE_URL?.trim() || "https://financialmodelingprep.com"
).replace(/\/api\/v3\/?$/, "");
const FMP_BLOCKED_NEXT_ACTION =
  "Check FMP key, account activation, or plan access.";
const DEFAULT_LIMIT = 3;
const MAX_LIMIT = 3;

type FmpRunOptions = { dryRun?: boolean; limit?: number; tickers?: string[] };
type FmpIssue =
  | "missing_key"
  | "invalid_key"
  | "provider_403"
  | "plan_restricted"
  | "wrong_endpoint_path"
  | "auth_style_failed"
  | "rate_limited"
  | "network_failed"
  | "unknown_provider_error";
type FmpAuthStyle = "query" | "header";
type FmpEventType =
  | "press_release"
  | "stock_news"
  | "earnings_transcript"
  | "earnings_event"
  | "guidance_update"
  | "analyst_estimate"
  | "price_target"
  | "management_commentary";
type FmpCandidate = {
  ticker: string;
  eventType: FmpEventType;
  title: string;
  summary: string;
  url: string;
  detectedAt: string;
  duplicateKey: string;
  importanceHint: "low" | "medium" | "high";
  payload: Prisma.InputJsonObject;
};

export type FmpRunResult = {
  ok: boolean;
  source: typeof FMP_SOURCE;
  dryRun: boolean;
  apiKeyConfigured: boolean;
  status?: "missing_key" | "complete" | "error";
  providerIssue?: string | null;
  nextAction?: string | null;
  endpointHealth?: Record<string, string>;
  recordsChecked: number;
  rawSignalsCreated: number;
  duplicatesSkipped: number;
  rejected: number;
  errors: string[];
  sourceHealthStatus: string;
};

function getApiKey() {
  return process.env.FMP_API_KEY?.trim() || "";
}

export function capFmpLimit(limit?: number) {
  if (!Number.isFinite(limit) || !limit || limit < 1) return DEFAULT_LIMIT;
  return Math.min(Math.floor(limit), MAX_LIMIT);
}

function requestedTickers(tickers?: string[], limit?: number) {
  const cleaned = (tickers?.length ? tickers : [...DEFAULT_FMP_TICKERS])
    .map((ticker) => ticker.trim().toUpperCase())
    .filter((ticker) => /^[A-Z.]{1,8}$/.test(ticker));
  const unique = [...new Set(cleaned)];
  return (unique.length ? unique : [...DEFAULT_FMP_TICKERS]).slice(
    0,
    capFmpLimit(limit),
  );
}

function safeError(error: unknown) {
  if (error instanceof Error)
    return error.message.split("\n")[0]?.slice(0, 220) || "FMP request failed";
  return "FMP request failed";
}

async function updateFmpSourceHealth(
  status: "connected" | "not_configured" | "degraded" | "error",
  startedAt: number,
  errorMessage: string | null,
) {
  if (!process.env.DATABASE_URL) return status;
  const now = new Date();
  await prisma.sourceHealth.upsert({
    where: { source: FMP_SOURCE },
    create: {
      source: FMP_SOURCE,
      status,
      checkedAt: now,
      lastSuccessAt:
        status === "connected" || status === "degraded" ? now : null,
      responseTimeMs: Date.now() - startedAt,
      errorMessage,
      usage: "Financial Modeling Prep live catalyst ear",
      notes:
        "Uses FMP_API_KEY for tiny batches of press releases, stock news, earnings events, transcripts, and analyst/target data. Creates raw live_catalyst raw signals only; never final alerts.",
    },
    update: {
      status,
      checkedAt: now,
      lastSuccessAt:
        status === "connected" || status === "degraded" ? now : undefined,
      responseTimeMs: Date.now() - startedAt,
      errorMessage,
      usage: "Financial Modeling Prep live catalyst ear",
      notes:
        "Uses FMP_API_KEY for tiny batches of press releases, stock news, earnings events, transcripts, and analyst/target data. Creates raw live_catalyst raw signals only; never final alerts.",
    },
  });
  return status;
}

async function fetchFmpWithAuthStyle<T>(
  path: string,
  apiKey: string,
  params: Record<string, string> = {},
  authStyle: FmpAuthStyle = "query",
) {
  const url = new URL(`${FMP_BASE_URL}${path}`);
  for (const [key, value] of Object.entries(params))
    url.searchParams.set(key, value);
  const headers: Record<string, string> = { Accept: "application/json" };
  if (authStyle === "query") url.searchParams.set("apikey", apiKey);
  else headers.apikey = apiKey;

  let response: Response;
  try {
    response = await fetch(url, { headers, cache: "no-store" });
  } catch (cause) {
    const err = new Error(`FMP ${path} network request failed`) as Error & {
      path?: string;
      authStyle?: FmpAuthStyle;
      cause?: unknown;
    };
    err.path = path;
    err.authStyle = authStyle;
    err.cause = cause;
    throw err;
  }

  if (!response.ok) {
    const err = new Error(
      `FMP ${path} failed with status ${response.status}`,
    ) as Error & { status?: number; path?: string; authStyle?: FmpAuthStyle };
    err.status = response.status;
    err.path = path;
    err.authStyle = authStyle;
    throw err;
  }
  const json = (await response.json()) as unknown;
  const providerMessage = providerErrorMessage(json);
  if (providerMessage) {
    const err = new Error(`FMP ${path}: ${providerMessage}`) as Error & {
      path?: string;
      authStyle?: FmpAuthStyle;
    };
    err.path = path;
    err.authStyle = authStyle;
    throw err;
  }
  return json as T;
}

async function fetchFmp<T>(
  path: string,
  apiKey: string,
  params: Record<string, string> = {},
  preferredAuthStyle: FmpAuthStyle = "query",
) {
  return fetchFmpWithAuthStyle<T>(path, apiKey, params, preferredAuthStyle);
}

function providerErrorMessage(json: unknown) {
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  const record = json as Record<string, unknown>;
  const value =
    record.Error ?? record.error ?? record["Error Message"] ?? record.message;
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, 160)
    : null;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function dateValue(value: unknown) {
  const date =
    typeof value === "number" || typeof value === "string"
      ? new Date(value)
      : new Date();
  return Number.isNaN(date.getTime())
    ? new Date().toISOString()
    : date.toISOString();
}

function priceCandidate(
  ticker: string,
  row: Record<string, unknown>,
): FmpCandidate | null {
  const changesPercentage = numberValue(row.changesPercentage);
  const price = numberValue(row.price);
  if (changesPercentage === null || Math.abs(changesPercentage) < 2)
    return null;
  const detectedAt = dateValue(
    row.timestamp ? Number(row.timestamp) * 1000 : undefined,
  );
  return {
    ticker,
    eventType: "management_commentary",
    title: `${ticker} notable FMP price move`,
    summary: `${ticker} moved ${changesPercentage.toFixed(2)}% in the latest FMP quote sample${price === null ? "." : ` with price near $${price}.`} This is raw market evidence only.`,
    url: `https://financialmodelingprep.com/financial-summary/${ticker}`,
    detectedAt,
    duplicateKey: `${FMP_SOURCE}|price_movement|${ticker}|${detectedAt.slice(0, 13)}`,
    importanceHint: Math.abs(changesPercentage) >= 5 ? "high" : "medium",
    payload: {
      provider: FMP_SOURCE,
      endpoint: "quote",
      row: row as Prisma.InputJsonObject,
      noFinalAlerts: true,
    },
  };
}

function earningsCandidate(
  ticker: string,
  rows: Record<string, unknown>[],
): FmpCandidate | null {
  const row = rows.find((item) => item.symbol === ticker) ?? rows[0];
  if (!row) return null;
  const date = dateValue(row.date);
  return {
    ticker,
    eventType: "earnings_event",
    title: `${ticker} FMP earnings calendar signal`,
    summary: `${ticker} has an earnings calendar item in the FMP sample dated ${date.slice(0, 10)}. This is raw scheduling evidence only.`,
    url: `https://financialmodelingprep.com/financial-summary/${ticker}`,
    detectedAt: date,
    duplicateKey: `${FMP_SOURCE}|earnings_event|${ticker}|${date.slice(0, 10)}`,
    importanceHint: "medium",
    payload: {
      provider: FMP_SOURCE,
      endpoint: "earning_calendar",
      row: row as Prisma.InputJsonObject,
      noFinalAlerts: true,
    },
  };
}

function stringValue(value: unknown, maxLength = 500) {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, maxLength)
    : null;
}

function urlForFmp(ticker: string, row: Record<string, unknown>) {
  return (
    stringValue(row.url ?? row.link, 1000) ??
    `https://financialmodelingprep.com/financial-summary/${ticker}`
  );
}

function pressReleaseCandidate(
  ticker: string,
  rows: Record<string, unknown>[],
): FmpCandidate | null {
  const row = rows[0];
  if (!row) return null;
  const title = stringValue(row.title ?? row.headline, 220);
  const url = urlForFmp(ticker, row);
  if (!title || !url) return null;
  const detectedAt = dateValue(row.date ?? row.publishedDate);
  return {
    ticker,
    eventType: "press_release",
    title,
    summary:
      stringValue(row.text ?? row.summary, 900) ??
      `${ticker} FMP press release catalyst with a real provider receipt.`,
    url,
    detectedAt,
    duplicateKey: `${FMP_SOURCE}|press_release|${ticker}|${url}`,
    importanceHint: "high",
    payload: {
      sourceCategory: "live_catalyst",
      catalystType: "press_release",
      provider: FMP_SOURCE,
      ticker,
      companyName: stringValue(row.symbol) ?? ticker,
      headline: title,
      publishedAt: detectedAt,
      url,
      rawPayloadReference: "press-releases",
      urgency: "medium",
      likelyMarketImpact: "medium",
      sourceReliability: "high",
      proofNeeds: [
        "independent_news_coverage",
        "price_reaction_or_filing_if_material",
      ],
      row: row as Prisma.InputJsonObject,
      noFinalAlerts: true,
    },
  };
}

function stockNewsCandidate(
  ticker: string,
  rows: Record<string, unknown>[],
): FmpCandidate | null {
  const row = rows[0];
  if (!row) return null;
  const title = stringValue(row.title ?? row.headline, 220);
  const url = urlForFmp(ticker, row);
  if (!title || !url) return null;
  const detectedAt = dateValue(row.publishedDate ?? row.date);
  return {
    ticker,
    eventType: "stock_news",
    title,
    summary:
      stringValue(row.text ?? row.summary ?? row.site, 900) ??
      `${ticker} FMP stock-specific news catalyst with a real provider receipt.`,
    url,
    detectedAt,
    duplicateKey: `${FMP_SOURCE}|stock_news|${ticker}|${url}`,
    importanceHint: "medium",
    payload: {
      sourceCategory: "live_catalyst",
      catalystType: "stock_news",
      provider: FMP_SOURCE,
      ticker,
      companyName: stringValue(row.symbol) ?? ticker,
      headline: title,
      publishedAt: detectedAt,
      url,
      rawPayloadReference: "stock_news",
      urgency: "medium",
      likelyMarketImpact: "medium",
      sourceReliability: "high",
      proofNeeds: ["second_source", "company_or_filing_receipt_if_material"],
      row: row as Prisma.InputJsonObject,
      noFinalAlerts: true,
    },
  };
}

async function writeCandidate(
  candidate: FmpCandidate,
  dryRun: boolean,
): Promise<WriteRawSignalResult> {
  const scoring = catalystImpactScores({
    ticker: candidate.ticker,
    title: candidate.title,
    summary: candidate.summary,
    url: candidate.url,
    publishedAt: candidate.detectedAt,
    sourceReliability: "high",
    catalystType: String(candidate.payload.catalystType ?? candidate.eventType),
    proofTypes: ["news"],
  });
  return writeRawSignal({
    sourceName: FMP_SOURCE,
    sourceType: "news",
    ticker: candidate.ticker,
    eventType: candidate.eventType,
    title: candidate.title,
    summary: candidate.summary,
    url: candidate.url,
    detectedAt: candidate.detectedAt,
    duplicateKey: candidate.duplicateKey,
    qualityHints: {
      importanceHint: candidate.importanceHint,
      sourceQuality: "high",
      useful: true,
      reasons: [
        "FMP live_catalyst provider data sample",
        `impact:${scoring.likelyMarketImpact}`,
        `specificity:${scoring.stockSpecificityScore}`,
      ],
    },
    rawPayload: { ...candidate.payload, catalystImpact: scoring },
    dryRun,
  });
}

function classifyFmpIssue(error: unknown): FmpIssue {
  const message = safeError(error).toLowerCase();
  const status = (error as { status?: number } | null)?.status;
  if (
    message.includes("network request failed") ||
    message.includes("fetch failed") ||
    message.includes("econn") ||
    message.includes("timed out")
  )
    return "network_failed";
  if (
    status === 401 ||
    message.includes("invalid") ||
    message.includes("api key") ||
    message.includes("apikey")
  )
    return "invalid_key";
  if (
    status === 429 ||
    message.includes("rate limit") ||
    message.includes("too many requests")
  )
    return "rate_limited";
  if (
    status === 404 ||
    message.includes("not found") ||
    message.includes("404")
  )
    return "wrong_endpoint_path";
  if (
    status === 402 ||
    message.includes("plan") ||
    message.includes("subscription") ||
    message.includes("not available") ||
    message.includes("upgrade")
  )
    return "plan_restricted";
  if (
    status === 403 ||
    message.includes("403") ||
    message.includes("forbidden")
  )
    return "provider_403";
  return "unknown_provider_error";
}

function shouldStopFmpDiagnostics(issue: FmpIssue) {
  return [
    "invalid_key",
    "provider_403",
    "plan_restricted",
    "rate_limited",
    "auth_style_failed",
  ].includes(issue);
}

async function fetchFmpDiagnostic<T>(
  path: string,
  apiKey: string,
  params: Record<string, string> = {},
) {
  try {
    return {
      rows: await fetchFmpWithAuthStyle<T>(path, apiKey, params, "query"),
      authStyle: "query" as FmpAuthStyle,
    };
  } catch (queryError) {
    const queryIssue = classifyFmpIssue(queryError);
    if (!["invalid_key", "provider_403"].includes(queryIssue)) throw queryError;
    try {
      return {
        rows: await fetchFmpWithAuthStyle<T>(path, apiKey, params, "header"),
        authStyle: "header" as FmpAuthStyle,
      };
    } catch (headerError) {
      const headerIssue = classifyFmpIssue(headerError);
      if (queryIssue === "invalid_key" && headerIssue === "invalid_key") {
        const err = new Error(
          `FMP ${path} failed with both query-param and header apikey auth styles`,
        ) as Error & { path?: string; issue?: FmpIssue };
        err.path = path;
        err.issue = "auth_style_failed";
        throw err;
      }
      throw headerError;
    }
  }
}

async function smokeTestFmp(apiKey: string) {
  const endpointHealth: Record<string, string> = {};
  const simpleEndpoints: Array<{
    key: string;
    path: string;
    params: Record<string, string>;
  }> = [
    {
      key: "/stable/profile?symbol=AAPL",
      path: "/stable/profile",
      params: { symbol: "AAPL" },
    },
    {
      key: "/stable/search-symbol?query=AAPL",
      path: "/stable/search-symbol",
      params: { query: "AAPL" },
    },
    { key: "/stable/stock-list", path: "/stable/stock-list", params: {} },
  ];

  for (const endpoint of simpleEndpoints) {
    try {
      const diagnostic = await fetchFmpDiagnostic<unknown>(
        endpoint.path,
        apiKey,
        endpoint.params,
      );
      endpointHealth[endpoint.key] = `connected:${diagnostic.authStyle}`;
      return {
        ok: true,
        issue: null as FmpIssue | null,
        endpointHealth,
        simpleEndpoint: endpoint.key,
        simpleEndpointWorks: Array.isArray(diagnostic.rows)
          ? diagnostic.rows.length >= 0
          : Boolean(diagnostic.rows),
        authStyle: diagnostic.authStyle,
      };
    } catch (error) {
      const explicitIssue = (error as { issue?: FmpIssue } | null)?.issue;
      const issue = explicitIssue ?? classifyFmpIssue(error);
      endpointHealth[endpoint.key] = issue;
      if (shouldStopFmpDiagnostics(issue)) {
        return {
          ok: false,
          issue,
          endpointHealth,
          simpleEndpoint: endpoint.key,
          simpleEndpointWorks: false,
          authStyle: null as FmpAuthStyle | null,
        };
      }
    }
  }

  return {
    ok: false,
    issue: "unknown_provider_error" as FmpIssue,
    endpointHealth,
    simpleEndpoint: null as string | null,
    simpleEndpointWorks: false,
    authStyle: null as FmpAuthStyle | null,
  };
}

type WorkingFmpEndpoint = {
  key: string;
  run: (ticker: string) => Promise<Record<string, unknown>[]>;
  candidate: (
    ticker: string,
    rows: Record<string, unknown>[],
  ) => FmpCandidate | null;
};

async function enabledStableEndpoints(apiKey: string) {
  const endpointHealth: Record<string, string> = {};
  const endpoints: WorkingFmpEndpoint[] = [
    {
      key: "/stable/news/stock?symbols=AAPL",
      run: (ticker) =>
        fetchFmp<Record<string, unknown>[]>("/stable/news/stock", apiKey, {
          symbols: ticker,
          limit: "1",
        }),
      candidate: (ticker, rows) => stockNewsCandidate(ticker, rows),
    },
    {
      key: "/stable/news/press-releases?symbols=AAPL",
      run: (ticker) =>
        fetchFmp<Record<string, unknown>[]>(
          "/stable/news/press-releases",
          apiKey,
          { symbols: ticker, limit: "1" },
        ),
      candidate: (ticker, rows) => pressReleaseCandidate(ticker, rows),
    },
    {
      key: "/stable/quote?symbol=AAPL",
      run: (ticker) =>
        fetchFmp<Record<string, unknown>[]>("/stable/quote", apiKey, {
          symbol: ticker,
        }),
      candidate: (ticker, rows) => priceCandidate(ticker, rows[0] ?? {}),
    },
    {
      key: "/stable/earnings?symbol=AAPL",
      run: (ticker) =>
        fetchFmp<Record<string, unknown>[]>("/stable/earnings", apiKey, {
          symbol: ticker,
          limit: "1",
        }),
      candidate: (ticker, rows) => earningsCandidate(ticker, rows),
    },
  ];
  const working: WorkingFmpEndpoint[] = [];

  for (const endpoint of endpoints) {
    try {
      await endpoint.run("AAPL");
      endpointHealth[endpoint.key] = "connected";
      working.push(endpoint);
    } catch (error) {
      const issue = classifyFmpIssue(error);
      endpointHealth[endpoint.key] = issue;
      if (shouldStopFmpDiagnostics(issue)) break;
    }
  }

  return { working, endpointHealth };
}

export async function runFmpIngestion(
  options: FmpRunOptions = {},
): Promise<FmpRunResult> {
  const startedAt = Date.now();
  const dryRun = options.dryRun !== false;
  const apiKey = getApiKey();
  const errors: string[] = [];
  let recordsChecked = 0;
  let rawSignalsCreated = 0;
  let duplicatesSkipped = 0;
  let rejected = 0;

  if (!apiKey) {
    const sourceHealthStatus = await updateFmpSourceHealth(
      "not_configured",
      startedAt,
      "FMP_API_KEY is not configured.",
    ).catch(() => "not_configured");
    return {
      ok: true,
      source: FMP_SOURCE,
      dryRun,
      apiKeyConfigured: false,
      status: "missing_key",
      providerIssue: "missing_key",
      endpointHealth: {},
      recordsChecked,
      rawSignalsCreated,
      duplicatesSkipped,
      rejected,
      errors,
      sourceHealthStatus,
    };
  }

  const endpointHealth: Record<string, string> = {};
  let providerIssue: string | null = null;
  try {
    const smoke = await smokeTestFmp(apiKey);
    Object.assign(endpointHealth, smoke.endpointHealth);
    if (!smoke.ok) {
      providerIssue = smoke.issue;
      errors.push(`FMP smoke test failed: ${smoke.issue}`);
      const sourceHealthStatus = await updateFmpSourceHealth(
        "error",
        startedAt,
        errors[0] ?? null,
      ).catch(() => "error");
      return {
        ok: false,
        source: FMP_SOURCE,
        dryRun,
        apiKeyConfigured: true,
        status: "error",
        providerIssue,
        nextAction:
          providerIssue === "plan_restricted" ||
          providerIssue === "provider_403"
            ? FMP_BLOCKED_NEXT_ACTION
            : null,
        endpointHealth,
        recordsChecked,
        rawSignalsCreated,
        duplicatesSkipped,
        rejected,
        errors,
        sourceHealthStatus,
      };
    }
    const enabled = await enabledStableEndpoints(apiKey);
    Object.assign(endpointHealth, enabled.endpointHealth);
    if (!enabled.working.length) {
      providerIssue = "plan_restricted";
      errors.push(
        "FMP stable endpoints blocked or unavailable after smoke test.",
      );
      const sourceHealthStatus = await updateFmpSourceHealth(
        "error",
        startedAt,
        errors[0] ?? null,
      ).catch(() => "error");
      return {
        ok: false,
        source: FMP_SOURCE,
        dryRun,
        apiKeyConfigured: true,
        status: "error",
        providerIssue,
        nextAction: FMP_BLOCKED_NEXT_ACTION,
        endpointHealth,
        recordsChecked,
        rawSignalsCreated,
        duplicatesSkipped,
        rejected,
        errors,
        sourceHealthStatus,
      };
    }

    const tickers = requestedTickers(options.tickers, options.limit);
    for (const ticker of tickers) {
      const candidates: Array<FmpCandidate | null> = [];
      for (const endpoint of enabled.working) {
        try {
          const rows = await endpoint.run(ticker);
          recordsChecked += rows.length;
          candidates.push(endpoint.candidate(ticker, rows));
        } catch (error) {
          const issue = classifyFmpIssue(error);
          endpointHealth[endpoint.key.replace("AAPL", ticker)] = issue;
          errors.push(`${issue}: ${safeError(error)}`);
          if (shouldStopFmpDiagnostics(issue)) break;
        }
      }

      for (const candidate of candidates
        .filter((item): item is FmpCandidate => Boolean(item))
        .slice(0, 5)) {
        const result = await writeCandidate(candidate, dryRun);
        if (result.status === "saved") rawSignalsCreated += 1;
        else if (result.status === "skipped" && result.reason === "duplicate")
          duplicatesSkipped += 1;
        else if (result.status === "rejected") rejected += 1;
      }
    }
  } catch (error) {
    providerIssue = classifyFmpIssue(error);
    errors.push(`${providerIssue}: ${safeError(error)}`);
  }

  const sourceHealthStatus = await updateFmpSourceHealth(
    errors.length ? (recordsChecked ? "degraded" : "error") : "connected",
    startedAt,
    errors[0] ?? null,
  ).catch(() => (errors.length ? "error" : "connected"));
  return {
    ok: recordsChecked > 0 || errors.length === 0,
    source: FMP_SOURCE,
    dryRun,
    apiKeyConfigured: true,
    status: errors.length ? "error" : "complete",
    providerIssue,
    nextAction:
      providerIssue === "plan_restricted" || providerIssue === "provider_403"
        ? FMP_BLOCKED_NEXT_ACTION
        : null,
    endpointHealth,
    recordsChecked,
    rawSignalsCreated,
    duplicatesSkipped,
    rejected,
    errors: [...new Set(errors)].slice(0, 10),
    sourceHealthStatus,
  };
}
