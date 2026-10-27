alter table public.account_stats
  add column if not exists multiplayer_wins bigint not null default 0 check (multiplayer_wins >= 0);
