create table if not exists provider_quota_ledger (
  id uuid primary key default gen_random_uuid(),
  provider text not null unique,
  plan_name text,
  daily_request_limit int,
  per_minute_limit int,
  monthly_bandwidth_limit_mb numeric,
  requests_used_today int not null default 0,
  requests_remaining_today int,
  estimated_bandwidth_used_mb numeric not null default 0,
  estimated_bandwidth_remaining_mb numeric,
  reset_at timestamptz,
  last_rate_limit_at timestamptz,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  current_backoff_until timestamptz,
  quota_status text not null default 'unknown',
  quota_source text not null default 'configured_default',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists provider_quota_ledger_status_idx on provider_quota_ledger(quota_status, current_backoff_until);
