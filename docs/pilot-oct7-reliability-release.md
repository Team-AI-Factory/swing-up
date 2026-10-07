# Pilot reliability release, 7 October 2026

This release follows `8db0d12aef6b23770a69dec696bb808f9806d3da` on `pilot-simple-alerts`. It preserves the fixed 25-company cohort, stopped main workers, source budgets, shared rolling $10 AI limit and 20-review ceiling. The separate staged Railway telemetry variable is not part of this code release.

## Observed baseline

The first source repair reached actual production on 7 October. At 00:48 UTC the sensor reported 21 current exact-issuer SEC snapshots, eight registered feeds, and two successful feed polls during that cycle. PGY and SERV filing cases completed four and five Committee roles respectively and remained insufficient-evidence cases. No serious alert was approved. Recorded shared spending was $4.691895 with no pending holds.

Profiles still failed at the 175-second boundary, including the 00:44 cycle with 33 attempts and one verified acknowledgement. Its source failure count was zero; storage finalization and unreconciled counts were separate failures. These observations justify the additional changes below. They are not post-release success evidence.

## Source and persistence corrections

- Reserve registry finalization time from the actual remaining source window. Preserve completed source observations when registry persistence fails, while reporting the failure and distinguishing observed results from durable registry state.
- Accept literal empty document names in otherwise complete historical SEC index rows. Actual INOD and TSSI HTTP 200 roots contained six such old rows. Blank-document rows never become events. Identity, aligned arrays, HTTP completeness and real acceptance timestamps remain required; filing-date timestamp fabrication is removed.
- Stop profile source/admission work before the persistence deadline. A bounded persistence window lets an already-started healthy conditional write finish, followed by a separate authoritative count read and bounded summary. Unknown writes remain failures, even when later counts are recoverable.
- Compress only the private profile-cache key through the existing transparent gzip codec. Decoded JSON and conditional-write intent remain identical; user-facing objects retain their existing format. Smaller payloads do not establish the cause of upstream HTTP 502 responses.
- Reuse complete, validated annual-source bytes and remove the intermediate profile metadata checkpoint. Existing durable admission, final row compare-and-swap, verification history, source quotas and failure backoff remain.

## Financial evidence and repeat decisions

All bounded collected financial comparisons reach the Committee prompts. The provider byte limit still rejects an oversized unique packet before a paid request. Requested debt must match the relevant current balance-sheet period, with original units and dates retained. No missing fact becomes a fabricated zero or proxy.

Completed approvals, rejections and `needs_more_data` decisions retain their distinct outcomes. The enduring evidence journal prevents another paid review of equivalent evidence across new daily IDs, clock expiry, restarts, policy-only changes and immaterial quote movement. It compares against retained past decisions, including A→B→A, rather than suppressing a company merely because its ticker was seen. Genuinely changed substantive evidence remains eligible under all existing gates. Partial or technical failures keep their bounded recovery and accounting holds.

An approved delivery requires matching durable decision proof and current publication gates. One immutable binding owns the canonical outbox for that evidence decision. Duplicate outboxes reuse its original job and receipts, including the original cohort namespace; they cannot create another feed item or send identity. Unknown legacy provenance cannot authorize a new send. Isolated controls remain separate from real alerts.

Strict typed zero-usage proof protects both review-count release and dollar reconciliation. Known partial use is charged; unknown or contradictory use keeps the unresolved upper bound. No historical charge, reservation or allowance is reset.

## Remaining eligibility and migration boundaries

The existing outbox gate still requires official source provenance. A valuation-only market-price receipt does not satisfy it merely because the Committee approved an analysis. This release does not relabel market-price evidence as an official filing or broaden that authority.

Legacy migration reads retained review records from the verified pre-journal pilot roots and the last valuation marker. It does not claim an exhaustive recovery of an unbounded historical archive. Missing evidence is preserved as unknown; it cannot manufacture a new paid case.

## Verification limits

Local regressions exercise real parsing, runner, conditional storage, journal, and delivery boundaries with isolated I/O. Release signoff also requires independent review, full type/lint/build checks, exact remote/deployment verification and actual completed live cycles. Registration is not a successful poll, a build is not a cycle receipt, and a provisional research card is not an approved serious alert. Neither a sustained 500 profiles/day nor a tenfold end-to-end improvement is established by local benchmarks.
