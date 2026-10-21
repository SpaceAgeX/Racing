-- The game server is the only writer of race results and shared tracks.
create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'Racer',
  can_build_tracks boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.account_stats (
  user_id uuid primary key references public.profiles(user_id) on delete cascade,
  races_started bigint not null default 0 check (races_started >= 0),
  time_played_seconds double precision not null default 0 check (time_played_seconds >= 0),
  distance_meters double precision not null default 0 check (distance_meters >= 0)
);

create table public.tracks (
  id text primary key,
  owner_id uuid references public.profiles(user_id) on delete set null,
  name text not null check (char_length(trim(name)) between 1 and 60),
  layout jsonb not null,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index tracks_name_unique on public.tracks (lower(name));
create index tracks_owner_idx on public.tracks (owner_id);

create table public.lap_results (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  track_id text not null,
  track_name text not null,
  layout_hash text not null,
  duration_ms integer not null check (duration_ms > 0),
  ranked boolean not null,
  mode text not null check (mode in ('time_trial', 'multiplayer')),
  completed_at timestamptz not null default now()
);
create index lap_results_leaderboard_idx on public.lap_results
  (track_id, layout_hash, duration_ms) where ranked;
create index lap_results_user_idx on public.lap_results (user_id, completed_at desc);

create function public.create_racing_account() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (user_id, display_name)
  values (new.id, coalesce(nullif(left(trim(new.raw_user_meta_data ->> 'full_name'), 32), ''), 'Racer'));
  insert into public.account_stats (user_id) values (new.id);
  return new;
end;
$$;
create trigger on_racing_user_created after insert on auth.users
for each row execute function public.create_racing_account();

-- No Data API policies: browser users cannot edit permissions, tracks, or verified results.
-- Express authenticates requests and performs authorized writes through a private DB connection.
alter table public.profiles enable row level security;
alter table public.account_stats enable row level security;
alter table public.tracks enable row level security;
alter table public.lap_results enable row level security;
revoke all on public.profiles, public.account_stats, public.tracks, public.lap_results from anon, authenticated;
