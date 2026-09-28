# Simple Alerts pilot launch log

## Current authorization and launch gates

Latest user instruction supersedes earlier planning text in `simple-alert-pilot.md`: stop main scanning; run only the isolated `pilot-simple-alerts` experiment, initially 25 companies; target 500 newly verified company profiles per Bangkok day in a separately paced preparation job. Do not restart main, merge to main, reset queues, weaken evidence/Committee/final-approval requirements, send to new recipients, or introduce a second AI allowance.

Railway dashboard two-factor verification was required to apply the staged pause on 28 September. Until explicitly verified resolved, infrastructure changes remain blocked: reads, code preparation and tests only. Do not use another route to bypass authentication. Staged changes are not live. Do not apply unrelated foundation or queue-reset changes bundled in the environment patch.

Preserve the single shared $10 rolling-24-hour Committee ledger, existing profiles and provider throttling. The $20/month infrastructure budget is separate; no verified infrastructure headroom has been obtained in this maintenance check.

25 → 50 requires all of: five completed US trading sessions after actual launch; 20 distinct real assessed cases; isolated positive and negative delivery controls; source and processing failure rates each below 5% in two consecutive observation windows; zero critical data, approval or duplicate incidents; receipt-backed delivery and verified cost headroom. Keep the original 25 and add 25 verified, source-complete identities. No automatic expansion beyond 50 and no new feature families. Zero natural Serious Alerts is not a reason to relax gates.

## 2026-09-28 maintenance observation, through 16:28 Bangkok

### Deployment and concurrent work

- Read `docs/simple-alert-pilot.md` from GitHub first. `docs/simple-alert-pilot-launch.md` returned 404 twice; this entry creates the requested launch log.
- Published pilot code checked: `c1634b2c3089b623845c2a0b539bb844cb2f7546`.
- Railway reports sensor and recovery on **main**, commit `5129218b77250791dd8f813d11ad8fe242d5a767`. Live sensor deployment: `fb168d4f-900e-4e2d-b5f2-50748520f0f5`; recovery: `6344649c-f33a-4bba-938c-7cedd4ee2222`.
- Sensor still configured every 15 minutes; recovery hourly at minute 7. Both show removal of the cron schedule only as **staged**. Completed main cycles confirm the pause has not taken effect. No pilot live cycle, launch time or eligible trading session can be credited.
- Environment patch `e836fb56-379c-4b19-85ec-d2c7dbb45591` contains five staged service changes, including unrelated foundation/queue-reset work. No apply, redeploy, variable, schedule or resource mutation was attempted.
- Another operator has unfinished local changes to pilot runtime/scope, storage, universe, directory, sensor, event job and orchestrator. They were not edited, staged, committed or tested as finished work. Verification used a separate detached worktree at the published pilot commit.

### Fresh operational evidence

The eight completed sensor/recovery cycles retrieved for 15:00–16:28 Bangkok report zero Committee approvals, zero Serious Alerts, zero discovered outboxes and zero deliveries. One additional review appears in that interval; its case requested more evidence. These are main results, not pilot performance.

Latest sensor completion: **16:16:09 Bangkok**. Pending events: 30; profile-ready: 1; profile-blocked: 21 across 15 companies; scheduled retries: 10. Oldest due evidence: 2,549 minutes (this is evidence age, not proven queue residence time). Thirteen due high-priority events had evidence older than 30 minutes. NVDA's official event was deferred by the full-source rolling quota guard.

Latest recovery completion: **16:12:19 Bangkok**. MU encountered `full_source_transport_failed:ipv6_ENETUNREACH`; other cases were held by the source quota. An earlier MU read returned insufficient source text. APAM was held on unchanged evidence; this is not exhausted AI budget.

Observed provider problems include GDELT timeout/rate limiting, State Department access denial inside a partial official-feed batch, and direct-issuer partial failures involving SEC quota and timeout. Throttling remains preserved.

Latest token-receipt accounting: **$0.035885**, four recorded reviews, $10 rolling cap, zero active reservations, healthy accounting, no budget stop. Provider invoice verification is unavailable; this is not an invoice total.

### Measurement issue: source failure rate cannot certify scaling

The latest persisted day counter reports **22/232 = 9.48%**, already above target. In the published orchestrator, `partial` is excluded from source failures, and provider batches are counted as one attempt regardless of child attempts. Quiet cycles can skip updating the daily cost metrics. Therefore this displayed percentage is not a complete child-request reliability measure and cannot certify the requested source threshold.

Keep partial failures and quota deferrals visible. Do not silently combine batch rates with request rates or treat zero event exceptions as successful assessment. A bounded next repair should add explicit, consistently defined reliability observations (with denominators), including partial-source degradation and processing outcomes, once the operator's orchestrator changes are ready to integrate. Do not overwrite that in-progress file.

### Profile production versus 500/day

For Bangkok 00:00–16:28, filtered logs returned 65 sensor and 17 recovery coverage entries without hitting the 500-entry limit: **86 attempts and 14 reported verifications**. These counters do not prove 14 distinct newly verified company identities. The foundation run reported zero profile attempts/verifications, while refreshing valuation coverage for 4,958 companies; valuation refreshes are not new profiles.

No dedicated 500/day profile job is deployed. Against the 500 distinct-new-profile target, even crediting all 14 reported verifications as new would leave **at least 486 outstanding at this checkpoint**. Exact distinct-new yield and final-day shortfall remain unverified; obtain identity-level completion records rather than subtracting snapshots affected by expiry. Do not present attempts or existing verified-profile totals as daily production.

### Bounded verification completed

All seven offline checks passed on published pilot commit `c1634b2`:

1. `node scripts/simple-alert-pilot-smoke.mjs` — frozen 25-company cohort, issuer identity, freshness and missing coverage.
2. `node scripts/company-card-facts-smoke.mjs` — dated geography evidence, country versus headquarters/region, no invented customer facts.
3. `node scripts/pr262-ai-daily-cost-fuse-smoke.mjs` — concurrent shared $10 cap, actual token accounting and uncertainty holds.
4. `node scripts/pr262-committee-authority-smoke.mjs` — existing authority policy and rejection of legacy scanner outputs.
5. `node scripts/serious-signal-delivery-smoke.mjs` — approval authority, stale-evidence rejection, duplicate protection and test-feed isolation.
6. `node scripts/pr262-storage-namespace-smoke.mjs` — production/preview separation.
7. `node scripts/pr262-runtime-pause-smoke.mjs` — existing launcher/preview/legacy-worker safety.

These tests use local fixtures and mocks. They do **not** prove a live pilot, actual destination receipt, completed main pause, live isolation of the unfinished implementation, or a sub-5% failure rate. No paid model call, new recipient, production write or data deletion was made by this check.

### Next bounded step and notifications

Coordinate with the existing operator's unfinished pilot isolation work; test its exact completed commit and shared-ledger routing before launch. Repair reliability measurement without changing approval rules. Authentication resolution must be independently verified before applying only the intended main-pause/pilot changes through the authorized path. Verify the resulting branch/commit, actual main inactivity and isolated real pilot cycles before starting the observation clock.

Scaling remains blocked. Maintenance remains active because reads, preparation and verification are still possible. No new critical incident, budget stop or receipt-backed live Serious Alert was established; the known authentication blocker is unchanged and should not be repeated hourly. Routine findings belong in the twice-daily report.

Evidence: [Railway project](https://railway.com/project/83d99341-d622-475f-8035-00ef3d0916d1), deployment IDs and exact log timestamps above; [pilot source](https://github.com/Team-AI-Factory/swing-up/tree/c1634b2c3089b623845c2a0b539bb844cb2f7546).
