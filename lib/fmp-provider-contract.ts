import { runFmpProof, runPriceVolume } from "@/lib/proof-ears";

const FMP_BASE = (process.env.FMP_BASE_URL?.trim() || "https://financialmodelingprep.com").replace(/\/api\/v3\/?$/, "");
type Json = Record<string, unknown>;
const PRICE_ENDPOINTS = [
  { name: "quote", path: "/stable/quote", fields: ["price", "volume", "avgVolume"] },
  { name: "quote-short", path: "/stable/quote-short", fields: ["price", "volume"] },
  { name: "stock-price-change", path: "/stable/stock-price-change", fields: ["1D", "5D", "1M"] },
  { name: "historical-price-eod/full", path: "/stable/historical-price-eod/full", fields: ["close", "volume"] },
];
const FUND_ENDPOINTS = [
  { name: "income-statement", path: "/stable/income-statement", fields: ["revenue", "grossProfitRatio", "operatingIncomeRatio", "netIncomeRatio"] },
  { name: "balance-sheet-statement", path: "/stable/balance-sheet-statement", fields: ["totalDebt", "totalStockholdersEquity"] },
  { name: "cash-flow-statement", path: "/stable/cash-flow-statement", fields: ["freeCashFlow", "operatingCashFlow", "netCashProvidedByOperatingActivities"] },
  { name: "key-metrics", path: "/stable/key-metrics", fields: ["peRatio", "debtToEquity", "enterpriseValueOverRevenue"] },
  { name: "ratios", path: "/stable/ratios", fields: ["grossProfitMargin", "operatingProfitMargin", "netProfitMargin", "debtEquityRatio"] },
  { name: "income-statement-growth", path: "/stable/income-statement-growth", fields: ["growthRevenue", "growthNetIncome"] },
];
const SYMBOL_ENDPOINTS = [
  { name: "search-symbol", path: "/stable/search-symbol", fields: ["symbol", "name", "exchangeShortName"] },
  { name: "search-exchange-variants", path: "/stable/search-exchange-variants", fields: ["symbol", "exchangeShortName"] },
];
function n(v: unknown) { const x = typeof v === "string" ? Number(v.replace(/,/g, "")) : typeof v === "number" ? v : NaN; return Number.isFinite(x) ? x : null; }
function rows(v: unknown): Json[] { return Array.isArray(v) ? v.filter((x) => x && typeof x === "object") as Json[] : v && typeof v === "object" ? [v as Json] : []; }
function keys(v: unknown) { return Object.keys(rows(v)[0] ?? {}).slice(0, 20); }
function safeMessage(value: unknown) { return String(value ?? "").replace(/[A-Za-z0-9_\-]{20,}/g, "[redacted]").slice(0, 220); }
function classify(status: number | null, body: unknown): string {
  const msg = safeMessage(typeof body === "object" && body ? JSON.stringify(body).slice(0, 500) : body).toLowerCase();
  if (status === 401 || /invalid.*api|api key|apikey/.test(msg)) return "invalid_api_key";
  if (status === 429 || /limit|rate|too many/.test(msg)) return "rate_limited";
  if (status === 403 || /plan|premium|starter|subscription|upgrade/.test(msg)) return "plan_restricted";
  if (status === 404) return "endpoint_not_available";
  if (/not found|cannot get|wrong endpoint|version/.test(msg)) return "wrong_endpoint_version";
  if (/symbol/.test(msg) && /invalid|bad/.test(msg)) return "bad_symbol_format";
  if (Array.isArray(body) && body.length === 0) return "empty_response";
  if (body == null || (typeof body === "string" && !body.trim())) return "empty_response";
  if (status && status >= 500) return "provider_error";
  return status && status >= 400 ? "provider_error" : "unknown";
}
function suspectedPlan(errorClass: string, status: number | null) { return errorClass === "plan_restricted" || status === 403 ? "Unknown" : "Unknown"; }
async function call(endpoint: {name:string;path:string;fields:string[]}, symbolInput: string, symbolUsed: string) {
  const key = process.env.FMP_API_KEY?.trim();
  if (!key) return detail(endpoint, symbolInput, symbolUsed, null, "invalid_api_key", null, [], "FMP_API_KEY not configured");
  const url = new URL(`${FMP_BASE}${endpoint.path}`);
  if (endpoint.name.startsWith("search")) url.searchParams.set("query", symbolInput); else url.searchParams.set("symbol", symbolUsed);
  if (!endpoint.name.includes("historical")) url.searchParams.set("limit", "5");
  if (endpoint.name.includes("historical")) { const to = new Date().toISOString().slice(0,10); const from = new Date(Date.now()-14*864e5).toISOString().slice(0,10); url.searchParams.set("from", from); url.searchParams.set("to", to); }
  url.searchParams.set("apikey", key);
  try {
    const r = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store" });
    let body: unknown = null; try { body = await r.json(); } catch { body = await r.text().catch(() => null); }
    const usable = endpoint.fields.filter((f) => rows(body).some((row) => n(row[f]) !== null || (typeof row[f] === "string" && String(row[f]).trim())));
    const err = r.ok ? (rows(body).length ? "unknown" : "empty_response") : classify(r.status, body);
    return detail(endpoint, symbolInput, symbolUsed, r.status, err, body, usable, r.ok ? null : safeMessage(JSON.stringify(body).slice(0, 220)));
  } catch (e) { return detail(endpoint, symbolInput, symbolUsed, null, "provider_error", null, [], safeMessage(e instanceof Error ? e.message : e)); }
}
function detail(endpoint:{name:string;path:string;fields:string[]}, symbolInput:string, symbolUsed:string, httpStatus:number|null, errorClass:string, body:unknown, usable:string[], safe:string|null) {
  const missing = endpoint.fields.filter((f) => !usable.includes(f));
  return { provider:"FMP", symbolInput, symbolUsed, endpointName:endpoint.name, endpointPathTemplate:endpoint.path, httpStatus, providerStatus:errorClass === "unknown" ? "ok_or_empty" : errorClass, responseKind:Array.isArray(body)?"array":body===null?"none":typeof body, responseItemCount:rows(body).length, hasUsableValues:usable.length>0, usableFieldsFound:usable, missingFields:missing, normalizedSuccessfully:usable.length>0, rejectedByNormalizer:usable.length===0, rejectionReason:usable.length?null:errorClass, planOrPermissionSuspected:errorClass==="plan_restricted" || httpStatus===403, rateLimitSuspected:errorClass==="rate_limited", invalidKeySuspected:errorClass==="invalid_api_key", endpointNotFoundSuspected:errorClass==="endpoint_not_available" || errorClass==="wrong_endpoint_version", providerErrorSafe:safe, responseSampleKeys:keys(body), accessibleUnderCurrentKey: usable.length>0 ? true : (httpStatus && httpStatus < 400 ? false : false), suspectedRequiredPlan:suspectedPlan(errorClass, httpStatus) };
}
export async function runFmpProviderContractTest(input:{symbols?:string[];provider?:string;dryRun?:boolean;confirmRun?:boolean}={}) {
  const symbols = [...new Set((input.symbols?.length ? input.symbols : ["NVDA","AMD","MSFT","GOOGL"]).map((s) => s.toUpperCase().replace(/[^A-Z0-9.-]/g, "")).filter(Boolean))].slice(0, 10);
  const results = [];
  for (const symbol of symbols) {
    const symbolDiagnostics = await Promise.all(SYMBOL_ENDPOINTS.map((ep) => call(ep, symbol, symbol)));
    const symbolUsed = symbol;
    const endpointDiagnostics = await Promise.all([...PRICE_ENDPOINTS, ...FUND_ENDPOINTS].map((ep) => call(ep, symbol, symbolUsed)));
    const stagePrice = await runPriceVolume({ tickers:[symbol], maxTickers:1 });
    const stageFund = await runFmpProof({ tickers:[symbol], maxTickers:1, dryRun:true, confirmRun:false });
    const stagePriceRow = rows(stagePrice.priceVolumeProof)[0] ?? {};
    const stageFundRow = rows(stageFund.proof)[0] ?? {};
    const standalonePrice = endpointDiagnostics.some((d) => ["quote","quote-short"].includes(d.endpointName) && d.hasUsableValues);
    const standaloneFund = endpointDiagnostics.some((d) => FUND_ENDPOINTS.map((e)=>e.name).includes(d.endpointName) && d.hasUsableValues);
    const stage1Price = n(stagePriceRow.latestPrice) !== null && n(stagePriceRow.volume) !== null;
    const stage1Fund = Object.values((stageFundRow.valuesUsed as Json) ?? {}).some((v) => n(v) !== null);
    results.push({ symbol, symbolResolution:{ symbolInput:symbol, symbolUsed, symbolChanged:false, diagnostics:symbolDiagnostics }, endpointDiagnostics, comparison:{ sameSymbolUsed:true, sameEndpointUsed:true, sameNormalizedFields: stage1Price || stage1Fund, standalonePriceVolumeWorks:standalonePrice, stage1PriceVolumeWorks:stage1Price, standaloneFundamentalsWorks:standaloneFund, stage1FundamentalsWorks:stage1Fund, mismatchFound:(standalonePrice!==stage1Price)||(standaloneFund!==stage1Fund), mismatchReason:(standalonePrice!==stage1Price)?"price_volume_standalone_stage1_difference":(standaloneFund!==stage1Fund)?"fundamentals_standalone_stage1_difference":null }, stage1Proof:{ priceVolume:stagePriceRow, fundamentals:stageFundRow } });
  }
  const all = results.flatMap((r) => r.endpointDiagnostics);
  return { ok:true, dryRun:input.dryRun!==false, provider:"FMP", symbols, results, providerContractSummary:{ symbolsTested:symbols.length, endpointsTested:all.length, usableEndpointCalls:all.filter((d)=>d.hasUsableValues).length }, fmpEndpointAccessSummary:Object.fromEntries([...new Set(all.map((d)=>d.endpointName))].map((name)=>[name, all.filter((d)=>d.endpointName===name && d.hasUsableValues).length])), fmpPlanRestrictionSummary:all.filter((d)=>d.planOrPermissionSuspected).map((d)=>({symbol:d.symbolInput,endpoint:d.endpointName,reason:d.providerStatus})), standaloneVsStage1MismatchSummary:results.filter((r)=>r.comparison.mismatchFound).map((r)=>({symbol:r.symbol,reason:r.comparison.mismatchReason})), secretsRedacted:true, safety:{callsOpenAI:false,publishesAlerts:false,sendsTelegram:false} };
}
