create table if not exists asset_universe (
  id uuid primary key default gen_random_uuid(), asset_type text not null, symbol text not null, name text, exchange text, country text,
  currency text, sector text, industry text, provider_sources jsonb not null default '[]', first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(), active boolean not null default true, priority_tier integer not null default 3,
  coverage_status text not null default 'seeded_from_existing_repo', created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(asset_type, symbol)
);
create index if not exists asset_universe_rotation_idx on asset_universe(active, priority_tier, asset_type, country, exchange, updated_at);

alter table source_freshness_ledger add column if not exists asset_type text;
alter table source_freshness_ledger add column if not exists skip_reason text;

create table if not exists autonomous_source_engine_runs (
  id uuid primary key default gen_random_uuid(), mode text not null, dry_run boolean not null, calls_used integer not null default 0,
  signals_created integer not null default 0, proof_receipts_created integer not null default 0, summary jsonb not null default '{}',
  safe_errors jsonb not null default '[]', created_at timestamptz not null default now()
);
create index if not exists autonomous_source_engine_runs_created_idx on autonomous_source_engine_runs(created_at desc);
