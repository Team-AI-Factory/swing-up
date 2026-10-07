# Local profile throughput improvements, 6 October 2026

This work was originally tested on integration tree `129793a6b943e84b053920304e255878d07e4577` and is now integrated after the deployed source/storage release `8db0d12aef6b23770a69dec696bb808f9806d3da`. The measurements below describe the isolated local experiment. Current release and runtime status require exact deployment receipts; these tests make no paid model calls.

## Measured problem

The supplied live receipt aggregate is 128 provisional first-time verifications from 661 attempts across 33 healthy passes, about 19.4%. At roughly 20 attempts per 15-minute pass, 500 verified companies/day would need about 26% yield. These are planning rates, not proof of sustained daily completion. Identity, source, quota, cadence and verification gates remain unchanged.

The observed profile-state object is 4.2–4.45 MB. An ordinary attempt previously performed four profile-state GETs and three conditional PUTs, including a filing-metadata checkpoint between durable admission and the final outcome.

## Changes

- Retain durable admission/backoff before any SEC request and the final acknowledged-row CAS. Remove only the intermediate filing-only checkpoint. All final successful/pending results include the selected filing. A process crash before final persistence may require rediscovering filing metadata on the next ordinary guarded retry; it cannot invent a verification, erase history or bypass the initial backoff.
- Preserve the reviewed complete-original-byte cache. Native transport EOF, HTTP 200, exact SEC URL/CIK/form/date/accession, bounded bytes, annual content identity, hash and original observation are required. Source storage reads/writes now receive the existing role signal. No source retry loop is added.
- Recover ACR's exact loan-origination statement from the held parser fix. Recover AOS's complete direct-to-consumer sales clause and AORT's complete compound sentence that explicitly identifies sales to hospitals. Preserve the full original quotes.
- Reject employee-compensation/training statements selected as the business of BDX/WYNN, and the previously identified ABOS/ABUS cases. The new consumer-sales grammar has an anchored end and rejects forecast/illustrative/conditional tails. Speculative audience modifiers also fail the legacy passive-recipient path in both extraction and cached validation.

## Offline results and limits

Ten authentic annual reports were replayed. The current frozen parser verifies none of this selected failure set; the local parser verifies exactly ACR, AOS and AORT. The other seven remain unverified. Four current failure tickers were resolved through current official SEC submissions; the production logs did not expose their cached filing URLs, so this is not proof of exact production-cache recovery. All six historical normalized-document hashes and all 21 preserved quote hashes/offsets match prior gold; their newly fetched raw HTML hashes differ and are recorded separately.

After ACR's deterministic recovery, five historical reports still fail. Four support the strict complete-source cache. On a later parser revision their annual-document requests fall from five to one, with zero verifications caused by caching itself. This is a retry benchmark, not a first-pass throughput claim.

A synthetic 4.4 MB state fixture exercises the real cache/builder code. The new ordinary path performs three GETs and two PUTs. The modeled removed checkpoint accounts for 8,800,816 serialized payload bytes. No live latency or daily capacity improvement is claimed from this byte calculation.

Regression coverage includes positive source replay, wrong identity and sales direction, omitted sales predicates, speculative/marketing targets, employee benefits, original-byte EOF and corruption checks, source-storage cause propagation, final applied/unapplied writes, same-row competitors, durable admission, simulated crash/restart backoff, and known/unknown verification history. Existing fault injections are keyed to retained admission/final stages instead of the obsolete third-write index.
