ALTER TABLE "pattern_matches" ADD COLUMN IF NOT EXISTS "raw_signal_id" uuid REFERENCES "raw_signals"("id");
ALTER TABLE "pattern_matches" ADD COLUMN IF NOT EXISTS "ticker" text;
ALTER TABLE "pattern_matches" ADD COLUMN IF NOT EXISTS "match_score" numeric(5,2);
ALTER TABLE "pattern_matches" ADD COLUMN IF NOT EXISTS "match_reason" text;
ALTER TABLE "pattern_matches" ADD COLUMN IF NOT EXISTS "matched_features" jsonb NOT NULL DEFAULT '[]';
ALTER TABLE "pattern_matches" ADD COLUMN IF NOT EXISTS "confidence_label" text NOT NULL DEFAULT 'none';
ALTER TABLE "pattern_matches" ADD COLUMN IF NOT EXISTS "created_at" timestamptz(6) NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS "pattern_matches_created_at_idx" ON "pattern_matches" ("created_at" DESC);
CREATE INDEX IF NOT EXISTS "pattern_matches_raw_signal_id_idx" ON "pattern_matches" ("raw_signal_id");
CREATE INDEX IF NOT EXISTS "pattern_matches_historical_event_id_idx" ON "pattern_matches" ("historical_event_id");
