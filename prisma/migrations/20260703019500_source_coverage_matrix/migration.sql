create table if not exists source_coverage_matrix (
  id uuid primary key default gen_random_uuid(), provider text not null, source_id text not null unique, display_name text not null,
  endpoint_group text not null, endpoint_name text not null, endpoint_path text not null, requires_api_key boolean not null, api_key_env_name text,
  access_status text not null, last_tested_at timestamptz, last_success_at timestamptz, last_failure_at timestamptz,
  safe_error_category text, safe_error_message text, plan_required text, plan_detected text, data_type text not null,
  proof_types_produced jsonb not null default '[]', pull_mode text not null, symbol_supported boolean not null, keyword_supported boolean not null,
  date_range_supported boolean not null, bulk_supported boolean not null, historical_supported boolean not null, real_time_supported boolean not null,
  recommended_interval_seconds int not null, priority int not null, cost_level text not null, max_items_per_run int not null, max_calls_per_run int not null,
  raw_storage_path_template text not null, enabled_by_default boolean not null, update_cadence_type text, update_detection_method text,
  natural_update_frequency text, should_pull_again_after_success boolean, next_pull_reason text, last_seen_external_id text,
  last_seen_published_at timestamptz, last_seen_document_hash text, last_data_change_detected_at timestamptz,
  cooldown_after_success_seconds int, cooldown_after_empty_seconds int, cooldown_after_rate_limit_seconds int,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists source_coverage_matrix_provider_idx on source_coverage_matrix(provider);
create index if not exists source_coverage_matrix_status_idx on source_coverage_matrix(access_status);

create table if not exists source_pull_history (
  id uuid primary key default gen_random_uuid(), provider text not null, endpoint_name text not null, endpoint_path text not null, pull_mode text not null,
  symbols jsonb not null default '[]', keywords jsonb not null default '[]', started_at timestamptz, finished_at timestamptz, http_status int,
  items_returned int, raw_receipt_ref text, normalized_signals_created int default 0, proof_receipts_created int default 0,
  duplicates_skipped int default 0, calls_used int default 0, safe_error_category text, safe_error_message text, created_at timestamptz not null default now()
);
create index if not exists source_pull_history_provider_created_idx on source_pull_history(provider, created_at desc);

create table if not exists source_freshness_ledger (
  id uuid primary key default gen_random_uuid(), provider text not null, endpoint_name text not null, symbol text, keyword text, event_type text,
  latest_external_id text, latest_published_at timestamptz, latest_document_hash text, latest_source_url text, latest_raw_storage_ref text,
  last_checked_at timestamptz, last_changed_at timestamptz, next_due_at timestamptz, update_cadence_type text, freshness_status text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists source_freshness_ledger_due_idx on source_freshness_ledger(next_due_at);
create index if not exists source_freshness_ledger_provider_endpoint_idx on source_freshness_ledger(provider, endpoint_name);
