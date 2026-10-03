# Bounded annual financial-note customer evidence

This adapter supports two independently checked 2025 annual disclosures. It is not a general HTML/XBRL authenticator or a fallback to arbitrary investor/partner mentions.

- HSAI: 20-F filed 2026-04-24. The accounts-receivable policy identifies amounts due from Group customers and explicit OEM/customer pools.
- PGY: 10-K filed 2026-03-02. Note 4 identifies servicing-fee payments received monthly from Financing Vehicles. The complete customer quote retains the agent-responsibility, no-loan-servicer and net-basis qualifications. Underlying investors are not relabeled as service-paying customers.

The evidence is separately typed as `financial_notes_accounts_receivable` or `financial_notes_revenue_contracts`. Its source URL, CIK, annual form, filing date, taxonomy, original quote and 2025-12-31 report period are retained. Cards and delivery text show note-specific labels and the report period. The actual Committee packet and stable evidence revision retain the complete verified note type, section, taxonomy, quote, source and period, with an explicit warning against inferring current rankings, the full customer base or geographic revenue shares. Receivable pools are never inferred to be geographic revenue or current customer rankings.

## Boundaries

Initial extraction requires authentic bytes from the existing SEC transport/discovery path. It checks a complete closed document, unique DEI identity/FY facts, undimensioned matching annual contexts, visible note text, exact section/paragraph relationships, and the complete selected continuation chain. Nil, hidden, quoted, unrelated, malformed or ambiguous evidence fails closed. The literal corroboration is intentionally limited to the documented 2025 period; newer reports require new source review.

Private-cache proof replay is structural revalidation of an already-established attestation, not authentication of arbitrary public JSON. The source cache keeps financial evidence beside, not inside, the layout-safe Business excerpt. The ordinary profile identity, filing-age and 30-day verification checks continue to apply. Original first-verification timestamps are preserved.

Annual Business-only extraction may still finish early. Financial-note extraction requires transport EOF, so later stream failure or trailing documents cannot be hidden by an early closing HTML tag. Existing request pacing, body-size limits, timeouts and provider backoffs are unchanged.

## Offline tests

Run `node scripts/reliable-alerts-smoke.mjs` for the combined suite. Source and cache tests are self-contained and make no network requests.

The complete authentic documents can also be replayed after separately obtaining them through the approved SEC read path:

- `HSAI_PROFILE_FIXTURE=/path/to/hsai-20251231x20f.htm node scripts/company-profile-financial-note-source-smoke.mjs`
- `PGY_PROFILE_FIXTURE=/path/to/pgy-20251231.htm node scripts/company-profile-revenue-note-source-smoke.mjs`

Authoritative documents:
- https://www.sec.gov/Archives/edgar/data/1861737/000110465926048025/hsai-20251231x20f.htm (SHA-256 `fb20820900250d007e69ef332fc30976ca775186a7180e9db90e34615396a42f`)
- https://www.sec.gov/Archives/edgar/data/1883085/000188308526000018/pgy-20251231.htm (SHA-256 `7620d8572fc1980e681d47ae869f0cb34f1a2f34d612bbac1b96943be55a2389`)
