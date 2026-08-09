# PR #262 — Cost-Efficient Sensor-First Architecture

## Status and binding safety

PR #262 continuous Railway scanning is intentionally paused for cost control. The replacement system must not be enabled until its cheap sensor layer, delta storage, cost guards, and tests are complete.

The old pattern of running Watch Out, valuation batches, earnings analysis, relationship backfill, signal operations, and deep research on every broad poll is retired for PR #262.

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
