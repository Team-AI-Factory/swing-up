# Backlog recovery: 23 September 2026

## Verified production diagnosis

Between 22 September 05:05 UTC and 23 September 03:18 UTC, 111 logged sensor/recovery cycles returned HTTP 200. They recorded 14 paid Committee attempts and no approved Serious Alerts. Complete event diagnostics independently verified 12 completed reviews; two attempts lacked complete diagnostics because long log lines were truncated. The queue grew from 213 to 408. Company-profile gaps accounted for 532 of 612 repeated deferrals.

The daily foundation completed on 23 September with 4,954 companies, 3,319 estimates and 1,635 missing estimates. Of the estimates, 2,396 were fundamental estimates, 783 needed validation and 140 were preliminary peer comparisons. Missing categories were 1,196 non-positive earnings/cash flow, 296 missing inputs and 143 specialist inputs. These categories cannot all be solved by more downloads. Models and sufficiently supported assumptions remain necessary.

The broader SEC directory had 9,897 entries, 82 verified profiles and 36 profiles with stored industry. These are different denominators from the foundation. The prior day's profile counts were 63 and 16. At 19 additional verified profiles per day, full directory coverage is plainly not a near-term completion promise; the improved rate must be measured after deployment.

## Root causes and this patch

- Expensive event work previously fetched source documents, halt evidence, quotes and financial data before discovering that the issuer's business description was unavailable. A single cached profile-readiness pass now holds those events outside the expensive admission path, with at most one discovery allowance per cycle. They remain in the existing queue.
- Old retries could take priority over new events from the same source. The admission order now gives three fresh, profile-ready events a turn and then one retained event. A newly verified profile can wake its own profile-blocked event; other provider and paid-budget restrictions remain authoritative.
- The per-cycle admission ceiling remains 12. The release changes admission order so profile-ready work gets the existing capacity without increasing paid infrastructure.
- Profile maintenance retains the current two-company ceiling, with two independently refilling issuer slots and request starts paced at 250 ms. Fresh queued issuers receive first priority, then current valuation candidates, and one background selection remains available. The 30-second maintenance deadline now also aborts requests waiting to start. The existing SEC metadata ceilings remain 190 and 400 per rolling day; commercial provider caps are unchanged. SEC fair access still applies (https://www.sec.gov/about/developer-resources).
- The independent paid-review count ceiling remains 20 per rolling day, and paid review stays disabled until the all-provider monthly guard is verified below the authorized total.
- Generated valuation receipts included changing quote and scan times in their evidence hash. Hashing now uses stable financial facts, model ranges and threshold state. Small quote ticks and reordered facts cannot manufacture a new paid-review opportunity; genuinely changed filings, facts and threshold conditions remain distinguishable.
- Loading saved queue records discarded their original firstQueuedAt field. It is now retained and validated, allowing actual queue-to-review latency reporting for new records. Missing legacy times stay unknown.
- Compact per-review logs preserve completion, failure, approval and blocker counts before the large response is truncated. Compact cycle logs distinguish profile-blocked events from profile-ready events.
- Missing annual reports are searched in up to two exact SEC historical index files named by the verified issuer's submissions response. Wrong-issuer and arbitrary URLs cannot be followed. Parser revision 5 handles actual customer lists and explicit no-product-revenue statements for pre-commercial developers. Saved sources are reconsidered automatically after the parser revision.
- When a request for an additional financial fact fails, still-fresh, correctly mapped cached facts survive with their original dates and a visible incomplete-refresh status. Missing requested comparisons remain missing.
- The event path can retain a recent foundation company's currency, industry and financial context even if no fair value was calculated. Valuation-only admission still requires valuation evidence.

## Negative-earnings policy authorized on 23 September

Do not fill missing loss-making-company estimates with peer comparisons merely to increase coverage. Model revision 3 records `negative_earnings_deferred` separately and revisits earnings during the normal financial refresh. Existing independently calculated estimates are retained; this status never excludes event screening. The previous 1,196 non-positive earnings/cash-flow bucket is not an exact negative-earnings count and must not be relabeled as one.

For an event with a documented loss in dated, issuer-matched SEC company facts, the alert may proceed without unsupported fair-value scenarios. It still needs the company description, industry, recorded price/currency, appropriate quote freshness and halt evidence, material event evidence, direction and full selected Committee/Final Judge approval. Profitable issuers, unknown earnings, wrong issuers and valuation-only triggers cannot use the exception. A later profitable reporting period removes the loss exception.

Public cards and delivery text explicitly explain the earnings-model limitation. Absent target prices and percentage returns remain null. If historical event scenarios are independently supported, display them as event scenarios. Evidence metrics mark price scenarios inapplicable only for the verified exception and count these exceptions separately, never as completed numeric forecasts.

## Backlog reset

This patch does not erase pending events, seen IDs, source caches, results, spending history or delivery records. The existing duplicate and expiry policies continue to apply. A blanket reset would discard potentially useful events and would not fix profile availability. Keeping blocked evidence separate in scheduling provides a fresh working lane without destructive deletion. Any later bulk archive/reset should first preserve a restorable snapshot and explicitly define which events are being retired.

## Recent work already deployed before this patch

- PR300, 21 September: focused Committee reviewers, truthful token-based accounting, removal of the $0.75 unknown-usage charge estimate, better 429 classification, market-session-aware price handling and bounded source/network recovery.
- PR301, 21 September: recover incomplete saved company-business excerpts.
- PR302, 21 September: complete company/industry/three-scenario/percentage alert details and reuse fresh daily foundation values during provider cooldowns.
- PR303, 22 September: expand accounted valuation coverage by approximately 401 estimates, add quality/missing-input categories, improve company description parsing and saved-source recovery.
- PR304, 22 September: preserve saved filing references across metadata failures and provider backoffs.
- 23 September: an enabled daily 08:00 Asia/Bangkok progress report replaces the disabled condition watch. First scheduled delivery is 24 September; scheduling confirmation is not proof of delivery.

## Release and acceptance

This file describes a prepared patch, not a claim of production deployment. Merge only after the required checks pass, then deploy the existing four services without applying unrelated Railway environment changes. Keep foundation, sensor and recovery schedules unchanged. Do not mutate Postgres or change secret/billing settings.

Check the first two worker cycles after deployment, then compare at least 24 hours of profile recoveries, useful admissions, backlog age, provider deferrals, cost and alert receipts. Success requires evidence-ready events reaching completed reviews promptly; a smaller displayed queue or successful deployment alone is insufficient. Coverage for every company and a continuous supply of valid market opportunities have no honest fixed completion date with the current evidence gaps.

Validation covers 20 reliability suites, negative-earnings event admission/publication and exclusions, queue selection/preservation, two-issuer paced profile recovery and cancellation, historical filing lookup, financial cache fallback, valuation coverage, TypeScript checks and the production build. Record actual passing results for the final commit before publishing; remote CI and production observation remain release gates.

Local verification on 23 September: the 20-suite reliability runner passed; all 38 deterministic smoke checks listed in the merge-certification code job passed; full-repository lint, TypeScript and the production build passed. Database migration rehearsal and remote GitHub checks remain unrun in this chat. No paid model requests or external alerts were sent by these tests. GitHub publishing is unavailable; production is still on PR304 at the last Railway check. The user's deployment approval is already present, so obtaining the connection is the remaining publishing prerequisite, not another request for deployment permission.

## Follow-up: distinguish blockers and enforce the ready lane

The live sensor's 23 September 06:48 UTC log showed 441 pending events, 433 due by time/identity, 8 waiting for a scheduled retry, 379 due SEC/official events and 424 high-priority events older than 30 minutes. The oldest due source was about 2,843 minutes old. These are pre-release observations. The earlier 210-event snapshot is not the current baseline, and 'due' is not proof that essential evidence is complete.

Additional repairs in this release:

- Profile recovery uses two independently refilling slots instead of waiting for each pair to finish. A slow first issuer no longer idles the second slot. The twelve-issuer ceiling, 250 ms request pacing, source checks, retry backoffs and maintenance deadline remain in force. Fresh SEC/official issuers lead other fresh candidates; one background slot remains.
- The queue selection routine now obeys the prepared ready-event list. Its legacy preference for a valuation case and older retry migration cannot reintroduce unplanned blocked cases. An exhausted ready list returns idle. Fresh ready official events lead other fresh candidates while the three-to-one fresh/retained allocation preserves old useful work.
- Review denial now preserves the actual reservation reason. `same_evidence`, `ai_budget`, `review_capacity`, `ai_provider`, `accounting_unavailable` and `reservation_unclassified` are distinct. Missing company profiles remain `missing_profile`. Old generic denials stay unclassified rather than being reported as exhausted dollars.
- Compact logs include per-cycle deferral counts and per-event blocker details. The result list retains every admitted attempt within the existing 12-item ceiling instead of silently cutting diagnostics. Profile-ready queue age is also reported; legacy rows without firstQueuedAt use source time, not an invented queue-entry time.
- A failed durable Committee reservation write cannot admit a paid call. Event-path profile requests now inherit the enclosing job's abort signal.

Follow-up validation: 20 reliability suites, all 38 deterministic certification checks, full lint, TypeScript and a production build passed again. Added assertions exercise a slow issuer alongside continuing recovery, exact duplicate-versus-dollar denial reasons through actual event jobs, and the real queue selector refusing to override an exhausted/ordered ready list. Tests used mocked external I/O and sent no paid Committee request or external alert. Remote CI and the database migration rehearsal still need to pass on the published pull request.

The existing 08:00 Asia/Bangkok morning report remains enabled. A separate hourly recovery progress monitor was enabled on 23 September, starting at 14:30 Asia/Bangkok. It checks deployment revision, verified recovery successes, distinct blockers, ready-queue delay and real approval-to-delivery receipts; it reports material progress and regressions. Scheduling confirmation is not proof a notification has been delivered. One successful cycle is not proof of consistent operation.

## Browser upload when no GitHub connection is available

The prepared browser-upload archive contains only the changed source, test and documentation files under four top-level folders: `components`, `docs`, `lib`, and `scripts`. It contains no credentials, dependency folder, runtime data or complete repository history. Its base is main at `0d4778a67da52570d0ec54076cf5a8c7e44478da`, confirmed with a fresh remote read on 23 September.

In GitHub, create a branch from that main revision, upload the four folders at the repository root, commit and open a pull request to main. Verify the branch still starts from the expected base before upload; if main changed, reconcile those changes rather than overwriting them. Required checks must pass on the uploaded commit before merging. Uploading these files does not authenticate this chat to GitHub. Production remains unchanged until the merge and the existing four service deployments are verified.

After publication, compare the uploaded files with the tested release, review remote check results, merge when green, and deploy the existing Railway services. Do not apply the unrelated staged environment patch. Observe two post-deployment cycles and a rolling day. Company-specific recovery for BIOX, NWS, QUIK, ALKS and NAMM and the first genuine approved Serious Alert plus delivery receipt remain production acceptance checks, not achievements asserted by this document. Keep the paid-data purchase decision pending until the corrected workflow exposes a measured source gap.
