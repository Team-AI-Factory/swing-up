import crypto from "node:crypto";
import type { ImpactCandidate } from "@/lib/equity-signal/types";

export type ApprovedWatchOutPriority = "P0" | "P1";
export type ApprovedWatchOutRuleId =
  | "trading_halt_or_resumption"
  | "delisting_or_exchange_compliance"
  | "liquidity_collapse_or_gap_risk"
  | "volatility_regime_spike"
  | "accounting_auditor_or_restated_financials"
  | "sec_doj_ftc_or_regulator_action"
  | "fda_clinical_hold_recall_or_rejection"
  | "bankruptcy_going_concern_or_covenant_stress"
  | "dilution_atm_secondary_or_convertible"
  | "earnings_guidance_or_cash_flow_break"
  | "customer_supplier_or_contract_concentration_loss"
  | "cyberattack_data_breach_or_operational_outage"
  | "sudden_ceo_cfo_or_governance_break"
  | "merger_deal_break_or_financing_failure"
  | "geopolitical_tariff_sanction_or_supply_chain_shock"
  | "source_contradiction_or_data_integrity_failure";

export type WatchOutReviewFinding = {
  ruleId: ApprovedWatchOutRuleId;
  ruleName: string;
  priority: ApprovedWatchOutPriority;
  ticker: string;
  company: string;
  eventFamily: string | null;
  observedAt: string;
  currentPrice: number | null;
  seriousSignal: false;
  publicationStatus: "review_only_validation_pending";
  notificationEligible: false;
  approvedByUser: true;
  reasons: string[];
  evidence: {
    marketScope: "US listed common equities and ADRs only";
    primaryOrIndependentProof: boolean;
    exactIssuerMapping: boolean;
    eventAgeHours: number | null;
    quoteAgeHours: number | null;
    sourceCount: number;
    noRumour: boolean;
    contradictionPenalty: number;
    noSyntheticData: true;
  };
  duplicateKey: string;
  validationStatus: "rule_specific_forward_validation_required";
};

type Json = Record<string, unknown>;
type MarketRow = {
  ticker: string;
  company: string;
  exchange: string;
  country: string | null;
  price: number;
  changePercent: number;
  volume: number | null;
  relativeVolume: number | null;
  averageVolume: number | null;
  marketCap: number | null;
};

type TradingViewPage = { totalCount: number; rows: MarketRow[]; error: string | null };

const RULE_NAMES: Record<ApprovedWatchOutRuleId, string> = {
  trading_halt_or_resumption: "Trading halt or volatile resumption",
  delisting_or_exchange_compliance: "Delisting or exchange-compliance danger",
  liquidity_collapse_or_gap_risk: "Liquidity collapse or abnormal gap risk",
  volatility_regime_spike: "Volatility-regime spike",
  accounting_auditor_or_restated_financials: "Accounting, auditor, or restatement risk",
  sec_doj_ftc_or_regulator_action: "Material regulator or law-enforcement action",
  fda_clinical_hold_recall_or_rejection: "FDA hold, recall, rejection, or pivotal-trial failure",
  bankruptcy_going_concern_or_covenant_stress: "Bankruptcy, going-concern, covenant, or refinancing stress",
  dilution_atm_secondary_or_convertible: "Dilution, ATM, secondary offering, or convertible financing",
  earnings_guidance_or_cash_flow_break: "Earnings, guidance, margin, or cash-flow break",
  customer_supplier_or_contract_concentration_loss: "Major customer, supplier, or contract loss",
  cyberattack_data_breach_or_operational_outage: "Cyberattack, data breach, or operational outage",
  sudden_ceo_cfo_or_governance_break: "Sudden leadership or governance break",
  merger_deal_break_or_financing_failure: "Merger deal-break or financing failure",
  geopolitical_tariff_sanction_or_supply_chain_shock: "Geopolitical, tariff, sanction, or supply-chain shock",
  source_contradiction_or_data_integrity_failure: "Source contradiction or data-integrity failure",
};

const RULE_PRIORITIES: Record<ApprovedWatchOutRuleId, ApprovedWatchOutPriority> = {
  trading_halt_or_resumption: "P0",
  delisting_or_exchange_compliance: "P0",
  liquidity_collapse_or_gap_risk: "P0",
  volatility_regime_spike: "P1",
  accounting_auditor_or_restated_financials: "P0",
  sec_doj_ftc_or_regulator_action: "P0",
  fda_clinical_hold_recall_or_rejection: "P0",
  bankruptcy_going_concern_or_covenant_stress: "P0",
  dilution_atm_secondary_or_convertible: "P0",
  earnings_guidance_or_cash_flow_break: "P0",
  customer_supplier_or_contract_concentration_loss: "P1",
  cyberattack_data_breach_or_operational_outage: "P0",
  sudden_ceo_cfo_or_governance_break: "P1",
  merger_deal_break_or_financing_failure: "P0",
  geopolitical_tariff_sanction_or_supply_chain_shock: "P1",
  source_contradiction_or_data_integrity_failure: "P0",
};

const APPROVED_RULE_IDS = Object.keys(RULE_NAMES) as ApprovedWatchOutRuleId[];
const TV_COLUMNS = ["name", "description", "exchange", "country", "currency", "type", "is_primary", "close", "change", "volume", "relative_volume_10d_calc", "market_cap_basic", "update_mode"] as const;
const US_EXCHANGES = new Set(["NASDAQ", "NYSE", "AMEX", "NYSEAMERICAN"]);

function object(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
}

function finite(value: unknown) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value.replace(/,/g, "")) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function boolean(value: unknown) {
  return value === true || value === 1 || value === "true";
}

function ageHours(now: Date, value: unknown) {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? Math.max(0, (now.getTime() - parsed) / 3_600_000) : null;
}

function safeError(error: unknown) {
  return error instanceof Error ? error.message.replace(/\s+/g, " ").slice(0, 300) : "unknown_watch_out_error";
}

function duplicateKey(ruleId: ApprovedWatchOutRuleId, ticker: string, identity: string) {
  return crypto.createHash("sha256").update(`${ruleId}|${ticker.toUpperCase()}|${identity}`).digest("hex").slice(0, 24);
}

function finding(input: {
  ruleId: ApprovedWatchOutRuleId;
  ticker: string;
  company: string;
  eventFamily?: string | null;
  observedAt: string;
  currentPrice?: number | null;
  reasons: string[];
  sourceCount: number;
  primaryOrIndependentProof: boolean;
  exactIssuerMapping: boolean;
  eventAgeHours?: number | null;
  quoteAgeHours?: number | null;
  noRumour: boolean;
  contradictionPenalty: number;
  identity: string;
}): WatchOutReviewFinding {
  return {
    ruleId: input.ruleId,
    ruleName: RULE_NAMES[input.ruleId],
    priority: RULE_PRIORITIES[input.ruleId],
    ticker: input.ticker.toUpperCase(),
    company: input.company,
    eventFamily: input.eventFamily ?? null,
    observedAt: input.observedAt,
    currentPrice: input.currentPrice ?? null,
    seriousSignal: false,
    publicationStatus: "review_only_validation_pending",
    notificationEligible: false,
    approvedByUser: true,
    reasons: input.reasons,
    evidence: {
      marketScope: "US listed common equities and ADRs only",
      primaryOrIndependentProof: input.primaryOrIndependentProof,
      exactIssuerMapping: input.exactIssuerMapping,
      eventAgeHours: input.eventAgeHours ?? null,
      quoteAgeHours: input.quoteAgeHours ?? null,
      sourceCount: input.sourceCount,
      noRumour: input.noRumour,
      contradictionPenalty: input.contradictionPenalty,
      noSyntheticData: true,
    },
    duplicateKey: duplicateKey(input.ruleId, input.ticker, input.identity),
    validationStatus: "rule_specific_forward_validation_required",
  };
}

function eventText(candidate: Json) {
  const receipts = Array.isArray(candidate.receipts) ? candidate.receipts.map(object) : [];
  return [candidate.eventHeadline, candidate.whatHappened, candidate.eventFamily, ...receipts.flatMap((receipt) => [receipt.title, receipt.summary, receipt.rawEventType])]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();
}

function eventRules(candidateValue: unknown, now: Date): WatchOutReviewFinding[] {
  const candidate = object(candidateValue);
  const ticker = text(candidate.ticker)?.toUpperCase();
  if (!ticker) return [];
  const company = text(candidate.company) ?? ticker;
  const family = text(candidate.eventFamily);
  const headline = text(candidate.eventHeadline) ?? family ?? ticker;
  const observedAt = text(candidate.eventObservedAt) ?? now.toISOString();
  const eventAge = ageHours(now, observedAt);
  const quote = object(candidate.quote);
  const currentPrice = finite(quote.price);
  const quoteAge = ageHours(now, quote.observedAt);
  const primarySource = candidate.primarySource === true;
  const independentPublishers = Math.max(0, Math.floor(finite(candidate.independentPublishers) ?? 0));
  const mappingConfidence = finite(candidate.mappingConfidence) ?? 0;
  const materiality = finite(candidate.materiality) ?? 0;
  const transmission = finite(candidate.transmissionConfidence) ?? 0;
  const contradictionPenalty = finite(candidate.contradictionPenalty) ?? 0;
  const rumour = candidate.rumour === true;
  const relationship = text(candidate.relationship);
  const proof = primarySource || independentPublishers >= 2;
  const commonGate = eventAge !== null && eventAge <= 168 && mappingConfidence >= 95 && materiality >= 65 && transmission >= 70 && proof && !rumour;
  const words = eventText(candidate);
  const results: WatchOutReviewFinding[] = [];
  const emit = (ruleId: ApprovedWatchOutRuleId, reasons: string[], allowContradiction = false) => {
    if (!commonGate || (!allowContradiction && contradictionPenalty >= 50)) return;
    results.push(finding({
      ruleId,
      ticker,
      company,
      eventFamily: family,
      observedAt,
      currentPrice,
      reasons,
      sourceCount: Math.max(1, independentPublishers),
      primaryOrIndependentProof: proof,
      exactIssuerMapping: mappingConfidence >= 95,
      eventAgeHours: eventAge,
      quoteAgeHours: quoteAge,
      noRumour: !rumour,
      contradictionPenalty,
      identity: `${headline}|${observedAt.slice(0, 13)}`,
    }));
  };

  if (family === "trading_halt" || /\b(trading halt|halted trading|trading suspension|suspended trading|trading resumes?|resumption of trading|limit up|limit down)\b/.test(words)) {
    emit("trading_halt_or_resumption", ["A verified trading halt, suspension, or resumption can make normal price discovery unreliable."]);
  }
  if (/\b(delist(?:ing|ed)?|non.?compliance|minimum bid price|listing deficiency|late filing notice|exchange compliance deadline)\b/.test(words)) {
    emit("delisting_or_exchange_compliance", ["An official delisting or exchange-compliance issue can reduce liquidity and force selling."]);
  }
  if (/\b(restatement|restate financial|auditor resign|auditor resignation|material weakness|internal control weakness|accounting investigation|financial statements? should no longer be relied)\b/.test(words)) {
    emit("accounting_auditor_or_restated_financials", ["Reported financial information or management credibility may be unreliable."]);
  }
  if (family === "regulatory_enforcement" || /\b(sec charges?|doj charges?|ftc sues?|enforcement action|subpoena|antitrust suit|regulator investigation|court injunction)\b/.test(words)) {
    emit("sec_doj_ftc_or_regulator_action", ["A material official enforcement or legal action can create fines, restrictions, and discontinuous downside."]);
  }
  if (/\b(clinical hold|complete response letter|fda.{0,40}(reject|deny|recall|warning)|pivotal (?:trial )?(?:fail|miss)|safety signal|drug recall|device recall)\b/.test(words)) {
    emit("fda_clinical_hold_recall_or_rejection", ["A verified regulatory or pivotal-product failure may remove a major portion of expected product value."]);
  }
  if (/\b(chapter 11|bankrupt(?:cy)?|going concern|covenant breach|missed payment|payment default|restructuring adviser|debt restructuring|refinancing shortfall|liquidity crisis)\b/.test(words)) {
    emit("bankruptcy_going_concern_or_covenant_stress", ["The equity may face severe dilution or permanent impairment from solvency or refinancing pressure."]);
  }
  if (family === "financing_dilution" || /\b(at-the-market|atm offering|secondary offering|public offering|share offering|convertible debt|convertible notes?|warrant exercise|dilution|new share issuance)\b/.test(words)) {
    emit("dilution_atm_secondary_or_convertible", ["New security supply can weaken per-share value and price support."]);
  }
  if (family === "earnings_guidance" && candidate.direction === "downside") {
    emit("earnings_guidance_or_cash_flow_break", ["Official results or guidance indicate material deterioration in earnings, margins, or cash flow."]);
  }
  if (family === "cyber_incident" || /\b(cyberattack|ransomware|data breach|security breach|systems? outage|operational outage|network intrusion)\b/.test(words)) {
    emit("cyberattack_data_breach_or_operational_outage", ["A verified cyber or operating incident may impair operations, trust, and cash flow."]);
  }
  if ((family === "merger_acquisition" && candidate.direction === "downside") || /\b(merger terminated|deal terminated|transaction terminated|financing failed|regulatory rejection|shareholder opposition|deal blocked|merger blocked|adverse court ruling)\b/.test(words)) {
    emit("merger_deal_break_or_financing_failure", ["A priced-in transaction may unwind abruptly if the deal or its financing fails."]);
  }
  if (family === "supply_chain" || /\b(major customer loss|customer terminated|contract terminated|contract cancellation|lost contract|supplier disruption|critical supplier|production interruption)\b/.test(words)) {
    emit("customer_supplier_or_contract_concentration_loss", ["A major customer, supplier, or contract disruption may reset revenue, production, or margins."]);
  }
  if (family === "leadership_change" || /\b(ceo resign|cfo resign|chief executive resign|chief financial officer resign|board conflict|insider misconduct|leadership shakeup)\b/.test(words)) {
    emit("sudden_ceo_cfo_or_governance_break", ["Unexpected leadership or governance disruption raises execution and reporting risk."]);
  }
  if (["geopolitical_conflict", "sanctions_trade"].includes(family ?? "") && ["direct", "second_order"].includes(relationship ?? "") && transmission >= 80) {
    emit("geopolitical_tariff_sanction_or_supply_chain_shock", ["A verified conflict, tariff, or sanctions event has a defensible direct or second-order issuer impact."]);
  }
  if (contradictionPenalty >= 50) {
    emit("source_contradiction_or_data_integrity_failure", ["Current evidence contains a material unresolved contradiction, so no directional alert is safe."], true);
  }
  return results;
}

function parseMarketRow(value: unknown): MarketRow | null {
  const row = object(value);
  const symbol = text(row.s)?.toUpperCase();
  const data = Array.isArray(row.d) ? row.d : [];
  if (!symbol || data.length < TV_COLUMNS.length) return null;
  const separator = symbol.indexOf(":");
  const exchangeFromSymbol = separator > 0 ? symbol.slice(0, separator) : "UNKNOWN";
  const ticker = separator > 0 ? symbol.slice(separator + 1) : symbol;
  const exchange = (text(data[2]) ?? exchangeFromSymbol).toUpperCase().replace(/[^A-Z0-9]/g, "");
  const country = text(data[3]);
  const type = text(data[5]);
  const isPrimary = boolean(data[6]);
  const price = finite(data[7]);
  if (!ticker || !isPrimary || type !== "stock" || price === null || price <= 0) return null;
  const isUs = country?.toLowerCase().includes("united states") || US_EXCHANGES.has(exchange);
  if (!isUs) return null;
  const volume = finite(data[9]);
  const relativeVolume = finite(data[10]);
  return {
    ticker,
    company: text(data[1]) ?? text(data[0]) ?? ticker,
    exchange,
    country,
    price,
    changePercent: finite(data[8]) ?? 0,
    volume,
    relativeVolume,
    averageVolume: volume !== null && relativeVolume !== null && relativeVolume > 0 ? volume / relativeVolume : null,
    marketCap: finite(data[11]),
  };
}

async function fetchTradingViewPage(start: number, pageSize: number): Promise<TradingViewPage> {
  try {
    const response = await fetch("https://scanner.tradingview.com/america/scan", {
      method: "POST",
      cache: "no-store",
      headers: { accept: "application/json", "content-type": "application/json", origin: "https://www.tradingview.com", referer: "https://www.tradingview.com/", "user-agent": "Mozilla/5.0 (compatible; SwingUpUSWatchOut/1.0)" },
      body: JSON.stringify({
        filter: [
          { left: "type", operation: "equal", right: "stock" },
          { left: "is_primary", operation: "equal", right: true },
        ],
        options: { lang: "en" },
        markets: ["america"],
        symbols: { query: { types: [] }, tickers: [] },
        columns: [...TV_COLUMNS],
        sort: { sortBy: "market_cap_basic", sortOrder: "desc" },
        range: [start, start + pageSize - 1],
      }),
      signal: AbortSignal.timeout(45_000),
    });
    const payload = await response.json().catch(async () => await response.text().catch(() => null));
    if (!response.ok) throw new Error(`tradingview_http_${response.status}`);
    const container = object(payload);
    const rawRows = Array.isArray(container.data) ? container.data : [];
    return { totalCount: Math.max(rawRows.length, Math.floor(finite(container.totalCount) ?? rawRows.length)), rows: rawRows.flatMap((item) => parseMarketRow(item) ?? []), error: null };
  } catch (error) {
    return { totalCount: 0, rows: [], error: safeError(error) };
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

async function scanUsMarketStructure(now: Date) {
  const pageSize = 1_000;
  const first = await fetchTradingViewPage(0, pageSize);
  if (first.error || !first.totalCount) return { rows: first.rows, totalProviderRows: first.totalCount, pagesRequested: 1, pagesFailed: first.error ? 1 : 0, errors: first.error ? [first.error] : [] };
  const starts = Array.from({ length: Math.max(0, Math.ceil(Math.min(20_000, first.totalCount) / pageSize) - 1) }, (_, index) => (index + 1) * pageSize);
  const remaining = await mapWithConcurrency(starts, 6, (start) => fetchTradingViewPage(start, pageSize));
  const pages = [first, ...remaining];
  const byTicker = new Map<string, MarketRow>();
  for (const page of pages) for (const row of page.rows) if (!byTicker.has(`${row.exchange}:${row.ticker}`)) byTicker.set(`${row.exchange}:${row.ticker}`, row);
  return {
    rows: [...byTicker.values()],
    totalProviderRows: first.totalCount,
    pagesRequested: pages.length,
    pagesFailed: pages.filter((page) => page.error).length,
    errors: pages.flatMap((page) => page.error ?? []),
    checkedAt: now.toISOString(),
  };
}

function marketStructureFindings(rows: MarketRow[], now: Date) {
  const findings: Array<WatchOutReviewFinding & { riskScore: number }> = [];
  for (const row of rows) {
    const absoluteMove = Math.abs(row.changePercent);
    const relativeVolume = row.relativeVolume ?? 0;
    const averageDollarVolume = row.averageVolume !== null ? row.averageVolume * row.price : null;
    const identity = `${now.toISOString().slice(0, 13)}|${row.exchange}`;
    const common = { ticker: row.ticker, company: row.company, observedAt: now.toISOString(), currentPrice: row.price, sourceCount: 1, primaryOrIndependentProof: true, exactIssuerMapping: true, eventAgeHours: null, quoteAgeHours: 0, noRumour: true, contradictionPenalty: 0, identity };
    const liquidityTrigger = (averageDollarVolume !== null && averageDollarVolume < 1_000_000 && (absoluteMove >= 5 || relativeVolume >= 3))
      || (row.price < 1 && averageDollarVolume !== null && averageDollarVolume < 5_000_000 && absoluteMove >= 10);
    if (liquidityTrigger) {
      const riskScore = Math.round(Math.min(100, 60 + absoluteMove * 2 + Math.max(0, 3 - Math.log10(Math.max(1, averageDollarVolume ?? 1))) * 8));
      findings.push({ ...finding({ ruleId: "liquidity_collapse_or_gap_risk", ...common, reasons: [`Estimated average dollar volume is ${averageDollarVolume === null ? "unavailable" : `$${Math.round(averageDollarVolume).toLocaleString("en-US")}`}; daily move is ${row.changePercent.toFixed(1)}% and relative volume is ${relativeVolume.toFixed(1)}x.`] }), riskScore });
    }
    const volatilityTrigger = absoluteMove >= 12 || (absoluteMove >= 7 && relativeVolume >= 4);
    if (volatilityTrigger) {
      const riskScore = Math.round(Math.min(100, 55 + absoluteMove * 2.5 + Math.max(0, relativeVolume - 1) * 4));
      findings.push({ ...finding({ ruleId: "volatility_regime_spike", ...common, reasons: [`Current move is ${row.changePercent.toFixed(1)}% with ${relativeVolume.toFixed(1)}x relative volume, far outside normal trading assumptions.`] }), riskScore });
    }
  }
  return findings.sort((left, right) => right.riskScore - left.riskScore).slice(0, 250).map(({ riskScore, ...item }) => ({ ...item, reasons: [...item.reasons, `Screening risk score: ${riskScore}/100.`] }));
}

export async function buildApprovedUsWatchOutReview(input: { rankedCandidates: unknown[]; now?: Date; fetchImpl?: typeof fetch }) {
  const now = input.now ?? new Date();
  const marketScan = await scanUsMarketStructure(now);
  const eventFindings = input.rankedCandidates.flatMap((candidate) => eventRules(candidate, now));
  const marketFindings = marketStructureFindings(marketScan.rows, now);
  const unique = new Map<string, WatchOutReviewFinding>();
  for (const item of [...eventFindings, ...marketFindings]) if (!unique.has(item.duplicateKey)) unique.set(item.duplicateKey, item);
  const findings = [...unique.values()].sort((left, right) => left.priority.localeCompare(right.priority) || left.ticker.localeCompare(right.ticker));
  return {
    policyVersion: 1,
    marketScope: "US listed common equities and ADRs only",
    approvedRuleIds: APPROVED_RULE_IDS,
    heldRuleIds: ["crowded_short_or_squeeze", "rate_inflation_or_commodity_sensitivity_break", "extreme_valuation_with_momentum_reversal"],
    activeCertifiedRuleIds: ["extreme_120_session_drawdown_volatility"],
    newRulesPromotionMode: "review_only_until_rule_specific_forward_validation",
    seriousSignalsFromNewRules: 0,
    eventCandidatesEvaluated: input.rankedCandidates.length,
    marketStructureScan: {
      provider: "TradingView public US stock scanner",
      totalProviderRows: marketScan.totalProviderRows,
      usPrimaryListingsChecked: marketScan.rows.length,
      pagesRequested: marketScan.pagesRequested,
      pagesFailed: marketScan.pagesFailed,
      errors: marketScan.errors,
      checkedAt: now.toISOString(),
    },
    findings,
    counts: {
      total: findings.length,
      p0: findings.filter((item) => item.priority === "P0").length,
      p1: findings.filter((item) => item.priority === "P1").length,
      byRule: Object.fromEntries(APPROVED_RULE_IDS.map((ruleId) => [ruleId, findings.filter((item) => item.ruleId === ruleId).length])),
    },
    safety: { databaseWrites: false, publishing: false, notifications: false, seriousSignalPromotion: false, noSyntheticData: true },
  };
}
