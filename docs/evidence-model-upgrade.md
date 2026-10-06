# Evidence and model upgrade — 5 October 2026

Scope: targeted improvements for `pilot-simple-alerts` and `main`. Deploy the current 25-company pilot; keep main scanning paused. This change does not reset the shared rolling AI ledger, increase its $10 limit, add infrastructure, increase the $20 Railway monthly limit, or authorize external messages or trades.

## Five changes

1. Collect missing financial evidence: exact-issuer SEC annual and quarterly filings, targeted segment/customer/margin/cash/debt sections, dated numeric facts and requested comparable annual periods. Reuse source caches with their original dates. Bound retrieval by existing provider quotas, request deadlines and document sizes. Failed or truncated retrieval remains visible.
2. Audit valuation inputs: retain source, reporting period, units, accession, method and assumption. Separate provider estimates from primary facts. Cross-check annual earnings/FCF where the stated method can be reproduced and show explicitly mechanical sensitivity; this does not certify unverified TTM values.
3. Apply the correct review criteria: event reviews require substantive event proof; valuation reviews require financial/valuation proof and do not require a new headline. A reviewer that makes that irrelevant event demand fails the review rather than creating a false rejection or approval.
4. Spend again only after meaningful changes: persist the completed valuation evidence fingerprint across generated daily IDs. Source content, financial facts, model assumptions, estimate ranges and material price-threshold state can change it; retrieval timestamps and small quote changes cannot. Technical failures retain normal guarded recovery. A deliberate policy upgrade admits a bounded reconsideration through the existing queue and shared budget.
5. Explain the result: distinguish rejection, insufficient evidence, technical failure, approval pending checks, and publishable approval. Positive model votes cannot replace financial evidence, price freshness, issuer identity or existing publication gates.

## Stage and model policy

| Stage | Implementation / model |
| --- | --- |
| Discovery, issuer matching, deduplication, quota checks | Deterministic code; no paid model |
| Downloading filings, company profiles, financial facts | Bounded source retrieval and caching; no paid model |
| Candidate screening, valuation calculations, input audit | Deterministic calculations; estimates labeled and source facts retained |
| Analyst, accounting/valuation/industry specialist when applicable, skeptic | `gpt-6.1-sol`, medium reasoning |
| Final Committee judge | `gpt-6-astra`, medium reasoning |
| Simple supporting roles in the full/manual Committee path | `gpt-6-luna`, low reasoning; not an automatic substitute for the core reviewers |
| Approval checks, delivery, outcome tracking | Deterministic gates; no extra model |

The focused valuation review uses analyst, valuation specialist, skeptic and final judge. Event reviews select relevant specialists. Full/manual Committee role definitions remain available; all roles do not need to run on every candidate.

Modern models use the supported text-only Chat Completions contract, standard service tier, no response storage, strict analyst JSON, medium reasoning for core reviewers and a hard prompt-byte bound. Total reasoning/output allowances are 8,192 tokens for Sol, 16,384 for Astra and 4,096 for Luna. Unknown/unpriced models are blocked. Live deployment must verify account access and real receipts; configured names alone do not prove successful model calls.

Official standard API prices checked on 5 October 2026, USD per million tokens:

| Model | Input | Cache read | Cache write | Output including reasoning |
| --- | ---: | ---: | ---: | ---: |
| GPT-6 Luna | 0.10 | 0.01 | 0.125 | 0.50 |
| GPT-6.1 Sol | 2.00 | 0.10 | 2.50 | 10.00 |
| GPT-6 Astra | 10.00 | 1.00 | 12.50 | 50.00 |

Sources: [Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol), [Luna](https://developers.openai.com/api/docs/models/gpt-6-luna), [Astra](https://developers.openai.com/api/docs/models/gpt-6-astra), [migration guidance](https://developers.openai.com/api/docs/guides/latest-model).

The maximum focused-review reservation is $2.7538, assuming five deep roles plus one final judge, 60,000 prompt bytes plus overhead per role, maximum cache-write input rates and maximum reasoning/output allowance. This is a conservative temporary hold, not the expected review price. Actual charges use each model's reported ordinary input, cache-read, cache-write and output separately. Unknown usage keeps conservative exposure. Existing historical GPT-4.1-mini receipts remain priced for reconciliation. Capacity shortages queue reviews without silently choosing a weaker model.

## Verification

Mocked regression checks cover exact issuer matching, bounded retrieval, source-date preservation, missing financial facts, traceable annual cross-checks, meaningful-change fingerprints, supported reasoning parameters, pricing metadata and usage, model-specific cost accounting, unknown-price blocking, irrelevant event requests, durable review markers and unchanged publication gates. No live alert or paid test call is created by these tests.

Real deployment receipts and any remaining evidence gaps belong in the pilot operating log. Passing tests does not establish investment accuracy or guarantee that a serious signal exists.

## Deployment record

See [evidence-model-deployment.md](evidence-model-deployment.md) for published commits, exact Railway deployments, completed-run evidence and remaining live-validation limits.
