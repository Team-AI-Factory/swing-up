# Durable same-evidence review suppression

The simple-alert pilot keeps every completed approved, rejected, and fully completed `needs_more_data` decision in a CIK-bound R2 journal. `approved_pending_checks` retains the substantive approval without granting publication authority. Partial or technical failures remain on the existing recovery path. The dollar ledger, count limits, and existing cooldowns are unchanged.

`terminal-reviews-v1/` and `serious-signal/evidence-delivery-v1/` use the pilot base namespace across cohort changes. Preview/test namespaces remain separate. Journal updates use conditional ETags or create-only writes, validate integrity and all retained entries, and never expire or truncate terminal baselines.

## Evidence identity

A descriptor records canonical external source facts/documents, financial inputs, actual observed price/halt state, and frozen comparison levels. Its SHA-256 decision key excludes ticker aliases, generated daily IDs, retrieval timestamps, review policy/model versions, assumptions, and derived fair values. The descriptor validator still binds the exact ticker for delivery, while paid-review comparison uses the CIK.

Admission checks every retained baseline. Missing evidence and stale observations cannot demonstrate novelty. New source facts/documents, a material real price change (5%), a five-percentage-point gap move against the stored reference value, or a real crossing of a stored price threshold can qualify. Comparison uses frozen original levels, so an internal model change cannot manufacture a crossing. A return from A to B to A finds the original A decision, including across days, restarts, and cooldown expiry.

Publication uses a separate digest of the reviewed valuation/forecast output packet. An old approval cannot attest changed model targets. Replays spend no model budget and must pass the original substantive gate plus current issuer/profile/quarantine, source, quote, halt, financial-document, essential-fact, requested-current-period fact, and ordinary publication checks. A failed current check remains held.

## Persistence and recovery

A CIK-level conditional admission prevents concurrent equivalent paid reviews. The completed report writes a create-only receipt before appending its terminal decision. Every approved outbox requires a validated durable approval matching the canonical descriptor, fingerprint, and direction. New outboxes use the terminal decision key; equivalent daily aliases reuse the original outbox.

A restart or failed append recovers the terminal decision from its write-ahead receipt without buying another review. Failed, corrupt, or uncertain storage fails closed. An admitted attempt without a receipt remains an unresolved hold; elapsed time alone cannot prove that it did not complete. A returned technical/partial report or a definite pre-provider denial releases only this journal's pending admission. It does not erase any dollar or count hold.

## Bounded legacy migration

The migration reads the retained research-alert indexes (at most 100 rows each) and issuer valuation markers from a fixed, verified pre-journal catalog: the legacy pilot base root, `small-ai-25-20261003-v1`, and the current cohort. These old roots remain in the catalog after a cohort switch; all later reviews use the shared journal. Unreadable or oversized indexes fail closed. It requires exact CIK/fingerprint and explicit completed-review provenance, never just a budget reservation. Old cards whose unpaid refresh lost the completion flag but retained successful reviewer history are kept as explicit unknown-completion holds, including cards relabeled awaiting review. Known partial failures remain recoverable. New card writes retain a small versioned-plan completion proof across unpaid refreshes. A validated old valuation snapshot compares only facts it actually recorded; unknown price, scanner, gate and model metadata are not reconstructed.

For a retained old SEC-event card, matching event accession, CIK-bound SEC source URL, and original event date provide a sparse primary-source baseline. A different later original SEC accession can establish novelty. A changed retrieval date, generated queue ID, summary, or old accession cannot do so. Records without such provenance keep a conservative unknown-evidence hold. This is a bounded migration of retained records, not a claim to have scanned every historical archive object.

The public research-alert read projection collapses only exact CIK plus proven same fingerprints. It selects an intact row, preserves rejection priority, does not transfer approval to new quotes, and leaves stored histories and distinct evidence untouched.

## Local verification

- `node scripts/terminal-review-journal-smoke.mjs`
- `node scripts/terminal-review-runner-smoke.mjs`
- `node scripts/terminal-review-event-job-smoke.mjs`
- `node scripts/research-alert-read-dedupe-smoke.mjs`
- `node scripts/pr262-storage-namespace-smoke.mjs`
- `node scripts/valuation-review-admission-smoke.mjs`
- `node scripts/committee-usage-retention-smoke.mjs`
- `npx tsc --noEmit`

These use local source/provider fixtures and conditional in-memory R2 storage. They do not call paid models, publish alerts, or mutate live storage. Existing valuation-only outbox authority still requires the original publication gates; this repair does not widen it.
