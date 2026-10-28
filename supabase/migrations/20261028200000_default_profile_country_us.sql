-- Existing racers and future accounts default to the United States.
alter table public.profiles alter column country_code set default 'US';
update public.profiles set country_code = 'US' where country_code is null;
alter table public.profiles alter column country_code set not null;

-- Email signups carry their selected country in Auth metadata. Google users
-- choose theirs when they claim a username after returning from OAuth.
create or replace function public.create_racing_account() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  chosen_username text := nullif(trim(new.raw_user_meta_data ->> 'username'), '');
  chosen_country text := case when new.raw_user_meta_data ->> 'country_code' ~ '^[A-Z]{2}$'
    then new.raw_user_meta_data ->> 'country_code' else 'US' end;
begin
  insert into public.profiles (user_id, username, display_name, country_code)
  values (new.id, chosen_username,
    coalesce(nullif(left(trim(new.raw_user_meta_data ->> 'full_name'), 32), ''), chosen_username, 'Racer'),
    chosen_country);
  insert into public.account_stats (user_id) values (new.id);
  return new;
end;
$$;
