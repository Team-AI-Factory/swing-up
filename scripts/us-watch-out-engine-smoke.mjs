import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync(new URL("../lib/equity-signal/us-watch-out-engine.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;
const cjsModule = { exports: {} };
new Function("require", "module", "exports", output)((name) => {
  if (name === "node:crypto") return crypto;
  throw new Error(`Unexpected Watch Out engine import: ${name}`);
}, cjsModule, cjsModule.exports);
const { buildApprovedUsWatchOutReview } = cjsModule.exports;

const now = new Date("2026-07-29T06:00:00.000Z");
const event = (ticker, eventFamily, headline, overrides = {}) => ({
  ticker,
  company: `${ticker} Corp`,
  eventFamily,
  eventHeadline: headline,
  whatHappened: headline,
  eventObservedAt: "2026-07-29T05:30:00.000Z",
  primarySource: true,
  independentPublishers: 1,
  mappingConfidence: 99,
  materiality: 90,
  transmissionConfidence: 90,
  contradictionPenalty: 0,
  rumour: false,
  relationship: "direct",
  direction: "downside",
  quote: { price: 10, observedAt: "2026-07-29T05:55:00.000Z" },
  ...overrides,
});

const candidates = [
  event("HALT", "trading_halt", "Exchange announces trading halt and later resumption"),
  event("DELIST", "other_material", "NYSE sends minimum bid price listing deficiency and delisting notice"),
  event("ACCT", "other_material", "Company announces financial restatement and material weakness after auditor resignation"),
  event("REG", "regulatory_enforcement", "SEC files material enforcement action"),
  event("FDA", "regulatory_enforcement", "FDA places clinical hold after a safety signal"),
  event("BANK", "other_material", "Company issues going concern warning after covenant breach and missed payment"),
  event("DIL", "financing_dilution", "Issuer launches at-the-market share offering"),
  event("EARN", "earnings_guidance", "Company cuts guidance after margin and cash flow deterioration"),
  event("CYBR", "cyber_incident", "Company confirms ransomware attack and prolonged systems outage"),
  event("DEAL", "merger_acquisition", "Merger terminated after financing failed", { direction: "downside" }),
  event("SUP", "supply_chain", "Critical supplier disruption causes production interruption"),
  event("CEO", "leadership_change", "Chief executive resigns during unexpected board conflict"),
  event("GEO", "sanctions_trade", "New export sanctions directly restrict company sales", { relationship: "second_order", transmissionConfidence: 88 }),
  event("CONTRA", "other_material", "Independent sources report conflicting filing and price identity", { contradictionPenalty: 70 }),
];

const tradingViewRow = (symbol, description, price, change, volume, relativeVolume, marketCap) => ({
  s: `NASDAQ:${symbol}`,
  d: [symbol, description, "NASDAQ", "United States", "USD", "stock", true, price, change, volume, relativeVolume, marketCap, "streaming"],
});

globalThis.fetch = async () => new Response(JSON.stringify({
  totalCount: 2,
  data: [
    tradingViewRow("ILLIQ", "Illiquid Example", 0.5, -12, 10_000, 5, 20_000_000),
    tradingViewRow("CALM", "Calm Example", 50, 1, 1_000_000, 1, 5_000_000_000),
  ],
}), { status: 200, headers: { "content-type": "application/json" } });

const result = await buildApprovedUsWatchOutReview({ rankedCandidates: candidates, now });
const ids = new Set(result.findings.map((item) => item.ruleId));
const expected = [
  "trading_halt_or_resumption",
  "delisting_or_exchange_compliance",
  "liquidity_collapse_or_gap_risk",
  "volatility_regime_spike",
  "accounting_auditor_or_restated_financials",
  "sec_doj_ftc_or_regulator_action",
  "fda_clinical_hold_recall_or_rejection",
  "bankruptcy_going_concern_or_covenant_stress",
  "dilution_atm_secondary_or_convertible",
  "earnings_guidance_or_cash_flow_break",
  "customer_supplier_or_contract_concentration_loss",
  "cyberattack_data_breach_or_operational_outage",
  "sudden_ceo_cfo_or_governance_break",
  "merger_deal_break_or_financing_failure",
  "geopolitical_tariff_sanction_or_supply_chain_shock",
  "source_contradiction_or_data_integrity_failure",
];
for (const id of expected) assert.equal(ids.has(id), true, `Missing approved Watch Out rule: ${id}`);
assert.equal(result.heldRuleIds.includes("crowded_short_or_squeeze"), true);
assert.equal(result.heldRuleIds.includes("rate_inflation_or_commodity_sensitivity_break"), true);
assert.equal(result.heldRuleIds.includes("extreme_valuation_with_momentum_reversal"), true);
assert.equal(result.seriousSignalsFromNewRules, 0);
assert.equal(result.safety.seriousSignalPromotion, false);
assert.equal(result.findings.every((item) => item.seriousSignal === false && item.publicationStatus === "review_only_validation_pending"), true);
assert.equal(result.marketStructureScan.usPrimaryListingsChecked, 2);

console.log(JSON.stringify({
  ok: true,
  approvedRulesCovered: expected.length,
  p0Findings: result.counts.p0,
  p1Findings: result.counts.p1,
  newRulesRemainReviewOnly: true,
  heldRulesRemainDisabled: true,
  marketScope: result.marketScope,
}, null, 2));
