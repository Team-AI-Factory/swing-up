export const railwayPostgresSchema = `
create extension if not exists pgcrypto;

create table users (id uuid primary key default gen_random_uuid(), email text unique not null, name text, role text not null default 'member', created_at timestamptz not null default now());
create table plans (id uuid primary key default gen_random_uuid(), code text unique not null, name text not null, price_cents integer not null default 0, created_at timestamptz not null default now());
create table subscriptions (id uuid primary key default gen_random_uuid(), user_id uuid references users(id), plan_id uuid references plans(id), status text not null, current_period_end timestamptz);
create table watchlists (id uuid primary key default gen_random_uuid(), user_id uuid references users(id), ticker text not null, created_at timestamptz not null default now());
create table alerts (id uuid primary key default gen_random_uuid(), ticker text not null, company text not null, action text not null, event text not null, status text not null default 'draft', published_at timestamptz);
create table alert_sources (id uuid primary key default gen_random_uuid(), alert_id uuid references alerts(id), source_type text not null, receipt_url text, summary text, collected_at timestamptz not null default now());
create table alert_scores (id uuid primary key default gen_random_uuid(), alert_id uuid references alerts(id), profit_potential integer not null, evidence_confidence integer not null, risk_level text not null, priced_in_check text, created_at timestamptz not null default now());
create table dcf_models (id uuid primary key default gen_random_uuid(), alert_id uuid references alerts(id), assumptions jsonb not null default '{}', output jsonb not null default '{}', created_at timestamptz not null default now());
create table target_prices (id uuid primary key default gen_random_uuid(), alert_id uuid references alerts(id), low_price numeric(12,2), high_price numeric(12,2), horizon_days integer not null default 30);
create table public_ledger (id uuid primary key default gen_random_uuid(), alert_id uuid references alerts(id), public_slug text unique not null, entry jsonb not null default '{}', created_at timestamptz not null default now());
create table price_snapshots (id uuid primary key default gen_random_uuid(), ticker text not null, price numeric(12,2) not null, captured_at timestamptz not null default now());
create table raw_signals (id uuid primary key default gen_random_uuid(), source text not null, ticker text, payload jsonb not null, received_at timestamptz not null default now());
create table historical_events (id uuid primary key default gen_random_uuid(), ticker text not null, event_type text not null, event_date date not null, forward_returns jsonb not null default '{}');
create table pattern_matches (id uuid primary key default gen_random_uuid(), alert_id uuid references alerts(id), historical_event_id uuid references historical_events(id), similarity numeric(5,2) not null, notes text);
create table source_health (id uuid primary key default gen_random_uuid(), source text not null, status text not null, uptime numeric(6,3), checked_at timestamptz not null default now());
create table notification_channels (id uuid primary key default gen_random_uuid(), user_id uuid references users(id), channel_type text not null, destination text not null, is_enabled boolean not null default true);
create table telegram_accounts (id uuid primary key default gen_random_uuid(), user_id uuid references users(id), telegram_user_id text unique, handle text, linked_at timestamptz);
create table notification_logs (id uuid primary key default gen_random_uuid(), user_id uuid references users(id), alert_id uuid references alerts(id), channel_type text not null, status text not null, sent_at timestamptz default now());
create table payment_events (id uuid primary key default gen_random_uuid(), user_id uuid references users(id), provider text not null, event_type text not null, payload jsonb not null default '{}', created_at timestamptz not null default now());
create table admin_actions (id uuid primary key default gen_random_uuid(), admin_user_id uuid references users(id), action text not null, subject_type text, subject_id uuid, metadata jsonb not null default '{}', created_at timestamptz not null default now());
create table ai_runs (id uuid primary key default gen_random_uuid(), alert_id uuid references alerts(id), run_type text not null, provider text not null default 'stub', status text not null, output jsonb not null default '{}', created_at timestamptz not null default now());
create table ai_cost_logs (id uuid primary key default gen_random_uuid(), ai_run_id uuid references ai_runs(id), model text not null, input_tokens integer not null default 0, output_tokens integer not null default 0, estimated_cost_cents integer not null default 0, created_at timestamptz not null default now());
`;
