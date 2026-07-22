# Serious Signal Branch Lab

This lab keeps every stock-intelligence change off `main` until the founder approves it.

## Branch boundary

- Work stays on `agent/live-signal-evaluation-automation` or another `agent/**` branch.
- CI refuses to run the lab as a `main`-branch job and has read-only repository permissions.
- The preview cannot merge, trade, publish alerts, send notifications, write PostgreSQL, or alter Railway production.
- Cloudflare R2 is the only durable branch-state store.

## Event-first public-equity policy

The scanner covers the active US-listed common-stock and ADR universe. Crypto is disabled. It starts from official filings, government and regulator releases, macro and geopolitical developments, scheduled earnings, company/product/technology news, and broad news discovery. It then maps direct issuers and defensible knock-on effects before fetching a short-list quote.

A candidate does not need a prior 2% daily move or a 1% post-event move. Price is used to establish an executable reference and measure later outcomes, not to decide whether the system is allowed to predict. Primary sources may establish an event directly; unofficial claims require independent origin publishers. Rumors, weak issuer matches, unclear transmission paths, stale events, and severe contrary evidence force `No Action`.

The system discovers every stock through a daily exchange/SEC universe refresh, but it does not call a free quote or news API once per stock every five minutes. Broad feeds narrow the affected companies first, preserving free quotas for evidence and execution checks that can change a decision.

## Source behavior

Every provider has a cadence and rolling free-plan budget stored in R2. A provider outage is isolated and cannot crash the whole scan. Fresh, previously successful real responses may be carried forward for discovery when explicitly marked cached; mock, neutral, or invented values are forbidden. The lab does not retry endpoints that the configured free package is not entitled to use.

Connected is not equivalent to useful evidence. Each report distinguishes live contribution, cached contribution, scheduled/not-due, not configured, not entitled, rate limited, and failed. Unmapped official events and upcoming earnings remain visible as watch items instead of being discarded or forced into a trade.

## Quality and outcome gates

All 14 committee roles must complete, the Final Judge must be positive at 80 or higher, and the consensus threshold must pass. Paid calls are quota-reserved before execution and require healthy durable state.

Approved candidates are measured using real public-equity quotes at 1D, 3D, 7D, 30D, and 90D. The actual provider timestamp and source are recorded. Late checkpoints are marked missed. Legacy crypto outcomes cannot count toward equity consistency.

Historical learning has its own durable R2 library. It starts with a small set of curated official events already documented in Swing Up, but fetches the stock and SPY prices from public history at runtime instead of hard-coding returns. New qualified events enter the learning queue immediately; the first valid 1D result can teach the model, while 3D/7D/30D/90D results refine it later. Duplicate stories, future information, mock records, and the current event itself are excluded. A numeric range needs at least three independent real analogues, and a Buy/Sell label needs substantially deeper calibrated history; otherwise a qualifying event can only become a serious Watch.

CI uses deterministic policy fixtures only to test compilation and safety. It makes no market-performance claim. Live performance is measured only from the guarded Railway preview with real provider responses and all database-write, publishing, and notification flags false.

## Iteration limit

The isolated branch may be improved when a real software defect or evidence gap is demonstrated. A quiet market, valid rejection, or temporary upstream failure is not a code failure and must not lead to weaker filters. The process stops before any change that would require new paid data, new authority, production access, publishing, notifications, trading, or a merge to `main`.

No model or filter can guarantee that a trade will never lose money. The goal is auditable selectivity, early causal reasoning, strict risk evidence, and forward-tested calibration—not a forced daily alert.

## Optional branch deployment

`SWING_UP_BRANCH_TEST_URL` may point CI at the Railway PR preview. `SWING_UP_AUTOMATION_TOKEN` is optional for guarded branch smoke tests. Neither should ever target production.
