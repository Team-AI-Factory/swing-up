# Lossless references for receipt text embedded in narrative fields

This repair changes prompt representation only. It builds on the source, profile and durable review safeguards published in `9b7a6489da47699865c77948c8ca5ef81921dd43`. The measurements below use local mock transport; they do not establish live model performance.

## Finding

The October 7 SERV retry was reported to fail at 71,331 logical input bytes before the analyst's network request. Its exact paid prompt was not persisted. The observed size is evidence of an input-limit failure, but does not establish the exact historical field breakdown.

The source pipeline gives a concrete failure mechanism:

1. `analysis.ts` includes the anchor receipt summary inside `whatHappened`, adding a source prefix.
2. `runner.ts` adds a causal-path suffix and also places the receipt summary in filing and news evidence.
3. The existing normalizer shares identical complete strings of at least 512 bytes. It shares the filing/news summaries but leaves the same summary embedded inside the longer `whatHappened` string.
4. Original financial excerpts, dated facts, profile context, market/macro context, strict response schema and instructions then add to the first role's input. Prior reviewers cannot explain a first-role overflow because that array is empty.

Other repeated groups include market quotes in priority and evidence sections, financial facts repeated by valuation reconciliation, and source links repeated across provenance. Those remain unchanged in this narrow repair. The full annual/quarter excerpts and financial values are substantive content, and are not shortened or selected away.

## Change

Reuse only a text already shared by at least two complete fields. When that exact text is embedded in another non-URL string, represent that string as ordered literal pieces and references using `verbatimTextParts`. Concatenation recovers the original string character for character. Choose the earliest match, breaking ties by longest full text. Do not infer common fragments from two otherwise unique strings.

The additional instruction appears only when an embedded reference is emitted. Existing prompts with ordinary whole-field references do not acquire extra framing. Both reference marker names are reserved: if source data already contains either key, normalization returns the original evidence. URLs stay inline, values are not interpreted, and the encoder does not mutate input evidence. It uses the existing JSON serialization semantics and checks the total encoded size including instructions before accepting the representation.

No price, materiality, rejection, identity, publication, strict JSON, model, spending, reservation, hold, terminal-dedupe, or 60,000-byte input rule changes.

## Measurements

The committed fixture is explicitly a reconstruction using authentic public SEC bytes fetched between 01:29:54 and 01:32:22 UTC on October 7, 2026. It includes the exact event accession's primary filing and exhibit, current annual and quarterly excerpts produced by the existing collector, 12 facts produced by the existing facts collector, and the annual profile produced by the existing extractor. Original sensor wording, cached valuation analysis, quote, macro context, and gap list were unavailable; missing fields were not invented. See the adjacent fixture provenance for URLs and SHA-256 hashes.

Real orchestrator and provider code, with local mock transport:

| Role | Previous representation | Embedded references |
| --- | ---: | ---: |
| Analyst | 64,017, blocked before transport | 51,941 |
| Industry | blocked by analyst failure | 50,049 |
| Accountant | blocked by analyst failure | 50,784 |
| Skeptic | blocked by analyst failure | 51,410 |
| Final Judge | blocked by analyst failure | 52,584 |

For the reconstructed analyst input, serialized financial diligence is 23,977 bytes; the shared receipt dictionary is 12,299; `whatHappened` drops from 12,498 to 276; evidence sections remain 5,652. Net savings are 12,076 bytes after new instructions. The resulting review remains `needs_more_data`.

A separate **engineered boundary test**, made by appending clearly labeled unique synthetic padding, measures exactly 71,331 bytes before encoding and 59,255 / 57,363 / 58,098 / 58,724 / 59,898 after encoding across five roles. This is not the historical live packet. Its final-role margin is only 102 bytes, so it does not guarantee that arbitrary future reviewer output or larger unique evidence will fit. All original limits continue to reject any such overflow before transport.

## Verification

- Exact serialized evidence round-trip at every role, including all facts, periods, units, sources, flags and unique prefix/suffix conditions
- Every substantive previous-role result retained unchanged; billing telemetry retains its preexisting exclusion from later prompts
- Five roles and Sol/Astra routing preserved; analyst strict JSON schema and all non-reference instructions unchanged
- Real provider byte gate rejects baseline and truly unique oversized input before mock transport
- Source-authored marker collisions, near duplicates, overlapping shared values, Unicode, line breaks, source URLs, input immutability and prototype keys
- Existing evidence-reference, full-financial-fact, provider-guardrail, prompt-budget, analyst-output and model-policy regressions
- Typecheck and focused lint

These validation runs made no live model calls or storage mutations. They do not assert exact historical replay. Spending caps, paid holds and the byte limit remain unchanged.
