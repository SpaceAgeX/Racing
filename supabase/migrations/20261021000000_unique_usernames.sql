-- Existing accounts claim a username on their next sign-in. New email accounts
-- reserve one during Auth signup; Google accounts claim one after OAuth returns.
alter table public.profiles add column username text;
alter table public.profiles add constraint profiles_username_format
  check (username is null or username ~ '^[A-Za-z][A-Za-z0-9_]{2,19}$');
create unique index profiles_username_unique on public.profiles (lower(username)) where username is not null;

create or replace function public.create_racing_account() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  chosen_username text := nullif(trim(new.raw_user_meta_data ->> 'username'), '');
begin
  insert into public.profiles (user_id, username, display_name)
  values (new.id, chosen_username,
    coalesce(nullif(left(trim(new.raw_user_meta_data ->> 'full_name'), 32), ''), chosen_username, 'Racer'));
  insert into public.account_stats (user_id) values (new.id);
  return new;
end;
$$;
