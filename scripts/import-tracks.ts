/** One-time import of the Pi's existing JSON library. Dry-run unless --apply is given. */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import pg from 'pg';
import { isSavedTrack, type SavedTrack } from '../src/track/records.ts';

const source = process.argv[2];
const apply = process.argv.includes('--apply');
if (!source || source.startsWith('--')) throw new Error('Usage: node scripts/import-tracks.ts <tracks-splines-v2.json> [--apply]');
if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL for the target Supabase project.');
const data: unknown = JSON.parse(await readFile(resolve(source), 'utf8'));
if (!Array.isArray(data) || !data.every(isSavedTrack)) throw new Error('The source is not a valid spline track library.');
const tracks = data as SavedTrack[];
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
let newTracks = 0;
let identical = 0;
try {
  await db.query('begin');
  for (const track of tracks) {
    const found = await db.query<{ id: string; name: string; same_layout: boolean; visibility: string }>(
      'select id,name,visibility,layout=$3::jsonb as same_layout from public.tracks where id=$1 or (owner_id is null and lower(name)=lower($2))',
      [track.id, track.name, JSON.stringify(track.layout)]);
    if (found.rows.length) {
      if (found.rows.length !== 1 || found.rows[0]!.id !== track.id || found.rows[0]!.name !== track.name
        || !found.rows[0]!.same_layout || found.rows[0]!.visibility !== 'ranked') {
        throw new Error(`Import conflict for ${track.name} (${track.id}). Nothing was imported.`);
      }
      identical++;
      continue;
    }
    newTracks++;
    if (apply) await db.query(`insert into public.tracks(id,name,layout,owner_id,visibility,created_at,updated_at)
      values($1,$2,$3::jsonb,null,'ranked',to_timestamp($4 / 1000.0),to_timestamp($4 / 1000.0))`,
      [track.id, track.name, JSON.stringify(track.layout), track.updatedAt]);
  }
  if (apply) await db.query('commit');
  else await db.query('rollback');
  console.log(`${apply ? 'Imported' : 'Would import'} ${newTracks} tracks; ${identical} already identical.`);
} catch (error) {
  await db.query('rollback');
  throw error;
} finally { await db.end(); }
