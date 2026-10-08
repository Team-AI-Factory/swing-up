# Committee financial-value capacity — 8 October 2026

The prompt builder applies lossless financial factoring before reserved review admission. Validation uses mocked model transport and isolated storage; it does not replay missing production prompts, establish model comprehension, or prove a live review completed.

## Change

The v3 whole-review check adds prior-review planning reserve, but its prompt builder attempted financial-record factoring only when that role's empty-history prompt already exceeded 60,000 bytes. A role that fit alone and exceeded the cap only after reserve did not receive an available lossless representation.

Apply profitable financial factoring consistently before both admission and actual calls. For encoded financial rows, repeated complete scalar strings may use `verbatimValueRef`, resolved by a readable `sharedEvidenceValues` dictionary in that same prompt. Full source URLs, concepts and qualifiers remain present verbatim. Field names, scalar types, original record order and context positions are preserved. Unique values stay literal; no common substring is inferred. Previous reviewer results never enter this codec.

Only accept the representation if the complete prompt, including dictionary and decoding instructions, becomes smaller. Revert value sharing when its instruction overhead erases the saving. Source-authored record/value marker keys make the financial codec return unchanged evidence. Existing long-text references continue to compose with the financial codec.

The input-policy revision advances from `utf8-schema-framing-60000-reserved-review-v3` to `utf8-schema-framing-60000-shared-financial-values-v4` for this actual representation change. The existing exact-policy mechanism can reconsider proven-zero technical holds. This does not remove stored history or change paid/unknown-usage protection, completed-review dedupe, source evidence fingerprints, or substantive missing-fact checks.

## Capacity evidence

Synthetic financial fixtures use the current collector's 42 facts (14 metrics × three dated rows), their actual valuation-audit shape, all context records, and two filings with eight distinct 1,600-character excerpts each.

The full-excerpt fixture now completes all four mocked roles with the v3 planning reserve retained:

| Role | Actual input bytes |
| --- | ---: |
| Analyst | 49,007 |
| Valuation | 47,156 |
| Skeptic | 47,704 |
| Final Judge | 48,726 |

Two additional synthetic fixtures reproduce only the magnitude of recently reported zero-call failures. Each raw role is below 60,000 bytes, which proves that v3's old trigger skips financial factoring for this control. They are not reconstructions of INOD or UPST.

| Synthetic peak with v3 reserve | Peak after factoring, reserve included | Planning headroom |
| ---: | ---: | ---: |
| 61,958 | 55,590 | 4,410 |
| 63,340 | 56,972 | 3,028 |

Both save 6,368 bytes per role after all prompt instructions. A separate 84-row facts-plus-qualified-audit fixture isolates 3,960 bytes of additional value-dictionary savings beyond record-field factoring, including the complete new instruction and dictionary. That figure is fixture-specific, not a promised saving for a real packet.

Every role's reconstructed evidence is compared using serialized JSON equality. All substantive prior results are preserved exactly; billing telemetry keeps its existing exclusion from subsequent prompts. Source evidence and consensus inputs are not mutated. The resulting mock decisions remain `needs_more_data`.

## Unavoidable limits and fail-closed evidence

The planning reserve remains `4 × visible-token target + 512` per prior role. It is an estimate, not a hard byte bound. Visible targets are prompt instructions; current API ceilings include reasoning and visible output together and remain 8,192 tokens for Sol, 16,384 for Astra, and 4,096 for Luna. No proven serialized-byte bound follows from the four-byte assumption. A lossless codec cannot guarantee capacity for arbitrary unique evidence or prior output under a fixed 60,000-byte cap.

The integration regression keeps three concrete counterexamples:

- The stored SEC-derived SERV reconstruction, with only 12 facts and five roles, still fails before any provider invocation. The final-role total is 63,729 bytes, including 14,248 reserved bytes. Financial factoring saves only 380 bytes for this packet. It retains the exact facts and missing current-quote requirement.
- Sixteen distinct full-length multibyte excerpts overflow before any model request. The collector's character ceiling is not a UTF-8 byte ceiling.
- Three distinct mocked responses of 6,051 serialized ASCII bytes each can cumulatively exceed the planning estimate. The final actual call is rejected, every previous result remains intact, and all three known usage receipts survive. An additional deliberately oversized unique mocked response stops the following role and preserves the first receipt. These are defensive transport tests with synthetic usage, not tokenizer-certified model outputs.

The actual provider independently measures each fully built prompt, including the response schema, immediately before a request. Overflow never truncates evidence or previous results and never sends that oversized call. The whole-review planning check reduces preventable partial reviews; it does not guarantee a complete paid review.

## Validation

- Financial-row/value and combined text-reference round trips; dates, units, URLs, Unicode, escaped quotes/newlines, null/zero/false, prototype keys, mixed contexts, reordered fields, marker collisions, unique strings and unprofitable dictionaries
- Reserve-only admission controls, maximum-count/full-excerpt capacity, real reconstructed SERV zero-call hold, unique multibyte evidence rejection and cumulative/oversized prior-output rejection
- Input-policy hold, preflight usage, and actual/unknown usage retention regressions
- Provider guardrails, exact model routing, prompt/schema budget and strict analyst-output regressions
- Valuation materiality, shared daily-cost fuse and pilot-scope regressions
- Full TypeScript check and focused lint

The text-only embedded-reference smoke intentionally disables the financial codec to preserve its original measured regression; the full-pipeline SERV result above is tested separately.

Independent read-only review found no blocking defect and passed 1,000 randomized round-trip/profitability cases, including 990 exercising both codecs together. Formal byte recovery does not measure an LLM's ability to follow reference instructions; natural eligible live reviews remain necessary to validate that behavior.

Validation made no paid model calls or production storage mutations. The repair does not force retries, raise limits, change model/output allowances, bypass missing facts, or edit queue/history records. The 60,000-byte hard cap, $2.7538 maximum per-review reservation, $10 rolling limit, 20-review ceiling, 25-company cohort and stopped main scanner remain unchanged.
