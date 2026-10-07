# Reservation-level valuation review materiality

The exact evidence fingerprint is unchanged. This repair adds a separate 12-hour valuation-only admission guard, evaluated before the outer dollar reservation and repeated inside the existing committee-count ETag compare-and-swap. It cannot grant publication authority or override an existing exact-fingerprint hold, the rolling $10 ledger, the 20-review daily limit, the lease, or any evidence/Committee gate.

## Reservation comparison policy

Compare with the latest admitted, potentially paid attempt for the same issuer. A new review may proceed through the existing gates when at least one condition holds:

- Source facts, source documents or their completeness, company evidence, currency, industry, actual model assumptions/method membership, or Committee policy changed.
- Direct scanner financial inputs changed at the precision available in the stored analysis: revenue, net income, free cash flow, diluted EPS, TTM/FY revenue growth, net-income/EPS growth, gross/operating/net margins, debt-to-equity, current ratio, return on equity, or return on assets.
- The actual eligibility gates, valuation direction, foundation action/tier, or trading-halt state changed; a previously stale quote became usable.
- Quote, low/base/high value, or a matched individual method estimate moved at least 5% relative to that admitted baseline, or the price-to-base gap moved at least 5 percentage points.

The 5%/5-point settings are a review-admission policy proposal, not an established financial materiality standard. Changes are measured cumulatively from the retained admission, never from the immediately previous unpaid scan. A fresh quote becoming stale or disappearing alone does not qualify; an absent quote is unknown rather than a genuine price-gap threshold crossing. Threshold/readiness deterioration can change visible evidence but cannot authorize a Serious Signal; existing safety gates still govern publication.

Price-linked P/E, P/B, P/S and EV/EBITDA ratios, market capitalization, continuous model outputs, generated scan IDs/text and retrieval timestamps are excluded from the exact financial-evidence component. Current production assumption templates contain sustainable multiples/yields, not interpolated quotes. Financial documents and method identities are canonicalized for comparison so mere ordering changes cannot purchase another review. The full old fingerprint still records exact model outputs without rounding or bucketing changes.

A material change is permission to continue admission checks, not a promise of another paid call. In particular, an unchanged old fingerprint can remain held by the completed-review marker or 24-hour dollar ledger even when this numerical comparator would permit a move.

## Persistence, failures, and migration

Each existing durable committee reservation gains an optional versioned baseline. The append and materiality recheck share the same ETag transaction. Incomplete, failed, or uncertain paid attempts retain that baseline and all existing recovery/accounting holds. The existing verified zero-usage rejection release removes only its matching reservation. No cleanup of unknown usage or historical charges is introduced.

Completed-review markers also retain the baseline and original admission time, separately from completion time. Unpaid observations cannot update them. A slow older completion cannot replace a newer admission. Reservation and marker baselines are ordered together by admission time, so an older completed result cannot veto a genuine change from a more recent partial paid attempt.

Legacy fingerprints, timestamps, markers, charges and holds are not rewritten or reset. A recent legacy valuation row with missing/unsupported baseline metadata is held until its known 12-hour boundary; unknown time is held conservatively. Existing fingerprint text can prove a direction flip even without a reconstructed baseline. Unknown opposite-direction rows cannot hide a newer same-direction admission. Malformed completed markers fail closed. Recognizable unknown-time valuation reservations are retained for that issuer's valuation guard; the existing global daily count continues to use dated rolling reservations.

The integrated release includes the separately reviewed conservative usage-retention repair. One strictly typed no-usage proof now protects both reservation release and dollar reconciliation. Contradictory, malformed or unknown usage retains the pending upper bound; known partial usage is charged and the unresolved remainder remains held. No old charges or unknown holds are erased.

A genuine separate event or catalyst stays on its original event path. No migration scan, retry-time refresh, or unpaid quote update creates a new baseline. A CAS loser after the dollar reservation returns a proven no-call outcome through the existing orchestrator release path; exceptions with uncertain outcome retain the existing conservative hold.

## Offline verification

- `scripts/valuation-review-materiality-smoke.mjs` recalculates generic and financial-specialist valuations with the production pure engine, including coherent price/ratio changes. It verifies that penny moves change the original hash but remain immaterial, and exercises the actual equity runner with an external-I/O/model trap.
- `scripts/valuation-review-admission-smoke.mjs` exercises durable reservation, concurrency, migration, budgets, leases, failure, and release behavior in memory.
- `scripts/valuation-committee-followup-smoke.mjs` covers paid marker immutability and admission ordering, plus existing publication and completed-review gates.

These tests use local fixtures and make no live model calls. This reservation layer is integrated with the separately documented permanent completed-evidence guard; passing or expiring this 12-hour comparison never overrides a durable approved/rejected decision on unchanged evidence. Release status must be verified from the exact deployed commit and runtime receipts.
