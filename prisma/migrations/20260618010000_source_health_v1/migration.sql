alter table source_health
  add column if not exists last_success_at timestamptz,
  add column if not exists response_time_ms integer,
  add column if not exists error_message text,
  add column if not exists usage text,
  add column if not exists notes text;
