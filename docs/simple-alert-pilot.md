# Simple Alerts pilot

Branch: `pilot-simple-alerts`. Base / rollback code: `5129218b77250791dd8f813d11ad8fe242d5a767` (main, PR308). Do not merge this experiment into main.

## Decision and scope

Prove a small, useful alert workflow before expanding coverage. Reuse existing verified profiles, valuation calculations, source checks, Committee and delivery code. Start with 25 fixed companies, valuation opportunities first, then add one event family only after the basic path works. Keep rejected and missing cases in the denominator. Do not add services, subscriptions, new feeds, new schedulers, a new Committee, or a second spending allowance.

The first implementation is a read-only feasibility test, not an isolated paid production worker. `config/simple-alert-pilot.json` freezes the cohort and original source URLs. `npm run pilot:simple-alerts -- --live` makes one public read of the existing valuation feed. `--snapshot <path>` evaluates saved input without network calls. Neither command calls an AI model, writes queue state, approves a signal or delivers a notification. Existing main continues operating independently.

## Baseline, 28 September 2026, 14:15 Bangkok

The live directory reported 175 verified profiles out of 9,863 companies. The public valuation feed returned 49 profile-verified companies. The frozen cohort deliberately includes all three Buy-research companies, 12 Sell-research companies and 10 price-watch comparison cases, selected alphabetically within each group before observing future returns. This feasibility sample is not representative of the whole market.

| Measure | Initial result |
| --- | ---: |
| Fixed companies found with valid profiles | 25 / 25 |
| Eligible provisional research cases | 15 |
| Reported Committee approvals in this snapshot | 0 |
| Stored verified revenue-country facts | 0 / 25 |
| Durable approval / delivery receipts checked by this command | Not checked |

Profiles describe products/services and customer groups. New shared card presentation separates those facts, uses a few meaning-preserving everyday-word substitutions, and links the dated filing. Revenue geography is optional, never an additional publication gate. Only an explicit dated country-level majority-of-total-revenue statement can currently be extracted automatically. Regions, headquarters, segment shares and forecasts do not qualify. Other disclosures, including financial tables, remain visibly unverified until reviewed extraction exists. Old cached profiles remain usable; no mass re-fetch is triggered for this optional field.

## Time and decision gates

These are planning estimates, not a promise of alerts or profitable returns.

| Phase | Time budget | Evidence needed to proceed |
| --- | --- | --- |
| Prepare and validate | 1–2 working days total | Freeze 25 names, audit the source packet for each, fill or explicitly mark revenue geography, replay saved positive/negative cases, verify exact-branch tests. Initial cohort/assessment and card changes are prepared. |
| Technical observation | 5 US trading sessions after launch | Record every eligible case, review outcome, latency, token cost, approval and receipt. Run known positive and negative replay controls as well, clearly separated from real live opportunities. |
| Usefulness decision | 10–20 trading sessions, extend if fewer than 20 distinct assessed cases | Manager-readable cards; supported thesis, price, downside and invalidation; compare frozen-cohort cases against a simple baseline. Insufficient cases means inconclusive, not a pass. |
| Investment performance | At least 30–90 calendar days and the actual stated holding horizon | Record outcomes at fixed horizons and versus a market/sector benchmark, including transaction costs and adverse moves. A week cannot establish investment profitability. |

Proposed acceptance criteria:

- Zero fabricated material facts, wrong issuers, false approval badges, duplicate notifications or unapproved publications. Every published alert has dated source evidence, complete required review, an authentic final approval and durable delivery proof.
- At least 95% of eligible source-complete cases finish a Committee decision within 30 minutes of becoming ready. Record provider outages and budget holds separately; do not remove difficult cases from the denominator.
- Every decision is a useful approved/rejected/needs-more-data outcome with exact reasons. A deletion, timeout or queue movement is not an analysis completion. Zero live approvals may be a correct market outcome; replay controls distinguish that from a broken pipeline.
- All 25 profiles remain identity-checked and current. Every card explains products/services and customer groups, and reports country/share/year or an explicit missing-data statement. Audit all pilot cards for clarity; never invent customer names or use headquarters as revenue evidence.
- All AI requests are bounded by the SAME shared $10 rolling-24-hour fuse; warning at $6. Reconcile actual token receipts and expose unknown charges separately. The maximum is not a spending target. $10 used every day would be $300 in 30 days, excluding hosting.
- At least 80% of sampled cards are understandable and worth reviewing according to a written manager checklist: what the business sells, customers, geographic exposure, why now, supported price scenario, main risk, and what disproves it. This is a proposed usefulness target, not measured performance or a win-rate claim.

Scale 25 → 50 → 100 only after two consecutive technical windows pass. Change one thing per step: company count OR one feature. Retain the fixed comparison cohort, per-alert cost and rejected-case counts. Stop expansion on a quality or cost failure; fix the specific failure before adding scope.

## Launch work still needed

This branch is prepared for evaluation; a live isolated 25-company paid worker is not deployed. Before such a worker is launched, isolate its queue/results from production, keep its AI ledger shared with the existing workers (not a second $10 cap), and prove actual approval-to-delivery with a labelled test destination. Existing generic PR preview workers intentionally skip execution; a green preview is not live-pilot proof. Do not bypass those guards. Reuse saved sources and existing review capacity, and retain main's production state. No queue reset or production deletion is authorized.

The highest-value next task is the 25-company source audit: current financial statements, material assumptions, customer/segment context and revenue-country evidence. Then measure the existing Committee's decisions on those packets. Do not rewrite the broad engine to make this test possible.

## AI authorization correction and live verification

The user clarified on 28 September that Committee reviews should remain enabled under a $10 daily maximum. This supersedes the prior blanket monthly-budget hold for Committee calls. It does not authorize infrastructure expansion. The implementation uses a stricter rolling 24-hour limit shared by sensor and recovery, durable compare-and-set reservations before calls, bounded prompts/output, pinned `gpt-4.1-mini-2025-04-14`, and accounting failure protection.

The two existing workers were reconfigured, without changing main code or cron schedules. Sensor deployment `fb168d4f-900e-4e2d-b5f2-50748520f0f5`, recovery `cd35af21-d8d0-4512-a805-965e61c39559`. Prior deployment rollback references: sensor `0c64339d-8d53-4bf6-9a91-9036b5bf9cda`, recovery `a23e0de5-3086-4fe3-89a3-443cbd494cb6`. Restore these deployment settings only for a demonstrated incident, not solely because of the superseded hold. For a genuine runaway/accounting incident, the emergency brake is the two review-enabled flags; preserve the ledger and queued work.

Sensor cycle completed 28 September at 14:19:19 Bangkok: AEIS, AKAM and APAM each completed four selected Committee roles. Total token-receipt-based cost $0.026898, zero outstanding reservations, remaining rolling allowance $9.973102, zero approvals. These reviews requested updated financials and segment/customer details. They are completed reviews, not approved opportunities. Provider invoices are unavailable; token accounting is not a verified invoice. See Railway logs for fresh evidence before quoting this checkpoint as current.

## Traditional coding effort estimate

108,056 nonblank lines do not measure delivered investment value or time saved. An illustrative assumption of 100–250 accepted nonblank lines per engineer per working day gives 432–1,081 person-days, 3,458–8,644 person-hours at eight hours/day, or 86–216 working days for five engineers: roughly 4–10 months at 22 working days/month. This is arithmetic under an assumed productivity range, not an industry benchmark or a measured counterfactual. Reuse, generated code, duplication, integration, tests, scope changes and team coordination can dominate the result. A focused version of the desired product could require far less code.
