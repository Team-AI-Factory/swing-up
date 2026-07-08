CREATE TABLE IF NOT EXISTS market_price_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker text NOT NULL,
  provider text NOT NULL,
  source_url text,
  latest_price numeric(20,6),
  currency text,
  volume numeric(24,4),
  average_volume numeric(24,4),
  price_change_1d numeric(14,6),
  price_change_5d numeric(14,6),
  price_change_20d numeric(14,6),
  previous_close numeric(20,6),
  open numeric(20,6),
  high numeric(20,6),
  low numeric(20,6),
  timestamp_from_provider timestamptz NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT now(),
  market_session text,
  raw_stored_in_r2 boolean NOT NULL DEFAULT false,
  r2_object_key text,
  data_quality text NOT NULL DEFAULT 'partial',
  unavailable_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT market_price_snapshots_not_null_only CHECK (
    latest_price IS NOT NULL OR volume IS NOT NULL OR average_volume IS NOT NULL OR
    price_change_1d IS NOT NULL OR price_change_5d IS NOT NULL OR price_change_20d IS NOT NULL OR
    previous_close IS NOT NULL OR open IS NOT NULL OR high IS NOT NULL OR low IS NOT NULL
  ),
  CONSTRAINT market_price_snapshots_price_non_negative CHECK (latest_price IS NULL OR latest_price >= 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS market_price_snapshots_ticker_provider_ts_uq ON market_price_snapshots (ticker, provider, timestamp_from_provider);
CREATE INDEX IF NOT EXISTS market_price_snapshots_latest_idx ON market_price_snapshots (ticker, captured_at DESC);
CREATE INDEX IF NOT EXISTS market_price_snapshots_quality_idx ON market_price_snapshots (ticker, data_quality, captured_at DESC);
