alter table historical_events add column if not exists company_name text;
alter table historical_events add column if not exists sector text;
alter table historical_events add column if not exists title text;
alter table historical_events add column if not exists summary text;
alter table historical_events add column if not exists source text;
alter table historical_events add column if not exists source_url text;
alter table historical_events add column if not exists price_before numeric(12,2);
alter table historical_events add column if not exists price_after_1d numeric(12,2);
alter table historical_events add column if not exists price_after_7d numeric(12,2);
alter table historical_events add column if not exists price_after_30d numeric(12,2);
alter table historical_events add column if not exists outcome_label text not null default 'unknown';
alter table historical_events add column if not exists notes text;
alter table historical_events add column if not exists created_at timestamptz not null default now();

create index if not exists historical_events_event_date_idx on historical_events (event_date desc);
create index if not exists historical_events_ticker_event_date_idx on historical_events (ticker, event_date desc);
create index if not exists historical_events_event_type_event_date_idx on historical_events (event_type, event_date desc);
