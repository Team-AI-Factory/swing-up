# Company valuation and description coverage

The foundation previously discarded positive valuation calculations outside 0.2–5 times the market price. The profile reader also missed usable product and customer sentences in some annual reports. Both problems left otherwise useful company records incomplete.

Model revision 2 retains positive calculations and flags extreme base estimates for validation. Single-method and extreme estimates cannot automatically become Buy or Sell candidates. Operating nonfinancial companies without an earnings value may receive a preliminary sales comparison if at least eight distinct profitable, cash-generating issuers match their industry, currency, snapshot, gross margins and revenue growth. This remains one research method with confidence capped at 55; it cannot trigger an alert. Companies without adequate inputs retain a missing-value reason instead of receiving an invented number.

The next foundation run recalculates a previous model revision, using revision-specific immutable batches. After completion, normal freshness handling resumes. The daily Railway schedule remains unchanged.

Profile parser revision 4 recognizes product portfolios, passive distribution statements and industry customer groups. Name formatting differences are accepted only while ticker, SEC issuer identity and source checks still match. Each maintenance cycle may re-read twenty saved annual business sections without SEC downloads, then handles the existing two-company retrieval allowance. One background retrieval slot ensures companies outside the current event queue also receive attention. Failed saved-source reads remain retryable, and one failure does not stop other recoveries.

A failed metadata refresh also retains the previous report reference. Saved-source recovery can run during network/provider backoff, including when a failed request has already recorded the current parser revision. It only bypasses the need for a network request; source identity, filing date and description verification still apply.

The public valuation-watchlist response now includes foundation valuation-quality counts and missing-input counts, plus company-profile coverage across the SEC-backed universe. These are different denominators and must not be combined. Profile coverage includes verified descriptions, verified industries and categorized pending reasons. The compact cron coverage log makes these counts visible without truncating a large event response.

Fair-value coverage is not the same as validated investment advice. Peer comparisons, extreme estimates, stale prices, incomplete profiles and incomplete scenarios retain their existing publication restrictions. Paid model usage, provider quotas, production storage prefix and Railway schedules are unchanged.

Validation: `node scripts/company-coverage-smoke.mjs` exercises model migration without stale-batch reuse, peer comparability and deduplication, publication restrictions, source identity, normalized names and bounded saved-report recovery. Existing foundation, company-profile, alert-presentation and valuation tests remain required.
