# PR #262 — Production Sensor-First Architecture

## Current status

PR #262 is active in its isolated Railway preview as a bounded five-minute sensor cron. The previous always-on deep scanner is retired.

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
- compact cursor/dedupe/provider-budget state only.

High-value central lanes run at the fastest useful cadence supported by the source and our quota policy. Slower or quota-limited providers keep independent durable schedules. Provider failure must never fall back to a broad deep-market scan.

## Serious Signal authority

A Serious Buy/Sell requires current evidence, exact issuer mapping, materiality, a defensible causal path, contradiction/rumour/priced-in controls, a fresh actionable quote, known trading-halt state, complete committee execution, a positive Final Judge at confidence >=80, and committee approval.

A Serious Watch Out has its own approved deterministic risk families and requires the same committee integrity. Raw Watch Out findings cannot self-promote.

Historical analogs may improve forecasting but cannot block a signal based on strong current evidence.

## Production deployment architecture

PR #262 must **not** turn the normal Swing Up website into a cron job when merged.

Production requires two independently configured Railway services from the same repository:

### 1. Swing Up web/API service

Use `railway.web.json`.

It keeps the persistent Next.js web/API application online and preserves production database migrations before application startup.

### 2. Serious Signal sensor service

Use `railway.sensor.json`.

It runs `npm run pr262:cron` every five minutes, does one bounded cycle, and exits. It must not replace the normal web/API service.

The current PR preview still uses the branch-specific default `railway.json` so the live PR sensor is not interrupted before the separate production sensor service is attached. Before merge, the production Railway services must explicitly point at their separate configuration files, or the repository default must be restored to the web service configuration after the sensor service is safely separated.

## API security boundary

The PR preview remains locked down: only health and the token-protected PR262 cron route are accessible.

On production/main, normal public application APIs remain available. High-risk internal routes—scanner triggers, AI Committee execution, live-alert mutation, publish-approved-alert and internal E2E actions—must require an internal token and return a non-disclosing 404 when authorization fails.

Publishing/notification routes must never rely only on a global branch middleware accident for security.

## Notification architecture

Serious Signal detection and user delivery are separate responsibilities.

A committee-approved alert must first be persisted to the outbox with a stable identity. Delivery consumers then send it through configured channels and record delivery state so retries cannot create duplicate notifications.

Target channels:

- immediate Telegram or another webhook-capable phone channel;
- Web Push for the installed/home-screen Swing Up web app after the user grants notification permission;
- email when a production email provider is configured;
- a sanitized read-only Serious Signal feed for hourly ChatGPT monitoring/summary.

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

## R2 and future Cloudflare option

Cloudflare R2 remains the durable PR262 store.

A future optimization may move only the lightweight sensor/state layer to Cloudflare Workers with a native R2 binding. Deep source analysis, valuation and committee work should remain on Railway. This migration is optional and is **not a merge prerequisite** for PR #262.

Until that migration is explicitly approved and shadow-tested, Railway remains the sensor owner.

## Merge blockers

PR #262 is not merge-ready until all of these are true:

1. the exact final commit passes typecheck, lint, production build and all Serious Signal safety tests;
2. production web/API startup and the five-minute sensor are separate services/configurations;
3. PR-only API shutdown behavior cannot block the normal production API;
4. all high-risk internal mutation/publish/committee routes have explicit authentication;
5. provider cadences and free-tier/commercial entitlement policy are finalized;
6. the independent daily AI-dollar emergency fuse is active;
7. notification delivery is outbox-driven, deduplicated and secure;
8. one real end-to-end event has been observed exactly once through sensor -> exact issuer -> decision-grade evidence -> targeted refresh -> 14-member committee -> Serious Signal outbox;
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
