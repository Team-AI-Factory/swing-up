alter table raw_signals
  add column if not exists signal_type text not null default 'unknown',
  add column if not exists title text not null default 'Untitled raw signal',
  add column if not exists summary text,
  alter column payload set default '{}'::jsonb,
  add column if not exists processed_status text not null default 'new',
  add column if not exists importance_hint text not null default 'medium',
  add column if not exists source_url text,
  add column if not exists created_at timestamptz not null default now();
