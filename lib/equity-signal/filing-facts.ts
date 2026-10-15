import crypto from "node:crypto";

/** A deliberately small iXBRL reader, not a general XBRL engine. Only reviewed
 * issuer/concept/scope combinations are admitted. No text-to-debt heuristics. */
export const FILING_FACTS_VERSION = 1;
export type FilingIdentity = { cik: string; url: string; accession: string; form: string;
  filedAt: string; reportingPeriod: string };
type Unit = "USD" | "shares" | "USD/shares";
export type FilingFact = { metric: string; value: number; unit: Unit; periodStart: string | null;
  periodEnd: string; basis: "reported_gaap" | "reported_disclosure"; scope: string;
  status: "reported" | "explicitly_zero"; concept: string; contextId: string; factId: string;
  unitRef: string | null; decimals: string | null; scale: number; sign: string; rawValue: string;
  sourceUrl: string; sourceLocation: string; sourceHash: string; sourceElementHash: string;
  cik: string; accession: string; filedAt: string; form: string };
export type FilingFactExtraction = { version: 1; status: "extracted" | "blocked";
  source: FilingIdentity; sourceHash: string; facts: FilingFact[];
  checks: Array<{ name: string; periodStart: string | null; passed: boolean }>;
  gaps: Array<{ metric: string; reason: string }>; coverage: "reviewed_concepts_only";
  normalization: "none; reported facts are not normalized earnings, TTM, or forward dilution" };
type Context = { cik: string; start: string | null; end: string; dimensional: boolean };
type Rule = { metric: string; unit: Unit; period: "instant" | "duration"; scope: string;
  basis?: FilingFact["basis"]; nonnegative?: boolean };
const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
const decode = (s: string) => s.replace(/&#(x[0-9a-f]+|\d+);/gi, (_, code: string) => {
  const value = code[0].toLowerCase() === "x" ? parseInt(code.slice(1), 16) : Number(code);
  return value >= 0 && value <= 0x10ffff ? String.fromCodePoint(value) : "";
}).replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
const plain = (s: string) => decode(s.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
function attrs(s: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const m of s.matchAll(/([A-Za-z_][\w:.-]*)\s*=\s*(["'])([\s\S]*?)\2/g)) {
    if (Object.hasOwn(result, m[1])) return {}; // Ambiguous attributes fail closed.
    result[m[1]] = decode(m[3]);
  }
  return result;
}
const isoDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s))
  && new Date(s).toISOString().slice(0, 10) === s;
function reportDate(s: string) {
  if (isoDate(s)) return s;
  const m = s.match(/^(January|February|March|April|May|June|July|August|September|October|November|December) (\d{1,2}), (\d{4})$/);
  if (!m) return null;
  const month = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"].indexOf(m[1]) + 1;
  const value = `${m[3]}-${String(month).padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  return isoDate(value) ? value : null;
}
const TAGS: Record<string, Rule> = {
  "us-gaap:WeightedAverageNumberOfSharesOutstandingBasic": { metric: "weighted_average_basic_shares", unit: "shares", period: "duration", scope: "GAAP weighted-average common shares", nonnegative: true },
  "us-gaap:WeightedAverageNumberOfDilutedSharesOutstanding": { metric: "weighted_average_diluted_shares", unit: "shares", period: "duration", scope: "GAAP weighted-average diluted common shares; not spot or prospective dilution", nonnegative: true },
  "us-gaap:IncrementalCommonSharesAttributableToShareBasedPaymentArrangements": { metric: "dilutive_award_shares", unit: "shares", period: "duration", scope: "GAAP EPS denominator increment from share-based awards", nonnegative: true },
  "us-gaap:IncrementalCommonSharesAttributableToConversionOfDebtSecurities": { metric: "dilutive_convertible_shares", unit: "shares", period: "duration", scope: "GAAP EPS denominator increment from convertible debt; not forward conversion", nonnegative: true },
  "us-gaap:WeightedAverageNumberDilutedSharesOutstandingAdjustment": { metric: "dilutive_shares_total", unit: "shares", period: "duration", scope: "GAAP EPS total denominator increment", nonnegative: true },
  "us-gaap:DilutiveSecuritiesEffectOnBasicEarningsPerShareOther": { metric: "diluted_eps_numerator_addback", unit: "USD", period: "duration", scope: "Reported GAAP EPS numerator adjustment; not per-share EPS" },
  "us-gaap:EarningsPerShareDiluted": { metric: "diluted_eps_reported_period", unit: "USD/shares", period: "duration", scope: "GAAP EPS for the stated duration; not TTM or normalized EPS" },
  "us-gaap:NetCashProvidedByUsedInOperatingActivities": { metric: "operating_cash_flow_reported_period", unit: "USD", period: "duration", scope: "GAAP net operating cash for the stated duration; includes working capital effects" },
  "us-gaap:PaymentsToAcquirePropertyPlantAndEquipment": { metric: "capital_expenditure_cash_outflow", unit: "USD", period: "duration", scope: "Cash payments for property, plant and equipment; positive outflow magnitude", nonnegative: true },
};
const UPST_TAGS: Record<string, Rule> = {
  "upst:LongTermAndShortTermDebtGross": { metric: "borrowings_principal", unit: "USD", period: "instant", scope: "Reported aggregate borrowings principal; separate securitization liabilities and leases excluded", nonnegative: true },
  "us-gaap:DebtLongtermAndShorttermCombinedAmount": { metric: "borrowings_carrying_amount", unit: "USD", period: "instant", scope: "Reported aggregate borrowings net of discount; not a current/noncurrent split", nonnegative: true },
  "us-gaap:DebtInstrumentUnamortizedDiscount": { metric: "borrowings_unamortized_discount", unit: "USD", period: "instant", scope: "Unamortized discount deducted from borrowings principal", nonnegative: true },
  ...Object.fromEntries([
    ["RemainderOfFiscalYear", "remainder_of_fiscal_year"], ["YearOne", "year_one"], ["YearTwo", "year_two"],
    ["YearThree", "year_three"], ["YearFour", "year_four"], ["AfterYearFour", "after_year_four"],
  ].map(([tag, metric]) => [`upst:LongTermAndShortTermDebtMaturity${tag}`, {
    metric: `borrowings_principal_maturity_${metric}`, unit: "USD", period: "instant",
    scope: `Borrowings principal maturity ${metric} relative to reporting fiscal year; not carrying value or lease obligations`, nonnegative: true,
  } as Rule])),
};
export const reviewedFilingRules = (cik: string): Record<string, Rule> => ({ ...TAGS, ...(cik === "0001647639" ? UPST_TAGS : {}) });

/** Requires actual HTTP-200/EOF collection upstream. The boolean never attests
 * document coverage on its own; callers bind the result into transport proof. */
export function extractFilingFacts(html: string, source: FilingIdentity, complete: boolean): FilingFactExtraction {
  const result: FilingFactExtraction = { version: 1, status: "blocked", source: { ...source }, sourceHash: sha(html),
    facts: [], checks: [], gaps: [], coverage: "reviewed_concepts_only",
    normalization: "none; reported facts are not normalized earnings, TTM, or forward dilution" };
  const gap = (metric: string, reason: string) => { if (!result.gaps.some(g => g.metric === metric && g.reason === reason)) result.gaps.push({ metric, reason }); };
  const stop = (reason: string) => { gap("filing_facts", reason); return result; };
  if (!complete || !/<\/html>\s*$/i.test(html)) return stop("partial_document_no_numeric_promotion");
  if (Buffer.byteLength(html) > 5_000_000) return stop("existing_document_limit_exceeded");
  // Comments and executable/style literals are not document facts. Keep the
  // original response hash above, but never parse lexical ix markup within them.
  for (const m of html.matchAll(/<ix:(nonFraction|nonNumeric)\b[^>]*>([\s\S]*?)<\/ix:\1>/g)) {
    if (/<!--|<(?:script|style)\b/i.test(m[2])) return stop("noncontent_within_fact_unsupported");
  }
  html = html.replace(/<!--[\s\S]*?-->/g, " ").replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ");
  if (!["0001647639", "0000903651"].includes(source.cik)) return stop("issuer_mapping_not_reviewed");
  if (!/^\d{10}-\d{2}-\d{6}$/.test(source.accession) || !isoDate(source.reportingPeriod) || !isoDate(source.filedAt)
    || source.reportingPeriod > source.filedAt || source.form !== "10-Q") return stop("unsupported_identity_period_or_amendment");
  const base = `https://www.sec.gov/Archives/edgar/data/${Number(source.cik)}/${source.accession.replace(/-/g, "")}/`;
  if (!source.url.startsWith(base) || !/^[\w.-]+\.html?$/.test(source.url.slice(base.length))) return stop("source_url_identity_mismatch");
  const rootTag = html.match(/<html\b([^>]*)>/i);
  const root = attrs(rootTag?.[1] ?? "");
  // This narrow reader resolves only root-declared namespaces. Any nested
  // declaration is unsupported, even if it appears equivalent.
  if (/\bxmlns(?::[\w.-]+)?\s*=/.test(html.replace(rootTag?.[0] ?? "", ""))) return stop("nested_namespace_declaration_unsupported");
  if (root["xmlns:iso4217"] !== "http://www.xbrl.org/2003/iso4217"
    || root["xmlns:ix"] !== "http://www.xbrl.org/2013/inlineXBRL"
    || root["xmlns:xbrli"] !== "http://www.xbrl.org/2003/instance"
    || !/^http:\/\/fasb.org\/us-gaap\/20\d{2}$/.test(root["xmlns:us-gaap"] ?? "")
    || !/^http:\/\/xbrl.sec.gov\/dei\/20\d{2}$/.test(root["xmlns:dei"] ?? "")
    || !/^http:\/\/www.xbrl.org\/inlineXBRL\/transformation\/(?:2020-02-12|2022-02-16)$/.test(root["xmlns:ixt"] ?? "")) return stop("unsupported_taxonomy_namespace");
  if (source.cik === "0001647639" && root["xmlns:upst"] !== `http://www.upstartholdings.com/${source.reportingPeriod.replace(/-/g, "")}`) return stop("custom_taxonomy_identity_mismatch");
  const ids = new Set<string>();
  for (const m of html.matchAll(/<ix:(?:nonFraction|nonNumeric)\b([^>]*)>/g)) {
    const a = attrs(m[1]);
    if (!a.name) return stop("ambiguous_inline_attributes");
    if (a.id && ids.has(a.id)) return stop("duplicate_inline_fact_id");
    if (a.id) ids.add(a.id);
  }
  const contexts = new Map<string, Context>(), units = new Map<string, Unit>(), unitIds = new Set<string>(), contextIds = new Set<string>();
  for (const m of html.matchAll(/<xbrli:context\b([^>]*)>([\s\S]*?)<\/xbrli:context>/g)) {
    const a = attrs(m[1]), body = m[2], ids = [...body.matchAll(/<xbrli:identifier\b([^>]*)>([^<]*)<\/xbrli:identifier>/g)];
    if (!a.id || contextIds.has(a.id)) return stop("duplicate_or_missing_context_id");
    contextIds.add(a.id);
    const periods = [...body.matchAll(/<xbrli:period>([\s\S]*?)<\/xbrli:period>/g)];
    if (periods.length !== 1) return stop("ambiguous_context_period");
    const p = periods[0][1].replace(/\s+/g, "");
    const instant = p.match(/^<xbrli:instant>([^<]+)<\/xbrli:instant>$/);
    const duration = p.match(/^<xbrli:startDate>([^<]+)<\/xbrli:startDate><xbrli:endDate>([^<]+)<\/xbrli:endDate>$/);
    if (!instant && !duration) return stop("ambiguous_context_period");
    const start = duration?.[1] ?? null, end = instant?.[1] ?? duration?.[2] ?? "";
    if (ids.length !== 1 || attrs(ids[0][1]).scheme !== "http://www.sec.gov/CIK" || !isoDate(end)
      || (start !== null && (!isoDate(start) || start > end))) continue;
    contexts.set(a.id, { cik: ids[0][2].padStart(10, "0"), start, end,
      dimensional: /<xbrli:(?:segment|scenario)\b|<xbrldi:/i.test(body) });
  }
  for (const m of html.matchAll(/<xbrli:unit\b([^>]*)>([\s\S]*?)<\/xbrli:unit>/g)) {
    const a = attrs(m[1]), compact = m[2].replace(/\s+/g, "");
    if (!a.id || unitIds.has(a.id)) return stop("duplicate_or_missing_unit_id");
    unitIds.add(a.id);
    const unit: Unit | null = compact === "<xbrli:measure>iso4217:USD</xbrli:measure>" ? "USD"
      : compact === "<xbrli:measure>xbrli:shares</xbrli:measure>" ? "shares"
        : compact === "<xbrli:divide><xbrli:unitNumerator><xbrli:measure>iso4217:USD</xbrli:measure></xbrli:unitNumerator><xbrli:unitDenominator><xbrli:measure>xbrli:shares</xbrli:measure></xbrli:unitDenominator></xbrli:divide>" ? "USD/shares" : null;
    if (unit) units.set(a.id, unit);
  }
  const identity = new Map<string, string>();
  for (const m of html.matchAll(/<ix:nonNumeric\b([^>]*)>([\s\S]*?)<\/ix:nonNumeric>/g)) {
    const a = attrs(m[1]);
    if (!["dei:EntityCentralIndexKey", "dei:DocumentType", "dei:DocumentPeriodEndDate", "dei:AmendmentFlag"].includes(a.name)) continue;
    const c = contexts.get(a.contextRef), value = plain(m[2]);
    if (!c || c.dimensional || c.cik !== source.cik || c.end !== source.reportingPeriod
      || (identity.has(a.name) && identity.get(a.name) !== value)) return stop("filing_identity_context_mismatch");
    identity.set(a.name, value);
  }
  if (identity.get("dei:EntityCentralIndexKey") !== source.cik || identity.get("dei:DocumentType") !== source.form
    || reportDate(identity.get("dei:DocumentPeriodEndDate") ?? "") !== source.reportingPeriod
    || identity.get("dei:AmendmentFlag") !== "false") return stop("filing_identity_period_or_amendment_mismatch");
  const rules = reviewedFilingRules(source.cik);
  const candidates = new Map<string, FilingFact[]>();
  for (const m of html.matchAll(/<ix:nonFraction\b([^>]*)>([\s\S]*?)<\/ix:nonFraction>/g)) {
    const a = attrs(m[1]), rule = rules[a.name];
    if (!rule) continue;
    const context = contexts.get(a.contextRef);
    if (!context || context.dimensional || context.end !== source.reportingPeriod) continue;
    if (context.cik !== source.cik) { gap(rule.metric, "fact_issuer_mismatch"); continue; }
    if ((rule.period === "instant") !== (context.start === null)) { gap(rule.metric, "fact_period_type_mismatch"); continue; }
    const days = context.start ? (Date.parse(context.end) - Date.parse(context.start)) / 86_400_000 : 0;
    if (context.start && (days < 70 || days > 300)) { gap(rule.metric, "unsupported_duration"); continue; }
    const rawValue = plain(m[2]), scaleText = a.scale ?? "0", scale = Number(scaleText);
    const unit = units.get(a.unitRef), format = a.format ?? "";
    const fixedZero = format === "ixt:fixed-zero" && /^[—–-]$/.test(rawValue);
    if (unit !== rule.unit || !/^-?\d+$/.test(scaleText) || Math.abs(scale) > 12
      || !/^(?:INF|-?\d+)$/.test(a.decimals ?? "") || !["", "-"].includes(a.sign ?? "")
      || !["", "ixt:num-dot-decimal", "ixt:fixed-zero"].includes(format)
      || (!fixedZero && !/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(rawValue))
      || (format === "ixt:fixed-zero" && !fixedZero) || /<ix:/i.test(m[2])
      || a.continuedAt !== undefined || a["xsi:nil"] !== undefined) {
      gap(rule.metric, "unsupported_unit_or_numeric_transform"); continue;
    }
    const value = (fixedZero ? 0 : Number(rawValue.replace(/,/g, ""))) * 10 ** scale * (a.sign === "-" ? -1 : 1);
    if (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER || (rule.nonnegative && value < 0)
      || (unit === "shares" && !Number.isSafeInteger(value)) || !a.id) { gap(rule.metric, "invalid_numeric_value"); continue; }
    const fact: FilingFact = { metric: rule.metric, value, unit, periodStart: context.start, periodEnd: context.end,
      basis: rule.basis ?? "reported_gaap", scope: rule.scope, status: value === 0 ? "explicitly_zero" : "reported",
      concept: a.name, contextId: a.contextRef, factId: a.id, unitRef: a.unitRef, decimals: a.decimals, scale,
      sign: a.sign ?? "", rawValue, sourceUrl: source.url, sourceLocation: `${source.url}#${encodeURIComponent(a.id)}`,
      sourceHash: result.sourceHash, sourceElementHash: sha(m[0]), cik: source.cik,
      accession: source.accession, filedAt: source.filedAt, form: source.form };
    const key = `${fact.metric}:${fact.periodStart ?? "instant"}:${fact.periodEnd}`;
    candidates.set(key, [...(candidates.get(key) ?? []), fact]);
  }
  for (const values of candidates.values()) {
    const first = values[0];
    if (values.some(f => f.value !== first.value || f.unit !== first.unit || f.scale !== first.scale || f.decimals !== first.decimals)) {
      gap(first.metric, "conflicting_duplicate_facts"); continue;
    }
    if (!result.gaps.some(g => g.metric === first.metric)) result.facts.push(first);
  }
  const find = (metric: string, start: string | null) => result.facts.find(f => f.metric === metric && f.periodStart === start);
  const check = (name: string, metrics: string[], start: string | null, reconcile: (values: number[]) => boolean) => {
    const facts = metrics.map(metric => find(metric, start));
    const passed = facts.every(Boolean) && reconcile(facts.map(f => f!.value));
    result.checks.push({ name, periodStart: start, passed });
    if (!passed) {
      for (const metric of metrics) gap(metric, "missing_or_unreconciled_bridge");
      result.facts = result.facts.filter(f => f.periodStart !== start || !metrics.includes(f.metric));
    }
  };
  if (source.cik === "0001647639") {
    const maturity = Object.values(UPST_TAGS).map(r => r.metric).filter(m => m.startsWith("borrowings_principal_maturity_"));
    check("borrowings_principal_equals_maturities", ["borrowings_principal", ...maturity], null,
      v => v[0] === v.slice(1).reduce((sum, value) => sum + value, 0));
    check("borrowings_principal_less_discount_equals_carrying", ["borrowings_principal", "borrowings_unamortized_discount", "borrowings_carrying_amount"], null,
      v => v[0] - v[1] === v[2]);
    if (result.checks.some(c => c.name.startsWith("borrowings_") && !c.passed)) {
      result.facts = result.facts.filter(f => !f.metric.startsWith("borrowings_"));
    }
  }
  for (const start of [...new Set(result.facts.filter(f => f.metric === "weighted_average_basic_shares").map(f => f.periodStart))]) {
    const metrics = ["weighted_average_basic_shares", "dilutive_award_shares", ...(source.cik === "0001647639" ? ["dilutive_convertible_shares"] : []), "weighted_average_diluted_shares"];
    check("basic_plus_incremental_equals_diluted_shares", metrics, start, v => v.slice(0, -1).reduce((sum, value) => sum + value, 0) === v.at(-1));
    if (source.cik === "0001647639") check("incremental_shares_equal_total", ["dilutive_award_shares", "dilutive_convertible_shares", "dilutive_shares_total"], start, v => v[0] + v[1] === v[2]);
    if (result.checks.some(c => c.periodStart === start && !c.passed)) {
      result.facts = result.facts.filter(f => f.periodStart !== start || !/^(?:weighted_average_|dilutive_)/.test(f.metric));
    }
  }
  if (source.cik === "0000903651") {
    // This exact issuer-authored disclosure supports revolver utilization only.
    // Facility capacity, pensions and vendor obligations are never debt aliases.
    const marker = /<ix:nonNumeric\b([^>]*\bname="us-gaap:DebtDisclosureTextBlock"[^>]*)>([\s\S]*?)<\/ix:nonNumeric>/g;
    for (const m of html.matchAll(marker)) {
      const a = attrs(m[1]), c = contexts.get(a.contextRef), content = plain(m[2]);
      const statement = content.match(/The Company did not utilize the Revolving Credit Facility during the six months ended ([A-Za-z]+ \d{1,2}, \d{4}) or during the subsequent period through the filing date of this Report\./);
      if (!c || c.cik !== source.cik || c.dimensional || c.end !== source.reportingPeriod || !c.start
        || !statement || reportDate(statement[1]) !== source.reportingPeriod || !a.id
        || !/^16\.\s*Line of Credit\b/.test(content)) continue;
      const duration = (Date.parse(c.end) - Date.parse(c.start)) / 86400000;
      if (duration < 175 || duration > 185) continue;
      result.facts.push({ metric: "revolver_utilization", value: 0, unit: "USD", periodStart: c.start,
        periodEnd: c.end, basis: "reported_disclosure", scope: "Named Revolving Credit Facility unused during reported H1 through filing date; not total corporate debt",
        status: "explicitly_zero", concept: a.name, contextId: a.contextRef, factId: a.id, unitRef: null,
        decimals: null, scale: 0, sign: "", rawValue: statement[0], sourceUrl: source.url,
        sourceLocation: `${source.url}#${encodeURIComponent(a.id)}`, sourceHash: result.sourceHash,
        sourceElementHash: sha(m[0]), cik: source.cik, accession: source.accession, filedAt: source.filedAt, form: source.form });
    }
  }
  // These are policy/scope gaps, not reasons to manufacture zero or normalized metrics.
  gap("long_term_debt_noncurrent", "not_mapped_total_borrowings_or_nonborrowing_obligations_are_not_a_debt_split");
  gap("normalized_earnings_and_cash_flow", "assumption_required_reported_or_company_adjusted_is_not_normalized");
  gap("forward_dilution", "assumption_required_historical_EPS_bridge_is_not_a_conversion_scenario");
  gap("current_date_debt", "amendments_and_subsequent_events_required_period_balance_does_not_prove_repayment_after_maturity");
  gap("reported_non_gaap", "reconciliation_source_not_in_reviewed_inline_concepts");
  result.status = result.facts.length ? "extracted" : "blocked";
  if (!result.facts.length) gap("filing_facts", "no_reconciled_supported_facts");
  return result;
}
