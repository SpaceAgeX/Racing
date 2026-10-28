-- Optional ISO 3166-1 alpha-2 country preference. Existing profiles stay unset.
alter table public.profiles add column if not exists country_code text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_country_code_format') then
    alter table public.profiles add constraint profiles_country_code_format
      check (country_code is null or country_code ~ '^[A-Z]{2}$');
  end if;
end $$;

-- Keeps the cached popularity refresh to a small index-only scan where possible.
create index if not exists lap_results_popularity_idx on public.lap_results (track_id)
  include (duration_ms) where ranked and duration_ms between 500 and 1800000;
