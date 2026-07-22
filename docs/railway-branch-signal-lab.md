# Railway Branch Signal Lab

This experiment is isolated from `main` and Railway production. It activates only when:

- `RAILWAY_GIT_BRANCH` is `agent/live-signal-evaluation-automation`;
- `RAILWAY_ENVIRONMENT_NAME` exists and is not `production`; and
- Railway supplies `RAILWAY_PROJECT_ID`.

The preview startup wrapper removes database, publishing, Telegram, payment, and unrelated paid-market credentials. It skips Prisma migrations and keeps only the credentials required for the read-only stock-intelligence lab, OpenAI review, and its isolated Cloudflare R2 state object. The lab never writes to PostgreSQL.

## What runs

The wrapper supervises the Next.js website and a separate scanner worker. The worker runs after the website becomes healthy and then every five minutes. It emits a heartbeat every 30 seconds and is restarted after a missing heartbeat. When Railway briefly has multiple replicas, an R2-backed seven-minute lease lets one worker scan while the others stand down without spending provider or OpenAI quota.

The live path is event-first and public-equity-only:

1. Refresh the active US-listed common-stock and ADR universe from Nasdaq Trader, joined to SEC CIK identifiers. The universe is cached for one day.
2. Collect new official filings, government and regulator announcements, macro releases, scheduled earnings, and broad news before looking for a price move.
3. Classify the event, map directly affected issuers across the full universe, and add limited sector or supply-chain knock-on effects.
4. Require a verified event, material causal path, fresh evidence, and either a primary source or independent corroboration.
5. Fetch price data only for the short list that already passed the event gate. Price is an execution and later outcome anchor, never permission to begin analysis.
6. Fetch SEC Company Facts for the strongest mapped issuer and send only a fully evidenced candidate to the 14-agent committee.

Crypto scanning is disabled. There is no 2% daily-move gate and no 1% post-event-move gate. A verified event may qualify while the stock is unchanged. `No Action` remains a valid result, and the filters are never relaxed merely to produce alerts.

## Sources and cadence

Calls are reserved in the durable R2 quota ledger before they run. The scanner uses the fastest safe cadence allowed by each free source instead of making thousands of per-stock calls:

- Nasdaq Trader and SEC ticker/CIK universe: daily.
- SEC 8-K/6-K current filings: about every five minutes; Form 4 every 14 minutes; other selected forms hourly.
- Federal Reserve, White House, Commerce, CISA, State, Defense, BLS, BEA, SEC press releases, and other official feeds: every five minutes where the publisher updates that often.
- Google News discovery: about every five minutes.
- GDELT: every 14 minutes, matching its 15-minute data cycle.
- Marketaux: every 14.5 minutes within its free daily allowance.
- Alpha Vantage broad news: about every two hours; earnings calendar daily; quote fallback is per-symbol and quota-limited.
- FRED macro series: hourly per series.
- Federal Register: every 29 minutes.
- Frankfurter FX reference rates: daily.
- openFDA: every six hours.
- Yahoo public chart data: five-minute short-list quote source, with Alpha Vantage and free FMP end-of-day data as fallbacks.

No source is treated as evidence merely because it is reachable. One unavailable discovery provider cannot stop the full scan. Each collector reports its own status, bounded cooldown, and error category. Temporary failures may use a previously successful, still-fresh real response for discovery, clearly marked as cached; the system never substitutes mock, neutral, or invented evidence. Paid-only FMP news or real-time endpoints are not retried on a free plan.

## Evidence policy

An event may advance when all of the following are true:

- source truth score is at least 80;
- issuer mapping confidence is at least 95;
- estimated materiality is at least 65;
- causal transmission strength is at least 70;
- the event is fresh and not a rumor;
- either a primary official/company source exists or at least two independent origin publishers corroborate it; and
- no severe opposite-direction contradiction is present.

Official filings and government announcements can establish that an event happened without being repeated by news sites, but they still must establish issuer identity, materiality, and a defensible causal link. Ten sites copying one wire report count as one origin. Provider availability, market movement, and generic macro context add no evidence score by themselves.

The current causal mapper covers direct issuer events across the complete US universe and a bounded set of energy, defense, airline, semiconductor, bank, cybersecurity, and AI-infrastructure ripple paths. Unmapped official events remain visible in the report for later model expansion; they are not silently converted into trades. Historical macro regimes are included as context. An analogue counts only when its event receipt and public stock/SPY outcome have been measured without using information that became available after the original prediction time.

The R2 historical library is bootstrapped gradually. Its first five seeds are previously documented official NVIDIA, Biogen, FDA/Pfizer, Meta, and FDIC/JPMorgan events. Their numeric returns are fetched from public adjusted daily history at runtime and are never hard-coded. A 1D result is enough to enter the library; later checkpoints add information. Fewer than three independent similar events cannot produce a numeric range, and fewer than twenty cannot produce a calibrated Buy/Sell range.

## Committee and cost controls

- No more than three committee reviews may run in a rolling 24-hour period.
- The same evidence fingerprint cannot be reviewed twice within 12 hours.
- A pending reservation is written to R2 before the first paid call, so a timeout or restart cannot repeat paid work.
- Every committee tier uses the allowlisted `gpt-4.1-mini-2025-04-14` snapshot, with request timeouts and token reporting.
- Paid review is disabled unless durable R2 state is healthy.
- All 14 roles must complete, the Final Judge must be positive with at least 80 confidence, and the minimum positive-vote consensus must pass.
- A quiet market, correctly rejected candidate, or isolated upstream outage is not counted as a software-repair failure.

## Durable state and safety

Cloudflare R2 is the only writable state store. The isolated object `branch-labs/pr-261/serious-signal/state.json` contains branch reports, provider and OpenAI reservations, selected candidates, and active forward outcomes. The separate object `branch-labs/pr-261/serious-signal/equity-history-v1.json` keeps compact real historical event outcomes after old scan logs are pruned. ETag conditions and the scan lease prevent concurrent workers from overwriting newer state.

If R2 is missing, unreadable, unwritable, or invalid, the cycle stops before provider or OpenAI calls. It never falls back to PostgreSQL, a Railway volume, or `/tmp`. The public report must show `backend=cloudflare_r2`, `postgresUsed=false`, and `railwayVolumeUsedAsPrimary=false` when healthy.

The lab performs no database writes, publishing, notifications, trades, or production changes. The public endpoint is redacted:

`GET /api/internal/railway-branch-signal-lab`

The worker's POST route requires an in-container runtime token and worker identity headers and is called over `127.0.0.1`.

## Outcome validation

Public-equity alerts are evaluated with real post-alert quote observations at 1D, 3D, 7D, 30D, and 90D. Yahoo chart data is preferred, with Alpha Vantage or free FMP end-of-day data used only when their timestamps meet the evaluation window. Each observation stores the actual source and timestamp. A late or unavailable quote becomes a missed checkpoint; it is not backfilled with an invented or unrelated value.

Legacy crypto runs cannot count toward public-equity performance. Three distinct serious public-equity signals with accepted 1D evaluations and at least a two-thirds useful rate are an early pipeline milestone. A consistency claim requires at least 30 independent signals, at least a 75% useful rate, a conservative 95% lower confidence bound of at least 55%, and no unsafe live performance run. This is an evaluation target, not a guarantee of profit or absence of loss.

## Railway requirement

Railway PR Environments must be enabled and the preview must inherit read/write credentials for the configured Cloudflare R2 object plus the provider keys included in the existing free packages. A Railway Volume is not required.
