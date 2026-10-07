# Complete SEC profile source cache

This optional cache retains original response bytes only after the existing budgeted SEC transport reaches actual EOF. It adds no requests, fallback providers, AI calls, profile attempts, or quota allowances. The parser and source-byte versions are independent.

## Admission and replay

- The filing is first discovered from issuer-matched SEC submissions. A 40-F uses the existing exact-accession cover/index/AIF resolution.
- A new byte record needs HTTP 200, exact requested and final SEC archive URLs, the original bounded response bytes, and `reader.read().done`. Early Business success, a closing HTML tag, timeout, and old extracted text cannot provide this receipt.
- The optional annual-content gate requires matching namespace-qualified DEI CIK, annual form, FY facts and annual context. Its narrow XML subset fails closed on hidden/malformed/ambiguous facts or SEC challenge pages. A resolved 40-F AIF instead retains its cover/index binding and existing AIF content check.
- Canonical CIK, accession, form, filing date, document name, URLs, source version, original observation time, exact byte count, SHA-256 and gzip length are checked again on every replay. Maximum raw bytes remain 12,000,000; compressed bytes are capped at 512 KiB. Base64/JSON overhead is additional.
- Records and transport receipts are plain data from trusted transport and JSON-deserialized private storage. Metadata and hashes do not authenticate arbitrary external payloads.
- Valid complete bytes are re-extracted under current profile rules without SEC calls, even when extraction remains unsuccessful. Derived Business/note text cannot override those bytes. Invalid records cannot fall through to derived source text.
- Legacy layout-safe excerpts retain their existing positive recovery path. They do not become complete records. A failed old excerpt still uses the existing single fresh-read path after a parser repair.
- The original observation and filing dates do not renew on replay. Existing profile 30-day, annual-source 550-day, submissions 7-day, provider cooldown and verification-history rules remain in force.

The content gate's fixed-boolean handling is confined to byte-cache identity; it does not broaden the published financial-note customer adapter. Supported XBRL registry 2020/2022 `fixed-true`/`fixed-false` transformations and SEC 2015 `boolballotbox` are namespace-qualified. Unknown formats fail closed.

## Offline evidence

On 18 actual saved 10-K/20-F documents (47,830,418 original bytes), the codec compressed to 4,293,739 bytes. All fit 512 KiB individually; the largest compressed payload was 430,152 bytes and largest serialized record 574,264 bytes. Those disk fixtures provide test content, not production transport receipts.

On six previously failed eligible company reports, four pass the conservative complete-source content gate. For a subsequent grammar revision, annual fetches fall from 6 to 2; all six remain unverified under the unchanged base parser. This is a 67% reduction in annual-document requests for that retry sample, not a claimed improvement in first-pass verification yield or proof of 500 profiles/day. The resolved actual AAUC 40-F source also replays with no extra SEC calls and remains unverified without customer evidence.

Tests cover original-byte round trips, bindings, dates, transformed annual flags, malformed gzip/bombs, partial/early streams, body timeouts, size limits, error pages, invalid records, source-proof replay, unchanged first verification history, old-excerpt handling and actual source replays.

## Primary references

- https://www.xbrl.org/Specification/inlineXBRL-transformationRegistry/REC-2020-02-12/inlineXBRL-transformationRegistry-REC-2020-02-12.html
- https://www.xbrl.org/Specification/inlineXBRL-transformationRegistry/REC-2022-02-16/inlineXBRL-transformationRegistry-REC-2022-02-16.html
- https://www.sec.gov/files/edgar/filermanual/archive/efmvol2-v53.pdf (SEC namespace and ballot-box transformation)
