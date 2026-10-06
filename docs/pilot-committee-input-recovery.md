# Pilot Committee input accounting — 6 October 2026

The first normal sensor cycle after valuation-admission repair `5705075e8b9047d7411844091cbd9b33807941d7` admitted INOD, PGY and UPST. At 04:33:50 UTC it completed HTTP 503: INOD had two successful `gpt-6.1-sol` responses, then the skeptic was blocked at 60,997 counted bytes against 60,000. Final judge was blocked. PGY failed deterministic business/valuation risk checks without a paid call; UPST waited for the next cycle's review capacity. None is a Serious Alert.

The shared ledger reconciled the partial review to $0.092157 recorded cost, zero remaining reservation and zero pending exposure. Actual usage was 28,848 prompt tokens and 2,004 completion tokens from two Sol responses. These receipts prove paid Sol access and accounting; they do not prove a complete Committee decision or a successful Astra call. All three configured models were visible in the read-only models check. Exact-commit isolated positive/negative/duplicate delivery controls passed and produced a test-only receipt excluded from live signals.

## Repair

The provider previously measured `JSON.stringify(messages)`, which counts an additional layer of escaping used only by the HTTP transport. The API decodes that layer before the model receives the message content. Measure actual UTF-8 content bytes, plus conservatively serialized empty-message role framing and the complete response schema. Keep the same 60,000-byte input ceiling and separate 1,000-token framing allowance used by cost reservations. Truly oversized text or schema still fails before any paid request; no truncation or increased budget is introduced.

Later reviewers receive all earlier verdicts, findings, source references, concerns, missing-data requirements, status, model and error details. Per-response token-usage telemetry remains in the complete durable results and cost ledger, and is no longer repeated inside the investment-evidence prompt. Evidence text, dates, amounts, units, sources and reviewer blockers are unchanged. No model downgrade, output-limit reduction, ledger reset, queue rewrite or policy-version bump is required for this technical retry.

## Verification

A synthetic regression reproduces the transport-overcount class: 63,953 transport bytes contain 55,147 input bytes. The model receives exactly the original content. True oversized multibyte input and oversized schemas remain blocked without network calls, and the maximum focused-review hold remains $2.7538. This is a representative regression, not a reconstruction of the full historical prompt.

Provider/model-policy tests also verify complete cost receipts after excluding billing telemetry from later prompts, retained reviewer blockers, strict analyst schema, exact model routing, cancellation, technical failures and the shared budget contract. The existing lossless evidence-reference round-trip regression continues to pass with the corrected input-byte measurement. Deployment and the next complete natural review must be checked separately before claiming runtime recovery. Preserve the current 25-company cohort and all scale-up gates; main scanning remains stopped.

## Deployment

Published `c3641df7e323ae4678b95bfc8861755546b1f339` matched tested tree `5de7d6f6bdc9130f7ee3c81ef3313545ffefb3ff`, including a successful production build. It preserves concurrent maintenance documentation commit `ba88a8727593e3a97778bdd1e9cb3b8f8240481e`.

All four exact-commit Railway deployments succeeded by 04:47 UTC: web `a69a16da-a9c3-459f-a351-487e58c6d5b8`, sensor `d5ae83a2-507f-4caa-9dfc-c76d9165c4b6`, profiles `26f1daf0-1a78-4d16-be6f-8f48a62deaf8`, inert foundation `36337745-439e-4ebb-9b12-eeb842f43e3c`. The normal sensor run started at 04:46 UTC. Its isolated authenticated web-feed positive/negative/duplicate controls passed at 04:46:39 UTC, with test-only receipt `branch-labs/simple-alerts/cohorts/small-ai-25-20261003-v1/serious-signal/delivery-test/receipts/web_feed/b7d82a18e18c58b1279199c771772719.json`. Test data remains excluded from live Serious Signals; external test channels were disabled.

## Completed live review — 11:49 Bangkok

The exact new sensor completed HTTP 200 at 04:49:16 UTC (149,995 ms), with one real Committee assessment, zero technical review/processing failures and zero Serious Alerts. UPST's analyst, valuation, skeptic and final judge all completed with `finishReason=stop` and reported usage. Three responses were from `gpt-6.1-sol`; one was from `gpt-6-astra`. This verifies real paid access to both core and final models. Luna was visible in the read-only model check but was not called by this focused review.

The decision was **insufficient evidence**, not approval. Reviewers require the half-year earnings/cash-flow bridge, loan-adjusted sustainable cash flow, debt/maturity/recourse details, diluted-share reconciliation and justified growth/ROE/multiple or EBITDA-to-equity assumptions. Financial-document presence does not prove that these questions are answered. All four roles completed in 94,696 ms; queue-to-completed-review time was 18.18 minutes. The latest-available quote was originally observed at 23:58:07 UTC on 5 October, about 291 minutes old when assessed; fetching it again did not make it executable current evidence.

The durable nonterminal audit is `branch-labs/simple-alerts/cohorts/small-ai-25-20261003-v1/event-job/nonterminal-audits/2026-10-06/valuation-9cedfa60bc5e49480c3ab9da-782c4aa5e56829892540102b.json`. It records a completed review requiring follow-up, not a terminal trade signal, outbox or delivery receipt. The event remains queued for evidence follow-up. Avoid another paid review without meaningful new evidence under the existing shared ledger and suppression policy.

The ledger recorded **$0.330928** for this complete review from 50,324 prompt tokens and 3,941 completion tokens, including 50,312 reported cache-write prompt tokens and 2,441 reasoning tokens already included in completion usage. Rolling totals are **$0.423085 recorded**, zero reserved, zero pending/unknown exposure and $9.576915 remaining under $10. All reported model pricing was verified by the application; provider invoice access remains unconfigured. No cap or allowance was reset or expanded.

SEC urgent, halts and market watch had zero failures in three source operations in this run; direct-issuer discovery was not due and its existing 25 missing-website records remain unresolved. No new valuation events were admitted; the two pending cases remained queued, and no queue hygiene drops occurred. The daily totals still include the earlier failure: one processing failure in four attempts and one technical Committee failure in two review attempts. One successful run does not pass the two-window reliability or scale-up gates.

Next bounded maintenance: verify INOD's specific technical retry, collect the exact missing dated financial facts for UPST without inventing estimates, and check continued profile yield/partial-source failures. Do not claim INOD's historical attempt itself has been rerun successfully from the UPST result. Keep the current cohort at 25, retain all quarantines and gates, and leave main scanning stopped. Foundation's new runtime explicitly confirms no scanning, network requests, paid calls or storage writes. The unrelated staged telemetry patch remains untouched.
