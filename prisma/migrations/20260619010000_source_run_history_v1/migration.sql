create table source_runs (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  started_at timestamptz not null,
  finished_at timestamptz not null,
  status text not null,
  dry_run boolean not null default true,
  records_checked integer not null default 0,
  signals_created integer not null default 0,
  duplicates_skipped integer not null default 0,
  errors jsonb not null default '[]'::jsonb,
  source_health_status text,
  created_at timestamptz not null default now()
);

create index source_runs_started_at_idx on source_runs (started_at desc);
create index source_runs_source_started_at_idx on source_runs (source, started_at desc);
