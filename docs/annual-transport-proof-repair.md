# Bounded legacy annual transport-proof repair

This is a separate follow-on to the signed quarterly-facts package. It does not
change the quarterly parser, filing selection, review identity policy, model
policy, provider quotas, financial values or deployment configuration.

## Normal collection only

The already-selected latest 10-K, 20-F or 40-F is eligible for its existing annual
request slot when a prior row has no valid matching HTTP-200/EOF attestation, or
its metadata no longer matches the exact issuer index's selected filing. The
ordinary nextCheckAt cache check still runs first. Nothing resets a cache,
changes a version, forces a due date, sweeps issuers, adds a fallback/exhibit
request or schedules another collection.

Before due: zero source requests. At a normal due check, annual repair alone is
index + annual (two reads); annual + supported quarterly repair is at most three.
Once both proofs are current, due collection is index-only. A valid historical
annual proof is not reread merely to add new response metadata. A cache older
than the existing one-day usability window still cannot skip requests: after an
exact issuer index reselects the same annual URL, its old row is retained if that
normal read fails, rather than being discarded on a capped/failed replacement.

The current six-hour success and one-hour failure cadence, durable provider
ledger, 15-second request abort, 4,000,000-byte index, 5,000,000-byte filing and
60,000-byte Committee prompt limits are unchanged. Exactly hitting a byte cap
without observing EOF is incomplete. An annual refresh that is non-200, capped,
interrupted, timed out, malformed or has no financial excerpts retains the old
selected annual row exactly and records a failure. It never substitutes a prefix
or invents a new complete row. The refresh uses the original source URL; a
nonempty response URL naming any different source is rejected.

## Bound transport identity, not comprehensive financial analysis

Newly collected annual proof includes response.cik, response.rawBytes and
response.sha256. The hash is incremental over the actual bytes consumed by the
bounded stream, before UTF-8 decoding. These fields are bound into the existing
receipt key along with the source URL, accession, form, filing date, reporting
period, excerpt digest and collection time. The issuer is taken from the exact
matching official SEC submissions response, and its CIK/accession URL path must
match. The outward view and publication gates check the exact official SEC URL's issuer
and accession against the collection for every receipt, including historical v1
receipts without raw response metadata. Moving an unchanged valid old receipt to
another issuer is held. Padded/unpadded collection CIKs identify the same issuer;
the URL issuer path must remain canonical and unpadded. Invalid/missing collection
CIK, lookalike hosts, userinfo, query/fragment, encoded/noncanonical paths and
accession-directory mismatches fail closed even if the receipt hash is internally
consistent. Legitimate same-issuer old receipts retain their exact keys and normal
skip behavior; there is no global proof migration.

This is an integrity/provenance binding on the fetched response, not a signed SEC
attestation or an annual accounting parser. Source/form/period identity relies on
the exact official issuer index and requested filing URL; annual DEI/XBRL facts
are not newly parsed. Selected financial windows do not claim that every note was
parsed or evaluated. Missing debt remains unknown, never zero. No normalization,
forward dilution, current debt split, amendment reconciliation or new financial
values are introduced.

## Completed reviews and current publication

Metadata-only proof repair is outside all substantive review keys. When the
excerpts and prior readComplete=true identity are unchanged, the actual runner
reuses the completed terminal decision, does not reserve another model budget,
and retains historical approval/rejection/needs-more-data results. An otherwise
approved result remains held while required annual proof is unknown; a genuinely
proven annual and quarter can remove that transport hold only. Other financial,
quote/halt, identity, profile and semantic gates still apply. A historical
needs-more-data review is not converted into approval by transport metadata.
A genuinely changed excerpt digest follows the existing controlled substantive
evidence policy; repeated evidence or return to old evidence cannot buy another
review.

## Tests and provenance

`scripts/annual-proof-repair-smoke.mjs` exercises the actual durable budget wrapper,
collector, runner, Committee orchestration/prompt encoding, terminal journal and
delivery consumer. Storage, profiles, valuations, fundamentals and provider replies
are explicit local stubs. All real network/paid calls are blocked in these tests.
The delivery envelope is assembled locally from an actual approved runner report
using the event-job schema; delivery validation, journal reads and receipt writes
remain real. This test does not claim it ran an entire live event job.

The official INOD 2025 10-K and exact issuer-submissions index are gzip-compressed,
unmodified fixtures. The manifest records URL, accession, dates, HTTP status,
EOF, raw byte counts and SHA-256; every load verifies count and hash. The annual
body is 2,722,684 bytes. Existing authentic INOD quarterly facts remain bound and
are compared without truncation in every model prompt. No fixture financial value
is a runtime default.

The tests cover pre-due zero I/O, two/three-read repairs, repeated index-only due
checks, provider cadence and shared quota denial before transport, legacy/partial/
stale/tampered/cross-issuer proofs, exact cap/oversized/index cap, a real 15-second
request timeout, interruption, non-200 and unusable bodies. They also cover expired
annual retention, unchanged review keys/cost reservations, needs-more-data and
approved replay behavior, other current gates, legitimate changed-evidence review,
and one canonical delivery receipt. Inherited completeness, proof-boundary,
dependency, delivery, label, quarterly and terminal-runner suites remain required.

Local tests establish neither production cache refresh nor live publication.
Release requires independent review of the exact separate patch, integration
checks, authorized publication, and a naturally due successful source read.
