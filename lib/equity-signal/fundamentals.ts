import type { ImpactCandidate, ProviderResult } from "@/lib/equity-signal/types";

const SEC_AGENT = "SwingUp/1.0 support@swingup.app";
const METRICS = [
  { label: "revenue", concepts: ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet"], units: ["USD"] },
  { label: "net_income", concepts: ["NetIncomeLoss", "ProfitLoss"], units: ["USD"] },
  { label: "operating_income", concepts: ["OperatingIncomeLoss"], units: ["USD"] },
  { label: "cash", concepts: ["CashAndCashEquivalentsAtCarryingValue", "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents"], units: ["USD"] },
  { label: "assets", concepts: ["Assets"], units: ["USD"] },
  { label: "liabilities", concepts: ["Liabilities"], units: ["USD"] },
  { label: "equity", concepts: ["StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"], units: ["USD"] },
  { label: "shares_outstanding", concepts: ["CommonStocksIncludingAdditionalPaidInCapitalMember", "CommonStockSharesOutstanding", "EntityCommonStockSharesOutstanding"], units: ["shares"] },
] as const;

type FactUnit = { val?: unknown; filed?: unknown; end?: unknown; form?: unknown; fy?: unknown; fp?: unknown; frame?: unknown };

function number(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function date(value: unknown) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function latestFact(facts: Record<string, unknown>, concepts: readonly string[], units: readonly string[]) {
  for (const concept of concepts) {
    const raw = facts[concept];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const unitMap = (raw as Record<string, unknown>).units;
    if (!unitMap || typeof unitMap !== "object" || Array.isArray(unitMap)) continue;
    for (const unit of units) {
      const rows = (unitMap as Record<string, unknown>)[unit];
      if (!Array.isArray(rows)) continue;
      const usable = rows
        .filter((row): row is FactUnit => Boolean(row) && typeof row === "object" && !Array.isArray(row) && number((row as FactUnit).val) !== null)
        .sort((left, right) => String(right.filed ?? "").localeCompare(String(left.filed ?? "")) || String(right.end ?? "").localeCompare(String(left.end ?? "")));
      const row = usable[0];
      const value = number(row?.val);
      if (row && value !== null) return { concept, value, unit, filedAt: date(row.filed), periodEnd: date(row.end), form: typeof row.form === "string" ? row.form : null };
    }
  }
  return null;
}

export async function enrichCandidateFundamentals(candidate: ImpactCandidate | null, fetchImpl: typeof fetch, now: Date) {
  const sourceUrl = candidate?.cik ? `https://data.sec.gov/api/xbrl/companyfacts/CIK${candidate.cik}.json` : null;
  if (!candidate || !candidate.cik || !sourceUrl) {
    const provider: ProviderResult = { provider: "sec_company_facts", status: candidate ? "not_configured" : "not_due", checkedAt: null, nextRetryAt: null, sourceUrls: sourceUrl ? [sourceUrl] : [], receipts: [], recordsRead: 0, error: candidate ? "candidate_has_no_sec_cik_mapping" : null, entitlementVerified: true, cached: false };
    return { candidate, provider };
  }
  try {
    const response = await fetchImpl(sourceUrl, { headers: { Accept: "application/json", "user-agent": SEC_AGENT }, cache: "no-store", signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`sec_company_facts_http_${response.status}`);
    const body = await response.json() as Record<string, unknown>;
    const namespaces = body.facts && typeof body.facts === "object" && !Array.isArray(body.facts) ? body.facts as Record<string, unknown> : {};
    const usGaap = namespaces["us-gaap"] && typeof namespaces["us-gaap"] === "object" && !Array.isArray(namespaces["us-gaap"]) ? namespaces["us-gaap"] as Record<string, unknown> : {};
    const dei = namespaces.dei && typeof namespaces.dei === "object" && !Array.isArray(namespaces.dei) ? namespaces.dei as Record<string, unknown> : {};
    const facts = { ...usGaap, ...dei };
    const items = METRICS.flatMap((metric) => {
      const fact = latestFact(facts, metric.concepts, metric.units);
      return fact ? [{ metric: metric.label, value: fact.value, unit: fact.unit, filedAt: fact.filedAt, periodEnd: fact.periodEnd, form: fact.form }] : [];
    });
    const latestFiledAt = items.map((item) => item.filedAt).filter((value): value is string => Boolean(value)).sort().at(-1) ?? null;
    const fiscalPeriodEnd = items.map((item) => item.periodEnd).filter((value): value is string => Boolean(value)).sort().at(-1) ?? null;
    candidate.fundamentals = { available: items.length >= 3, sourceUrl, checkedAt: now.toISOString(), latestFiledAt, fiscalPeriodEnd, items, error: items.length ? null : "no_supported_company_facts" };
    const provider: ProviderResult = { provider: "sec_company_facts", status: items.length ? "connected" : "temporarily_unavailable", checkedAt: now.toISOString(), nextRetryAt: null, sourceUrls: [sourceUrl], receipts: [], recordsRead: items.length, error: items.length ? null : "no_supported_company_facts", entitlementVerified: true, cached: false };
    return { candidate, provider };
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 160) : "sec_company_facts_failed";
    const status = /cadence_guard|rolling_quota_guard/.test(message) ? "not_due" as const : /429|rate/i.test(message) ? "rate_limited" as const : "temporarily_unavailable" as const;
    candidate.fundamentals = { available: false, sourceUrl, checkedAt: now.toISOString(), latestFiledAt: null, fiscalPeriodEnd: null, items: [], error: message };
    const provider: ProviderResult = { provider: "sec_company_facts", status, checkedAt: null, nextRetryAt: null, sourceUrls: [sourceUrl], receipts: [], recordsRead: 0, error: status === "not_due" ? null : message, entitlementVerified: true, cached: false };
    return { candidate, provider };
  }
}
