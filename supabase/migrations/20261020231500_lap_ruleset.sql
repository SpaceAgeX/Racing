-- A leaderboard compares laps only when both the road and default handling match.
alter table public.lap_results add column ruleset_hash text not null default '';
drop index public.lap_results_leaderboard_idx;
create index lap_results_leaderboard_idx on public.lap_results
  (track_id, layout_hash, ruleset_hash, duration_ms) where ranked;
