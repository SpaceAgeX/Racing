-- Building is available to everyone; this flag permits publishing ranked tracks.
alter table public.profiles rename column can_build_tracks to can_publish_ranked_tracks;
update public.profiles set can_publish_ranked_tracks = true;

-- Existing shared tracks are ranked. Newly inserted tracks must choose explicitly.
alter table public.tracks add column visibility text not null default 'personal'
  check (visibility in ('ranked', 'personal'));
update public.tracks set visibility = 'ranked';

-- Personal track names only need to be unique for their owner.
drop index public.tracks_name_unique;
create unique index tracks_owner_name_unique on public.tracks (owner_id, lower(name))
  where owner_id is not null;
create index tracks_ranked_updated_idx on public.tracks (updated_at desc)
  where visibility = 'ranked';
