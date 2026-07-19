# Railway Branch Signal Lab

This experiment is deliberately isolated from `main` and Railway production. It activates only when all of these are true:

- `RAILWAY_GIT_BRANCH` is exactly `agent/live-signal-evaluation-automation`.
- `RAILWAY_ENVIRONMENT_NAME` exists and is not `production`.
- Railway has supplied `RAILWAY_PROJECT_ID`.

In the branch preview, the startup wrapper removes database, Telegram, publishing-storage, payment, and uncontrolled paid-market credentials from the application process. It also skips Prisma migrations. It retains `OPENAI_API_KEY` plus the configured free-tier keys for FMP, Marketaux, Alpha Vantage, CoinGecko, FRED, and openFDA. Provider calls remain bounded by branch-specific cadence and never write to the database.

## What runs

The preview process runs immediately at startup and then every five minutes by default. CoinGecko and Google News RSS refresh on that cycle. GDELT refreshes no more often than every fifteen minutes, Marketaux every twenty minutes, FMP Crypto News every thirty minutes, Alpha Vantage every two hours, and FRED/Frankfurter once per hour. In addition to the in-process caches, every quota-limited call is reserved in the durable branch ledger before it runs. The ledger enforces provider-specific minimum intervals and rolling free-plan budgets across restarts. CoinGecko is capped below its Demo monthly credit allowance, and each historical event anchor is fetched once and then combined with the current five-minute market row. A real provider rate limit or temporary outage starts bounded exponential cooldown without substituting stale, neutral, mock, or invented evidence. Only an explicitly repair-eligible application failure gets the one-minute technical retry; upstream outages remain on the normal quota-safe loop.

Each performance run reads live CoinGecko price, volume, market-cap, FDV, supply, range, and 24-hour/7-day data for ten major digital assets. It searches the five largest movers through the available real news channels. GDELT remains active, but a shared-network GDELT limit cannot stop otherwise valid analysis. A candidate reaches the 14-agent OpenAI committee only when it has:

- 100% live input provenance;
- at least two matching live news discovery channels, three unique origin publishers, CoinGecko market proof, and connected FRED/Frankfurter context;
- at least three origin publishers and two discovery channels carrying fresh (at most 12-hour-old) catalysts aligned with the observed upside or downside direction;
- official regulator/exchange evidence when the claim concerns approval, enforcement, listing, or delisting;
- a meaningful 24-hour move plus a real CoinGecko event-to-current price move in the same direction; and
- at least 60 action strength and 60 evidence confidence.

The filters are never relaxed merely to produce a signal. `No Action` is a valid result.

Every live report includes a candidate funnel, explicit pass/fail evidence checks for each ranked asset, and provider cooldown details. Those diagnostics let the repair loop distinguish a real quiet market from a parsing, matching, freshness, or provider-integration defect without treating connectivity as evidence or lowering the serious-signal threshold.

CI does not fabricate a market, news event, or outcome. It verifies compilation, branch isolation, and side-effect guards only. A result counts toward signal quality only when it came from the Railway branch preview through real HTTP responses. Missing or unavailable sources are reported as failed or not configured; they are never replaced with mock or neutral values.

SEC EDGAR and openFDA remain active read-only ears for event-specific regulatory corroboration, but connectivity alone never counts toward a digital-asset score. FINRA short-sale files, Wikidata relationships, and corporate accounting/DCF evidence are marked not applicable unless the specific event makes them relevant. Keyed providers remain unavailable unless their own key and plan are configured; the lab reports `not_configured` or `not_entitled` and never invents a successful response. In particular, an FMP key does not prove that its Crypto News entitlement is included. Frankfurter supplies latest daily reference FX context, not intraday prices.

The free CoinGecko Demo credential can be supplied as `COINGECKO_DEMO_API_KEY`; the existing `COINGECKO_API_KEY` name remains a backwards-compatible Demo-key alias. The branch never guesses that this is a paid Pro key or sends it to the Pro hostname.

Once per 24 hours, the preview performs a tiny, real, read-only connectivity audit of SEC EDGAR and openFDA. SEC EDGAR uses its free public API with a built-in declared Swing Up contact header and needs no API key or Railway variable. openFDA remains context/connectivity-only and can never trigger or raise a serious-alert score. Marketaux, Alpha Vantage, and FMP are already exercised by the live crypto-news path, so they are not called a second time merely for auditing. The audit uses no database, no R2, no publishing, and no notifications. Audit connectivity itself never counts as serious-signal evidence. The report exposes missing variable names and provider status while redacting all secret values.

## Cost and repetition controls

- No more than three committee reviews can run in any rolling 24-hour period.
- The same evidence fingerprint cannot be reviewed twice within 12 hours.
- Immediately before a committee call, the preview atomically writes a pending reservation for that evidence fingerprint to durable branch state. A timeout, process exit, or incomplete response still consumes the reservation, so it cannot evade the rolling budget or trigger an immediate duplicate paid call.
- The preview pins every committee tier to the allowlisted `gpt-4.1-mini-2025-04-14` snapshot, limits each provider request to 12 seconds, and reports actual prompt/completion/cached token usage returned by OpenAI.
- Paid committee calls are disabled unless durable branch state is available. Merely having `OPENAI_API_KEY` does not bypass this guard.
- If the same explicitly repair-eligible application/code failure repeats three times without measurable improvement, the lab stops itself. Real provider outages, rate limits, and cooldowns never consume these repair attempts.
- A quiet market or a correctly rejected weak candidate is not counted as a technical failure.

## Durable branch state

Attach a Railway Volume to the **PR preview service only**. Railway supplies `RAILWAY_VOLUME_MOUNT_PATH`; the lab creates its state directory and stores `swing-up-railway-branch-signal-lab.json` there using atomic file replacement. As an alternative, `SWING_UP_BRANCH_LAB_STATE_PATH` may be set to an absolute volume directory or an absolute `.json` file path. This state contains only branch-lab reports, forward outcomes, provider-call quota reservations, and OpenAI attempt reservations. It does not use the production database, R2, migrations, publishing credentials, or another production data store.

If no durable path exists, the lab falls back to `/tmp` for non-paid observation only. If a configured volume cannot be created, read, or written, it also falls back safely and reports the reason without exposing the filesystem path. `stateStorage` in the GET and POST responses reports the backend, whether it is durable, whether it survives a preview redeploy, and whether fallback is active. OpenAI committee calls remain blocked while fallback is active.

## Outcome validation

Reviewed candidates are kept in the branch-only state described above. Later five-minute snapshots can calculate real CoinGecko forward returns at the 1D, 3D, 7D, 30D, and 90D checkpoints. A snapshot is accepted only from the checkpoint target through 30 minutes after it. Each evaluation records its target time, provider observation time, polling time, delay, and maximum accepted delay. A late snapshot is marked as a missed evaluation window instead of being reused, and one market snapshot can never fill multiple horizons. Legacy outcomes without this timing proof are discarded from validation.

A run can count toward validated signal quality only when it reports `mode=railway_branch_live_read_only`, `realProviderResponsesOnly=true`, and all three safety flags (`databaseWrites`, `publishing`, and `notifications`) are false. Safety consistency is calculated across every tested real branch performance run in durable history, not merely the most recent three. A consistent result requires at least three distinct serious-signal evidence fingerprints with an accepted 1D evaluation, at least a two-thirds useful rate, and no unsafe tested performance run. Repeating the same evidence cannot satisfy this target.

The redacted report is available from:

`GET /api/internal/railway-branch-signal-lab`

The POST trigger requires a random runtime-only token generated inside the preview container. It is not a repository or Railway secret.

## Railway requirement

Railway PR Environments must be enabled for the repository. Railway then creates an isolated preview deployment for the PR and supplies the branch/environment system variables used by the guard. The durable state requirement additionally needs a Railway Volume attached specifically to that preview service.
