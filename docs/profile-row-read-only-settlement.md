# Profile row settlement and early storage diagnostics — 7 October 2026

## Failure boundary

A timeout before the role cutoff can occur during profile-row storage. The repair handles only an exact acknowledged write; it does not identify the cause of a particular production incident.

The source explains why those observations are compatible with several paths:

- `ensureCompanyProfile` initially reads the shared profile object, then saves
  admission/backoff before source I/O. Both operations precede its normal
  company-result log. Verified-row persistence also precedes that log. Pending
  outcomes log before final persistence, so a pending line is not proof that
  its final row was saved.
- `store` puts FIFO waiting, read/CAS, readback, and retry delay inside its own
  15-second transaction deadline. That can expire well before the builder's
  100-second admission, 140-second work, and 160-second persistence cutoffs.
- The R2 helper preserves error name, message, and cause. A locally cancelled
  PUT can escape before the ordinary R2 recovery log. A failed lower readback
  is wrapped as `r2_state_write_reconciliation_failed`, which the outer row
  retry classifier intentionally does not replay.
- A returned failed builder summary produces HTTP 503. Startup daily-state
  read/lease claim and final-summary persistence errors escape that catch and
  normally produce HTTP 500. Provider initialization occurs before attempted
  increments. Authoritative count reconciliation is also inside the caught
  region and can fail after worker activity.

Source: `lib/opportunity-engine/company-profile-cache.ts`,
`lib/r2-warehouse.ts`, `lib/simple-alert-profile-builder.ts`, and
`app/api/internal/combined-opportunity-engine/cron-v3/route.ts` at the commit
above. No live R2 read/write or replay was used to infer the production cause.

## Reproduced failure class

The deterministic fixture uses the real builder, profile FIFO/CAS, R2 encoder,
signer, transport wrapper, and error provenance. HTTP responses and clock
advancement are local fixtures. It starts one admission transaction at 35
seconds: an applied PUT with a lost response reaches its 15-second deadline
and makes the run fail at 50 seconds. A later count read can see the saved row
but cannot acknowledge the failed transaction. An unapplied or still-unknown
PUT can produce the same error and timing. Final verified-row writes and
transient lower readback failures reproduce the same settlement gap.

This reproduces a possible mechanism, not a specific production request.

## Narrow repair

After an unresolved attempted normal profile-row PUT fails transiently, the
row helper may perform one fresh GET with a five-second maximum, composed with
the caller's existing, still-live persistence signal. It retains the local
FIFO lock and the immutable redacted JSON row. It acknowledges only an exact
matching target row in a valid object with a real ETag and a unique target.
Changes to other issuers are preserved. A different same-row value, missing
row, malformed object, missing ETag, duplicate target, unavailable readback,
or expired settlement/persistence signal remains a failed transaction.

Settlement never sends a PUT, replays source work, resets a ledger, or extends
a caller deadline. It requires an explicit persistence reserve, an unresolved
attempted PUT, and the current eligible fault. A lower conflict clears the
unresolved flag. Initial/queued/pre-PUT failure, permanent or schema failure,
429, exhausted conflicts, and caller expiry cannot enter settlement. The
known reconciliation wrapper is inspected through its actual current cause;
an old transient error does not excuse a later permanent failure. The special
deadline-cleanup transaction retains its complete one-PUT/five-second bound.

Normal mutations retain the existing four-PUT/15-second allowance. The new
read-only allowance can hold the FIFO for up to five additional seconds, only
inside the existing 160-second persistence window. An expired waiter still
leaves the FIFO and may not inherit the lock. Work admission and provider
quotas continue to govern any normal work after acknowledged admission.

Count reconciliation remains separate. It can report saved verification
counts after an unknown write, but never clears that failed write or an
independent source-cache failure.

## Diagnostics and validation

Failure/settlement-only `company-profile-storage` events contain controlled
row stage, operation phase, sanitized ticker, PUT count, queue/transaction
duration, cause code, deadline flags, and settlement outcome. Initial profile
GETs also receive an event. They contain no bodies, headers, credentials, or
raw exception strings. The builder summary records a controlled
`failureOperationFamily` to distinguish initialization, universe, profile
planning, profile workers, count reconciliation, and provider finalization.
The original caught family remains intact when a later count read succeeds.

`scripts/simple-alert-profile-row-settlement-smoke.mjs` contains 44 controlled
cases, run against both original f9 and the candidate. They compare applied,
unapplied, and unknown writes; transient versus permanent readback faults;
other-row and same-row winners; lower conflict followed by a read timeout;
missing ETag, duplicates, schema errors, local versus caller deadlines,
initial/pre-PUT failure, exact GET/PUT bounds, FIFO waiter cancellation and
later progress, and independent source-cache failure after pending-row
settlement. Existing persistent-readback tests still fail truthfully after
both their original readback and the one settlement GET are unavailable.

Publication, deployment, and a completed production run must be verified
separately. This repair does not claim that the underlying upstream timeout
cause has disappeared.
