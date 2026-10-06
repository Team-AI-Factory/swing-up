# Evidence and model deployment — 6 October 2026

This is the current deployment record for the targeted evidence/model upgrade. Historical launch entries remain historical. The five changes and stage-by-stage model policy are documented in [evidence-model-upgrade.md](evidence-model-upgrade.md).

## Published and deployed revisions

| Scope | Code commit | Tested tree | Runtime |
| --- | --- | --- | --- |
| pilot-simple-alerts | `441d3ec294c0a7e89b12f916bd4d042c408d5cb1` | `41a71f73fe68906e4211f3ccdbdedea00a183b73` | Deployed on the four existing pilot services |
| main | `435c0f8de37194c132b239ee11ce041dc4f9e3af` | `0fce38da56af0c1cebb139245590dc964e1c8dcc` | Code updated; main scanning remains stopped |

Main received only the scoped evidence, model, review, accounting and supporting reliability changes, on its existing parent `5129218b77250791dd8f813d11ad8fe242d5a767`. The full pilot branch was not merged. The current 25-company cohort `small-ai-25-20261003-v1`, its source restrictions and quarantines were preserved.

Railway project `83d99341-d622-475f-8035-00ef3d0916d1`, production environment `87afb8d7-c4fc-4f84-92b6-5d2820a689b6` reported SUCCESS for all four code deployments created at 02:53:43 UTC:

| Service | Deployment |
| --- | --- |
| Web | `75a25700-a2c4-4f5e-87b2-a3c887b7633b` |
| Sensor | `7869f82d-e76f-4b06-a867-0f3dc12c4996` |
| Profiles | `72f9597a-73aa-45cd-ae6e-c92b3c028ba4` |
| Inert foundation | `4308eb79-addc-449b-8751-dd60e5bb6e0e` |

All four live sources are `pilot-simple-alerts`. The retired foundation has no active deployment, and the old queue-reset service is sleeping. Existing sensor and profile cron schedules, NEVER restart policy, and docs-only build exclusions remain. Postgres, service count and allocated infrastructure were unchanged. The unrelated staged telemetry patch `97789f67-b0f5-4cb3-b689-bd46c2b4c63f` was not accepted.

## Verified live behavior

The web process started successfully and the existing public `/api/health` returned healthy. No database migration was pending.

The first observed scheduled sensor run on the exact new code commit completed successfully at 03:01:51 UTC, HTTP 200, with a 22,760 ms cycle. It attested the 25-company current cohort, an eight-minute deadline, 45-second delivery reserve, 15-second reporting reserve and 335-second minimum time before admitting a paid review. Railway subsequently reported the cron execution succeeded at 03:01:55 UTC.

That run admitted zero cases, processed zero cases, made zero AI calls, and produced zero Serious Buy/Sell/Watch Out alerts. Its delivery consumer completed with no due jobs or outboxes. Shared rolling accounting reported $0 recorded spending, $0 reserved and $0 unknown exposure, a $10 limit and healthy accounting. These are the existing rolling ledger's current values, not a reset, and not provider-invoice verification. Processing and Committee failure rates are undefined with zero attempts, not proven zero.

The existing automatic isolated web-feed controls passed on exact commit `441d3ec294c0a7e89b12f916bd4d042c408d5cb1`: durable receipt verified, duplicate suppressed, negative control passed, test data excluded from the Serious Signal feed. External Telegram and webhook test delivery were disabled. Receipt:
`branch-labs/simple-alerts/cohorts/small-ai-25-20261003-v1/serious-signal/delivery-test/receipts/web_feed/499d0530b69123cd646e9d595a825d4c.json`.
This is an isolated control receipt, not a real approved investment alert.

The new profile deployment was ready with its existing schedule at verification time; its first completed new-revision production pass was not yet observed. Do not infer profile throughput from deployment success.

## Validation and remaining evidence

Type checking, lint, production builds and the relevant regression/smoke suites passed for both tested code trees before publication. Tests covered missing-source handling, source identity and provenance, meaningful-change review suppression, distinct review outcomes, supported model parameters, usage accounting and existing approval/budget gates.

Core reviewers now use `gpt-6.1-sol` with medium reasoning; the final judge uses `gpt-6-astra` with medium reasoning; simple supporting roles in the full/manual path use `gpt-6-luna` with low reasoning. Discovery, retrieval, profile extraction, valuation arithmetic and hard approval/delivery gates remain deterministic. There is no automatic downgrade to a weaker reviewer when budget is unavailable.

The $2.7538 maximum focused-review reservation is a conservative temporary hold, not an expected or observed charge. The same $10 rolling-24-hour cap and existing review-count limit remain. Actual model receipts must reconcile usage and cost after a qualifying case. The new revision has not yet demonstrated a completed live paid Committee review or new-model account access; do not report model configuration as proof of successful calls.

Missing real financial evidence may still prevent approval. The upgrade collects and exposes the required evidence; it does not create a valid opportunity. Keep observing real qualifying cases and current source/processing denominators. Remain at 25 companies until every existing scale-up gate passes. Main scanning must remain stopped.

Infrastructure retains its separate $20/month authorization; actual current Railway spending/forecast was not independently available. No new resource or paid subscription was added.
