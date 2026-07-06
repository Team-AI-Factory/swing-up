CREATE TABLE IF NOT EXISTS live_event_calendar (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_id text NOT NULL, event_type text NOT NULL, source text NOT NULL, title text NOT NULL,
  ticker text, company text, asset_type text, country text, sector text,
  related_symbols jsonb NOT NULL DEFAULT '[]', related_keywords jsonb NOT NULL DEFAULT '[]', related_sector_baskets jsonb NOT NULL DEFAULT '[]', related_keyword_baskets jsonb NOT NULL DEFAULT '[]',
  scheduled_at timestamptz, expected_end_at timestamptz, source_url text, source_reliability integer NOT NULL DEFAULT 50, priority integer NOT NULL DEFAULT 50,
  listen_harder_from timestamptz, listen_harder_until timestamptz, status text NOT NULL DEFAULT 'unknown', raw_storage_ref text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS live_event_calendar_dedupe_idx ON live_event_calendar(source,event_id,coalesce(ticker,''),coalesce(scheduled_at,'epoch'::timestamptz));
CREATE INDEX IF NOT EXISTS live_event_calendar_window_idx ON live_event_calendar(status,listen_harder_from,listen_harder_until,scheduled_at);
CREATE TABLE IF NOT EXISTS serious_signal_action_queue (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), story_cluster_id uuid, ticker text, event_type text, action_type text NOT NULL, priority integer NOT NULL DEFAULT 50, reason text NOT NULL, required_proof_types jsonb NOT NULL DEFAULT '[]', missing_proof_types jsonb NOT NULL DEFAULT '[]', next_source_to_call text, source_call_budget integer NOT NULL DEFAULT 1, status text NOT NULL DEFAULT 'pending', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE serious_signal_action_queue ADD COLUMN IF NOT EXISTS live_event_id text;
CREATE UNIQUE INDEX IF NOT EXISTS serious_signal_action_queue_live_event_dedupe_idx ON serious_signal_action_queue(coalesce(live_event_id,''),coalesce(ticker,''),action_type) WHERE live_event_id IS NOT NULL;
