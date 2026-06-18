-- Historical Event Store v1: additive, nullable fields only.
-- This safely reuses the existing historical_events table without overwriting data.
ALTER TABLE historical_events
  ADD COLUMN IF NOT EXISTS industry text,
  ADD COLUMN IF NOT EXISTS source_receipts jsonb NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS price_after_3d numeric(12,2),
  ADD COLUMN IF NOT EXISTS price_after_90d numeric(12,2),
  ADD COLUMN IF NOT EXISTS max_gain numeric(8,4),
  ADD COLUMN IF NOT EXISTS max_drawdown numeric(8,4),
  ADD COLUMN IF NOT EXISTS volume_before_event numeric(20,2),
  ADD COLUMN IF NOT EXISTS volume_after_event numeric(20,2),
  ADD COLUMN IF NOT EXISTS revenue_growth_at_time numeric(8,4),
  ADD COLUMN IF NOT EXISTS margin_trend text,
  ADD COLUMN IF NOT EXISTS cash_flow_trend text,
  ADD COLUMN IF NOT EXISTS debt_level text,
  ADD COLUMN IF NOT EXISTS valuation_at_time text,
  ADD COLUMN IF NOT EXISTS analyst_changes jsonb NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS insider_activity text,
  ADD COLUMN IF NOT EXISTS macro_snapshot jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS sector_trend text,
  ADD COLUMN IF NOT EXISTS pattern_tags jsonb NOT NULL DEFAULT '[]';

CREATE INDEX IF NOT EXISTS historical_events_outcome_label_event_date_idx ON historical_events (outcome_label, event_date DESC);
CREATE INDEX IF NOT EXISTS historical_events_sector_event_date_idx ON historical_events (sector, event_date DESC);
