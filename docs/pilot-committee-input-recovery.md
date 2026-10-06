# Pilot Committee input accounting — 6 October 2026

The first normal sensor cycle after valuation-admission repair `5705075e8b9047d7411844091cbd9b33807941d7` admitted INOD, PGY and UPST. At 04:33:50 UTC it completed HTTP 503: INOD had two successful `gpt-6.1-sol` responses, then the skeptic was blocked at 60,997 counted bytes against 60,000. Final judge was blocked. PGY failed deterministic business/valuation risk checks without a paid call; UPST waited for the next cycle's review capacity. None is a Serious Alert.

The shared ledger reconciled the partial review to $0.092157 recorded cost, zero remaining reservation and zero pending exposure. Actual usage was 28,848 prompt tokens and 2,004 completion tokens from two Sol responses. These receipts prove paid Sol access and accounting; they do not prove a complete Committee decision or a successful Astra call. All three configured models were visible in the read-only models check. Exact-commit isolated positive/negative/duplicate delivery controls passed and produced a test-only receipt excluded from live signals.

## Repair

The provider previously measured `JSON.stringify(messages)`, which counts an additional layer of escaping used only by the HTTP transport. The API decodes that layer before the model receives the message content. Measure actual UTF-8 content bytes, plus conservatively serialized empty-message role framing and the complete response schema. Keep the same 60,000-byte input ceiling and separate 1,000-token framing allowance used by cost reservations. Truly oversized text or schema still fails before any paid request; no truncation or increased budget is introduced.

Later reviewers receive all earlier verdicts, findings, source references, concerns, missing-data requirements, status, model and error details. Per-response token-usage telemetry remains in the complete durable results and cost ledger, and is no longer repeated inside the investment-evidence prompt. Evidence text, dates, amounts, units, sources and reviewer blockers are unchanged. No model downgrade, output-limit reduction, ledger reset, queue rewrite or policy-version bump is required for this technical retry.

## Verification

A synthetic regression reproduces the transport-overcount class: 63,953 transport bytes contain 55,147 input bytes. The model receives exactly the original content. True oversized multibyte input and oversized schemas remain blocked without network calls, and the maximum focused-review hold remains $2.7538. This is a representative regression, not a reconstruction of the inaccessible historical full prompt.

Provider/model-policy tests also verify complete cost receipts after excluding billing telemetry from later prompts, retained reviewer blockers, strict analyst schema, exact model routing, cancellation, technical failures and the shared budget contract. The existing lossless evidence-reference round-trip regression continues to pass with the corrected input-byte measurement. Deployment and the next complete natural review must be checked separately before claiming runtime recovery. Preserve the current 25-company cohort and all scale-up gates; main scanning remains stopped.
