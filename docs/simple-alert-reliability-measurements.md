# Simple Alerts processing reliability

The cron response and bounded launcher summary now expose explicit processing and Committee counters. A transport-successful event job can still contain a failed required reviewer. Such a case stays queued with its immutable audit and partial token charges, but counts as a failed processing attempt and makes the cycle unhealthy. No approval, evidence, delivery, or spending gate is relaxed.

- `processingAttempts`: one non-idle event-job invocation. Each retry is a separate attempt; idle/busy probes and quiet cycles cannot dilute the denominator. A later error in the same invocation counts once.
- `processingFailures`: unsuccessful operations and technical analysis/reviewer failures, including an oversized final-judge request. Successful no-signal decisions and scheduled evidence/capacity deferrals are not technical processing failures.
- `committeeReviewAttempts`: conservatively admitted paid reviews, including partial calls and locally blocked required roles. This is not a count of completed assessments or provider invoice charges.
- `committeeTechnicalFailures`: reviews with failed or blocked required roles. Its separate rate prevents unrelated healthy source deferrals from diluting a high Committee failure rate.
- `committeeOutcomeUnknown`: an admitted review whose diagnostics do not establish completion or a known technical failure. Missing diagnostics cannot establish reliability.
- `nontechnicalDeferrals`: scheduled evidence/capacity retries without an identified processing failure. They remain unresolved work, not completed decisions.

Zero attempts produces a null rate, not a passing zero-percent result. Daily counters retain `processingMeasuredCycles` and `processingMeasurementStartedAt`; older cycles are not backfilled with invented successes. Daily totals alone do not prove two complete, non-overlapping 24-hour windows. Reconcile exact window logs, scheduled executions, unresolved cases, and receipt-backed decisions under the existing launch criteria. Source completeness, evidence latency, profile yield, delivery controls, cost headroom, and all expansion gates still require independent proof.

Regression coverage includes failed final judges with HTTP-successful retry results, valid incomplete-evidence/no-signal outcomes, idle exclusion, nonduplicated operation counts, unchanged cost reconciliation, no publication of failed reviews, legacy metric gaps, quiet-cycle accounting, and failed metric persistence.
