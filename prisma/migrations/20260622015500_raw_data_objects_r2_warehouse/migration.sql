create table if not exists raw_data_objects (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  asset_type text not null,
  symbol text,
  normalized_symbol text,
  data_type text not null,
  r2_key text not null,
  content_hash text not null unique,
  observed_at timestamptz not null default now(),
  stored_at timestamptz not null default now(),
  byte_size integer not null default 0,
  record_count integer,
  date_range_start date,
  date_range_end date,
  status text not null default 'stored',
  provider_plan_status text,
  source_url text,
  receipt_url text,
  metadata jsonb not null default '{}'
);
create index if not exists raw_data_objects_source_idx on raw_data_objects(source);
create index if not exists raw_data_objects_asset_type_idx on raw_data_objects(asset_type);
create index if not exists raw_data_objects_normalized_symbol_idx on raw_data_objects(normalized_symbol);
create index if not exists raw_data_objects_data_type_idx on raw_data_objects(data_type);
create index if not exists raw_data_objects_observed_at_idx on raw_data_objects(observed_at desc);
create index if not exists raw_data_objects_date_range_idx on raw_data_objects(date_range_start, date_range_end);
create index if not exists raw_data_objects_content_hash_idx on raw_data_objects(content_hash);
