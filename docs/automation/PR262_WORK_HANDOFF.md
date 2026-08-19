# PR #262 — ChatGPT Work Handoff

## Mission

Supervise PR #262 (`agent/combined-opportunity-engine` -> `main`) through merge readiness without adding new product features.

The goal is a production-safe U.S. Serious Signal system that detects material market/company changes cheaply, opens only affected companies for deep research, and can produce committee-verified Serious Buy, Serious Sell, and Serious Watch Out alerts before full market repricing where evidence permits.

## Feature freeze

From this point until merge readiness, do not add new scoring ideas, broad new sensors, new alert categories, or speculative architecture changes unless required to close an identified production blocker.

Allowed changes are limited to:

- correctness fixes;
- production deployment compatibility;
- security/authentication;
- notification delivery;
- provider entitlement/cost controls;
- performance/recovery safeguards;
- regression tests;
- documentation that makes the final architecture accurate.

Cloudflare Worker migration is explicitly deferred. Railway remains the current sensor owner.

## Current architecture

- Five-minute lightweight Railway sensor; no old always-on deep scanner.
- SEC/news/official/market sensors record deltas and deduplicate.
- Exact issuer mapping before specialist work.
- Targeted company refresh only.
- Historical cases are optional learning context, not a Serious Signal gate.
- 13 specialist roles + Final Judge for Serious Signal authority.
- Maximum 20 distinct committee reviews per rolling 24 hours; same evidence cannot be re-reviewed for 12 hours.
- Serious Watch Out has separate committee-verified authority.
- Persistent PR262 state is under the PR262 Cloudflare R2 prefix.
- PR remains draft and unmerged.

## Production deployment requirement

Production must keep two Railway services from the same repository:

1. Web/API service: `railway.web.json` — persistent app + database migrations.
2. Sensor service: `railway.sensor.json` — five-minute bounded cron.

Do not merge a configuration that turns the normal web application into a cron worker.

The current PR preview still depends on its branch-specific sensor deployment. Do not change the active default Railway config in a way that silently stops the live PR sensor until the separate sensor service has been attached.

## Security requirement

The PR preview may remain globally locked down, but production/main must keep the normal API surface alive.

High-risk internal routes must require explicit internal authentication, including:

- Serious Signal scanner triggers;
- AI Committee execution;
- live-alert mutation;
- publish-approved-alert;
- internal E2E/test mutation routes.

Do not rely on a branch-wide blocker as the only security control for a dangerous route.

## Notification requirement

A Serious Signal must be written exactly once to a durable outbox before delivery.

Immediate delivery can use Telegram/webhook first. Web Push for the home-screen Swing Up web app should use a standard push subscription + service worker and must require user permission. Email may be added when a production email provider is configured.

ChatGPT monitoring should use a sanitized read-only Serious Signal feed and may run hourly; it is not the immediate-delivery channel.

## Cost requirement

- quiet sensor cycle: zero AI calls;
- no repeat deep work for duplicate events;
- provider quotas/cadences hard-enforced;
- 20 distinct committee reviews/day maximum;
- same-evidence cooldown remains;
- add an independent daily AI-dollar emergency fuse;
- no source failure may trigger a full-market deep fallback;
- preserve queue capacity during busy markets instead of dropping events silently.

## Review passes

Review PR262 in these independent passes:

1. production/deployment architecture;
2. Serious Signal correctness;
3. security and data-write boundaries;
4. cost, performance and recovery;
5. existing-main regression risk.

For Serious Signals, verify exact issuer mapping, decision-grade source evidence, current quote/trading-halt state, committee completeness, Final Judge authority, contradiction controls and fail-closed behavior.

## Exact-final-commit test gate

The exact commit proposed for merge must pass, in order:

- TypeScript;
- lint;
- production build;
- deterministic source/event tests;
- Serious Buy/Sell tests;
- Serious Watch Out tests;
- security tests;
- five-minute sensor/deduplication/quiet-cycle tests;
- existing Swing Up pages and API regression tests;
- isolated Railway deployment test;
- one real end-to-end event reaching the Serious Signal outbox exactly once.

If any commit is added after the final review, rerun the affected checks and final review.

## Merge policy

- Keep PR draft until all blockers clear.
- Enable protection on `main` before merge.
- No auto-merge.
- Human approval required.
- Use a normal merge commit.
- Record the exact pre-merge `main` SHA as rollback point.
- Verify production after merge before declaring success.

After production verification, record: `PR262 is now canonical main; ignore the old PR branch as a source of current architecture.`
