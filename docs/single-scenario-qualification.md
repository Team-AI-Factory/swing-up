# One annual SEC scenario: restricted-beta qualification

This local follow-on implements adopted launch-tradeoff item 3 on frozen beta production tree `dfa0aab9b429cc627346232286c506389783d13c`. It is not a live-model, deployment, delivery or investment-performance certificate. The original production confidence score is retained, normally 69 for a one-method scanner result. No score is raised and no generic confidence threshold is reduced.

## Exactly what changes

Only the approved 25-company pilot's direct `valuation_gap` route can use policy `sec-annual-single-scenario-v1`. The original multi-method route is unchanged. Risk-only Watch Out and non-valuation event candidates cannot borrow this qualification.

An existing already-budgeted scanner snapshot may enqueue a narrowly applicable single-method **research** case. This does not establish an actionable quote, SEC facts, paid-review approval or publication. The runner still collects the exact company's facts and required filings, checks the current quote and halt state, and revalidates the rule. There are no new provider calls, model tiers, costs, limits, services or schedules in the discovery change.

The separate rule replaces the method-count-dependent confidence gate only. Its non-method arithmetic is:

`N = 30 + 0.20 × financialCompleteness + 0.14 × businessQuality − 0.08 × risk`, requiring `N >= 51`.

The existing generic formula adds 12 points per method, up to 36. A two-method case therefore contributes 24 method points toward the generic minimum 75. Requiring 51 preserves its non-method component; it is slightly stricter than the rounded two-method cutoff of 50.5. This is an explicit product admission policy, **not empirical calibration, a probability, or proof of investment accuracy**. The new route neither passes arbitrary capped-69 cases nor invents a second method. Financial completeness must still be at least 75; positive direction must still satisfy business quality ≥70, balance sheet ≥50 and risk ≤45. The stronger publication evidence-truth ≥80 and independence ≥78 checks also still apply.

Original candidate score ≥72, at least 20% current/base gap, correct direction and original publication materiality ≥65 remain. All stored scalar gates must be finite and valid. Scores are reconstructed from the bound snapshot; event truth and independence must equal the original completeness value, displayed confidence must equal the unchanged scanner formula, and saved score/materiality cannot exceed their current recomputation. Source/issuer scope, current actionable quote/session, no rumour, severe contradiction/priced-in holds, full required financial transport, all required roles and positive Final Judge ≥80 remain mandatory.

## Supported economic case

- One earnings-power or owner-earnings/FCF method only
- Limited operating-company sectors: technology, technology services, electronic technology, commercial/consumer services, producer manufacturing or industrial services, with a stated industry
- Banks, credit/financial/insurance, investment, REIT/real-estate/mortgage, biotechnology, extraction/mining/oil/gas are excluded from this generic rule
- Existing structured engine parameter: 8–26× earnings or 4.5–10% required FCF yield; it is explicitly a **model assumption**, not an SEC statement
- Base within 0.2×–5× the actual current quoted share price
- Exactly the engine's rounded base and mechanical 0.8×–1.2× sensitivity range; arbitrary endpoints, unsupported normalization and provider/analyst targets cannot qualify

The sector restrictions are conservative applicability exclusions, not a claim that a generic multiple is economically sufficient for every eligible business. The required valuation reviewer, skeptic and Final Judge still assess sustainability, business economics, contradictions and downside. A valid calculation is necessary, not final approval.

## Source basis and deliberately narrow period coverage

This is explicitly a **reported annual SEC scenario**. It does not certify that a provider's undated TTM number has been reconciled. `annualCalculation.providerTtmReconciled` remains false and reviewer/public text says so.

The exact base must reproduce, within one-cent output rounding, from actual selected annual SEC facts and the full-precision structured model parameter:

- Earnings: annual diluted EPS × assumed multiple
- FCF: (annual operating cash flow − annual capital expenditure) ÷ dated shares outstanding ÷ assumed yield

Every required fact has an exact requested SEC companyfacts URL, response-verified issuer CIK, finite value, correct USD/USD-per-share/share units, valid annual filing form, concept and accession. All required income/cash-flow/EPS facts must have the same annual start/end period; equity and share count must have the same end date. Filing dates cannot be future or precede period end; period end cannot exceed 550 days of age. Latest/interim and annual facts cannot be mixed even if their numeric values happen to match. Negative/zero required financial amounts fail; capex may legitimately be zero. Original missing-fact and financial-document checks remain in addition.

This deliberately excludes many otherwise researchable cases, including a current interim period that has not been explicitly reconciled to the annual model. It does not manufacture annualized, normalized or adjusted figures. A future TTM/reconciliation policy needs its own source-backed implementation and review. SEC filing accessions are format-validated and bound exactly; their prefix is not assumed to be the issuer CIK, because filing agents may submit filings.

## Review, replay, delivery and cost

The bound single-scenario evidence contains the original model scores/fundamentals/range, full-precision assumption, exact annual inputs and all required primary fact atoms, including issuer, units, periods, concepts and accessions. Every producer and delivery boundary recomputes support from those inputs. It is included in the terminal **publication packet**, preventing an old approval from authorizing changed assumptions, sources, periods or facts.

The existing substantive source-evidence keys, technical-recovery rules, paid count/money locks and durable deduplication keys are unchanged. A model/policy/timestamp change does not establish new external evidence or buy a new review. Existing terminal holds are checked first; this change never automatically re-reviews old rejected or incomplete unchanged cases.

The one-method route has a documented narrow pre-review hold: after durable history lookup, a deterministically impossible single-scenario case (missing/inconsistent facts, quality/risk/materiality, incomplete filing transport, source or quote hold) cannot reserve its normal paid review. General inclusive research policy remains unchanged. New relevant evidence or an already permitted technical recovery can still advance under existing rules. No cap is increased.

All four valuation roles must complete: analyst, valuation reviewer, skeptic and Final Judge. A coherently shortened saved plan cannot omit the valuation reviewer. Final Judge must be positive and ≥80; rejected, missing-data, failed and timed-out review results cannot publish. The exact annual SEC proof supplies the official financial source only for this route; TradingView discovery is never marked official.

New and pending delivery recheck the current quote and evidence before sending. Already delivered receipts remain historical and duplicates reuse them; stale archived alerts become currently ineligible. The authenticated feed and delivery text explain the annual basis, explicit model parameter, mechanical sensitivity and unchanged scanner confidence. Real alerts still need their own authentic approval and delivery receipt.

## Local validation

`node scripts/single-valuation-scenario-smoke.mjs` checks arithmetic, applicability, parameter bounds, missing facts and nonpilot behavior.

The independent date review identified and closed an invalid-calendar-start normalization bug; `2025-02-30` now fails instead of being normalized by Date.parse.

`node scripts/single-scenario-publication-smoke.mjs` starts with synthetic raw provider `s`/`d` rows, uses the actual parser, scanner, hardener, SEC companyfacts bridge, event job, four-role Committee orchestration, terminal journal, outbox and authenticated delivery functions. Only network/model/storage are synthetic. It covers EPS and FCF positives plus malformed/changed issuer, units, dates, same-number wrong periods, missing inputs, unsupported assumptions, extreme values, weak non-method quality, stale quotes, failed/incomplete/rejected review, duplicate delivery and current status. Real networking is blocked; the script asserts zero real network attempts.

These tests establish mechanical reachability and safety behavior only. The release owner must independently review exact final bytes and perform the existing shipped-version CI, bounded live-model and isolated delivery gates before deployment is considered verified.
