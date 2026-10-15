# Source-aware financial facts, bounded local patch

## Corrected diagnosis and unchanged limits

The prior working assumption that this route was limited to 128 KB was incorrect.
The existing `collectFinancialDocuments` route accepts a 4,000,000-byte SEC issuer
index and a 5,000,000-byte filing, with a 15-second request timeout and at most one
index plus two selected filings. Its success/failure checks remain six hours/one
hour. The event-job's separate 2 MB full-event-source route and article-reader's
800 KB SEC document route do not wrap this financial collector. The 128,000-byte
constant in company-profile collection is an incremental extraction check interval.

The existing `createPr262SensorBudgetedFetch` still accounts for requests and
cadence, and returns non-submissions response bodies unchanged. Its optional
2 MB submissions snapshot cache is separate from the collector's 4 MB index read.
The Committee's existing per-prompt ceiling remains 60,000 UTF-8 bytes, including
schema/framing. No request, byte, runtime, provider, model or cost limit changes.

Both authentic original quarterly filings fit this route: UPST 3,037,401 bytes;
INOD 2,193,581 bytes. Missing debt/share/cash-flow facts were discarded by the
selected-window excerpt path, not blocked by a demonstrated 128 KB transport cap.
Compact FilingSummary/report-table substitution was researched but is deliberately
excluded from this release. There are no new source-selection or event-job imports.

## Extraction and provenance

The existing full collector now adds typed facts for supported UPST/INOD original
10-Qs after exact HTTP 200, EOF and parser validation. The original excerpt output
is retained. Facts preserve issuer, accession, original source URL/anchor, filing
and reporting dates, duration start, concept, context ID, fact ID, unit reference,
scale, sign, XBRL decimals, raw value, response hash and exact element hash.

The narrow parser validates source identity, DEI, namespace bindings, unique IDs,
well-formed unique context periods, explicit units and numeric transforms. It
ignores comment/script/style literals and rejects such markup within fact elements
rather than claiming a hash of cleaned text. Dimensioned instrument rows cannot
stand in for consolidated amounts. Conflicts and failed arithmetic bridges block
the affected group; failed identity/complete-body checks cannot mint current proof.

- UPST: 25 facts, including borrowings principal, discount, amortized carrying value,
  six maturity buckets, Q2/H1 basic/diluted shares and award/convertible increments,
  EPS numerator adjustment, reported EPS, H1 operating cash flow and cash capex.
- INOD: 11 facts, including Q2/H1 basic/diluted shares and award increments, reported
  EPS, H1 operating cash flow and cash capex, plus the explicit unused named revolver.
- Facility capacity, pensions and vendor obligations never become borrowed debt.
  Unused revolver utilization does not imply zero total company debt.

These are dated reported facts, not a reconstructed current balance sheet or new
valuation model inputs. The parser reports explicit remaining gaps: current versus
noncurrent borrowing split; normalized earnings/cash flow; non-GAAP reconciliation;
forward dilution; amendments/subsequent events and post-maturity repayments.
The 10-Q/A fixture is rejected as a new original period. Existing filing selection
still excludes amendments; no automatic restatement reconciliation is claimed.
Whole response coverage still does not claim that every financial note was parsed.
No publication or recommendation is forced by adding a numeric fact.

## Natural cache repair and cost

A supported selected quarterly row is skipped only when its parser version is
current, extraction succeeded, and its transport proof binds the fact payload.
A legacy/missing-version/blocked/tampered row becomes eligible on the next normal
due check, never by an immediate cache reset. A successful repair replaces that
quarterly row; an unsuccessful read/parse retains the earlier row and records a
collection failure. The unchanged cache CAS applies. Other issuers and the annual
selection/skip policy are unchanged.

Cold collection uses at most three reads. A due legacy repair with its annual row
already cached uses two: index plus quarterly filing. This is one additional
quarterly read versus the prior index-only skip, inside the same three-read maximum.
A fresh current-version row returns to index-only due checks. Before nextCheckAt,
there are zero source reads. Failed repairs retain the one-hour failure cadence and
provider ledger protections. No paid review reopening is introduced: the existing
excerpt-based substantive review keys are unchanged. Tests verify a completed
Committee review is not reopened by extraction metadata/version repair alone.

## Reproducible tests

All fixture bytes are unmodified HTTP-200 SEC responses, gzip-compressed only;
`scripts/fixtures/filing-facts/manifest.json` records exact URLs, dates, raw byte
counts and SHA-256. Fixture loading checks hashes and counts before every test.
The source-injected scripts are stored as evidence but never executed. Research
numbers appear in tests, not live defaults.

- `node scripts/filing-facts-smoke.mjs`: authentic 25/11 facts, eight bridges,
  issuer/period/accession/amendment/partial/units/scales/conflict/namespace/context/
  anchor/comment/script/style negatives.
- `node scripts/filing-facts-integration-smoke.mjs`: actual durable provider wrapper,
  full collector, runner, Committee orchestration and prompt-building path. Storage,
  index/annual transport, valuations/profile and provider replies are explicitly
  local synthetic fixtures; quarterly source bytes are authentic. All real network
  and paid calls are blocked. Every fact/provenance field is reconstructed from
  the final prompt references and compared exactly. Actual maximum prompt sizes:
  UPST 48,697 bytes; INOD 45,170 bytes, below unchanged 60 KB. This is a bounded
  fixture proof, not a promise every larger future evidence pack will fit.
- Existing HTTP completeness, proof boundary, dependency lifecycle, delivery proof,
  review-label and terminal-runner regression scripts remain applicable.

Only a naturally due successful pilot run can establish live availability. This
patch/test result does not attest a production cache refresh or publication.
