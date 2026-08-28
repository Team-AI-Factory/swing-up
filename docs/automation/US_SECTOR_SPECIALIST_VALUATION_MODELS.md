# U.S. Sector Specialist Valuation Models

## Purpose

The production foundation deliberately avoids generic corporate Buy/Sell valuation for banks, financial companies, insurers, real estate/REITs and utilities because ordinary earnings/free-cash-flow rules can be misleading in those sectors.

The production foundation now applies dedicated specialist valuation to those sectors. A specialist result never bypasses the downstream Serious Signal evidence, current-price, halt, committee and Final Judge gates.

## Stacking rule

Layer 1 is wired into the canonical daily foundation path on `main`. Its provisional Buy/Sell/Watch Out research appears in the authenticated Valuation Watchlist with `userAlertEligible: false`. Layer 2 remains the fail-closed event-time authority: current primary evidence is required before any candidate can reach the Committee or become a Serious Signal.

## Two-layer specialist design

### Layer 1 — sector valuation

`lib/opportunity-engine/us-sector-specialist-valuation.ts`

Provides conservative sector-appropriate valuation methods and avoids applying generic corporate rules where they are economically wrong.

### Layer 2 — adversarial intelligence

`lib/opportunity-engine/us-sector-specialist-intelligence.ts`

Takes the base valuation plus current sector evidence and market movement, then:

- scores evidence source quality and freshness;
- requires primary-source critical metrics for directional promotion;
- detects conflicting and stale evidence;
- checks sector-specific quality and risk drivers;
- constructs an explicit anti-thesis and contradiction list;
- creates a conservative bear/base/bull scenario overlay;
- separates price movement from fundamental evidence;
- calculates Buy, Sell and Watch Out opportunity scores;
- identifies abnormal company-specific movement versus sector/market movement;
- produces an urgent research queue even when evidence is not yet strong enough to promote;
- lists the exact missing evidence that should be fetched next;
- fails closed to `watch` or `research_only` when evidence is not decision-grade.

A large stock move can increase urgency. It can never create Serious Signal authority by itself.

## Evidence reliability

Each specialist metric carries provenance:

- value and previous value;
- observation date;
- source type;
- primary-source flag;
- estimated flag;
- conflict flag;
- optional source URL.

Highest trust is given to current regulatory filings/data and SEC filings, followed by issuer IR. Market data is useful for price/movement. Derived data is lower confidence. Analyst estimates can inform context but cannot replace primary evidence for a sector-critical metric.

A current price move with missing sector evidence is therefore treated as `urgentResearch`, not as a Buy/Sell.

## Banks

### Valuation anchors

- tangible/book value adjusted for ROE/ROA economics;
- normalized earnings power.

Generic corporate FCF/current-ratio/debt-to-equity rules are not mandatory bank gates.

### Critical intelligence

- tangible book value per share;
- ROTCE/ROE/ROA;
- CET1/capital buffer;
- net interest margin and sequential NIM change;
- deposit growth and uninsured deposit concentration;
- loan/deposit ratio;
- non-performing loans and net charge-offs;
- allowance coverage;
- CRE concentration;
- AOCI relative to tangible equity.

The specialist specifically challenges apparent NIM/earnings improvement when deposits are leaving, and challenges high profitability when capital is thin.

## Other financial companies

The specialist changes emphasis by business model instead of treating every financial company the same.

### Asset managers

- AUM growth;
- organic net flows;
- effective fee rate and mix;
- recurring revenue;
- operating margin.

It distinguishes market-driven AUM growth from genuine client inflows and flags fee-rate dilution.

### Brokers / exchanges / capital markets

- client asset growth;
- recurring revenue;
- compensation ratio;
- operating margin;
- activity mix.

### Specialty lenders / credit businesses

- credit-loss ratio;
- regulatory/capital buffer where relevant;
- leverage;
- operating margin;
- delinquency/provision trend in later primary-source diligence.

## Insurers

### Valuation anchors

- ROE-adjusted book value;
- normalized earnings.

### Critical intelligence

- risk-based capital;
- combined/loss ratio where applicable;
- premium growth;
- reserve development;
- investment yield;
- unrealized investment losses versus equity;
- catastrophe loss burden;
- statutory capital growth.

The model treats RBC as a solvency tool, not a company-ranking shortcut. It flags rapid premium growth with poor underwriting and higher investment income accompanied by large unrealized losses.

## Real estate / REITs

Generic EPS and FCF are not primary valuation anchors because depreciation and property/leasing capex can distort them.

### Base valuation

- conservative book/NAV proxy;
- EV/EBITDA proxy.

### Preferred specialist evidence

- FFO and AFFO per share;
- FFO growth;
- same-store NOI growth;
- occupancy and rent growth;
- current NAV per share;
- implied cap rate;
- net debt / EBITDA;
- fixed-rate debt percentage;
- weighted debt cost and maturity;
- dividend payout versus AFFO.

The intelligence layer detects cases where high occupancy hides falling NOI or where AFFO is materially below FFO because recurring capital/leasing costs are higher than headline FFO suggests.

## Utilities

### Base valuation

- ROE-adjusted book value;
- normalized earnings;
- EV/EBITDA cross-check.

Negative generic FCF is not automatically bad during regulated capital investment.

### Critical intelligence

- rate-base growth;
- allowed ROE versus earned ROE;
- regulatory equity capital ratio;
- interest coverage;
- debt/capital;
- regulatory assets versus equity;
- capex/rate base;
- customer/load growth;
- pending rate-case impact;
- dividend payout;
- material wildfire/storm/nuclear/environmental liabilities.

The model challenges high capex/rate-base growth when earned ROE is materially below allowed ROE because growth is only valuable if shareholders actually earn an adequate return on the new capital.

## Market-movement intelligence

The specialist compares the stock's 1-day and 5-day move with its sector and the market and checks relative volume.

Examples:

- stock -12%, bank sector -2% -> company-specific selloff; immediately check deposits, credit, capital and NIM;
- stock -5%, bank sector -5% -> mostly sector move; do not invent company-specific bad news;
- stock +10%, utility sector +1% while valuation is already stretched -> test whether the market has over-priced a catalyst;
- large movement but no decision-grade sector evidence -> urgent research only.

This preserves fast opportunity discovery without letting price action become evidence of its own correctness.

## Adversarial / anti-thesis rules

Before directional promotion, each specialist asks what would make its own conclusion wrong.

Examples include:

- bank NIM expands while deposits contract;
- insurer premium growth accelerates while combined ratio deteriorates;
- REIT occupancy looks high but same-store NOI falls;
- utility rate base grows while earned ROE materially trails allowed ROE;
- asset-manager AUM rises while net client flows are negative.

Conflicting critical evidence, stale critical evidence, insufficient primary-source coverage or a hard sector-risk flag prevents directional promotion.

## Universal safety rules

Every specialist:

- requires at least two usable valuation methods for Buy/Sell promotion;
- requires sector-specific evidence completeness;
- requires valuation-method agreement;
- uses conservative margin-of-safety thresholds;
- requires decision-grade sector evidence for v2 directional promotion;
- fails to `watch` or `research_only` when required evidence is missing;
- can identify an urgent research opportunity without prematurely calling it a Buy/Sell;
- can emit a specialist Watch Out when sector risk is extreme;
- never publishes, notifies, trades or writes production data itself.

## Current layer-1 thresholds

| Sector | Evidence | Max method spread | Buy base upside | Buy conservative upside | Max Buy risk |
| --- | ---: | ---: | ---: | ---: | ---: |
| Bank | 80 | 50% | 35% | 20% | 45 |
| Other financial | 70 | 55% | 40% | 20% | 45 |
| Insurer | 80 | 50% | 35% | 20% | 50 |
| REIT / real estate | 80 | 45% | 45% | 25% | 50 |
| Utility | 70 | 50% | 30% | 20% | 55 |

The v2 layer adds evidence reliability, primary-source coverage, adversarial risk, market-relative movement and scenario skew on top of these base thresholds.

## External framework references

The model design follows sector-specific public reporting/regulatory concepts rather than generic corporate ratios:

- FDIC Quarterly Banking Profile / Graph Book: NIM, ROA/ROE, deposits, capital, loan growth, noncurrent loans and charge-offs.
- Federal Reserve supervision/stress framework: bank credit, liquidity, funding, interest-rate and CET1 stress.
- NAIC Risk-Based Capital and solvency guidance: insurer capital, underwriting, asset, interest-rate and catastrophe risks.
- Nareit: FFO/AFFO, NOI, occupancy, leverage and implied cap-rate concepts.
- FERC formula-rate / Form 1 framework: rate base, allowed return, capital structure, O&M, depreciation and regulatory cost recovery.

These are analytical frameworks, not hard-coded legal conclusions. Company-specific current filings remain the source of truth.

## Validation

Dedicated tests now cover:

- healthy bank selloff becomes a high-priority Buy only with decision-grade bank evidence;
- a large price move cannot self-promote without evidence;
- conflicting bank capital data fails closed;
- stale critical data fails closed;
- stressed bank becomes Watch Out;
- low-RBC / deteriorating insurer becomes Watch Out;
- high-quality REIT selloff can become Buy with FFO/NOI/occupancy/leverage evidence;
- overvalued/weak utility rally can become Sell;
- asset-manager AUM growth with net outflows triggers an anti-thesis rather than a naive Buy;
- generic baseline specialist tests remain intact.

## Merge rule

Do not merge this stacked PR directly to production while PR262 remains unmerged. Once PR262 is canonical `main`:

1. re-verify the new `main` SHA;
2. retarget/rebase this PR to that SHA;
3. build targeted primary-source extraction for the new sector metrics;
4. integrate layer 1 + layer 2 into production company-first and event-triggered value refresh paths;
5. run whole-app typecheck/lint/build and all Serious Signal/value/safety workflows;
6. run real-data sector examples for all five model families;
7. perform a separate valuation-model and false-positive review;
8. request explicit human approval before merge.
