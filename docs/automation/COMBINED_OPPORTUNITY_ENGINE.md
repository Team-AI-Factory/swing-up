# Combined Opportunity Engine — PR #262

## Binding scope

This branch is `agent/combined-opportunity-engine` for draft PR #262 only. It must remain isolated from PR #261 and `main`. It scans only active U.S.-listed common stocks and ADRs. Persistent branch state belongs only under the Cloudflare R2 prefix `branch-labs/pr-262/`. No production publishing, user notifications, trades, PostgreSQL writes, production migrations, Railway Volume fallback, secret changes, auto-merge, or merge to `main` are allowed from this branch.

## Primary objective

Find high-quality Buy, Sell, and Watch Out opportunities by understanding each company before the opportunity arrives. The primary investment style is company-first and value-first: analyze the business, estimate a conservative fair-value range, store the thesis in R2, monitor the price, and react to new material information as a change to that stored thesis.

Buy discovery has priority because the user wants more investable upside opportunities, but Sell and Watch Out coverage must continue and their standards must not be neglected.

## Leading-indicator Buy architecture

The primary Buy path is **source first, price second**. A stock-price move is never required to discover a Buy catalyst.

Correct order:

1. Detect a new official SEC filing, issuer/company announcement, regulator/government source, or decision-relevant news item.
2. Map it to the exact pre-analysed company or to a stored strategic relationship of that company.
3. Read the full source content. For SEC 8-K/6-K index pages, follow the filing into the primary document and relevant Exhibit 99 / earnings / press-release exhibits.
4. Determine what actually changed in revenue, costs, margins, cash flow, balance-sheet risk, customer demand, competitive position, strategic assets, or future optionality.
5. Compare the new information with the stored company thesis, long-term SEC normalization, and conservative/base/optimistic fair-value range.
6. Only after the source has been read and understood, obtain the current stock price and independently cross-check it.
7. Decide Serious Buy, Buy candidate, research-only, Sell, or Watch Out.

The system records whether the later price check shows `before_visible_move`, `early_repricing`, or `already_repriced`. This proves whether the alert actually behaved as a leading indicator rather than claiming first-mover status after the fact.

### Fast official SEC lane

`us-fast-sec-buy-radar` polls free official SEC 8-K and 6-K current-filing feeds independently of the broader research cycle. Its default polling interval is 60 seconds. It consumes no paid-news API allowance. A fresh filing is identified by CIK, the filing/exhibit is read, and only then is the stock price requested.

This fast lane is for low-latency official material information. It must not require an unusual price move, volume spike, analyst estimate, or news headline before reading the filing.

### Broad source-first lane

`us-preprice-buy-radar` reads the broader SEC, issuer/announcement, regulator, government, discovery-news, and public-data source set. Cheap broad discovery can inspect hundreds of source items. Full-content reading is reserved for the highest-priority mapped candidates; a dedicated priority lane may read up to 40 pages in a busy cycle while ordinary scans retain lower default limits.

Headline-only evidence cannot create a Serious Buy.

### Reaction radar is fallback only

The positive-price-reaction earnings radar remains as a redundant recovery mechanism. It can catch something that source-first intake missed, but it is not the primary discovery path and must never be described as first-mover logic.

## Strategic optionality and multi-layer causation

Company value must not be analysed in one layer. Material relationships with private companies, strategic investments, cloud customers, suppliers, joint ventures, or likely liquidity events must be treated as separate economic layers when the evidence supports them.

For example, a strategic AI relationship can affect a public company through:

- recurring operating revenue from cloud/compute/services;
- infrastructure and custom-chip demand;
- the fair value of an equity or convertible investment;
- ecosystem pull-through into other products;
- an IPO/direct-listing/liquidity event that improves price discovery;
- future funding obligations or contractual cash commitments;
- capital expenditure required to serve the demand; and
- competitive dependence or concentration risk.

The model must separate mark-to-market/non-operating investment gains from recurring operating earnings. Disclosed commercial commitments may be quantified as scenario evidence, but gross customer spend is not profit. The system must not invent an undisclosed margin or future revenue and must not add the same economics twice. An IPO filing is optionality, not a guarantee of timing, pricing, completion, or a higher valuation.

## Company-first foundation path

Analyze active U.S.-listed common stocks and ADRs in advance rather than waiting for news. Score business quality, profitability, cash generation, balance-sheet strength, growth durability, evidence completeness, and fundamental risk. Estimate conservative/base/optimistic fair value from independent earnings-power, owner-earnings/free-cash-flow, and Graham-style methods where data permits. Analyst target prices are optional context and are not intrinsic value.

Store every analysed company in branch-scoped R2 shards or store a clear insufficient-evidence reason. Maintain quality-company buy-below and strong-buy price watchlists.

## Mandatory diligence

Every provisional foundation Buy, Sell, or Watch Out and every important catalyst company must be deep-checked against official SEC Company Facts or the best available primary filing. Checks include debt and near-term refinancing, operating-cash-flow/free-cash-flow conversion, one-time tax or asset-sale gains, multi-year revenue durability, reinvestment/capital-expenditure burden, and direct retention/renewal/backlog/customer-concentration disclosures when available. Never invent retention. Multi-year revenue durability is a proxy only when direct retention disclosure is unavailable.

A foundation Serious Buy requires fair-value and safety gates plus SEC buy-quality confirmation. A foundation Sell requires reliable normalized valuation inputs and deterioration or an unjustified premium. A foundation Watch Out requires confirmed fundamental stress.

## Historical event pilot

Serious event-driven Buy or Sell requires at least five independent real leakage-safe same-company or same-industry events supporting the same direction. Same-sector history is fallback only when industry classification is unavailable. Four successful outcomes out of five satisfy the 80% Pilot-5 threshold. A usable common horizon and non-negative lower-quartile direction-adjusted result are also required. This pilot is not statistically equivalent to a 30-plus-sample certificate.

Analyst expectations are optional context and cannot veto a Buy. Swing Up does not wait for its own later forward outcome before issuing a currently qualified alert; later outcomes are an immutable transparency and learning ledger and losing outcomes must never be removed or retuned away.

## Watch Out

The separately certified extreme-volatility rule retains its historical-certification label. User-approved P0/P1 rules may emit evidence-triggered serious internal Watch Out alerts when their rule-specific gates pass. Crowded short/squeeze (#6), issuer-specific rate/inflation/currency/commodity sensitivity (#18), and extreme valuation with reversal (#20) remain disabled until dependable data and stable validation exist.

## Scheduling

- Fast official SEC 8-K/6-K Buy lane: default 60-second polling.
- Broad branch cycle: approximately every five minutes.
- Resumable full-company valuation: persisted in 500-company R2 batches and safely resumed across timeout/redeployment.
- ChatGPT condition-watch notification layer: hourly, because hourly is the fastest supported automation cadence; Railway detection and R2 recording happen independently and faster.

## Truthfulness rule

The system may aim to be early, but it must never claim guaranteed first access to public information. Public filings and announcements are available to other market participants at the same time, and low-latency trading systems may react in milliseconds. Swing Up proves its actual timing by storing the source publication time, source-read time, price-check time, and first-mover-status label for each candidate.
