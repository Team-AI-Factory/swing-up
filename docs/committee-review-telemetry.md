# Current attempts and retained Committee decisions

The terminal journal remains the authority for completed decisions and reuse.
Immutable paid-attempt receipts remain the authority for attempt reliability and
cost. Latest event-quality samples are bounded projections, not an all-attempt
ledger or complete historical coverage.

## Quality schema

New samples carry `reviewTelemetryVersion: 2` without changing storage keys or
the container format. Existing consumers retain the original field names:

- `committeeCompleted`, `committeeRolesCompleted`, `committeeRolesFailed` and
  the research card's `committee` summarize this pass only. An unpaid pass has
  no current completion and zero current roles. Missing diagnostics on a paid
  attempt are null, not invented zeroes.
- `historicalReview` identifies the validated terminal decision being reused:
  decision key, fingerprint, outcome, original event, recorded decision time,
  original Committee times/counts and optional result key. Missing provenance
  stays null. Reuse never fills current-event timing from historical dates.
- `lastPaidAttempt` retains this event's most recent known paid-path report,
  including original fingerprint, timestamps, roles and technical outcome.
  Unpaid collection/reuse cannot turn a partial failure into a success. The
  existing `openAiCalled` flag describes entering the paid path, not proof of a
  billed charge; the separate cost ledger is unchanged.
- `assessmentOutcome` describes this pass. `reviewOutcome` retains the known
  last paid outcome, otherwise an explicitly observed legacy technical failure,
  otherwise the current assessment. Bare paid flags with no outcome evidence
  produce `unknown_attempt`; explicit runner catch failures remain failures.
- `legacyReviewObservation` preserves old reported values with unknown attempt
  provenance. It cannot establish a paid attempt's date, identity or completion.
  A failure overwritten before this upgrade cannot be reconstructed from these
  mutable samples; no such reconstruction is claimed.

`completedCommitteeReviews` now counts unique sampled events whose latest
proven paid attempt finished in the sample's UTC day. Repeated unpaid refreshes
do not add completions; unpaid event aliases do not inherit an attempt; an
attempt finishing across midnight belongs to its actual UTC completion date.
Old retained attempts, missing completion dates and unversioned legacy
completion claims are excluded. `historicalReviewReusedEvents` separately
counts current assessments with validated historical provenance.
`unknownReviewProvenanceEvents` makes legacy/unknown coverage explicit. These
counts overlap where an event reuses known history but its older attempt is
unknown; they are not a partition or an attempt success denominator.

## Consumers and unchanged authority

- The evidence-quality reader recomputes these definitions from existing
  bounded samples, including for the public signals API.
- The research card keeps `completedReview` intact for legacy terminal-history
  recovery. Current-pass role totals no longer display a prior paid summary.
- Public signal projection adds only the review source and known historical
  decision date. Approval and publication eligibility still use the existing
  gates, not telemetry counts. Internal analysis diagnostics expose the
  historical decision/hold separately from the current paid Committee.
- Serious-signal delivery still requires its full Committee proof, approved
  terminal decision and existing current publication checks. Cost, count
  reservations, immutable receipts, dedupe and journal validation are unchanged.

No new storage reads, scans, writes, provider calls, scheduler jobs, token or
runtime limits are introduced. The existing bounded objects carry the extra
metadata; no live backfill or migration is performed.

## Local regression

`node scripts/terminal-review-telemetry-smoke.mjs` exercises the real runner,
role orchestration, journal, evidence writer and public projection with synthetic
providers and in-memory storage. It covers paid three-role failure followed by
four-role history reuse, immutable receipt preservation, genuine completions,
aliases, UTC rollover, missing dates, first-upgrade legacy failures, already
overwritten legacy ambiguity, missing paid diagnostics and the public shape
with three historical reuses and zero current-day completions.
