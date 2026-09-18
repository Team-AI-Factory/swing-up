import { companyProfileFixture } from "./helpers/company-profile-fixture.mjs";
import assert from "node:assert/strict";
import { loadTsModule } from "./helpers/load-typescript-module.mjs";

const { buildPriceOutlook, candidatePriceOutlook, compareSignalPotential } = loadTsModule("@/lib/signal-outlook");
const { publicExplanation, explainSignal, explainCompany } = loadTsModule("@/lib/signal-explanation");
const { assemblePublicSignals } = loadTsModule("@/lib/public-signals");
const make = (action, price = 100, base = 150, low = 80, high = 180) => buildPriceOutlook({ action, currency: "USD", currentPrice: price, base, conservative: low, optimistic: high });
const buy = make("buy");
assert.equal(buy.base.changePercent, 50);
assert.equal(buy.potentialPercent, 50);
assert.equal(buy.upsidePercent, 80);
assert.equal(buy.downsidePercent, -20);
assert.equal(buy.horizonBasis, "assessment_window");
assert.match(buy.horizon, /6–24 months.*unconfirmed/);
const sell = make("sell", 100, 50, 40, 70);
assert.equal(sell.potentialPercent, 50, "A fall from 100 to 50 is 50%, not the 100% valuation premium");
assert.equal(sell.base.changePercent, -50);
assert.equal(sell.upsidePercent, null, "A range below the market does not estimate short-sale loss risk");
assert.equal(make("buy", 100, 150, 120, 180).downsidePercent, null, "An all-positive valuation range must not imply zero downside risk");
for (const price of [null, undefined, 0, -1, NaN, Infinity, "100"]) assert.equal(buildPriceOutlook({ action: "buy", currentPrice: price, base: 150 }).potentialPercent, null);
const invalid = make("buy", 100, 150, 200, 100);
assert.equal(invalid.base.price, null);
assert.equal(invalid.potentialPercent, null);
assert.equal(make("buy", 200, 100, 80, 150).potentialPercent, null, "An erased buy opportunity cannot rank as a positive gain");
const ordered = [
  { ticker: "RISK", action: "watch_out", outlook: make("watch_out"), risk: 100 },
  { ticker: "SELL", action: "sell", outlook: sell },
  { ticker: "UNKNOWN", action: "buy", outlook: make("buy", 0) },
  { ticker: "BUY50", action: "buy", outlook: buy },
  { ticker: "BUY10", action: "buy", outlook: make("buy", 100, 110, 80, 120) },
  { ticker: "REJECTED", action: "buy", outlook: buy, committeeStatus: "rejected" },
].sort(compareSignalPotential);
assert.deepEqual(ordered.map(row => row.ticker), ["BUY50", "BUY10", "UNKNOWN", "SELL", "RISK", "REJECTED"]);
const forecast = candidatePriceOutlook({ direction: "upside", currency: "USD", quote: { price: 100 }, timeHorizon: "hours_to_10_trading_days", priceForecast: { status: "provisional", lowPrice: 90, medianPrice: 110, highPrice: 130, horizon: "7D" } });
assert.equal(forecast.horizon, "7 calendar days from the price observation");
assert.equal(forecast.basis, "historical_scenarios");
const missing = candidatePriceOutlook({ quote: { price: 100 }, timeHorizon: "hours_to_10_trading_days", priceForecast: { status: "insufficient_history" } });
assert.equal(missing.horizonBasis, "unavailable");
assert.equal(missing.base.price, null);
assert.equal(missing.assessmentWindow, "Hours to 10 trading days");

const raw = "Official source: A new SEC filing was detected. Official filing content: FORM 424B5 PROSPECTUS SUPPLEMENT. We are offering 1,219,513 shares of our common stock at an offering price of $3.28 per share.";
const clean = publicExplanation({ whatHappened: raw, missingInformation: ["The rolling OpenAI review budget was not available."] }, { company: "Example Company", industry: "Biotechnology" });
assert.match(clean.whatHappened, /1,219,513 shares at \$3\.28/);
assert.doesNotMatch(clean.whatHappened, /Official|SEC|424B5|PROSPECTUS/);
assert.match(clean.whatHappened, /plans to sell/);
const pastOffer = publicExplanation({ whatHappened: "We offered 20,000 shares at an offering price of $5 per share." }, { company: "Example Company" });
assert.match(pastOffer.whatHappened, /offered 20,000 shares at \$5/);
assert.doesNotMatch(pastOffer.whatHappened, /plans to/);
const resale = publicExplanation({ whatHappened: "FORM 424B5: offering of 20,000 shares by selling stockholders at an offering price of $5 per share." }, { company: "Example Company", eventFamily: "financing_dilution" });
assert.doesNotMatch(resale.whatHappened, /brings in money|smaller share of the company/, "A resale must not imply new issuer cash or dilution");
const legalDeal = publicExplanation({ whatHappened: "Example Company entered into a definitive agreement for a cash consideration of $12 million." }, { company: "Example Company" });
assert.equal(legalDeal.whatHappened, "Example Company signed an agreement for a cash payment of $12 million.");
assert.equal(clean.companyDoes, "", "Industry categories cannot stand in for verified products and customers");
assert.doesNotMatch(clean.missingInformation.join(" "), /OpenAI/);
const unknown = publicExplanation({ whatHappened: "Official filing content: 8-K UNITED STATES SECURITIES AND EXCHANGE COMMISSION Registrant: Test" }, { company: "Test", eventFamily: "unknown" });
assert.doesNotMatch(unknown.whatHappened, /8-K|COMMISSION|Registrant/);
assert.match(unknown.whatHappened, /not yet established/);
assert.doesNotMatch(publicExplanation({ whatHappened: raw }, { company: "Test", headline: "8-K - Test Company", eventFamily: "unknown" }).whatHappened, /8-K/);
assert.equal(explainCompany("Cargo Company", "Air Freight/Couriers"), "");
assert.doesNotMatch(explainSignal({ company: "Bank", kind: "valuation", action: "buy", price: 100, fairValue: 150, reasons: ["SEC filing 8-K internal specialist score 99"] }).whyItMatters, /SEC|8-K|specialist/);

const candidate = { id: "buy-1", ticker: "ONE", company: "One Company", cik: "0000000001", companyProfile: companyProfileFixture({ticker: "ONE", company: "One Company"}), action: "buy_research", userAlertEligible: true,
  committeeApproved: false, committeeStatus: "awaiting_review", observedAt: "2026-09-17T02:00:00Z", currentPrice: 100,
  priceObservedAt: "2026-09-17T02:00:00Z",
  currency: "USD", sector: "Healthcare", industry: "Biotechnology", fairValue: { conservative: 80, base: 150, optimistic: 180 },
  outlook: buy, explanation: clean, links: [], scores: { fairValueConfidence: 80 } };
const oldReview = { id: "old", ticker: "ONE", company: "One Company", cik: "0000000001", companyProfile: candidate.companyProfile, action: "buy", kind: "valuation", userAlertEligible: true, committeeApproved: false, valuationObservedAt: "2026-09-16T02:00:00Z", explanation: clean };
assert.deepEqual(assemblePublicSignals([candidate], [oldReview]).map(row => row.id), ["buy-1"], "An older review must not replace the fresh daily valuation");
const event = { ...oldReview, id: "event", kind: "event", action: "sell", currentPrice: 100, fairValue: 50, outlook: sell, explanation: { ...clean, whatHappened: raw }, committee: { confidence: 60 } };
const feed = assemblePublicSignals([candidate], [event]);
assert.deepEqual(feed.map(row => row.id), ["buy-1", "event"]);
assert.equal(feed[1].outlook.potentialPercent, 50);
assert.doesNotMatch(feed[1].explanation.whatHappened, /Official|SEC|PROSPECTUS/);
assert.equal(feed[1].committeeApproved, false);
assert.equal(assemblePublicSignals([candidate], [event], "approved").length, 0);
assert.equal(assemblePublicSignals([candidate], [event], "sell")[0].id, "event");

// A valuation review cannot keep an obsolete quote or transfer its approval to
// a fresh price, even when the underlying daily valuation has not changed.
const reviewed = { ...oldReview, id: "approved-review", currentPrice: 100, priceObservedAt: candidate.priceObservedAt,
  valuationObservedAt: candidate.observedAt, fairValue: 150, outlook: buy, committeeApproved: true, committeeStatus: "approved",
  explanation: { ...clean, whatCouldHappen: "The Committee's reviewed business scenario remains conditional." } };
const matchingCandidate = { ...candidate, committeeApproved: true, committeeStatus: "approved" };
const matchingFeed = assemblePublicSignals([matchingCandidate], [reviewed], "approved");
assert.equal(matchingFeed[0].id, reviewed.id, "An unchanged reviewed observation retains its approval");
assert.equal(matchingFeed[0].explanation.whatCouldHappen, reviewed.explanation.whatCouldHappen, "Preserve valid reviewed reasoning");
const refreshed = { ...candidate, currentPrice: 120, priceObservedAt: "2026-09-17T03:00:00Z", outlook: make("buy", 120) };
const refreshedFeed = assemblePublicSignals([refreshed], [reviewed]);
assert.equal(refreshedFeed.length, 1);
assert.equal(refreshedFeed[0].currentPrice, 120);
assert.equal(refreshedFeed[0].outlook.potentialPercent, 25);
assert.equal(refreshedFeed[0].committeeApproved, false);
assert.equal(refreshedFeed[0].committeeStatus, "awaiting_review");
assert.equal(assemblePublicSignals([refreshed], [reviewed], "approved").length, 0);
const competing = { ...candidate, id: "buy-2", ticker: "TWO", companyProfile: companyProfileFixture({ ticker: "TWO", company: "One Company" }), fairValue: { conservative: 80, base: 140, optimistic: 180 }, outlook: make("buy", 100, 140) };
assert.deepEqual(assemblePublicSignals([refreshed, competing], [reviewed]).map(row => row.ticker), ["TWO", "ONE"],
  "Public ranking must use the refreshed 25% potential instead of the old approved 50%");
assert.equal(assemblePublicSignals([{ ...refreshed, currentPrice: 160, outlook: make("buy", 160), userAlertEligible: false }], [reviewed]).length, 0,
  "A price above base value must not retain the old approved buy opportunity");
assert.equal(assemblePublicSignals([{ ...matchingCandidate, userAlertEligible: false }], [reviewed]).length, 0,
  "A matching stored review cannot bypass current validated eligibility");
assert.equal(assemblePublicSignals([{ ...candidate, priceObservedAt: refreshed.priceObservedAt }], [reviewed], "approved").length, 0,
  "A newer observation at the same numerical price still requires its own review");

// Exercise live-price re-ranking before the requested feed limit.
const analyses = [
  { ...candidate, ticker: "A", tradingViewSymbol: "NYSE:A", fairValue: { conservativeValue: 140, baseValue: 150, optimisticValue: 160, upsideToBasePercent: 50 }, scores: {}, decision: {} },
  { ...candidate, ticker: "B", tradingViewSymbol: "NYSE:B", fairValue: { conservativeValue: 180, baseValue: 200, optimisticValue: 220, upsideToBasePercent: 100 }, scores: {}, decision: {} },
];
const watchlist = loadTsModule("@/lib/opportunity-engine/valuation-watchlist-feed", {
  "@/lib/opportunity-engine/pr262-storage": { pr262StorageKey: value => value },
  "@/lib/opportunity-engine/company-profile-cache": { readCompanyProfiles: async items => new Map(items.map(item => [item.ticker, companyProfileFixture(item)])) },
  "@/lib/opportunity-engine/pr262-research-evidence": { readResearchAlerts: async () => [] },
  "@/lib/r2-warehouse": { readVersionedTextFromR2: async key => ({ found: true, text: JSON.stringify(key.includes("watchlist-live-prices") ? { checkedAt: new Date().toISOString(), prices: [{ ticker: "A", price: 50 }, { ticker: "B", price: 190 }] } : { kind: "us_value_investing_resumable_summary", seriousAlerts: { buy: analyses }, coverage: {} }) }) },
});
const ranked = await watchlist.getValuationWatchlistStatus({ limit: 1 });
assert.equal(ranked.candidates[0].ticker, "A");
assert.equal(ranked.candidates[0].outlook.potentialPercent, 200);

let captured;
const route = loadTsModule("@/app/api/public/valuation-watchlist/route", {
  "next/server": { NextResponse: { json: value => value } },
  "@/lib/opportunity-engine/valuation-watchlist-feed": { getValuationWatchlistStatus: async options => { captured = options; return { ok: true }; } },
});
await route.GET({ nextUrl: new URL("https://example.com/api/public/valuation-watchlist") });
assert.equal(captured.limit, 60, "An absent query parameter must not silently reduce the feed to one alert");
console.log("PASS: signal ranking, live prices, return math, unknown risks, timeline basis, explanations, approval identity and feed limits");
