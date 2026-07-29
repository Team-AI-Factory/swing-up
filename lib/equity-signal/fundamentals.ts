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
  { label: "shares_outstanding", concepts: ["CommonStockSharesOutstanding", "EntityCommonStockSharesOutstanding"], units: ["shares"] },
] as const;

const DAY_MS = 24 * 60 * 60 * 1000;
const ANNUAL_REVENUE_MAX_AGE_MS = 18 * 30.4375 * DAY_MS;
const SHARES_MAX_AGE_MS = 6 * 30.4375 * DAY_MS;
const ANNUAL_FORMS = new Set(["10-K", "20-F", "40-F"]);

type FactUnit = {
  val?: unknown;
  filed?: unknown;
  start?: unknown;
  end?: unknown;
  form?: unknown;
  fy?: unknown;
  fp?: unknown;
  frame?: unknown;
  segment?: unknown;
};

type SelectedFact = {
  concept: string;
  value: number;
  unit: string;
  filedAt: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  form: string | null;
};

function number(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function date(value: unknown) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function factRows(facts: Record<string, unknown>, concepts: readonly string[], units: readonly string[]) {
  const candidates: Array<{ concept: string; unit: string; row: FactUnit }> = [];
  for (const concept of concepts) {
    const raw = facts[concept];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const unitMap = (raw as Record<string, unknown>).units;
    if (!unitMap || typeof unitMap !== "object" || Array.isArray(unitMap)) continue;
    for (const unit of units) {
      const rows = (unitMap as Record<string, unknown>)[unit];
      if (!Array.isArray(rows)) continue;
      for (const row of rows) {
        if (!row || typeof row !== "object" || Array.isArray(row) || number((row as FactUnit).val) === null) continue;
        candidates.push({ concept, unit, row: row as FactUnit });
      }
    }
  }
  return candidates;
}

function selectedFact(input: { concept: string; unit: string; row: FactUnit }): SelectedFact | null {
  const value = number(input.row.val);
  if (value === null) return null;
  return {
    concept: input.concept,
    value,
    unit: input.unit,
    filedAt: date(input.row.filed),
    periodStart: date(input.row.start),
    periodEnd: date(input.row.end),
    form: typeof input.row.form === "string" ? input.row.form.trim().toUpperCase() : null,
  };
}

function latestFact(facts: Record<string, unknown>, concepts: readonly string[], units: readonly string[]) {
  const selected = factRows(facts, concepts, units)
    .flatMap((candidate) => selectedFact(candidate) ?? [])
    .sort((left, right) =>
      String(right.filedAt ?? "").localeCompare(String(left.filedAt ?? ""))
      || String(right.periodEnd ?? "").localeCompare(String(left.periodEnd ?? "")));
  return selected[0] ?? null;
}

function ageIsSafe(value: string | null, now: Date, maximumAgeMs: number) {
  if (!value) return false;
  const observedAt = Date.parse(`${value}T00:00:00.000Z`);
  const ageMs = now.getTime() - observedAt;
  return Number.isFinite(observedAt) && ageMs >= 0 && ageMs <= maximumAgeMs;
}

function latestAnnualRevenue(facts: Record<string, unknown>, now: Date) {
  const metric = METRICS.find((item) => item.label === "revenue")!;
  const selected = factRows(facts, metric.concepts, metric.units)
    .filter(({ row }) => row.segment === undefined || row.segment === null)
    .flatMap((candidate) => {
      const fact = selectedFact(candidate);
      if (!fact || fact.value <= 0 || !fact.periodStart || !fact.periodEnd || !fact.form || !ANNUAL_FORMS.has(fact.form)) return [];
      const durationDays = (Date.parse(`${fact.periodEnd}T00:00:00.000Z`) - Date.parse(`${fact.periodStart}T00:00:00.000Z`)) / DAY_MS;
      if (!Number.isFinite(durationDays)
        || durationDays < 300
        || durationDays > 430
        || !ageIsSafe(fact.filedAt, now, ANNUAL_REVENUE_MAX_AGE_MS)
        || !ageIsSafe(fact.periodEnd, now, ANNUAL_REVENUE_MAX_AGE_MS)) return [];
      return [fact];
    })
    .sort((left, right) =>
      String(right.periodEnd ?? "").localeCompare(String(left.periodEnd ?? ""))
      || String(right.filedAt ?? "").localeCompare(String(left.filedAt ?? "")));
  return selected[0] ?? null;
}

function latestSharesOutstanding(facts: Record<string, unknown>, now: Date) {
  const metric = METRICS.find((item) => item.label === "shares_outstanding")!;
  const selected = factRows(facts, metric.concepts, metric.units)
    .filter(({ row }) =>
      (row.segment === undefined || row.segment === null)
      && (row.start === undefined || row.start === null))
    .flatMap((candidate) => {
      const fact = selectedFact(candidate);
      if (!fact || fact.value <= 0 || !ageIsSafe(fact.periodEnd, now, SHARES_MAX_AGE_MS)) return [];
      return [fact];
    })
    .sort((left, right) =>
      String(right.periodEnd ?? "").localeCompare(String(left.periodEnd ?? ""))
      || String(right.filedAt ?? "").localeCompare(String(left.filedAt ?? "")));
  return selected[0] ?? null;
}

function round(value: number, digits = 4) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function relativeMagnitude(candidate: ImpactCandidate, annualRevenue: SelectedFact | null, sharesOutstanding: SelectedFact | null, sourceUrl: string) {
  const contractValue = candidate.eventMagnitude.metrics
    .filter((metric) => metric.promotionEvidenceVerified
      && metric.kind === "contract_value"
      && metric.unit === "USD"
      && metric.eventStatus === "committed")
    .sort((left, right) => right.value - left.value)[0];
  const offeringShares = candidate.eventMagnitude.metrics
    .filter((metric) => metric.promotionEvidenceVerified
      && metric.kind === "offering_shares"
      && metric.unit === "shares"
      && ["priced", "completed"].includes(metric.eventStatus ?? ""))
    .sort((left, right) => right.value - left.value)[0];
  const finalFine = candidate.eventMagnitude.metrics
    .filter((metric) => metric.promotionEvidenceVerified
      && metric.kind === "fine_value"
      && metric.unit === "USD"
      && metric.eventStatus === "final")
    .sort((left, right) => right.value - left.value)[0];
  const comparison = candidate.eventFamily === "contract_award" && contractValue && annualRevenue
    ? { metric: "annual_revenue" as const, eventValue: contractValue.value, eventMetricSourceReceiptId: contractValue.sourceReceiptId, companyValue: annualRevenue.value }
    : candidate.eventFamily === "financing_dilution" && offeringShares && sharesOutstanding
      ? { metric: "shares_outstanding" as const, eventValue: offeringShares.value, eventMetricSourceReceiptId: offeringShares.sourceReceiptId, companyValue: sharesOutstanding.value }
      : candidate.eventFamily === "regulatory_enforcement" && finalFine && annualRevenue
        ? { metric: "annual_revenue" as const, eventValue: finalFine.value, eventMetricSourceReceiptId: finalFine.sourceReceiptId, companyValue: annualRevenue.value }
      : null;
  if (!comparison || comparison.eventValue <= 0 || comparison.companyValue <= 0) return null;
  return {
    ...comparison,
    ratioPercent: round((comparison.eventValue / comparison.companyValue) * 100),
    sourceUrl,
  };
}

function requiredScale(candidate: ImpactCandidate) {
  return {
    annualRevenue: (candidate.eventFamily === "contract_award"
      && candidate.eventMagnitude.metrics.some((metric) => metric.promotionEvidenceVerified
        && metric.kind === "contract_value"
        && metric.unit === "USD"
        && metric.eventStatus === "committed"))
      || (candidate.eventFamily === "regulatory_enforcement"
        && candidate.eventMagnitude.metrics.some((metric) => metric.promotionEvidenceVerified
          && metric.kind === "fine_value"
          && metric.unit === "USD"
          && metric.eventStatus === "final")),
    sharesOutstanding: candidate.eventFamily === "financing_dilution"
      && candidate.eventMagnitude.metrics.some((metric) => metric.promotionEvidenceVerified
        && metric.kind === "offering_shares"
        && metric.unit === "shares"
        && ["priced", "completed"].includes(metric.eventStatus ?? "")),
  };
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
    const annualRevenue = latestAnnualRevenue(facts, now);
    const sharesOutstanding = latestSharesOutstanding(facts, now);
    const items = METRICS.flatMap((metric) => {
      const fact = metric.label === "revenue"
        ? annualRevenue
        : metric.label === "shares_outstanding"
          ? sharesOutstanding
          : latestFact(facts, metric.concepts, metric.units);
      return fact ? [{ metric: metric.label, value: fact.value, unit: fact.unit, filedAt: fact.filedAt, periodEnd: fact.periodEnd, form: fact.form }] : [];
    });
    const latestFiledAt = items.map((item) => item.filedAt).filter((value): value is string => Boolean(value)).sort().at(-1) ?? null;
    const fiscalPeriodEnd = items.map((item) => item.periodEnd).filter((value): value is string => Boolean(value)).sort().at(-1) ?? null;
    const requirements = requiredScale(candidate);
    const requiredScaleAvailable = (!requirements.annualRevenue || Boolean(annualRevenue))
      && (!requirements.sharesOutstanding || Boolean(sharesOutstanding));
    const hasRequiredScale = requirements.annualRevenue || requirements.sharesOutstanding;
    const available = hasRequiredScale ? requiredScaleAvailable : items.length > 0;
    const relativeToCompany = relativeMagnitude(candidate, annualRevenue, sharesOutstanding, sourceUrl);
    if (hasRequiredScale) {
      const eventScaleLabel = candidate.eventFamily === "regulatory_enforcement"
        ? "final enforcement amount"
        : relativeToCompany?.metric === "annual_revenue"
          ? "committed contract value"
          : "priced offering shares";
      candidate.eventMagnitude = {
        ...candidate.eventMagnitude,
        status: relativeToCompany ? "relative_to_company" : candidate.eventMagnitude.metrics.length ? "absolute_only" : "unquantified",
        relativeToCompany,
        materialityBasis: relativeToCompany
          ? `Explicit ${eventScaleLabel} equals ${relativeToCompany.ratioPercent}% of the latest safe SEC ${relativeToCompany.metric.replace("_", " ")} denominator.`
          : `No current safe SEC ${requirements.annualRevenue ? "annual revenue" : "shares outstanding"} denominator was available; company-relative magnitude was not inferred.`,
      };
    }
    const error = available ? null : items.length ? "required_company_scale_unavailable" : "no_supported_company_facts";
    candidate.fundamentals = { available, sourceUrl, checkedAt: now.toISOString(), latestFiledAt, fiscalPeriodEnd, items, error };
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
