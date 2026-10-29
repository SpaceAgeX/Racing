-- Historical lap results keep NULL; newly recorded laps include an array of
-- checkpoint IDs and cumulative milliseconds from that lap's start.
alter table public.lap_results add column if not exists checkpoint_splits jsonb;
