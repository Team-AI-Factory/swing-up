# Pilot issuer coverage and profile storage recovery

Prepared 6 October 2026 on pilot head `bcbe2a15a96341cdbf3b1a356fdfab71d2fd21bd`.

The live pilot mapped all 25 issuers but had no registered direct feeds or dated exact-issuer SEC checks. Profiles also lacked complete historical and storage-failure accounting. The existing conditional R2 recovery, model input-byte correction, newer valuation evidence, runtime-deferral labels and framework security update are retained.

## Source coverage

- Register 25 official investor-relations roots and eight issuer-advertised RSS feeds. All eight returned HTTP 200 and parseable issuer RSS during independent 6 October checks. Registration itself is not a successful production poll.
- Rotate up to 13 exact-CIK SEC checks per cycle, independently of optional-feed discovery backoff. Existing provider quotas and per-issuer cadence remain enforced before network admission.
- Reuse only complete, exact-issuer HTTP 200 submissions snapshots under 29 minutes and 2 MB. Validate aligned filing arrays and acceptance timestamps; reject partial or mismatched roots. Reuse preserves the original source timestamp and consumes no new provider reservation.
- Keep 28-second SEC and 35-second collection targets, with a five-second registry finalization reserve inside the outer 45-second source cutoff. Request cancellation reaches private snapshot, budget-reservation and registry I/O. The existing 335-second paid-review admission check remains.
- Separate initialization catch-up from live-new event totals. Preserve original publication times and source URLs. TSSI's 6 October 12:00 UTC release and PGY's 5 October 12:30 UTC release are natural coverage checks; neither is a preapproved opportunity.
- Report pre-network storage/preparation faults separately from actual source requests. Real HTTP, body and network failures remain failures.

## Profile persistence and accounting

- Preserve known historical verification and explicitly mark unknown historical dates through failed refreshes. Repairs and ticker aliases cannot create another first-time company.
- Retain global conditional-write recovery. The profile row helper uses single-attempt transport calls under its own four-PUT/15-second bound; deadline cleanup gets one PUT/five seconds. No nested multiplication of retries.
- After an ambiguous write, accept identical persisted intent. Rebase unrelated rows only if the target issuer row still equals its acknowledged baseline. Never overwrite a newer or changed same-issuer row.
- Preserve read/write storage provenance, durable source backoff and original failure causes. A storage fault does not become a SEC transport failure.
- Reconcile production counts from durable cache rows after both workers settle. If the cache cannot be reread, report counts as unknown and retain the last known total. A failed run remains failed. Shared-cache changes during a run do not by themselves prove this worker authored every new row.

## Verification and rollout boundary

The combined 63-suite reliability aggregate and both pilot suites passed. Type checking, zero-warning lint, production build and focused real-cache/R2 and hanging-storage deadline tests passed; final post-review checks are recorded with the release.

Independent review covers source identity/freshness, cancellation, actual network denominators, row concurrency, historical counts and ambiguous-write recovery. Live 25-issuer freshness, successful feed polling, completed profile cycles and source provenance must still be verified on the exact deployed commit. The underlying upstream R2 502 cause is not established by recovered writes.

Fixed 25-company scope, shared rolling $10 AI fuse, shared 20-review ceiling, provider allowances, approval gates, source authenticity, HSAI unit guard and REKR buy quarantine remain. Main scanning stays stopped. No synthetic serious alerts, paid validation calls, external test deliveries or acceptance-counter resets are introduced. The older single-variable Railway telemetry patch is separate and is not committed by this source release.
