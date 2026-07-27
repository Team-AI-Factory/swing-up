# Serious Signal Branch Lab

This lab keeps every stock-intelligence change off `main` until the founder approves it.

## Branch boundary

- Work stays on `agent/combined-opportunity-engine` or another isolated `agent/**` branch.
- CI refuses to run the lab as a `main`-branch job and has read-only repository permissions.
- The preview cannot merge, trade, publish alerts, send notifications, write PostgreSQL, or alter Railway production.
- Cloudflare R2 is the only durable branch-state store.

## US-only public-equity policy

The active scanner covers US-listed common stocks and ADRs only. Non-US equity scanning is paused. Crypto is disabled. The scanner starts from official filings, government and regulator releases, macro and geopolitical developments, scheduled earnings, company/product/technology news, and broad news discovery. It then maps direct issuers and defensible knock-on effects before fetching a short-list quote.

A candidate does not need a prior 2% daily move or a 1% post-event move. Price is used to establish an executable reference and measure later outcomes, not to decide whether the system is allowed to discover an event. Primary sources may establish an event directly; unofficial claims require independent origin publishers. Rumours, weak issuer matches, unclear transmission paths, stale events, and severe contrary evidence force `No Action`.

Analyst expectations are optional context. An analyst already expecting improvement does not veto a Buy opportunity, and missing analyst coverage does not by itself block an event-first Buy candidate.

## Source behaviour

Every provider has a cadence and rolling free-plan budget stored in R2. A provider outage is isolated and cannot crash the whole scan. Fresh, previously successful real responses may be carried forward for discovery when explicitly marked cached; mock, neutral, or invented values are forbidden. The lab does not retry endpoints that the configured free package is not entitled to use.

Connected is not equivalent to useful evidence. Each report distinguishes live contribution, cached contribution, scheduled/not-due, not configured, not entitled, rate limited, and failed. Unmapped official events and upcoming earnings remain visible as watch items instead of being discarded or forced into a trade.

## Five-case pilot serious Buy and Sell gate

All 14 committee roles must complete, the Final Judge must be positive at 80 or higher, and the consensus threshold must pass. Paid calls are quota-reserved before execution and require healthy durable state.

A pilot serious Buy or Sell additionally requires:

- at least five independent real historical events from Swing Up tracked outcomes or public historical bootstrap data;
- no future-data leakage;
- a usable historical outcome horizon;
- at least 90% observed directional success across those analogues;
- a non-negative lower-quartile direction-adjusted result;
- current event truth, exact issuer mapping, materiality, causal transmission, evidence independence, a live price anchor, and no severe contradiction.

Five examples are deliberately labelled a pilot threshold. Five successful examples are not statistically equivalent to a 30-plus-sample certificate. The alert must expose this limitation rather than displaying false certainty.

The public bootstrap uses official issuer announcements and rebuilds stock and SPY outcomes from public adjusted daily history at runtime. It stores no hard-coded return or future outcome. Every new qualified finding is stored in R2 and measured at 1D, 3D, 7D, 30D, and 90D so the evidence set grows over time.

## Watch Out rules

Watch Out alerts use a separate rule catalog. Only the already certified extreme-volatility rule is active. Every additional Watch Out rule remains disabled until the founder selects it and it receives its own evidence, testing, duplicate-alert, freshness, and contradiction gates. See `config/watch-out-rule-catalog.json`.

CI uses deterministic policy fixtures only to test compilation and safety. It makes no market-performance claim. Live performance is measured only from real provider responses with all database-write, publishing, and notification flags false.

## Iteration limit

The isolated branch may be improved when a real software defect or evidence gap is demonstrated. A quiet market, valid rejection, or temporary upstream failure is not a code failure and must not lead to weaker filters. The process stops before any change that would require new paid data, new authority, production access, publishing, notifications, trading, or a merge to `main`.

No model or filter can guarantee that a trade will never lose money. The goal is auditable selectivity, early causal reasoning, strict risk evidence, and forward-tested calibration—not a forced daily alert.

## Optional branch deployment

`SWING_UP_BRANCH_TEST_URL` may point CI at the Railway PR preview. `SWING_UP_AUTOMATION_TOKEN` is optional for guarded branch smoke tests. Neither should ever target production.
