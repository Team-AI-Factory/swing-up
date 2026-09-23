import { reassessCandidateAfterFundamentals } from "@/lib/equity-signal/analysis";
import type { ImpactCandidate, ProviderResult } from "@/lib/equity-signal/types";

const SEC_AGENT = "SwingUp/1.0 support@swingup.app";
const METRICS = [
  { label: "revenue", concepts: ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet", "Revenue"], units: ["USD"] },
  { label: "net_income", concepts: ["NetIncomeLoss", "ProfitLoss"], units: ["USD"] },
  { label: "operating_income", concepts: ["OperatingIncomeLoss"], units: ["USD"] },
  { label: "cash", concepts: ["CashAndCashEquivalentsAtCarryingValue", "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents", "CashAndCashEquivalents"], units: ["USD"] },
  { label: "assets", concepts: ["Assets"], units: ["USD"] },
  { label: "liabilities", concepts: ["Liabilities"], units: ["USD"] },
  { label: "equity", concepts: ["StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest", "Equity"], units: ["USD"] },
  { label: "shares_outstanding", concepts: ["CommonStockSharesOutstanding", "EntityCommonStockSharesOutstanding"], units: ["shares"] },
  { label: "diluted_eps", concepts: ["EarningsPerShareDiluted", "DilutedEarningsLossPerShare"], units: ["USD/shares"] },
  { label: "operating_cash_flow", concepts: ["NetCashProvidedByUsedInOperatingActivities", "CashFlowsFromUsedInOperatingActivities"], units: ["USD"] },
  { label: "capital_expenditure", concepts: ["PaymentsToAcquirePropertyPlantAndEquipment", "PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities"], units: ["USD"] },
  { label: "long_term_debt_noncurrent", concepts: ["LongTermDebtNoncurrent"], units: ["USD"] },
  { label: "long_term_debt_current", concepts: ["LongTermDebtCurrent"], units: ["USD"] },
  { label: "gross_profit", concepts: ["GrossProfit"], units: ["USD"] },
] as const;

type FactUnit = { val?: unknown; filed?: unknown; end?: unknown; start?: unknown; form?: unknown; fy?: unknown; fp?: unknown; frame?: unknown };

function number(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function date(value: unknown) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function datedFacts(facts: Record<string, unknown>, concepts: readonly string[], units: readonly string[], now: Date, annualOnly = false) {
  const today = now.toISOString().slice(0, 10);
  const candidates = concepts.flatMap((concept) => {
    const raw = facts[concept];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
    const unitMap = (raw as Record<string, unknown>).units;
    if (!unitMap || typeof unitMap !== "object" || Array.isArray(unitMap)) return [];
    return units.flatMap((unit) => {
      const rows = (unitMap as Record<string, unknown>)[unit];
      if (!Array.isArray(rows)) return [];
      return rows.flatMap((row: FactUnit) => {
        if (!row || typeof row !== "object") return [];
        const value = number(row.val);
        const filedAt = date(row.filed), periodEnd = date(row.end), periodStart = date(row.start);
        const days = periodEnd && periodStart ? (Date.parse(periodEnd) - Date.parse(periodStart)) / 86_400_000 : 0;
        if (value === null || !filedAt || !periodEnd || filedAt > today || periodEnd > today
          || !Number.isFinite(Date.parse(filedAt)) || !Number.isFinite(Date.parse(periodEnd))
          || (annualOnly && (days < 330 || days > 380))) return [];
        return [{ concept, value, unit, filedAt, periodEnd, periodStart, form: typeof row.form === "string" ? row.form : null }];
      });
    });
  });
  // Compare all aliases. A discontinued tag must not hide a newer equivalent tag;
  // a recently filed comparative prior period must not replace the current period.
  return candidates.sort((a, b) => b.periodEnd.localeCompare(a.periodEnd) || b.filedAt.localeCompare(a.filedAt));
}

export function latestFact(facts: Record<string, unknown>, concepts: readonly string[], units: readonly string[], now: Date, annualOnly = false) {
  return datedFacts(facts, concepts, units, now, annualOnly)[0] ?? null;
}

function priorYearFact(facts: Record<string, unknown>, concepts: readonly string[], units: readonly string[], now: Date) {
  const rows = datedFacts(facts, concepts, units, now);
  const current = rows[0];
  if (!current) return null;
  return rows.find(row => {
    const yearGapDays = (Date.parse(current.periodEnd) - Date.parse(row.periodEnd)) / 86400000;
    if (row.unit !== current.unit || yearGapDays < 350 || yearGapDays > 380 || Boolean(row.periodStart) !== Boolean(current.periodStart)) return false;
    if (!row.periodStart || !current.periodStart) return true;
    const currentDays = (Date.parse(current.periodEnd) - Date.parse(current.periodStart)) / 86400000;
    const previousDays = (Date.parse(row.periodEnd) - Date.parse(row.periodStart)) / 86400000;
    // Do not compare one quarter with a year-to-date or full-year number.
    return Math.abs(currentDays - previousDays) <= 7;
  }) ?? null;
}

function applyCompanyScale(candidate: ImpactCandidate, annualRevenue: ReturnType<typeof latestFact>, sourceUrl: string, now: Date) {
  const kind = candidate.eventFamily === "contract_award" ? "contract_value"
    : candidate.eventFamily === "financing_dilution" ? "offering_shares"
      : candidate.eventFamily === "regulatory_enforcement" ? "fine_value" : null;
  const metric = candidate.eventMagnitude.metrics.filter((item) => item.kind === kind && item.promotionEvidenceVerified)
    .sort((a, b) => b.value - a.value)[0];
  const denominator = kind === "offering_shares"
    ? candidate.fundamentals?.items.find((item) => item.metric === "shares_outstanding") : annualRevenue;
  if (metric && denominator && denominator.value > 0 && denominator.periodEnd
    && now.getTime() - Date.parse(denominator.periodEnd) <= (kind === "offering_shares" ? 180 : 550) * 86_400_000) {
    candidate.eventMagnitude.relativeToCompany = {
      metric: kind === "offering_shares" ? "shares_outstanding" : "annual_revenue",
      eventValue: metric.value, eventMetricSourceReceiptId: metric.sourceReceiptId,
      companyValue: denominator.value, companyPeriodEnd: denominator.periodEnd, companyFiledAt: denominator.filedAt, ratioPercent: metric.value / denominator.value * 100, sourceUrl,
    };
  }
  return reassessCandidateAfterFundamentals(candidate, now);
}

export type VerifiedFactsSnapshot = { cik: string; fundamentals: NonNullable<ImpactCandidate["fundamentals"]>; annualRevenue: ReturnType<typeof latestFact> };
export type VerifiedFactsCache = { requiredMetrics?: string[]; read: (cik: string) => Promise<VerifiedFactsSnapshot | null>; write: (snapshot: VerifiedFactsSnapshot) => Promise<void> };

export async function enrichCandidateFundamentals(candidate: ImpactCandidate | null, fetchImpl: typeof fetch, now: Date, cache?: VerifiedFactsCache) {
  const sourceUrl = candidate?.cik ? `https://data.sec.gov/api/xbrl/companyfacts/CIK${candidate.cik}.json` : null;
  if (!candidate || !candidate.cik || !sourceUrl) {
    const provider: ProviderResult = { provider: "sec_company_facts", status: candidate ? "not_configured" : "not_due", checkedAt: null, nextRetryAt: null, sourceUrls: sourceUrl ? [sourceUrl] : [], receipts: [], recordsRead: 0, error: candidate ? "candidate_has_no_sec_cik_mapping" : null, entitlementVerified: true, cached: false };
    return { candidate, provider };
  }
  let reusableSaved: VerifiedFactsSnapshot | null = null;
  try {
    const saved = await cache?.read(candidate.cik).catch(() => null);
    const checked = Date.parse(saved?.fundamentals.checkedAt ?? "");
    const eventAt = Date.parse(candidate.eventObservedAt);
    const datedFacts = saved?.fundamentals.items.every(item => Number.isFinite(item.value)
      && Number.isFinite(Date.parse(item.filedAt ?? "")) && Date.parse(item.filedAt!) <= now.getTime()
      && Number.isFinite(Date.parse(item.periodEnd ?? "")) && Date.parse(item.periodEnd!) <= now.getTime());
    const requestedFactsPresent = (cache?.requiredMetrics ?? []).every(metric => saved?.fundamentals.items.some(item => item.metric === metric));
    if (saved?.cik === candidate.cik && saved.fundamentals.sourceUrl === sourceUrl && saved.fundamentals.available && datedFacts && Number.isFinite(checked)
      && checked <= now.getTime() && now.getTime() - checked <= 6 * 60 * 60_000
      && (candidate.eventFamily === "valuation_gap" || checked >= eventAt)) {
      reusableSaved = saved;
    }
    if (reusableSaved && requestedFactsPresent) {
      const saved = reusableSaved;
      candidate.fundamentals = structuredClone(saved.fundamentals);
      if (candidate.eventFamily !== "valuation_gap") applyCompanyScale(candidate, saved.annualRevenue, sourceUrl, now);
      const provider: ProviderResult = { provider: "sec_company_facts", status: "connected", checkedAt: saved.fundamentals.checkedAt, nextRetryAt: null, sourceUrls: [sourceUrl], receipts: [], recordsRead: saved.fundamentals.items.length, error: null, entitlementVerified: true, cached: true, cacheAgeMs: now.getTime() - checked };
      return { candidate, provider };
    }
    const response = await fetchImpl(sourceUrl, { headers: { Accept: "application/json", "user-agent": SEC_AGENT }, cache: "no-store", signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`sec_company_facts_http_${response.status}`);
    const body = await response.json() as Record<string, unknown>;
    if (body.cik != null && String(body.cik).replace(/^0+/, "") !== candidate.cik.replace(/^0+/, "")) throw new Error("sec_company_facts_issuer_mismatch");
    const namespaces = body.facts && typeof body.facts === "object" && !Array.isArray(body.facts) ? body.facts as Record<string, unknown> : {};
    const usGaap = namespaces["us-gaap"] && typeof namespaces["us-gaap"] === "object" && !Array.isArray(namespaces["us-gaap"]) ? namespaces["us-gaap"] as Record<string, unknown> : {};
    const dei = namespaces.dei && typeof namespaces.dei === "object" && !Array.isArray(namespaces.dei) ? namespaces.dei as Record<string, unknown> : {};
    const ifrs = namespaces["ifrs-full"] && typeof namespaces["ifrs-full"] === "object" && !Array.isArray(namespaces["ifrs-full"]) ? namespaces["ifrs-full"] as Record<string, unknown> : {};
    const facts = { ...ifrs, ...usGaap, ...dei };
    const items: NonNullable<ImpactCandidate["fundamentals"]>["items"] = METRICS.flatMap((metric) => {
      const fact = latestFact(facts, metric.concepts, metric.units, now);
      return fact ? [{ metric: metric.label, value: fact.value, unit: fact.unit, periodStart: fact.periodStart, filedAt: fact.filedAt, periodEnd: fact.periodEnd, form: fact.form }] : [];
    });
    const currentMetricCount = items.length;
    for (const metric of METRICS) {
      if (!cache?.requiredMetrics?.includes(`${metric.label}_prior_year`)) continue;
      const fact = priorYearFact(facts, metric.concepts, metric.units, now);
      if (fact) items.push({ metric: `${metric.label}_prior_year`, value: fact.value, unit: fact.unit, periodStart: fact.periodStart, filedAt: fact.filedAt, periodEnd: fact.periodEnd, form: fact.form });
    }
    const latestFiledAt = items.map((item) => item.filedAt).filter((value): value is string => Boolean(value)).sort().at(-1) ?? null;
    const fiscalPeriodEnd = items.map((item) => item.periodEnd).filter((value): value is string => Boolean(value)).sort().at(-1) ?? null;
    candidate.fundamentals = { available: currentMetricCount >= 3, sourceUrl, checkedAt: now.toISOString(), latestFiledAt, fiscalPeriodEnd, items, error: items.length ? null : "no_supported_company_facts" };
    const annualRevenue = latestFact(facts, METRICS[0].concepts, ["USD"], now, true);
    if (candidate.eventFamily !== "valuation_gap") applyCompanyScale(candidate, annualRevenue, sourceUrl, now);
    if (candidate.fundamentals.available) await cache?.write({ cik: candidate.cik, fundamentals: candidate.fundamentals, annualRevenue }).catch(() => undefined);
    const provider: ProviderResult = { provider: "sec_company_facts", status: items.length ? "connected" : "temporarily_unavailable", checkedAt: now.toISOString(), nextRetryAt: null, sourceUrls: [sourceUrl], receipts: [], recordsRead: items.length, error: items.length ? null : "no_supported_company_facts", entitlementVerified: true, cached: false };
    return { candidate, provider };
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 160) : "sec_company_facts_failed";
    const status = /cadence_guard|rolling_quota_guard/.test(message) ? "not_due" as const : /429|rate/i.test(message) ? "rate_limited" as const : "temporarily_unavailable" as const;
    // A failed request for an additional field does not invalidate the other
    // verified facts. Preserve their actual observation time and the gap.
    candidate.fundamentals = reusableSaved ? { ...structuredClone(reusableSaved.fundamentals), error: `refresh_incomplete:${message}` }
      : { available: false, sourceUrl, checkedAt: now.toISOString(), latestFiledAt: null, fiscalPeriodEnd: null, items: [], error: message };
    if (reusableSaved && candidate.eventFamily !== "valuation_gap") applyCompanyScale(candidate, reusableSaved.annualRevenue, sourceUrl, now);
    const provider: ProviderResult = { provider: "sec_company_facts", status, checkedAt: reusableSaved?.fundamentals.checkedAt ?? null, nextRetryAt: null, sourceUrls: [sourceUrl], receipts: [], recordsRead: candidate.fundamentals.items.length, error: status === "not_due" ? null : message, entitlementVerified: true, cached: Boolean(reusableSaved) };
    return { candidate, provider };
  }
}
