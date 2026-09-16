# Live provisional alerts and evidence follow-up

The public `/alerts` and `/serious-signals` pages show model opportunities before Committee approval. `/api/public/signals` returns a bounded, sanitized feed with explanations and actual review status. A provisional alert can be eligible for display while `committeeApproved` remains false. Approval is never inferred from eligibility.

## Valuation review

The existing price watcher admits fair-value threshold crossings under a new daily valuation event identity. At most three new valuation events enter a sensor cycle, with eight pending valuation reviews at a time. Unexplained price spikes remain research. SEC and other higher-priority events retain their queue priority.

A valuation candidate uses the exact company directory, a foundation/targeted valuation no more than 30 hours old, its assumptions and financial inputs. It does not require a news headline. All 14 Committee roles receive explicit valuation instructions. Verified financial facts, current price and halt checks, supported valuation methods, the current value gap, original Committee consensus and Final Judge requirements govern Serious approval. Positive AI votes cannot fill missing financial facts. Historical comparisons remain optional.

## Needs more data

The event job records requested documents, financial fields, market checks and causal questions in `research-evidence/followups/`. Evidence collection becomes eligible after 15 minutes. Existing provider reservations can still defer individual requests; this is an eligibility time, not a promise that a provider will respond then.

The paid-review cooldown is separate. A stable evidence revision excludes fetch timestamps and small price ticks. The same evidence retains its 24-hour cooldown; materially changed evidence may be reviewed again within the unchanged shared AI budget. Complete source documents and partial documents are retained separately. Partial evidence never gains complete-source authority. SEC financial facts are cached by exact CIK for up to six hours, with dates and source validation. A new filing or a specifically requested missing metric triggers collection again.

The old needs-more-data queue delay is recognized during normal queue reads. No queue reset or historical record deletion is required. Committee rejections remain explicit. Missing data is not automatically a rejection.

## Source quality and auditing

- Short SEC filings do not imply missing exhibits. Explicitly referenced exhibits remain required; safe links inside the same accession provide a fallback when the index omits them.
- Verified issuer roots and issuer-published RSS links supplement discovery. SEC identity must match. Existing roots survive missing website fields in SEC submissions. Provider caps and polling schedules are unchanged.
- A deterministic 10% rejection sample is retained. At most one eligible sample per day can enter the existing paid Committee budget; ambiguity about the issuer or a headline alone still cannot qualify.
- Daily evidence telemetry records seven named checks per unique event, evidence age, missing fields and time to first Committee review. The public summary covers at most 500 tracked events. It does not represent all incoming events or imply that HTTP success equals complete evidence.

Company descriptions, the event/value finding, business impact, conditional outcome and risk are shown on alert cards. The Committee's Explainer uses the same five-part structure. Existing immutable research snapshots preserve their historical status.

## Verification

`smoke:valuation-committee-followup` runs the real 14-role orchestrator against deterministic provider responses. It covers valuation admission, price movement erasing the gap, absent facts, budget refusal, explanations, durable follow-up, fact-cache identity and rejection-audit bounds. Event-job tests separately prove that collection resumes before the paid cooldown and unchanged evidence does not reserve another paid review. SEC and issuer-feed tests cover attachment and discovery regressions.

Serious alerts enter the public review index only after the verified result and outbox are durable. The existing Serious delivery consumer retains its authority checks. This change does not add native phone push, change notification destinations, increase spending limits, or guarantee that research will produce an approved investment signal.
