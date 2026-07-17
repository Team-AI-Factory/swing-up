# Serious Signal Branch Lab

This lab keeps every optimisation change off `main` until the founder approves the result.

## Branch boundary

- Work happens on `agent/live-signal-evaluation-automation` or another `agent/**` branch.
- The workflow refuses to run as a main-branch job.
- It has read-only repository permissions.
- It cannot merge pull requests.
- It cannot publish alerts or send notifications.
- Railway production remains unchanged until the founder manually merges the draft PR.

## Quality gates

The evaluator requires complete live input provenance, at least two independent receipts, no mock or neutral fallback, a verified price at alert, and real 1D/3D/7D/30D/90D outcome checkpoints. Missing inputs force `No Action` and block approval/publication.

The outcome worker uses CoinGecko prices for supported digital assets. It stores provider, asset ID, currency, source URL, timestamp, data-quality label, and alert ID with every snapshot. This prevents price history from a different alert on the same asset being reused accidentally.

CI uses no simulated market or news data and makes no performance claim. Live performance is measured only in the guarded Railway preview, where the lab polls real CoinGecko, Google News RSS, and GDELT responses every five minutes by default.

## Iteration limit

ChatGPT may inspect and improve the isolated branch up to three times for the same technical failure without measurable gain. A quiet market or correctly rejected evidence is not a technical failure. The process must stop when the live gates pass, after three no-gain repairs to the same issue, or when a change would require new paid data, secrets, production access, publishing, notifications, or a main-branch merge.

## Optional branch deployment

Set the GitHub repository variable `SWING_UP_BRANCH_TEST_URL` to a Railway preview/staging deployment for this branch. Optionally set the GitHub secret `SWING_UP_AUTOMATION_TOKEN` to allow authenticated live outcome dry-runs. Neither setting targets production unless the founder deliberately points it there.
