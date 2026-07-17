# Railway Branch Signal Lab

This experiment is deliberately isolated from `main` and Railway production. It activates only when all of these are true:

- `RAILWAY_GIT_BRANCH` is exactly `agent/live-signal-evaluation-automation`.
- `RAILWAY_ENVIRONMENT_NAME` exists and is not `production`.
- Railway has supplied `RAILWAY_PROJECT_ID`.

In the branch preview, the startup wrapper removes database, Telegram, publishing-storage, payment, and paid market-data credentials from the application process. It also skips Prisma migrations. The only paid credential retained is `OPENAI_API_KEY`, which is used only after a candidate passes the live evidence filters.

## What runs

Once an hour the lab reads current CoinGecko market data and recent Google News RSS receipts for ten major digital assets. A candidate reaches the 14-agent OpenAI committee only when it has:

- 100% live input provenance;
- at least two independent news publishers plus CoinGecko market proof;
- a recent catalyst keyword;
- a meaningful 24-hour move and price/volume confirmation; and
- at least the configured evidence-confidence threshold.

The filters are never relaxed merely to produce a signal. `No Action` is a valid result.

## Cost and repetition controls

- No more than three committee reviews can run in any rolling 24-hour period.
- The same evidence fingerprint cannot be reviewed twice within 12 hours.
- If the same technical failure repeats three times without improvement, the lab stops itself.
- A quiet market or a correctly rejected weak candidate is not counted as a technical failure.

## Outcome validation

Reviewed candidates are kept only in the preview container's temporary report. Later hourly snapshots calculate real CoinGecko forward returns at 1D, 3D, 7D, 30D, and 90D. A consistent result requires at least three serious signals with a 1D evaluation and at least a two-thirds useful rate.

The redacted report is available from:

`GET /api/internal/railway-branch-signal-lab`

The POST trigger requires a random runtime-only token generated inside the preview container. It is not a repository or Railway secret.

## Railway requirement

Railway PR Environments must be enabled for the repository. Railway then creates an isolated preview deployment for the draft PR and supplies the branch/environment system variables used by the guard.
