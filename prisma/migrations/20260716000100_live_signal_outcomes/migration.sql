-- Live signal evidence and outcome provenance. Additive only: no existing rows are removed.
ALTER TABLE "alert_scores"
  ADD COLUMN IF NOT EXISTS "input_completeness" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "live_data_ready" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "missing_inputs" JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS "input_provenance" JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE "price_snapshots"
  ADD COLUMN IF NOT EXISTS "alert_id" UUID,
  ADD COLUMN IF NOT EXISTS "provider" TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS "provider_asset_id" TEXT,
  ADD COLUMN IF NOT EXISTS "currency" TEXT NOT NULL DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS "source_url" TEXT,
  ADD COLUMN IF NOT EXISTS "data_quality" TEXT NOT NULL DEFAULT 'unverified';

ALTER TABLE "price_snapshots"
  ALTER COLUMN "price" TYPE DECIMAL(20,8);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'price_snapshots_alert_id_fkey'
  ) THEN
    ALTER TABLE "price_snapshots"
      ADD CONSTRAINT "price_snapshots_alert_id_fkey"
      FOREIGN KEY ("alert_id") REFERENCES "alerts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "price_snapshots_alert_id_provider_captured_at_key"
  ON "price_snapshots"("alert_id", "provider", "captured_at");
CREATE INDEX IF NOT EXISTS "price_snapshots_alert_id_captured_at_idx"
  ON "price_snapshots"("alert_id", "captured_at");
CREATE INDEX IF NOT EXISTS "price_snapshots_ticker_data_quality_captured_at_idx"
  ON "price_snapshots"("ticker", "data_quality", "captured_at");

ALTER TABLE "ai_committee_runs"
  ALTER COLUMN "dry_run" SET DEFAULT false;
