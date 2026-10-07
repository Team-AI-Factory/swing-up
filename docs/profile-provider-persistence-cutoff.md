# Profile provider persistence at the work cutoff

A durable provider reservation or optional submissions-cache write can still be settling when the profile source-work cutoff is reached. Cancelling that write can produce `annual_filing` / `company_profile_storage_write_failed` even when no source request began. A timeout alone does not identify the failed storage object.

## Reproduced defect

On base `954a0e1`, `runSimpleAlertProfileBuilder` creates separate 140-second work and 160-second persistence signals. It supplies both to profile/source persistence, but only the work signal reaches `createPr262SensorBudgetedFetch`. That helper passes the combined work/request signal to its provider-budget reservation PUT and optional complete-submissions snapshot PUT. An in-progress write is consequently cancelled when work admission closes, even though persistence still has reserved time.

The new `simple-alert-profile-provider-persistence-smoke.mjs` uses the real builder, profile cache, provider-budget wrapper, R2 encoding, conditional-write recovery and signed transport. Only the clock, HTTP transport and universe fixture are substituted; no external requests occur. Before the fix, a reservation admitted at 139 seconds and acknowledged at 144 seconds produced `annual_filing` / `company_profile_storage_write_failed`, `Deadline 140000`, no source requests and a failed summary with reconciled counts. This establishes a reachable failure mechanism matching the observed failure class, not a specific production write.

## Bounded repair

- The profile builder passes its existing persistence signal to the provider wrapper. Other callers keep their current behavior.
- Reservation queue admission, ledger reads and pre-PUT checks remain work/request-bound. An already-started conditional reservation can settle within the persistence reserve, including the existing bounded exact-intent readback/retry rules. A settled reservation remains charged even if its source request can no longer start. Work is checked again before source network; conflicts do not initiate a new reservation after cutoff.
- Only a complete, validated submissions body received before source cancellation may enter snapshot persistence. Its original observation time is retained. On the opt-in profile path, snapshot storage failures retain R2 provenance and fail the run. Default sensor callers continue receiving the complete source plus the explicit cache-write-failed header on optional persistence failure.
- Profile storage-failure logs can now identify `provider_budget_reservation` or `submissions_snapshot` through an allowlisted context field. They do not include document bodies, headers or credentials.

The concurrent 100-second new-issuer admission cutoff is retained, as are the 140/160/175/235/240-second source-work, persistence, counts, summary and HTTP boundaries. Work admitted before 100 seconds can still reach a later provider reservation; the dedicated persistence signal protects only started settlement, never permission to start a source request after 140 seconds. Profile-row FIFO, four-PUT/15-second transaction ceiling, one-PUT/five-second cleanup bound, two-worker concurrency, source pacing, quota limits, attempt caps, cohort, source-quality rules and money limits remain unchanged. Independent R2 faults, unavailable ambiguity readback and persistence-deadline expiry still fail. Cache reconciliation cannot convert those failures into success.

## Verification

The deterministic matrix covers 26 cases: successful reservation/snapshot settlement after work cutoff; a second reservation already queued when work closes; cancelled admission read; conflict after cutoff; committed 502 verified by exact readback; retry with the original condition; applied and unapplied writes whose persistence deadline expires; applied and unapplied writes whose readback is unavailable; independent 403, repeated 502 and transport timeouts; and an incomplete aborted submissions body. The isolated persistence-expiry cases first verify a PUT was unapplied, then retry its original condition at 149 seconds, proving the 160-second persistence deadline stops that retry before its own 20-second request limit. Assertions verify source/network separation, no post-cutoff source start, conservative quota counts, source timestamps, uncertainty preservation, bounded writes, cache reconciliation and final summary persistence.

Validation on the isolated repair passed: all 93 reliability regression suites, the final 26-case provider-persistence matrix, the existing source-storage deadline and durable-provider-budget checks, TypeScript, zero-warning ESLint and a production build. The final runtime change also received a separate review of its admission, quota and ambiguity behavior.

The repair preserves the packet/legacy safeguards and the independent Simple Alerts R2 compression repair. It does not modify the R2 helper. Local tests and independent review do not establish production recovery; completed scheduled runs remain necessary evidence.
