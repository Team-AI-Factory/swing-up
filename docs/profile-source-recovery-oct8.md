# Current annual-source profile recovery, 8 October 2026

Parser revision 14 recovers three source-backed profiles from six deliberately selected failed tickers: POCI, POWL and PPSI. The other three remain pending. This is a local parser result, not a production throughput measurement or evidence that the 500-new-profiles/day goal has been reached.

## Diagnosis and measured sample

Six previously unverified tickers were selected to exercise specific extraction gaps. Their latest annuals were discovered through official SEC issuer submissions, with matching CIK and ticker. Each raw HTML file and discovery payload has a SHA-256 receipt. Requests were serialized, spaced by at least 1.05 seconds, limited to 12 seconds and 12,000,000 bytes, with the existing identifying User-Agent. No model calls or production writes were made.

These are current official annuals, not a claim that the exact cached production inputs were replayed. All six reproduce the stated extraction gap at base commit `ef020eb0e3437affe8c96618620e1adc5cf048a8`.

| Ticker | Annual filed | Base result | Revision 14 |
|---|---|---|---|
| PNW | 2026-02-25 | Customers missing | Customers missing |
| POCI | 2026-09-28 | Customers missing | Verified |
| POWL | 2025-11-19 | Customers missing | Verified |
| PPIH | 2026-04-16 | Customers missing | Customers missing |
| ACCO | 2026-03-09 | Customers missing | Customers missing |
| PPSI | 2026-04-08 | Business missing | Verified |

Exact filing URLs, accession numbers, CIKs, filing/report dates, hashes, minimal source passages and their original Business-section offsets are in `scripts/fixtures/company-profile-current-failures-oct8.json`. Full reports and long Business extracts are external replay inputs, not bundled in the repository.

## Narrow changes

- POCI's complete outsourcing sentence explicitly names medical-device and advanced-aerospace customers. The parser requires the present-tense manufacturing and outsourcing predicates and a bounded list of actual manufacturing capabilities.
- POWL's complete sentence explicitly identifies current customer industries. The parser preserves its commercial/industrial scope and the complete list. It does not infer buyers from product uses, locations or future markets.
- PPSI's full issuer and wholly owned subsidiary jointly describe concrete manufacturing operations. This separate bounded predicate preserves the complete operating statement. Its optional definition accepts only quoted issuer-name prefixes and pronouns; acquisition qualifications and hypothetical aliases fail. The generic issuer-subject rule is unchanged.

PNW still requires source-authenticated APS subsidiary context. PPIH's Business section identifies geographic channels without a concrete buyer population. ACCO needs a genuine operating-business description before customer expansion: its selected baseline business is only a distribution sentence. None is force-verified.

Revision 14 uses the existing one-attempt parser-repair mechanism. No builder/cache, SEC cadence, provider caps, history/CAS, cohort, debt/valuation or runtime pause code changes are included.

## Validation

Run the checked-in source and adversarial cases:

```sh
node scripts/company-profile-current-failures-smoke.mjs
node scripts/company-profile-current-failures-cache-smoke.mjs
```

For full original-HTML replay, point `PROFILE_CURRENT_FAILURE_FIXTURES` to the directory containing the six byte-pinned `<TICKER>.html` files. The test checks complete raw hashes, Business hashes, quote offsets and identical outputs before accepting the result.

Validation includes 63 negative mutations through extraction and cached-profile validation, identity/URL/freshness checks, and negative Business-section scope controls. The cache test covers nine actual-source recovery/history combinations and twelve active provider/error waits, making zero network requests. It verifies that known or unknown historical success cannot be counted as a new first verification, genuine first success is counted, and the same parser revision does not repeatedly bypass pending backoff.

The broader parser/cache/builder smoke suite, ten preserved October 6 annuals, changed-file ESLint and full-project TypeScript check pass. TypeScript requires generating the local Prisma client after installing lockfile dependencies. Live R2 integration is not part of this parser validation.

Independent review tested all three authentic positive quotes, adversarial customer cases, and four valid/twenty negative final PPSI variants. The final review found no remaining scoped blocker.
