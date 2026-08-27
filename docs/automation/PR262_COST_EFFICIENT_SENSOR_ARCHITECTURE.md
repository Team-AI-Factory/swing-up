# PR #262 — Production Sensor-First Architecture

## Current status

PR #262 uses Railway for the bounded five-minute sensor, targeted analysis,
delivery recovery, and daily foundation. Cloudflare R2 remains the durable
object store. A Cloudflare Worker shadow or ownership cutover is not part of
the production architecture and is not a merge requirement. The previous
always-on deep scanner is retired.

The active design is:

1. cheap central sensors detect deltas;
2. duplicate and low-materiality items stop immediately;
3. exact issuer/sector mapping identifies only affected U.S. companies;
4. only affected companies receive full-source and valuation refresh work;
5. only finalists enter the 13-specialist + Final Judge committee;
6. a committee-verified Serious Buy, Serious Sell, or Serious Watch Out is written once to the Serious Signal outbox.

Historical cases are optional learning context and do **not** gate Serious Signal authority.

The AI committee may review up to 20 distinct finalists per rolling 24 hours. The same evidence remains locked for 12 hours so duplicated headlines cannot consume the allowance repeatedly.

## Five-minute sensor policy

The five-minute clock is a detection clock, not a deep-analysis clock.

A quiet cycle must perform:

- zero AI calls;
- zero full-company warehouse rebuilds;
- zero repeated full-article reads;
- one compact cadence/provider-health checkpoint only;
- no full pending-queue rewrite when the important-event queue is unchanged;
- no immutable analysis result or company-refresh object for a routine
  `no_qualified_signal` outcome.

Only priority-80+ changes enter the durable queue. A detailed event result is
persisted only for a qualified finding, an actionable/Serious Signal, or a paid
Committee decision that needs an audit record. Small lease, idempotency,
provider-budget, and AI-dollar ledgers remain durable because they prevent
duplicate work and overspending after a restart.

High-value central lanes run at the fastest useful cadence supported by the source and our quota policy. Slower or quota-limited providers keep independent durable schedules. Provider failure must never fall back to a broad deep-market scan.

## Serious Signal authority

A Serious Buy/Sell requires current evidence, exact issuer mapping, materiality, a defensible causal path, contradiction/rumour/priced-in controls, a fresh actionable quote, known trading-halt state, complete committee execution, a positive Final Judge at confidence >=80, and committee approval.

A Serious Watch Out has its own approved deterministic risk families and requires the same committee integrity. Raw Watch Out findings cannot self-promote.

Historical analogs may improve forecasting but cannot block a signal based on strong current evidence.

## Production deployment architecture

PR #262 must **not** turn the normal Swing Up website into a cron job when merged.

Production requires the persistent Railway web/API service plus explicitly
separated sensor, recovery, and daily foundation configurations:

### 1. Swing Up web/API service

Use `railway.web.json`.

It keeps the persistent Next.js web/API application online and preserves production database migrations before application startup.

### 2. Railway sensor service

Use `railway.sensor.json`.

It runs `npm run pr262:cron` every five minutes, does one bounded cycle, and exits. It must not replace the normal web/API service.

This is the sole production source-sensor owner. Keep its five-minute schedule
active while projected Railway project cost is at or below the approved $30
threshold.

### 3. Railway analysis and delivery recovery service

Use `railway.analysis-recovery.json`.

The five-minute sensor performs immediate bounded analysis after discovery.
The hourly recovery job processes retained R2 queue work and delivery retries
without scanning sources a second time.

### 4. Daily production foundation service

Use `railway.foundation.json`.

It refreshes the production-only U.S. universe and resumable valuation batches,
then materializes an exposure index only after the entire value cycle is
complete. It has no database, AI, payment, publishing, or notification
credentials. A partial batch set can never be reported as ready coverage.

The repository default `railway.json` is restored to the persistent web/API
service. The sensor, recovery, and foundation jobs must be created as separate
Railway services that explicitly select their matching configuration files.

## API security boundary

The PR preview remains locked down: only health and the token-protected PR262 cron route are accessible.

On production/main, normal public application APIs remain available. High-risk internal routes—scanner triggers, AI Committee execution, live-alert mutation, publish-approved-alert and internal E2E actions—must require an internal token and return a non-disclosing 404 when authorization fails.

Publishing/notification routes must never rely only on a global branch middleware accident for security.

## Notification architecture

Serious Signal detection and user delivery are separate responsibilities.

A committee-approved alert must first be persisted to the outbox with a stable
identity. Delivery consumers use durable claims and receipts. External delivery
is honestly at-least-once; the webhook receives an idempotency key, while a
crash after Telegram accepts a message but before its receipt is written can
still cause a duplicate. A notification expires after 30 minutes by default
(and is hard-capped at two hours) so recovery never presents an old quote as
current. The authenticated web feed retains 48 hours of history.

Delivery channels:

- required immediate authenticated R2-backed Serious Signal feed;
- optional, explicit-opt-in Telegram or HTTPS webhook add-ons;
- optional hourly ChatGPT monitoring/summary over the same sanitized feed.

Native Web Push and email are optional future channels, not hidden fallbacks or
merge requirements. The implemented web/app surface is the authenticated live
feed; Telegram/HTTPS webhook delivery remains disabled unless explicitly opted in.

No raw candidate or unfinished committee result may be delivered as a Serious Signal.

## Cost controls

Mandatory production controls:

- no AI on quiet cycles;
- no repeated work for a previously seen event;
- provider-specific request budgets and minimum intervals;
- bounded response sizes and timeouts;
- 20 distinct AI Committee reviews per rolling day, with duplicate-evidence cooldown;
- an independent daily AI-dollar emergency fuse;
- bounded sensor cycle duration so one cycle cannot overlap indefinitely;
- queue retention/prioritization instead of silently discarding a burst of material events;
- cost/effectiveness metrics for provider calls, AI calls, queue age, duplicates skipped, cycle time, and Serious Signals produced;
- no automatic expensive fallback when a source is unavailable.

## Low-egress R2 policy

Cloudflare R2 remains the durable PR262 store, but Railway is the only compute
owner. Every PR262 job is locked to the exact `production/pr262/` namespace and
sets a global write fence to that prefix. The persistent web/API service keeps
its existing broader R2 policy because the rest of Swing Up owns other
namespaces; PR262's key resolver still fences all PR262 keys.

The large `sensor/state-v1.json` object contains only important queue data and
is rewritten only when that queue changes. The small
`sensor/cadence-v1.json` object retains schedules, readiness, and provider
health. Routine low-priority discoveries and quiet-cycle cost metrics are
logged in Railway rather than copied into R2. Detailed result, latest-result,
history, company-refresh, outbox, and delivery objects are written only for a
meaningful finding/change or a paid audit record.

The event-analysis hot path follows the same rule. Its durable completion
ledger contains only compact pointers for important findings and paid audit
records; routine no-signal outcomes, expired unread discoveries, and scheduled
retries do not rewrite it. Volatile leases, provider reservations, and
Committee reservations live in separate small runtime objects so a safety
checkpoint cannot resend the historical completion ledger. Queue outcomes are
batched once per cycle. A provider timeout that already has a durable
`next_retry_at` remains healthy deferred work rather than failing the entire
five-minute job.

## Merge blockers

PR #262 is not merge-ready until all of these are true:

1. the exact final commit passes typecheck, lint, production build and all Serious Signal safety tests;
2. production web/API startup and the five-minute sensor are separate services/configurations;
3. PR-only API shutdown behavior cannot block the normal production API;
4. all high-risk internal mutation/publish/committee routes have explicit authentication;
5. provider cadences and free-tier/commercial entitlement policy are finalized;
6. the independent daily AI-dollar emergency fuse is active;
7. notification delivery is outbox-driven, deduplicated and secure;
8. one explicitly labelled end-to-end delivery test has proved the exact
   issuer -> current evidence -> 14-member committee -> durable outbox -> user
   delivery path exactly once; a test must never be represented as a real
   market finding;
9. existing Swing Up pages/APIs pass regression testing;
10. main branch protection/required checks are enabled before the merge;
11. a final review is performed on the exact commit that will be merged, with no later unreviewed commit.

## Merge policy

- Keep PR #262 draft until the merge blockers are cleared.
- No auto-merge.
- Use human approval and a normal merge commit.
- Record the pre-merge `main` SHA as the rollback point.
- After merge, verify production web/API uptime, database migrations, several sensor cycles, notification delivery, duplicate prevention and AI/provider cost behavior before declaring PR262 canonical.

## Principle

Think of the sensor as a smoke alarm and the specialist engine as the fire department.

The alarm may check frequently because it is cheap. The expensive team moves only when a real alarm identifies where to look.
