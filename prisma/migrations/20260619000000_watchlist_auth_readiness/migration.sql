alter table watchlists
  add column if not exists preview_owner_id uuid,
  add column if not exists company text,
  add column if not exists asset_type text not null default 'equity',
  add column if not exists sector_theme text,
  add column if not exists risk_preference text not null default 'balanced',
  add column if not exists alert_preference text not null default 'preview_only',
  add column if not exists status text not null default 'active';

create index if not exists watchlists_user_status_created_at_idx on watchlists(user_id, status, created_at desc);
create index if not exists watchlists_preview_owner_status_created_at_idx on watchlists(preview_owner_id, status, created_at desc);
