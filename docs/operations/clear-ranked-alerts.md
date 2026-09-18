# Clear, ranked alerts

Public alerts, the valuation watchlist, authenticated Serious Signals and dated research cards share price-scenario formatting. Buy opportunities precede Sell opportunities, each ordered by the potential move to the base estimate using its displayed price. Risk scores are never compared with return percentages. Live-price overlays are applied before ranking and limiting. Filters are applied before the public response limit.

Each price panel shows the recorded current price and observation time, conservative/base (middle)/best estimated cases, their percentage changes, upside/downside estimates where supported, and the time basis. A 100-to-50 decline is 50%, not the 100% premium to fair value. Selling owned shares avoids exposure; it does not automatically earn a short-sale profit.

The valuation review already uses a 6–24 month assessment window. The UI labels this as a model assumption with an unconfirmed target date. Historical event scenarios retain their recorded 1/3/7/30/90-day horizon. A general event assessment window cannot masquerade as a price-arrival forecast. Missing risk estimates stay unavailable: a conservative value above the current price does not mean zero downside. Reversed ranges and invalid prices cannot create a ranked gain.

Source documents remain available under Sources. Explanations describe business meaning and exclude filing headers, form numbers, legal boilerplate and references. Company descriptions require dated source evidence for products or services and customers, matched to the issuer. Missing company profiles trigger bounded evidence collection and hold publication; generic sector descriptions and missing-profile filler are not alert content. The Committee explainer is instructed to keep references in supporting evidence.

The API no longer truncates the mixed candidate list before selecting eligible opportunities. An absent watchlist limit now returns the intended 60 entries. An older valuation review cannot hide a new valuation screen or transfer approval to changed price evidence. Research history keeps original snapshot prices and dates and ranks the latest 30 snapshots separately from the current feed; its badges reflect the saved review status.

Validation: `smoke:signal-presentation` exercises return arithmetic, missing/invalid values, both ranking directions, live-price reordering before truncation, timeline provenance, filing-text removal, historical review identity, approval filtering and the default limit. Existing valuation Committee, delivery, live-surface and growth checks cover the surrounding contracts. Type checking, lint and production build remain required gates.

Committee provider failures must be distinct from missing research evidence. JSON response formatting and compact outputs address unusable paid responses; diagnostics retain safe HTTP categories and output truncation without logging credentials or raw provider error bodies. A shared provider failure stops the remaining role requests. Partial or failed reviews cannot approve a Serious Signal.

The cost ledger retains 45 days of audit entries while the spending guard continues to use its rolling 24-hour window. Complete token usage estimates, unknown-usage budget allocations and active reservations are reported separately. These are operational estimates, not provider invoices; historical coverage is marked incomplete until the retained history covers the requested window.

The existing provider and AI budgets, polling schedules, notification destinations and database schema remain unchanged. Roll out to the same four application services only; do not apply unrelated staged Railway settings.
