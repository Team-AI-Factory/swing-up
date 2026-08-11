# PR #262 — Cost-Efficient Sensor-First Architecture

## Status and binding safety

PR #262 continuous Railway scanning is intentionally paused for cost control. The replacement system must not be enabled until its cheap sensor layer, delta storage, cost guards, and tests are complete.

The old pattern of running Watch Out, valuation batches, earnings analysis, relationship backfill, signal operations, and deep research on every broad poll is retired for PR #262.

The replacement path is now implemented but remains dormant while the binding runtime pause is in place. Its only supported flow is:

1. poll bounded central event feeds with durable cursors;
2. map the affected issuer by official SEC CIK;
3. load that issuer's exact stored PR #262 company-analysis row;
4. read the full primary source, including SEC Exhibit 99.1/99.2 when applicable;
5. refresh only that affected company's stored value analysis;
6. check authoritative trading-halt and current-price evidence;
7. run the five-real-case historical gate before any paid reasoning;
8. run all 13 specialists plus the Final Judge only for a surviving finalist; and
9. write an undelivered R2 outbox record only after unanimous process completion and a positive Final Judge score of at least 80.

The event job processes at most one due material queue item per invocation. It refreshes one exact issuer, but does not rebuild the U.S. universe, poll broad feeds again, publish, notify, trade, or write to the application database. Repeated invocations use R2 leases, evidence cooldowns, immutable result keys, durable provider budgets, and a maximum of three committee reservations per rolling 24 hours.

### Binding runtime pause

The pause applies to all Railway runtime processes, not only the broad scanner:

- `railway.json` enters through `scripts/railway-pr262-cost-pause-start.mjs`.
- That PR-specific launcher always exits successfully without starting a web server, sensor, worker, or supervisor, even if Railway branch metadata is absent or incorrect.
- Both legacy supervisors reject the PR #262 branch before migrations, application startup, worker startup, watchdogs, or restart timers can run.
- The dedicated PR #262 sensor-worker executable is itself inert and exits successfully before polling anything.
- PR #262 is not a member of either legacy lab-branch allowlist and has no legacy `branch-labs/pr-262/` worker namespace in those supervisors.
- Branch middleware blocks every API route except read-only `GET /api/health`, so a stale web deployment, manual `npm start`, or Railway start-command override cannot invoke a scanner.
- The PR #262 change-sensor route and inherited branch-lab route reject this branch before either local-development bypass is evaluated.
- There is no environment-variable escape hatch that resumes PR #262 scanning. Re-enabling any runtime requires an intentional reviewed code change and corresponding safety-test update.
- The unconditional branch middleware is a deliberate draft-PR shutdown device and is a merge blocker: it must be removed or replaced by the reviewed activation design before any merge to `main`.

`npm run smoke:pr262-runtime-pause` executes all four possible start/worker entry points with the PR #262 branch identity and verifies that none launches `npm`. It also verifies the middleware and route barriers, checks the static ordering/allowlists, and ensures automatic GitHub workflow steps cannot contact the live PR #262 Railway preview.

### CI and live-preview policy

Push and pull-request workflows may run deterministic local typechecks, builds, and fixture tests. They must not poll live SEC/market providers, start a live-data route workflow, build a live calibration dataset, wait for the Railway preview, or POST to it. Those live diagnostics are restricted to an explicit `workflow_dispatch` run; this includes the Yahoo-backed external-volatility certification and the optional generic branch-preview smoke.

### Serious Watch Out boundary

The expanded deterministic Watch Out rules remain available for raw research/watchlist findings. They are deliberately prevented from becoming a committee-verified **Serious Watch Out** in the dormant event job until a same-run 14-member committee path, proof object, and dedicated tests are implemented. Buy/Sell cannot borrow a Watch Out result, and a raw Watch Out cannot be relabeled serious. This is a fail-closed capability boundary, not an implied approval.

## Goal

Detect material changes across U.S.-listed common stocks and ADRs quickly while spending almost nothing when nothing meaningful changes.

The system must separate **detection** from **analysis**:

1. Cheap sensors discover what changed.
2. Delta filters discard duplicates and immaterial updates.
3. Only affected companies are opened.
4. Only promising affected companies receive deep fundamental/event analysis.
5. Only finalists receive expensive committee reasoning and historical analog work.

No price move is required before a source-first catalyst can be investigated.

## Sensor layer — broad coverage without deep market rescans

### A. SEC and official-company disclosures

Use central SEC current-filing feeds to detect new 8-K, 6-K, 10-Q, 10-K, registration, financing, ownership, and other decision-relevant filings. A single central feed covers many issuers, so the system does not query every company separately.

Keep a durable cursor containing the newest filing identifiers already seen. On each poll, compare the feed with the cursor and process only unseen filings. Do not reread old filings unless a later filing explicitly changes the earlier thesis.

### B. Company announcements and investor-relations sources

Maintain a cached issuer-source registry for U.S. companies containing known investor-relations news, press-release, newsroom, RSS/Atom, earnings, and presentation endpoints when dependable sources can be identified.

Do not scrape every company site every few minutes. Use this hierarchy:

1. Central SEC/current-filing feeds for material issuer disclosures.
2. Central news/press-release discovery feeds that aggregate company announcements.
3. Direct issuer RSS/Atom feeds where available.
4. Direct issuer-page checks only for high-priority companies, scheduled earnings/catalyst windows, companies already on the quality-price watchlist, and companies recently changed by another sensor.
5. Slow background rotation to discover/refresh issuer-source endpoints, normally no more than once daily per issuer unless a near-term catalyst makes it higher priority.

Use ETag, Last-Modified, source IDs, publication timestamps, and content fingerprints so unchanged pages create no downstream work.

### C. News and public-information sensors

Use broad discovery feeds such as Google News RSS, GDELT, configured market/news providers, and reliable official/government feeds. Poll the central feeds, not thousands of individual company queries.

Store a durable event fingerprint from source URL, publisher, title, publication time, mapped issuer, and normalized event type. Duplicate syndications must collapse into one event family before deep reading.

Headlines and snippets are discovery only. A Serious Buy, Sell, or Watch Out still requires decision-grade source content.

### D. Government, regulator, macro, industry, and geopolitical sensors

Monitor central feeds from relevant government/regulatory sources already supported by PR #262, including SEC press releases, Federal Reserve, BLS, BEA, Federal Register, FDA/openFDA, Commerce, White House, CISA, State Department, Defense Department, and other dependable official feeds added later.

A macro/industry event is mapped only to companies with a plausible causal path. Do not deep-analyse every U.S. stock because one macro headline appeared.

### E. Market-price and volume sensor

Prefer one bulk/screener/market-wide endpoint when an existing provider can return many U.S. symbols in one request. The sensor flags only unusual changes, threshold crossings, gaps, abnormal volume, volatility, or a stored valuation-watchlist price crossing.

If only per-symbol quote endpoints are available, restrict frequent price checks to:

- companies already affected by a fresh event;
- companies near stored Buy / Strong Buy / Sell valuation thresholds;
- active Watch Out candidates;
- companies with near-term earnings or known catalysts; and
- positions/outcome checkpoints that actually need evaluation.

Do not poll every U.S. ticker individually every few minutes.

## Change detection and durable cursors

Every sensor keeps a small R2 state object containing the latest source cursor, source-specific ETag/Last-Modified values when available, last successful check, fingerprints already seen, and retry state.

A sensor poll must answer only:

- Did the source change?
- What new items appeared since the last cursor?
- Which U.S. companies are affected?
- Is the change potentially material?

If the answer is no, the run ends immediately with no deep content fetch, no company rebuild, no historical analog search, and no AI committee call.

If a provider temporarily fails, resume from the last durable cursor when it returns. Do not compensate with a full-market deep rescan.

Mapped, actionable retries and unresolved discovery items use separate queue partitions. Due mapped retries are ordered first and cannot be evicted by a burst of unmapped SEC filings; unresolved items have their own 500-item bound and expire after 24 hours. A fresh item is added to `seen` only after it is actually retained in a queue partition.

## Materiality gate before expensive analysis

A new item reaches deep analysis only when at least one of these is true:

- credible earnings/guidance change;
- material contract/customer/supplier development;
- acquisition, merger, divestiture, strategic investment, financing, dilution, buyback, or capital-allocation change;
- major product/technology/clinical/regulatory development;
- legal, recall, cyber, sanctions, fraud, accounting, governance, or balance-sheet risk;
- management change with plausible financial/strategic impact;
- meaningful macro/industry shock with an issuer-specific causal path;
- stored fair-value threshold crossing;
- abnormal price/volume/volatility behavior that matches an approved Watch Out rule; or
- another approved Serious Buy/Sell/Watch Out rule.

Cheap deterministic rules perform this gate first. AI is not used to decide whether an unchanged source changed.

## Company-first fundamentals

### Daily baseline

Run the full U.S. company/fair-value refresh no more than once daily, preferably outside the most time-sensitive market window. Persist normalized company fundamentals, quality scores, valuation ranges, and evidence timestamps in R2.

The daily batch is resumable and processes only companies whose stored baseline is stale or incomplete. It does not rebuild already-fresh companies merely because another sensor poll occurred.

### Event invalidation

Immediately mark an affected company stale when a new filing, earnings release, material announcement, financing, acquisition, major contract, regulatory event, or other thesis-changing event arrives.

Recompute only that company and any directly connected public companies with a documented causal relationship.

### Price-only updates

A price change normally does not require rebuilding the company's financial statements. Reuse stored fundamentals and recalculate only price-dependent valuation margins, threshold status, and signal gates.

## Deep-analysis funnel

For each new material event:

1. Map exact issuer and related public companies.
2. Read the primary/full source only for those candidates.
3. Compare the new facts with the stored company thesis.
4. Update affected fundamentals or valuation inputs only where the source changed them.
5. Check current price only after source-first understanding for source-first catalyst paths.
6. Search the historical library for at least five leakage-safe same-company or same-industry analogs when a serious Buy/Sell candidate survives.
7. Run expensive committee reasoning only for finalists.
8. Persist the decision, evidence fingerprint, timing, and later outcome checkpoints.

## Suggested low-cost cadence

These are target maximum frequencies, not a requirement to perform deep work each time:

- SEC current filing index: 1 minute when enabled, central-feed delta only.
- High-value official feeds / press-release aggregators: 1–2 minutes where the source is cheap and supports incremental reads.
- Broad news discovery: 2–5 minutes using rotating central queries and durable deduplication.
- Bulk market anomaly sensor: 1–2 minutes during U.S. market hours if a true bulk endpoint is available; otherwise use candidate/watchlist-only quotes.
- Direct issuer IR feeds: high-priority issuers 2–5 minutes; ordinary issuers slow rotation, normally daily unless a scheduled catalyst is near.
- Full U.S. fundamentals/fair-value baseline: once daily or immediately after an invalidating event for the affected company only.
- Historical outcome/learning maintenance: batch after market close and at due checkpoints, not every sensor poll.

## Cost controls

The following are mandatory:

- zero AI calls when no new material event survives cheap filters;
- zero full-company fundamental rebuilds when stored inputs remain fresh;
- no immutable full scan record for an empty sensor heartbeat; store compact sensor health/cursor state instead;
- no deep article/page fetch for duplicate or immaterial events;
- cache successfully read full content and primary filings;
- retry unavailable full sources for up to seven days, then archive them explicitly as unread with no candidate, historical-finding, committee, or outbox authority;
- resolve and validate every non-SEC source redirect, then pin the validated public IP address into the HTTPS connection to prevent DNS rebinding toward a private destination;
- reuse stored company fundamentals, relationships, historical analogs, and valuation inputs;
- provider-specific call budgets, retry backoff, and cadence guards;
- daily and rolling cost counters for external APIs and AI calls;
- hard stop/degrade-to-cheap-sensors mode before a configured cost ceiling is exceeded;
- never fall back from a failed cheap sensor into an expensive full-market scan.

## Catch-up safety

A cheap central-feed system must not lose events during downtime. Every source cursor stores enough information to resume from the last successful point. After downtime, the system performs a bounded catch-up window and deduplicates everything already seen.

A periodic reconciliation job may compare recent source windows against stored fingerprints to detect missed events, but reconciliation remains source-index based and must not trigger a full-company deep analysis for unchanged companies.

## Detection principle

The system does not need to walk into every room every five minutes. It watches shared alarm panels that report which room changed. When an alarm names a company, Swing Up opens that company's stored file and sends the specialist analysis only there.

The objective is not fewer detections. The objective is **cheap broad detection plus narrow expensive analysis**.
