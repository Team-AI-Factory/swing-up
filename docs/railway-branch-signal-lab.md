# Railway Branch Signal Lab

This experiment is deliberately isolated from `main` and Railway production. It activates only when all of these are true:

- `RAILWAY_GIT_BRANCH` is exactly `agent/live-signal-evaluation-automation`.
- `RAILWAY_ENVIRONMENT_NAME` exists and is not `production`.
- Railway has supplied `RAILWAY_PROJECT_ID`.

In the branch preview, the startup wrapper removes database, Telegram, publishing-storage, payment, and uncontrolled paid-market credentials from the application process. It also skips Prisma migrations. It retains `OPENAI_API_KEY` plus the configured free-tier keys for FMP, Marketaux, Alpha Vantage, CoinGecko, FRED, and openFDA. Provider calls remain bounded by branch-specific cadence and never write to the database.

## What runs

The preview process runs immediately at startup and then every five minutes by default. CoinGecko and Google News RSS refresh on that cycle; GDELT reuses its most recent real response and refreshes at most every fifteen minutes to match its useful update cadence and avoid needless rate-limit pressure. A GDELT rate-limit response also starts a minimum fifteen-minute cooldown, extended when the provider supplies a longer `Retry-After`, without substituting stale or invented news. A technical failure retries after one minute. The interval can be changed with `SWING_UP_BRANCH_LAB_INTERVAL_SECONDS`, but the runner refuses intervals below 60 seconds to protect free-source quotas.

Each performance run reads current CoinGecko market data and recent receipts from both Google News RSS and GDELT for ten major digital assets. It also uses live public FRED interest-rate data and Frankfurter FX rates, refreshed hourly because those sources update more slowly. A candidate reaches the 14-agent OpenAI committee only when it has:

- 100% live input provenance;
- both live news discovery channels, at least two independent news publishers, CoinGecko market proof, and connected FRED/Frankfurter context;
- a recent catalyst keyword;
- a meaningful 24-hour move and price/volume confirmation; and
- at least the configured evidence-confidence threshold.

The filters are never relaxed merely to produce a signal. `No Action` is a valid result.

CI does not fabricate a market, news event, or outcome. It verifies compilation, branch isolation, and side-effect guards only. A result counts toward signal quality only when it came from the Railway branch preview through real HTTP responses. Missing or unavailable sources are reported as failed or not configured; they are never replaced with mock or neutral values.

Other integrated ears such as SEC EDGAR, FINRA short-sale files, openFDA, Wikidata, and keyed equity-news providers remain available to their applicable stock, regulatory, or relationship workflows. They are not counted as direct evidence for a digital-asset alert because doing so would create misleading confidence. Keyed providers remain unavailable unless their own key and plan are configured; the lab never invents a successful response.

Once per 24 hours, the preview performs a tiny, real, read-only connectivity audit of SEC EDGAR, openFDA, Marketaux, Alpha Vantage, and FMP. SEC EDGAR uses its free public API with a built-in declared Swing Up contact header and needs no API key; `SEC_USER_AGENT` remains an optional override only. The audit uses dry-run mode, no database, no R2, no publishing, and no notifications. Its results are operational diagnostics only and never count as serious-signal performance evidence. The report exposes missing variable names and provider status while redacting all secret values.

## Cost and repetition controls

- No more than three committee reviews can run in any rolling 24-hour period.
- The same evidence fingerprint cannot be reviewed twice within 12 hours.
- If the same technical failure repeats three times without improvement, the lab stops itself.
- A quiet market or a correctly rejected weak candidate is not counted as a technical failure.

## Outcome validation

Reviewed candidates are kept only in the preview container's temporary report. Later five-minute snapshots calculate real CoinGecko forward returns when each 1D, 3D, 7D, 30D, and 90D checkpoint becomes due. A consistent result requires at least three distinct serious-signal evidence fingerprints with a 1D evaluation and at least a two-thirds useful rate. Repeating the same evidence cannot satisfy this target.

The redacted report is available from:

`GET /api/internal/railway-branch-signal-lab`

The POST trigger requires a random runtime-only token generated inside the preview container. It is not a repository or Railway secret.

## Railway requirement

Railway PR Environments must be enabled for the repository. Railway then creates an isolated preview deployment for the draft PR and supplies the branch/environment system variables used by the guard.
