create table if not exists macro_sentiment_snapshots (
  id uuid primary key default gen_random_uuid(),
  snapshot_type text not null,
  status text not null default 'partial',
  overall_market_mood text,
  macro_risk_level text,
  macro_support_score integer,
  sentiment_support_score integer,
  risk_off_penalty integer,
  confidence_adjustment integer,
  profit_potential_adjustment integer,
  summary text not null default '',
  data_freshness jsonb not null default '{}',
  source_receipts jsonb not null default '[]',
  payload jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists macro_sentiment_snapshots_created_at_idx on macro_sentiment_snapshots (created_at desc);
create index if not exists macro_sentiment_snapshots_type_created_at_idx on macro_sentiment_snapshots (snapshot_type, created_at desc);
