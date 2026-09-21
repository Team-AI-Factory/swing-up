# Alert recovery and cost accounting

The PR262 pipeline uses a versioned focused Committee: an evidence analyst, a
sceptic, and a final judge. Earnings/financing, valuation and medical/regulatory
events add the relevant specialist. Every selected role must complete. Negative
findings, missing material evidence, unsafe claims, issuer mismatches and unknown
halt state still prevent publication. Legacy 14-role proofs remain readable.

## Spending

- Actual OpenAI input, cached-input and output token receipts determine the
  immediate cost ledger, including partial reviews and malformed paid outputs.
- HTTP-rejected requests with no reported usage book no charge. A shared quota,
  rate, authentication or service failure pauses subsequent calls and retries
  after a bounded cooldown. Unknown 429 codes are classified as rate-or-quota.
- Legacy $0.75 missing-usage estimates are removed from spending and preserved
  as unverified historical records. They are not evidence of a provider bill.
- The rolling $10 ceiling and $6 warning remain. Concurrent reviews reserve an
  exposure bound derived from at most six GPT-4.1-mini calls, 60,000 prompt bytes
  per call and 1,000 output tokens per call. The current bound is $0.156. This is
  a temporary hold, never a charge. Ambiguous network failures retain a separate
  pending hold; a process crash retains its reservation for the rolling window.
- The optional official Costs API audit needs `OPENAI_ADMIN_KEY` and
  `SWING_UP_OPENAI_COMMITTEE_API_KEY_ID` in the analysis runtime. Add secrets through
  Railway's secret settings, never source control or chat. The API key ID is the
  public identifier of the existing Committee key, not its secret value. Use a
  dedicated key for clean attribution. Without access, the audit says so.
  Daily billed-cost buckets can lag and are reported separately from immediate
  token-based admission. They do not establish invoice payment or Railway costs.

## Evidence and recovery

US equity quotes follow the New York session calendar, including holidays, DST
and scheduled early closes. Closed-market research can use the latest completed
session's quote, retaining its real timestamp. Once trading resumes the 15-minute
rule applies. Fresh fetch and halt verification remain required. Extraordinary
closures can be configured in `SWING_UP_US_MARKET_EXTRA_CLOSURES` as ISO dates.

Queued-event profiles are warmed before background valuation profiles. Exact
annual business sections are cached by issuer and accession. Missing extractable
business/customer descriptions back off for a day; they are never filled with
invented prose. Existing successful document and financial-fact caches are reused.
Incomplete list introductions cannot qualify as business descriptions. The parser
also recognizes the issuer's complete brand without its legal suffix. A parser
revision revisits earlier extraction failures once, reusing the exact source or
retrieving a fuller excerpt if the earlier parser stopped too soon. Real network
and provider-budget backoffs remain authoritative.

The source downloader uses a bounded IPv4 DNS-over-HTTPS fallback when local A
resolution fails, then retains public-address validation and pinned HTTPS. Source
bodies have a 2 MB bound; truncation remains explicit. Access-denied pages still
require an accessible legitimate alternate source. The daily foundation job retries
temporary failures twice, resuming its persisted checkpoint.

Evidence metrics distinguish completed reviews, technical failures, evidence gaps,
real rejections and deferred reviews. Completion time is distinct from first-attempt
time. Routine source connectivity is not usable-evidence proof. Delivery receipts
remain the authority for whether a real alert reached the feed.

Run `node scripts/reliable-alerts-smoke.mjs` for the 18 focused regression suites.
The same gate runs in the build workflow before merge/deployment.
