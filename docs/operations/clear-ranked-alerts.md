# Clear, ranked alerts

Public alerts, the valuation watchlist, authenticated Serious Signals and dated research cards share price-scenario formatting. Buy opportunities precede Sell opportunities, each ordered by the potential move to the base estimate using its displayed price. Risk scores are never compared with return percentages. Live-price overlays are applied before ranking and limiting. Filters are applied before the public response limit.

Each price panel shows the recorded current price and observation time, conservative/base/optimistic prices, their percentage changes, upside/downside estimates where supported, and the time basis. A 100-to-50 decline is 50%, not the 100% premium to fair value. Selling owned shares avoids exposure; it does not automatically earn a short-sale profit.

The valuation review already uses a 6–24 month assessment window. The UI labels this as a model assumption with an unconfirmed target date. Historical event scenarios retain their recorded 1/3/7/30/90-day horizon. A general event assessment window cannot masquerade as a price-arrival forecast. Missing risk estimates stay unavailable: a conservative value above the current price does not mean zero downside. Reversed ranges and invalid prices cannot create a ranked gain.

Source documents remain available under Sources. Explanations describe business meaning and exclude filing headers, form numbers, legal boilerplate and references. Older saved event cards are cleaned on read; their review status is preserved. Company descriptions use the available verified description or known industry, with an explicit gap when neither is available. The Committee explainer is instructed to keep references in supporting evidence.

The API no longer truncates the mixed candidate list before selecting eligible opportunities. An absent watchlist limit now returns the intended 60 entries. An older valuation review cannot hide the next day's valuation screen or transfer approval to it. Research history keeps original snapshot prices and dates and ranks the latest 30 snapshots separately from the current feed.

Validation: `smoke:signal-presentation` exercises return arithmetic, missing/invalid values, both ranking directions, live-price reordering before truncation, timeline provenance, filing-text removal, historical review identity, approval filtering and the default limit. Existing valuation Committee, delivery, live-surface and growth checks cover the surrounding contracts. Type checking, lint and production build remain required gates.

No provider or AI budget, polling schedule, Serious publication approval rule, notification destination, database schema or staged Railway setting changes are included. Roll out to the same four application services only.
