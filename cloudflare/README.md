# PR262 Cloudflare cheap sensor

This Worker owns only low-cost change discovery. It runs every five minutes,
stores bounded candidate events in the shared private R2 queue, and wakes the
Railway analysis-only route only while that queue contains retained work. Quiet
scans stop at Cloudflare and do not wake Railway. Railway continues to own issuer mapping, evidence
reading, fresh quote/halt verification, valuation, the 14-role Committee, final
judgment, notification delivery, and all expensive work.

The Worker is implemented but is **not live merely because these files exist**.
The account bindings, secrets, production Railway URL, and two-sided ownership
switch must be configured and then verified in shadow mode before cutover. The
repository contains separate shadow and production Wrangler configurations so
the observation period cannot accidentally write production state or invoke
Railway analysis.

## Safety properties

- One named Durable Object serializes scheduled runs and holds the renewable
  run lease. Overlapping cron deliveries return `409 busy` rather than scanning
  twice.
- Provider reservations are written to Durable Object storage **before** each
  network request. A crash therefore cannot erase the last quota spend.
- Every source has a minimum interval and rolling 24-hour cap. A run permits at
  most 16 external source calls, four at a time, within a 42-second wall clock.
- Wrangler additionally enforces 10 seconds of CPU and 32 subrequests.
- Bodies are limited to 1 MB, timestamps are bounded, queues are capped at 500
  new events and 2,500 retained events, and unresolved events expire after one
  day.
- R2 state updates use ETag conditions and retry/merge, so Railway acknowledgments
  are not silently overwritten.
- Each scan also writes a create-only immutable audit record. The Railway
  handoff verifies its SHA-256 digest before starting analysis.
- The handoff uses a route-scoped sensor token plus a separate HMAC secret,
  timestamp, nonce, five-minute expiry, and durable replay receipt.
- The public Worker surface exposes only `/health`. `/status` requires its own
  read token. There is no public manual scan endpoint.
- The Worker has no AI, Committee, article-reading, notification, trade, payment,
  database, or publishing capability.

## Sources

The five-minute lane covers broad SEC filings, a rotating urgent SEC form,
rotating Google News discovery, NYSE halt changes, and the stored TradingView
quality/value watch. Longer-cadence lanes cover GDELT, Marketaux, official U.S.
government feeds, Federal Register, Commerce, FDA MedWatch/openFDA, Alpha
Vantage news/earnings, commercially approved FMP news, FRED, Frankfurter/ECB
rates, and registered issuer feeds. It also discovers at most one new issuer
feed per eligible discovery cycle and polls at most four registered feeds in a
run. The four highest-quality registered issuers are eligible every 15 minutes;
the rest rotate fairly on an hourly cadence. Every issuer still consumes one
shared 480-request rolling daily ceiling, so per-issuer cadence keys cannot
bypass the provider-wide cost guard. Material government/macro events use deterministic sector fan-out only;
Railway must still prove issuer-specific causality.

FMP remains disabled unless `FMP_COMMERCIAL_USE_APPROVED=true` is deliberately
set and the account is licensed for this production use.

## Account configuration required

Before production deployment, replace the reserved `.invalid` Railway URL and
allowlist values in `wrangler.pr262-sensor.toml` with the exact production
Railway hostname. The hostname must appear in
`RAILWAY_HANDOFF_HOST_ALLOWLIST`.

The production R2 binding currently expects the existing private bucket named
`swingup`. Confirm that name in the Cloudflare account before deployment. The
shadow configuration uses two bindings: `SENSOR_R2` is the non-existent
`replace-with-shadow-bucket` placeholder that must be replaced with a dedicated
private shadow bucket, while `REFERENCE_R2` reads the existing PR262 universe
and exposure indexes from `swingup` through a GET-only adapter in the Worker.
The shadow Worker never writes state, runs, queues, or direct-feed records to
`REFERENCE_R2`. Never bind the shadow state bucket to the production Worker or
the production state bucket to the shadow `SENSOR_R2` binding.

The `production/pr262/` namespace starts empty by design. Before enabling paid
analysis, Railway must build a **fresh production** equity universe, value
state/batches, exposure index, and company directory there. Do not copy branch
event queues, delivery receipts, AI budgets, or dry-run decisions into
production. If the universe/exposure cache is missing, the Worker deliberately
keeps exact source records as unresolved and does not guess a ticker; Railway
also fails closed, so no Serious Signal can be produced from an unknown issuer.

Configure these Cloudflare Worker secrets; do not put their values in Git:

| Cloudflare secret | Matching Railway value / purpose |
|---|---|
| `RAILWAY_SENSOR_TOKEN` | Same random value as Railway `SWING_UP_PR262_SENSOR_TOKEN` |
| `RAILWAY_HANDOFF_SECRET` | Same independent random value as Railway `SWING_UP_PR262_HANDOFF_SECRET` |
| `STATUS_READ_TOKEN` | Independent read-only token for Worker status |
| `MARKETAUX_API_TOKEN` | Optional provider credential |
| `ALPHA_VANTAGE_API_KEY` | Optional provider credential |
| `FMP_API_KEY` | Optional; ignored until commercial approval is true |

Each token/secret must be at least 32 unpredictable characters. Cloudflare R2
S3 access keys are not needed by this Worker because it uses a native binding.
Railway still needs its own least-privilege R2 credentials.

Railway must have:

- `SWING_UP_PR262_SENSOR_OWNER=cloudflare_worker`
- the matching sensor token and HMAC secret above
- `SWING_UP_PR262_STORAGE_PREFIX=production/pr262/`
- access to the same R2 bucket

With the ownership switch set, Railway's cron must run analysis-only and must
not call discovery providers. The persistent Railway web service must serve
`POST /api/internal/combined-opportunity-engine/cloudflare-sensor-handoff`.

## Handoff contract

The Worker sends this compact body after the R2 state and immutable run exist:

```json
{
  "version": 1,
  "kind": "pr262_cloudflare_sensor_handoff",
  "owner": "cloudflare_worker",
  "scanId": "UUIDv4",
  "checkedAt": "ISO-8601",
  "stateKey": "production/pr262/sensor/state-v1.json",
  "stateEtag": "R2 ETag",
  "runKey": "production/pr262/sensor/runs/YYYY-MM-DD/...-UUID.json",
  "runDigest": "64 lowercase SHA-256 hex characters",
  "newEvents": 0,
  "pendingEvents": 0
}
```

Headers are:

- `x-swing-up-pr262-sensor-token`
- `x-swing-up-sensor-timestamp` (Unix seconds)
- `x-swing-up-sensor-nonce` (the scan UUID)
- `x-swing-up-sensor-signature: v1=<hex HMAC-SHA256>`

The signed text is exactly:

```text
v1\n<TIMESTAMP>\n<NONCE>\nPOST\n/api/internal/combined-opportunity-engine/cloudflare-sensor-handoff\n<SHA256_OF_EXACT_BODY>
```

Railway confirms the private R2 state and immutable run, claims a durable replay
receipt, then queues `runPr262AnalysisOnlyCycle()`. A failed or restarted
analysis never loses the event: it remains in the R2 pending queue for the next
five-minute handoff.

## Safe rollout

1. Run the clean production universe/value bootstrap, while keeping copied
   branch queues and decisions out of `production/pr262/`.
2. Validate both bundles with `npm run check:pr262-cloudflare-bundle`.
3. Deploy `wrangler.pr262-sensor-shadow.toml` with a separate shadow state
   bucket and the existing PR262 reference bucket on `REFERENCE_R2`;
   keep the five-minute `railway.sensor.json` production sensor unchanged.
   Shadow has a live five-minute
   schedule but `ANALYSIS_HANDOFF_ENABLED=false`, and the Worker rejects any
   attempt to enable analysis while `SENSOR_DEPLOYMENT_MODE=shadow`.
4. Run the smoke test and inspect Worker logs for provider caps, R2 ETag
   conflicts, HMAC rejection, and queue counts.
5. Shadow for 24–48 hours and compare discovered event identities against the
   Railway sensor. Do not allow the shadow endpoint to run paid analysis.
6. Freeze provider/config changes. Bind the production R2 bucket and production
   handoff URL.
7. In one controlled cutover, enable the production Worker, disable the
   five-minute Railway sensor service, and enable the hourly
   `railway.analysis-recovery.json` safety net with
   `SWING_UP_PR262_SENSOR_OWNER=cloudflare_worker`. The Worker invokes Railway
   immediately whenever retained work exists; the hourly job only recovers
   interrupted handoffs/deliveries. Never leave both sensors as owners.
8. Verify at least three quiet cycles, one real retained event, one provider
   failure/retry, one Railway analysis handoff, and no duplicate scan or alert.
9. Roll back by disabling the Worker cron first, then restoring Railway's sensor
   owner. Do not run both during rollback.

Useful references: [Cloudflare R2 Worker bindings](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/),
[Wrangler cron and limits](https://developers.cloudflare.com/workers/wrangler/configuration/), and
[Durable Objects](https://developers.cloudflare.com/durable-objects/).
