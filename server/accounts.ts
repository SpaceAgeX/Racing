import { createHash, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { Pool } from 'pg';
import type { RequestHandler } from 'express';
import { splineTrackError } from '../src/track/spline-records.ts';
import { trackNameError, type SavedTrack } from '../src/track/records.ts';
import type { SplineTrack } from '../src/track/spline-records.ts';
import type { HandlingParameters } from '../src/simulation/types.ts';
import { usernameError } from '../src/auth/username.ts';
import { countryCodes } from '../src/ui/countries.ts';

export class AccountError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}

export function trackLayoutHash(layout: SplineTrack): string {
  return createHash('sha256').update(JSON.stringify(layout)).digest('hex');
}
export function handlingHash(handling: Readonly<HandlingParameters>): string {
  // Physics Time scales movement and lap time together. Ignore it for ranking,
  // preserving the ruleset hash of laps recorded before this setting existed.
  const { physicsTime: _physicsTime, ...physics } = handling.physics;
  return createHash('sha256').update(JSON.stringify({ driving: handling.driving, physics })).digest('hex');
}

export interface AccountIdentity { id: string; email: string | null }

export function createAccounts() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  const connectionString = process.env.DATABASE_URL;
  if (!url || !key || !connectionString) {
    throw new Error('Set SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, and DATABASE_URL before starting the game.');
  }
  const auth = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const db = new Pool({ connectionString, max: 4, idleTimeoutMillis: 30_000 });

  async function identity(token: unknown): Promise<AccountIdentity | null> {
    if (typeof token !== 'string' || token.length < 20 || token.length > 8192) return null;
    const { data, error } = await auth.auth.getUser(token);
    return error || !data.user ? null : { id: data.user.id, email: data.user.email ?? null };
  }

  const requireAccount: RequestHandler = async (request, response, next) => {
    try {
      const match = /^Bearer (.+)$/i.exec(request.get('authorization') ?? '');
      const user = await identity(match?.[1]);
      if (!user) { response.status(401).json({ error: 'Sign in to continue.' }); return; }
      response.locals.account = user;
      next();
    } catch (error) { next(error); }
  };

  async function profile(userId: string) {
    const result = await db.query<{ username: string | null; display_name: string; can_publish_ranked_tracks: boolean; country_code: string | null }>(
      'select username, display_name, can_publish_ranked_tracks, country_code from public.profiles where user_id = $1', [userId]);
    if (!result.rows[0]) throw new AccountError('Account profile is missing.', 500);
    return { username: result.rows[0].username, displayName: result.rows[0].display_name,
      canPublishRankedTracks: result.rows[0].can_publish_ranked_tracks, countryCode: result.rows[0].country_code };
  }

  async function updateCountry(userId: string, value: unknown): Promise<string | null> {
    if (value !== null && (typeof value !== 'string' || !countryCodes.has(value))) {
      throw new AccountError('Choose a valid country or clear the selection.');
    }
    await db.query('update public.profiles set country_code=$2 where user_id=$1', [userId, value]);
    return value;
  }

  async function usernameAvailable(value: unknown): Promise<boolean> {
    if (usernameError(value)) return false;
    const found = await db.query('select 1 from public.profiles where lower(username)=lower($1) limit 1',
      [(value as string).trim()]);
    return !found.rows.length;
  }

  async function claimUsername(userId: string, value: unknown): Promise<string> {
    const invalid = usernameError(value);
    if (invalid) throw new AccountError(invalid);
    const username = (value as string).trim();
    try {
      const updated = await db.query('update public.profiles set username=$2 where user_id=$1 and username is null',
        [userId, username]);
      if (!updated.rowCount) throw new AccountError('This account already has a username.', 409);
      return username;
    } catch (error) {
      if ((error as { code?: string }).code === '23505') throw new AccountError('That username is already taken.', 409);
      throw error;
    }
  }

  async function updateUsername(userId: string, value: unknown): Promise<string> {
    const invalid = usernameError(value);
    if (invalid) throw new AccountError(invalid);
    const username = (value as string).trim();
    try {
      const updated = await db.query('update public.profiles set username=$2 where user_id=$1 returning username',
        [userId, username]);
      if (!updated.rows[0]) throw new AccountError('Account profile is missing.', 404);
      return updated.rows[0].username as string;
    } catch (error) {
      if ((error as { code?: string }).code === '23505') throw new AccountError('That username is already taken.', 409);
      throw error;
    }
  }

  async function updateDisplayName(userId: string, value: unknown): Promise<void> {
    if (typeof value !== 'string' || value.trim().length < 2 || value.trim().length > 32
      || /[\u0000-\u001f\u007f]/.test(value)) throw new AccountError('Choose a name between 2 and 32 characters.');
    await db.query('update public.profiles set display_name=$2 where user_id=$1', [userId, value.trim()]);
  }

  function savedTrack(row: { id: string; name: string; layout: SplineTrack; updated_at: Date; created_at?: Date;
    visibility: 'ranked' | 'personal' }): SavedTrack {
    return { id: row.id, name: row.name, layout: row.layout,
      updatedAt: new Date(row.updated_at).getTime(), createdAt: row.created_at ? new Date(row.created_at).getTime() : undefined,
      visibility: row.visibility };
  }

  async function listTracks(userId: string): Promise<SavedTrack[]> {
    const result = await db.query<{ id: string; name: string; layout: SplineTrack; updated_at: Date;
      visibility: 'ranked' | 'personal' }>(
      "select id, name, layout, created_at, updated_at, visibility from public.tracks where visibility='ranked' or owner_id=$1 order by updated_at desc", [userId]);
    return result.rows.map(savedTrack);
  }

  async function listRankedTracks(): Promise<SavedTrack[]> {
    const result = await db.query<{ id: string; name: string; layout: SplineTrack; updated_at: Date;
      visibility: 'ranked' | 'personal' }>(
      "select id, name, layout, updated_at, visibility from public.tracks where visibility='ranked' order by updated_at desc");
    return result.rows.map(savedTrack);
  }

  let popularityCache: { expiresAt: number; values: Map<string, { popularityMs: number; completedLaps: number }> } | null = null;
  async function listTrackDiscovery(userId: string): Promise<SavedTrack[]> {
    const tracks = await listTracks(userId);
    if (!popularityCache || Date.now() >= popularityCache.expiresAt) {
      // One cached, indexed aggregate for all cards; no estimates from personal bests.
      const result = await db.query<{ track_id: string; popularity_ms: string; completed_laps: string }>(
        `select track_id, sum(duration_ms)::text as popularity_ms, count(*)::text as completed_laps
         from public.lap_results where ranked and duration_ms between 500 and 1800000
         group by track_id`);
      popularityCache = { expiresAt: Date.now() + 60_000,
        values: new Map(result.rows.map(row => [row.track_id, {
          popularityMs: Number(row.popularity_ms), completedLaps: Number(row.completed_laps) }])) };
    }
    return tracks.map(track => ({ ...track,
      popularityMs: popularityCache!.values.get(track.id)?.popularityMs ?? 0,
      completedLaps: popularityCache!.values.get(track.id)?.completedLaps ?? 0 }));
  }

  async function getTrack(id: string, userId?: string): Promise<SavedTrack | null> {
    const result = await db.query<{ id: string; name: string; layout: SplineTrack; updated_at: Date;
      visibility: 'ranked' | 'personal' }>(
      "select id, name, layout, updated_at, visibility from public.tracks where id=$1 and (visibility='ranked' or owner_id=$2)",
      [id, userId ?? null]);
    return result.rows[0] ? savedTrack(result.rows[0]) : null;
  }

  async function saveTrack(userId: string, name: unknown, layout: unknown, visibility: unknown): Promise<SavedTrack> {
    const invalid = trackNameError(name) ?? splineTrackError(layout);
    if (invalid) throw new AccountError(invalid);
    if (visibility !== 'ranked' && visibility !== 'personal') throw new AccountError('Choose ranked or personal when saving.');
    if (visibility === 'ranked' && !(await profile(userId)).canPublishRankedTracks) {
      throw new AccountError('Your account is not approved to publish ranked multiplayer tracks.', 403);
    }
    const cleanName = (name as string).trim();
    const client = await db.connect();
    try {
      await client.query('begin');
      const existing = await client.query<{ id: string; owner_id: string | null }>(
        'select id, owner_id from public.tracks where owner_id=$1 and lower(name)=lower($2) for update',
        [userId, cleanName]);
      const previous = existing.rows[0];
      const id = previous?.id ?? randomUUID();
      const result = await client.query<{ id: string; name: string; layout: SplineTrack; updated_at: Date;
        visibility: 'ranked' | 'personal' }>(
        previous
          ? 'update public.tracks set name=$2, layout=$3::jsonb, visibility=$4, revision=revision+1, updated_at=now() where id=$1 returning id,name,layout,updated_at,visibility'
          : 'insert into public.tracks(id,name,layout,owner_id,visibility) values($1,$2,$3::jsonb,$4,$5) returning id,name,layout,updated_at,visibility',
        previous ? [id, cleanName, JSON.stringify(layout), visibility]
          : [id, cleanName, JSON.stringify(layout), userId, visibility]);
      await client.query('commit');
      return savedTrack(result.rows[0]!);
    } catch (error) {
      await client.query('rollback');
      if ((error as { code?: string }).code === '23505') throw new AccountError('You already have a track with that name.', 409);
      throw error;
    } finally { client.release(); }
  }

  async function deleteTrack(userId: string, id: string): Promise<boolean> {
    const result = await db.query('delete from public.tracks where id=$1 and owner_id=$2', [id, userId]);
    return (result.rowCount ?? 0) > 0;
  }

  async function recordLap(input: { userId: string; trackId: string; trackName: string; layoutHash: string;
    rulesetHash: string; durationSeconds: number; ranked: boolean; mode: 'time_trial' | 'multiplayer' }): Promise<void> {
    const durationMs = Math.round(input.durationSeconds * 1000);
    if (!Number.isSafeInteger(durationMs) || durationMs <= 0 || durationMs > 24 * 60 * 60 * 1000) return;
    await db.query(`insert into public.lap_results
      (user_id,track_id,track_name,layout_hash,ruleset_hash,duration_ms,ranked,mode)
      values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [input.userId, input.trackId, input.trackName, input.layoutHash, input.rulesetHash,
        durationMs, input.ranked, input.mode]);
  }

  async function startRace(userIds: string[]): Promise<void> {
    if (userIds.length) await db.query(
      'update public.account_stats set races_started=races_started+1 where user_id=any($1::uuid[])', [userIds]);
  }

  async function recordMultiplayerWin(userId: string): Promise<void> {
    await db.query('update public.account_stats set multiplayer_wins=multiplayer_wins+1 where user_id=$1', [userId]);
  }

  async function addActivity(userId: string, seconds: number, distanceMeters: number): Promise<void> {
    if (seconds <= 0 && distanceMeters <= 0) return;
    await db.query(`update public.account_stats set time_played_seconds=time_played_seconds+$2,
      distance_meters=distance_meters+$3 where user_id=$1`, [userId, seconds, distanceMeters]);
  }

  async function dashboard(userId: string) {
    const [account, stats, totals, tracks, recent, personalBests] = await Promise.all([
      profile(userId),
      db.query<{ races_started: string; multiplayer_wins: string; time_played_seconds: number; distance_meters: number }>(
        `select races_started, coalesce((to_jsonb(account_stats)->>'multiplayer_wins')::bigint,0)::text as multiplayer_wins,
          time_played_seconds,distance_meters from public.account_stats where user_id=$1`, [userId]),
      db.query<{ laps: string; ranked_laps: string }>(`select count(*)::text as laps,
        count(*) filter (where ranked)::text as ranked_laps from public.lap_results where user_id=$1`, [userId]),
      db.query<{ count: string }>('select count(*)::text as count from public.tracks where owner_id=$1', [userId]),
      db.query<{ track_name: string; duration_ms: number; ranked: boolean; completed_at: Date }>(
        'select track_name,duration_ms,ranked,completed_at from public.lap_results where user_id=$1 order by completed_at desc limit 10', [userId]),
      db.query<{ track_name: string; duration_ms: number }>(`select (array_agg(track_name order by completed_at desc))[1] as track_name,
        min(duration_ms)::integer as duration_ms from public.lap_results
        where user_id=$1 and ranked group by track_id order by track_name limit 50`, [userId]),
    ]);
    return {
      ...account,
      racesStarted: Number(stats.rows[0]?.races_started ?? 0),
      multiplayerWins: Number(stats.rows[0]?.multiplayer_wins ?? 0),
      timePlayedSeconds: Math.round(stats.rows[0]?.time_played_seconds ?? 0),
      distanceMeters: Math.round(stats.rows[0]?.distance_meters ?? 0),
      lapsCompleted: Number(totals.rows[0]?.laps ?? 0),
      rankedLaps: Number(totals.rows[0]?.ranked_laps ?? 0),
      tracksCreated: Number(tracks.rows[0]?.count ?? 0),
      personalBests: personalBests.rows.map(row => ({ trackName: row.track_name, durationMs: row.duration_ms })),
      recentLaps: recent.rows.map(row => ({ trackName: row.track_name, durationMs: row.duration_ms,
        ranked: row.ranked, completedAt: row.completed_at })),
    };
  }

  async function leaderboard(trackId: string, layoutHash: string, rulesetHash: string) {
    const result = await db.query<{ username: string; country_code: string | null; duration_ms: number }>(`select coalesce(p.username,p.display_name) as username,
      p.country_code,
      min(l.duration_ms)::integer as duration_ms from public.lap_results l
      join public.profiles p on p.user_id=l.user_id
      where l.track_id=$1 and l.layout_hash=$2 and l.ruleset_hash=$3 and l.ranked
      group by l.user_id,p.username,p.display_name,p.country_code order by duration_ms asc limit 10`, [trackId, layoutHash, rulesetHash]);
    return result.rows.map(row => ({ name: row.username, countryCode: row.country_code, durationMs: row.duration_ms }));
  }

  async function personalBest(userId: string, trackId: string, layoutHash: string, rulesetHash: string): Promise<number | null> {
    const result = await db.query<{ duration_ms: number | null }>(`select min(duration_ms)::integer as duration_ms
      from public.lap_results where user_id=$1 and track_id=$2 and layout_hash=$3
      and ruleset_hash=$4 and ranked`,
      [userId, trackId, layoutHash, rulesetHash]);
    return result.rows[0]?.duration_ms ?? null;
  }

  return { identity, requireAccount, profile, usernameAvailable, claimUsername, updateUsername, updateDisplayName, updateCountry,
    listTracks, listRankedTracks, listTrackDiscovery, getTrack, saveTrack, deleteTrack,
    recordLap, startRace, recordMultiplayerWin, addActivity, dashboard, leaderboard, personalBest, close: () => db.end() };
}
export type Accounts = ReturnType<typeof createAccounts>;
