# Simple Alerts launch and operating record

## Current state — 28 September 2026

The user authorizes stopping main scanning, launching `pilot-simple-alerts`, a fixed 25-company test followed by gated expansion to 50, two daily progress reports, and a concurrent target of 500 newly verified company profiles each Bangkok calendar day. The single $10 rolling-24-hour AI Committee allowance remains enabled. The separate infrastructure ceiling is $20/month. Do not merge this branch into main or reset/delete existing data.

**NOT LIVE:** Railway's `commitStagedChangesTool` returned `awaiting_user_action`: two-factor verification must be completed in the Railway dashboard. Main's sensor, recovery and foundation were still configured to run in the subsequent read-back. Staged changes and successful builds are not proof of a stopped scanner or a launched pilot. Do not bypass this authentication requirement with another mutation endpoint, credentials, or a main-branch code change.

Project `83d99341-d622-475f-8035-00ef3d0916d1`; environment `87afb8d7-c4fc-4f84-92b6-5d2820a689b6`. Source repository `Team-AI-Factory/swing-up`. Existing web domain: `https://swing-up-production.up.railway.app`.

## Concrete launch configuration

Reuse existing services. No new service, subscription, instance, or database is needed. Source branch for the four services below is `pilot-simple-alerts`, pinned to the tested branch head at deployment.

| Existing service | ID | Pilot configuration file | Role / schedule (UTC) |
| --- | --- | --- | --- |
| swing-up | d02bf6e1-4140-418f-aa5c-b67dcc2d8d15 | railway.json (existing default) | Existing web; role `web` |
| pr262-sensor | f2ccbe38-c107-443f-b1da-74b92ae829a6 | railway.sensor.json | role `sensor`; `*/15 * * * *` |
| pr262-analysis-recovery | adc23c8d-3912-4b22-87d9-e258bc70a044 | railway.analysis-recovery.json | role `profiles`; `7,22,37,52 * * * *` |
| pr262-foundation-v2 | 0a79a28a-d264-4202-86a0-adb5f2fbffcf | railway.foundation.json | Inert, no cron and no broad foundation pass |

For web, sensor and profiles set `SWING_UP_SIMPLE_PILOT_ENABLED=true`, `SWING_UP_SIMPLE_PILOT_ROLE` to the role above, `SWING_UP_PR262_STORAGE_PREFIX=branch-labs/simple-alerts/`, and `SWING_UP_R2_WRITE_PREFIX=branch-labs/simple-alerts/`. Runtime attests exact branch, project, environment and both prefixes. Ordinary PR previews remain inert. Keep other existing credential references unchanged. Sensor must keep both `AI_COMMITTEE_ENABLED` and `SWING_UP_PR262_EVENT_JOB_OPENAI_ENABLED` true with the existing bounded model policy. Profiles have both false; its launcher additionally removes OpenAI credentials. Both roles use the same provider allowance; the pilot reuses the existing AI spend/reservation ledger, not a fresh $10 allowance.

`SWING_UP_PR262_PROJECTED_RAILWAY_MONTHLY_COST_USD` must contain an authentic current projection above zero and at most 20; the launcher refuses missing/out-of-range values. This is a check of the configured forecast, **not live Railway invoice metering or a guaranteed account spending cap**. Railway's available connector did not supply current billing. Never set a guessed low number to launch. Verify the dashboard projection before starting the additional profile workload, preserve account spending controls, and stop expansion if the forecast becomes unavailable or breaches the ceiling.

The stored valuation foundation is read-only input. Pilot queues, company mapping/exposure caches, research, approvals, outboxes, delivery receipts and measurements are separate. Shared writes are restricted to the existing AI ledger, source request ledgers, refreshed official ticker universe, verified profiles and exact profile filing excerpts. Shared objects cannot be deleted by pilot exceptions. Main's queue, approvals, foundation calculations and results cannot be written through the pilot fence.

The earlier version of staged patch `e836fb56-379c-4b19-85ec-d2c7dbb45591` contained older **service deletions** for `pr262-foundation` (`734b2d0d-14a3-4dad-b01a-aceaef7565df`) and `pr262-queue-reset-once` (`a90a72f1-dc27-4f84-bbcd-87a7e749bae0`). Those deletion requests have now been cleared by discarding and reconstructing only the intended four-service launch patch; direct read-back verifies both retired services have no staged changes. Preserve their live inert configuration. Postgres remains unchanged. Nulling UI cron alone may be overridden by the repository configuration; use the explicit configuration files above and verify effective settings after deployment.

Rollback: stop the pilot worker schedules, leave the website/database available, preserve all queues, profiles and accounting. Return the web to the prior main revision only if needed. **Do not restart main scanning as rollback** without a later user instruction. The pre-pilot source main revision was `5129218b77250791dd8f813d11ad8fe242d5a767`; schedules were sensor every 15 minutes, recovery minute 7 hourly, foundation 02:17 UTC, for historical reference only.

## What the smaller test does

- Keep exactly the original 25 identities in `config/simple-alert-pilot.json`. Filter both discovery admission and paid event selection; no out-of-cohort review. Public valuation cards also use the cohort.
- Use SEC current filings, existing issuer announcement monitoring, cohort prices and trading halts. Broad government/macro/news aggregation and sector expansion are explicitly out of this pilot, not declared fixed or deleted. Re-enable a source family only after a separate measured test.
- Keep identity, readable full source, financial/price support, all required Committee roles, final approval, and receipt-backed delivery. Do not weaken a gate to obtain output.
- Publish approved pilot alerts to its existing authenticated web-feed path and record delivery receipts. External Telegram/webhook destinations remain disabled in the pilot launcher. No trades or new recipients. A model review or provisional card is not a Serious Alert.
- Count partial source failures, and count each direct-issuer attempt using its actual attempt/failure counters. Store every completed pilot cycle, including quiet runs. Full-document failures, missing evidence and profile-extraction failures remain separate visible categories; do not hide them in the headline transport error percentage.

## Profile production target

The separate profile role uses the existing identity-checked annual-report extractor. It prioritizes missing pilot profiles, then least-recently-attempted issuers; keeps exact source excerpts and known retry dates; makes no AI calls. It streams company filings and reuses saved sources. Cadence is offset from the sensor.

Each pass has a 175-second network budget and at most 100 selected issuers. A durable lease prevents overlapping profile passes; daily reservations cap attempts at 2,500. First-time successful verifications are date-stamped and counted against the 500/day target, using Bangkok dates. Cached profiles and failed attempts do not count as new completions. A process crash retains its reserved capacity until the daily accounting/lease allows safe continuation. Completed unused reservations are returned.

Requests are paced at one per second; 403 or 429 opens a stop for the rest of that pass. Existing issuer cooldowns remain enforced. Pilot SEC submissions and annual-filing requests each have a shared 3,500 rolling-day network allowance; these replace the insufficient 190-submissions application cap for this explicitly approved profile workload. They do not modify a paid provider subscription. SEC's official published ceiling is 10 requests/second in aggregate: https://www.sec.gov/about/privacy-information. Keep other concurrent source use within that ceiling.

**500 is a completion target, not proven throughput.** Prior extraction success was low; report attempts, verified, unverified, verification yield, source errors, cooldowns, daily shortfall and cost separately. Do not manufacture descriptions or infer revenue country from headquarters. Revenue-country facts remain optional and visibly unverified until sourced. The target must not override source throttles or the infrastructure budget.

## Observation and expansion

Start the clock only after the first successful live pilot cycle on the tested commit, a verified main pause, and an isolated approval-to-web-feed control with durable receipt. Label control/replay data as test-only and exclude it from live counts. The existing synthetic delivery tests are local controls, not live delivery proof.

Earliest operational assessment: five completed US trading sessions. Usefulness assessment: 10–20 sessions, with at least 20 distinct real cases. Investment returns require the stated holding horizon; reliable delivery is not investment profitability.

Expand to 50 only when two consecutive, **non-overlapping** 24-hour windows satisfy all of:

1. At least five US sessions and 20 distinct real assessed cases overall, at least 100 source attempts per window, and no missed scheduled execution left unexplained.
2. Source attempt failures **strictly below 5%** and processing operation failures **strictly below 5%**, with numerators/denominators and partial errors included. No stale critical price/universe source, unresolved access refusal blocking an assessed case, or hidden provider quota problem.
3. Positive and negative isolated approval/delivery controls pass. At least one real approved alert has a durable delivery receipt. All approved live alerts are delivered; no duplicate, wrong-issuer, fabricated fact, unapproved publication, or unresolved critical incident.
4. At least 95% of source-complete eligible cases reach a documented decision within 30 minutes; unresolved/expired cases stay visible, not deleted from statistics.
5. Shared AI exposure stays below the $10 ceiling; source quotas and a current infrastructure projection remain within authorization. All 25 current company packets pass identity and clarity checks; the next 25 have verified profiles and required current evidence.

Retain the original 25, append the next 25 to the same cohort file, test the cohort boundary and run normal validation, then deploy only this branch. Do not go beyond 50. Fewer cases or a quiet market means inconclusive; correct no-opportunity decisions are legitimate, and must not be forced into approvals. For the user's longer-term goal of consistent Serious Alerts, require at least three distinct real receipt-backed approvals across at least two US sessions plus continuing reliability; this observation still cannot guarantee future availability or profitable outcomes.

Recommend adding back one feature/source family at a time only after a passed window. Prioritize the feature with a specific measured missed-opportunity benefit, not code volume or queue activity.

## Automated oversight

- Progress task `6ab38ed8ae788191af1e9dd9ff73e637` is updated for 08:00 and 20:00 Asia/Bangkok. Report good/bad results, Serious/provisional/rejected/no-signal/blocked cases, source reliability, processing reliability, profile output, card completeness, latency, spending, fixes, unresolved issues and next step.
- Maintenance task `6ab38ef504848191b0cc0100811eda54` checks hourly for bounded reversible repairs and evidence-based expansion. It must not bypass dashboard authentication, restart main scanning, or repeatedly notify routine unchanged blockers. Report the verified incident or needed user action promptly when material.

## Launch staging read-back

The first connected infrastructure preparation call ended with HTTP 502 after staging partial changes. Configuration-file path changes were not staged. The pilot branch therefore updates the EXISTING Railway config files listed above, while leaving main unchanged, so repository configuration cannot silently reinstate the old jobs.

The connection cannot undo individual service-deletion flags. After checking that the entire pending patch contained only the known launch edits and the two older deletions, the patch was discarded and rebuilt from the exact saved configuration. Direct read-back now proves: ONLY web, sensor, profiles and foundation-v2 have staged edits; BOTH retired services have `staged: null`; Postgres is unchanged. No deletion remains. This discarded preparation only, not live data or deployments. Pilot role variables, source branches and worker commands/schedules are staged; nothing has been applied. Dashboard two-factor verification remains required.

The read of the configured cost projection returned `valuesRedacted: true`; actual current spend remains unavailable. Preserve the existing projection; do not invent a value. The pilot launch script checks its configured $20 ceiling at runtime and may refuse to start if the existing value does not meet it. A current dashboard billing check is still required to claim infrastructure headroom.

## Validation record

Local tests passed for pilot runtime/storage/cohort/first-verification targeting, existing sensor and event retries, analysis orchestration, provider-budget durability, concurrent $10 accounting, profile extraction and invalidation/recovery, valuation card filtering, official universe fallback, R2 mutation/list boundaries, exposure completeness and authenticated delivery recovery. Type checking, lint and a production build passed. These establish code behavior with controlled inputs; live schedule, data yield, delivery and cost proof are still blocked on the Railway launch.

## Preserved concurrent maintenance entry

The following observation was committed independently as `5fe2630` while launch work was being prepared. It is retained as historical evidence; the configuration and implementation above are newer.

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


## 2026-09-29 maintenance observation, through 17:49 Bangkok

### Deployment and authorization

Read both pilot documents from GitHub before inspection. Fresh Git fetch and remote ref agree that published pilot head is `1827f3970177d0d8e531d3effea41349fe0611ba`. Verification used a new detached worktree; no existing operator worktree was changed.

Railway still reports live sensor `4f4b32a1-12ce-4bb5-bcb0-d64846d94d71`, recovery `6344649c-f33a-4bba-938c-7cedd4ee2222`, foundation and web on main `5129218b77250791dd8f813d11ad8fe242d5a767`. Sensor configuration read-back confirms main and the 15-minute schedule; pilot branch/launcher/prefixes remain staged. Environment patch remains STAGED with 18 reported changes. Main cycles continued through 17:48:43 Bangkok. The pause is not effective; the pilot is not live. No authentication resolution is established. No infrastructure mutation, apply, redeploy, paid request, queue reset, resource increase or main restart was performed.

### Fresh operational evidence (main only)

Eight sensor coverage completions and one recovery completion were retrieved for 16:00–17:49 Bangkok. Latest sensor: 272 pending; 12 profile-ready; 246 profile-blocked across 204 companies; 15 scheduled retries; oldest reported profile-ready queue wait 2,596 minutes; zero fresh authoritative ready cases.

At 16:47 Bangkok, NVDA completed four roles but was not approved: verification, freshness, primary/independent proof and evidence-score gates remained unmet. At 17:47, XLAB filing `sec:0001829126-26-010494` completed three roles but the final judge failed with `prompt_too_large`; filing `sec:0001829126-26-010462` failed before the analyst call for the same reason. Both were unapproved and had null outbox keys. Review-attempt counts must not be presented as successful Committee completions.

Five complete parseable sensor cycle payloads in this interval each showed zero approvals, zero discovered outboxes and zero durable deliveries. Several other connector log messages were truncated mid-JSON, so no aggregate final-approval/delivery claim is made for their missing tails. All nine coverage summaries reported zero Serious Alerts.

The last complete cost snapshot, cycle checked at 17:31:09 Bangkok, reports $0.332770 spent/exposed, $10 limit, healthy accounting and no active provider cooldown. Later partial payloads show an invalid-request cooldown following oversized prompts; they are insufficient to reconcile an exact latest total. No verified budget stop. Token receipts are not provider invoices; infrastructure projection remains unverified.

At the 17:31 cycle, the legacy daily source counter reports 59/297 failures (19.87%). This is the legacy batch measure, not a complete request-level reliability measure or a pilot window. Commerce was rate limited and market-watch returned HTTP 429. Existing source pacing and retry controls were not changed. Zero event exceptions does not establish sub-5% end-to-end processing failure while cases remain deferred or technically incomplete.

### Profile target

For Bangkok 00:00–17:49, filtered coverage retrieval returned 72 sensor and 17 recovery entries (neither reached the 500-entry limit): 92 profile attempts and 11 reported verifications. These are not identity-level first-verification receipts. Even crediting all 11 as distinct new profiles leaves at least 489 outstanding against today's 500 target at this checkpoint. Exact newly verified count and final-day shortfall remain unverified. The separate pilot profile role is still not deployed.

### Bounded verification and diagnosed next repair

Five offline checks passed on published pilot `1827f39`:
- `ai-committee-provider-guardrails-smoke.mjs`: oversized prompts refused before network calls, allowed model, timeout/cancellation and actual token usage.
- `pr262-ai-daily-cost-fuse-smoke.mjs`: shared concurrent $10 ceiling, rejected-request zero charge, uncertainty handling and audit.
- `simple-alert-live-smoke.mjs`: frozen 25, isolated results, shared accounting, main-write denial, first-verification counting, role boundaries and launcher refusal on main.
- `simple-alert-pilot-smoke.mjs`: identity/freshness, missing coverage and no implied approvals.
- `serious-signal-delivery-smoke.mjs`: final authority, stale-price rejection, duplicate protection and isolated test delivery.

An initial command used a nonexistent runtime-test filename; it was corrected to the existing `simple-alert-live-smoke.mjs`, which passed. This was a test invocation error, not a product failure. All tests used local fixtures/mocks; no live delivery control or pilot launch is claimed.

Source inspection confirms the prepared pilot shares the 60,000-byte per-role prompt guard. Each reviewer prompt includes the evidence packet plus prior reviewer results. The final-judge failure is consistent with accumulated input exceeding that bound; another case already exceeds it before the first reviewer. Logs do not expose the exact serialized prompt, so the precise contributing fields are not yet established. Do not raise the cost bound or cut required evidence to suppress the error. The next bounded repair should first reproduce with a sanitized packet and measure field sizes, then remove proven duplication or unnecessary formatting while preserving source facts, reviewer conclusions and approval gates. The local prompt rejection is also currently classified as an invalid-request shared stop; keep this separate from an external provider outage in reporting.

No product-code change was justified without that packet reproduction in this check. This launch-log update is the only repository change. Expansion remains blocked: zero verified pilot sessions/windows, no live control receipts and no live pilot Serious Alert. Continue read-only oversight and preparation; the known authentication blocker is unchanged and should not trigger another hourly notification.

Evidence: [Railway project](https://railway.com/project/83d99341-d622-475f-8035-00ef3d0916d1?environmentId=87afb8d7-c4fc-4f84-92b6-5d2820a689b6); [tested pilot source](https://github.com/Team-AI-Factory/swing-up/tree/1827f3970177d0d8e531d3effea41349fe0611ba).
