# Pilot storage recovery and valuation admission — 6 October 2026

Scope: bounded repairs on `pilot-simple-alerts`. Main scanning stays stopped. Preserve the current 25-company cohort, financing/compliance quarantine, currency/ADS exclusions, all evidence and approval gates, existing review-count limit, the single shared $10 rolling AI ledger and existing infrastructure.

## Observed failures

At 03:11 UTC the profile pass failed with `r2_state_write_http_502`. Three later scheduled passes succeeded, reaching 138 newly verified profiles today at 03:57 UTC; all 25 pilot profiles were verified. This demonstrates intermittent recovery, not removal of the underlying failure mode. The old versioned write helper made one PUT and threw on a transient response. It could not distinguish an uncommitted write from a committed write whose response was lost. The failed profile batch also skipped reconciliation of partial persisted work.

A separate deterministic regression reproduced a valuation admission gap: pilot identities correctly start without old foundation values, and the watch request already collects fresh financial fields, but market-watch thresholds still came only from the empty initial identity rows. A qualifying fictional test company generated zero valuation-review events despite a derived valuation gap. This was not proof of a quiet market. The fixture is isolated and never published as a real signal.

## Changes

- Conditional versioned R2 writes allow at most three PUT attempts inside a 45-second total deadline. After a transient 408/429/500/502/503/504 or recognized transport failure, back off and read the object directly. Identical saved bytes with an ETag acknowledge an already committed write. Unchanged old ETag, or continued absence for create-only, permits another attempt using the ORIGINAL condition. A competing write returns conflict; failed reconciliation does not replay. Unconditional writes and permission/configuration failures are not automatically retried. Long server cooldowns defer to the next run.
- Successful writes still use one request. Exceptional diagnostics include the object key, size, attempt, status and recovery outcome, without content or signing credentials. Missing response ETags cannot silently adopt a different writer's state.
- Profile workers settle together before reading persisted first-time verifications and failure reasons, even if one worker failed. Partial completed work is counted once by issuer; the batch remains failed. Existing lease, provider pacing, two-worker concurrency and daily attempt caps remain.
- Fresh, exact-issuer watch rows can now supply provisional valuation thresholds from the existing hardened calculation. Require a USD basis, at least two methods and confidence of at least 70. Reject ambiguous/wrong-issuer/nonprimary rows and unresolved currency/ADS basis. Financing quarantine still blocks upside. This uses the existing single cohort watch request, adds no provider subscription or scan, and does not import research backsolves.
- Existing same-day event IDs, at most three new valuation admissions per cycle and eight pending valuation slots remain. A threshold only admits research. It cannot certify a live quote, replace dated financial evidence, lower the Committee's approval criteria or publish an alert.

## Validation

The regression first failed on the old valuation admission path, then passed after the repair. Fault tests cover uncommitted 502, committed-but-lost responses, concurrent winners, unchanged ETags, initial conflicts, create-only ownership, retry exhaustion, unavailable read-back, missing ETags, compressed state, cooldown, cancellation, mutation fences and secret-free diagnostics. Partial-profile tests reconcile a persisted success alongside a failed peer without reporting a successful batch.

Type checking, lint and focused storage, namespace, provider-budget, shared AI-cap, profile transport/throughput, valuation, queue, event-job, financial-evidence and publication-safety checks passed. Deployment and completed-run verification must be recorded separately; these tests make no live paid calls and send no external test messages.

R2 references: [strong consistency](https://developers.cloudflare.com/r2/reference/consistency/), [retry and concurrency guidance](https://developers.cloudflare.com/r2/platform/troubleshooting/), [error codes](https://developers.cloudflare.com/r2/api/error-codes/). The actual cause of the upstream 502 is not established; this repair safely handles the observed failure class and supplies diagnostics for recurrence.

## Production verification

Published repair `5705075e8b9047d7411844091cbd9b33807941d7` matched tested tree `bbece6608203d2c8c3d58fa2333717201894b5d3`; all four pilot app services deployed successfully. The 04:30 UTC sensor admitted three natural valuation cases, demonstrating that the previously missing admission path now operates. PGY failed deterministic valuation risk checks; INOD's two successful Sol roles exposed a later prompt-accounting failure; UPST waited for available cycle time. No case was approved or published. See [the input-accounting repair](pilot-committee-input-recovery.md) and the 11:36 Bangkok maintenance entry in the launch log for the exact outcomes.

Framework-only successor `848cccca4ae4f6e2890c9c00f519268263ac4849` retained the storage/profile code. Its profile deployment `7ae4682c-1521-4212-b8f7-05e6c1a908c7` completed HTTP 200 at 04:41:45 UTC after 186,859 ms: 20 attempts, three verifications of which two were first-time verifications, **151 newly verified today / 500**, 349 remaining, and all 25 cohort profiles verified. There were 37 requests and one request failure (2.70%); provider deferrals and extraction/AIF gaps remain. No model calls were made. A successful run does not prove that the upstream 502 cause has disappeared; no real transient-write retry was observed in this pass.
