-- Raw Signal Store v1: additive-only table/column setup.
CREATE TABLE IF NOT EXISTS "raw_signals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "source" text NOT NULL,
  "ticker" text,
  "signal_type" text NOT NULL DEFAULT 'general',
  "title" text NOT NULL DEFAULT 'Untitled raw signal',
  "summary" text NOT NULL DEFAULT '',
  "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "received_at" timestamptz(6) NOT NULL DEFAULT now(),
  "processed_status" text NOT NULL DEFAULT 'new',
  "importance_hint" text NOT NULL DEFAULT 'medium',
  "source_url" text,
  "created_at" timestamptz(6) NOT NULL DEFAULT now()
);

ALTER TABLE "raw_signals" ADD COLUMN IF NOT EXISTS "signal_type" text NOT NULL DEFAULT 'general';
ALTER TABLE "raw_signals" ADD COLUMN IF NOT EXISTS "title" text NOT NULL DEFAULT 'Untitled raw signal';
ALTER TABLE "raw_signals" ADD COLUMN IF NOT EXISTS "summary" text NOT NULL DEFAULT '';
ALTER TABLE "raw_signals" ADD COLUMN IF NOT EXISTS "processed_status" text NOT NULL DEFAULT 'new';
ALTER TABLE "raw_signals" ADD COLUMN IF NOT EXISTS "importance_hint" text NOT NULL DEFAULT 'medium';
ALTER TABLE "raw_signals" ADD COLUMN IF NOT EXISTS "source_url" text;
ALTER TABLE "raw_signals" ADD COLUMN IF NOT EXISTS "created_at" timestamptz(6) NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS "raw_signals_received_at_idx" ON "raw_signals" ("received_at" DESC);
CREATE INDEX IF NOT EXISTS "raw_signals_source_received_at_idx" ON "raw_signals" ("source", "received_at" DESC);
