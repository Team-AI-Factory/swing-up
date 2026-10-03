# Pilot watch valuation reuse

## Failure confirmed

TradingView watch and targeted valuation requests use the same durable provider-account
budget (`sensor_tradingview`, 300 per rolling day) and cadence
(`sensor_tradingview_watch`, minimum 4.5 minutes). The pilot runs the watch first.
A targeted refresh immediately afterward therefore receives `minimum_interval`.
Repeating the cycle every five minutes repeats this ordering indefinitely.
The separate targeted 100/day and 15-minute-per-ticker guard does not solve that
shared-account scheduling conflict.

The controlled regression executes the real watch, valuation parser, shared budget
and cache with in-memory provider/R2 substitutes. It reproduces the conflict in
three consecutive five-minute cycles.

## Narrow remedy

Only the pilot watch asks for the existing targeted valuation column set in its
already-budgeted POST. It keeps the same cohort, one provider request, cadence,
and shared rolling quota. The main scanner and foundation job are not started.
The targeted request's own quota and cadence remain unchanged.

The watch can derive all configured pilot identities from a fresh official
SEC-backed universe without old valuation batches. Exact ticker, CIK, supported
exchange, share class and unique eligible issuer listing are required. Universe
identity freshness remains 24 hours. A narrowly reviewed SEC ADS filing can
supply the class metadata absent from SEC ticker metadata; it cannot override a
conflicting Nasdaq listing record. The companion directory change uses the same
identity rules and explicitly represents missing valuation.

The cohort watch stores exact provider rows through `pr262StorageKey`, so its
snapshot follows the cohort's storage namespace. Each new snapshot replaces the
prior snapshot; no old rows are silently carried forward. Duplicate, mismatched
and nonprimary rows cannot become valuation context. An older write cannot replace
a newer snapshot. Event jobs can reuse an exact row for at most 15 minutes, then
fall back to the existing bounded targeted/foundation behavior.

No provider quota or cadence namespace is added. A cache read spends no provider
reservation because it performs no provider request. The 30-hour foundation gate,
separate quote actionability gate, evidence requirements and shared $10 AI fuse
are unchanged.

## Timestamp and valuation authority

The scanner column set provides no quote/session timestamp or financial reporting
period. `receivedAt` records snapshot retrieval; `quoteObservedAt` and
`fundamentalPeriodAsOf` remain null and `liveQuoteVerified` is false. The analysis
carries an explicit retrieval-only `sourceTiming` warning through the runner into
the actual Committee evidence packet. The separate dated quote is unchanged.
A weekend fetch cannot manufacture a live quote or a new financial reporting period.

HSAI remains eligible for proven-identity monitoring. Its configured RMB financial
reporting and eight-ordinary-share ADS basis are not established by a USD quote
column. Until those units are proven, the event job withholds all scanner/cache/
foundation numerical valuation context for it rather than silently converting.

Quota-blocked targeted attempts now expose their actual guard reason and
`targetedRefreshNextRetryAt`. A cache reuse is labeled `cohort_watch_snapshot`,
not an event-targeted provider refresh.

## Offline verification

- `node scripts/pr262-pilot-watch-valuation-smoke.mjs`: three watches plus cache
  reuse consume exactly three provider requests; same 300/day and 4.5-minute guards;
  all 25 configured identities without foundation; 15-minute TTL; wrong/ambiguous/
  nonprimary identities; stale/future snapshots; ADS attestation and unit blockers.
- `node scripts/pr262-event-job-smoke.mjs`: cache reuse makes no targeted call,
  quota retry telemetry is preserved, unverified units cannot use any valuation path.
- `node scripts/equity-event-first-runner-smoke.mjs`: actual Committee-bound packet
  preserves retrieval-only provenance and separate quote time.
- Existing provider-budget durability, sensor bootstrap, value-engine/safety and
  reliability suites are also run with mocks. TypeScript and lint cover edits.

These are controlled offline results. They do not certify current provider
coverage or financial completeness for every live company. Deployment verification
must observe the already-scheduled watch's returned identities/cache coverage and
real event reuse. No additional live provider or paid AI calls are required by this
patch or its tests.
