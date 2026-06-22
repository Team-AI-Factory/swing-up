create table if not exists asset_universe (
  id uuid primary key default gen_random_uuid(), source text not null, source_symbol text not null, normalized_symbol text not null, asset_type text not null, company_name text, exchange text, country text, sector text, industry text, cik text, isin text, cusip text, active boolean not null default true, delisted boolean not null default false, first_seen_at timestamptz not null default now(), last_seen_at timestamptz not null default now(), source_metadata jsonb not null default '{}', unique(source, source_symbol)
);
create index if not exists asset_universe_normalized_symbol_idx on asset_universe(normalized_symbol);
create index if not exists asset_universe_source_asset_type_idx on asset_universe(source, asset_type);
create table if not exists asset_identity_map (
  id uuid primary key default gen_random_uuid(), normalized_symbol text not null, source text not null, source_symbol text not null, aliases jsonb not null default '[]', company_names jsonb not null default '[]', cik text, asset_type text not null, confidence_score numeric(5,4) not null default 0.5, unique(normalized_symbol, source, source_symbol)
);
create index if not exists asset_identity_map_normalized_symbol_idx on asset_identity_map(normalized_symbol);
