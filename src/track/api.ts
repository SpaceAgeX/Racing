import type { SplineTrack as TrackLayout } from './spline-records.ts';
import { isSavedTrack } from './records.ts';
import type { SavedTrack } from './records.ts';
import { accountFetch } from '../auth/session.ts';

async function request(path: string, options: RequestInit = {}): Promise<unknown> {
  let response: Response;
  try {
    response = await accountFetch(`/api/tracks${path}`, { ...options, cache: 'no-store', signal: AbortSignal.timeout(10_000) });
  } catch { throw new Error('Could not reach the server track library. Keep your drawing and try again.'); }
  if (response.status === 204) return null;
  const value: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = value && typeof value === 'object' && 'error' in value ? value.error : null;
    throw new Error(typeof error === 'string' ? error : 'Could not access the server track library.');
  }
  return value;
}

export async function listSharedTracks(): Promise<SavedTrack[]> {
  const records = await request('');
  if (!Array.isArray(records) || !records.every(isSavedTrack)) throw new Error('The server returned an invalid track library.');
  return records;
}

export async function listDiscoverableTracks(): Promise<SavedTrack[]> {
  const response = await accountFetch('/api/tracks/discovery', { cache: 'no-store', signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error('Could not load track popularity.');
  const records: unknown = await response.json();
  if (!Array.isArray(records) || !records.every(isSavedTrack)) throw new Error('The server returned invalid track data.');
  return records;
}

export async function getSharedTrack(id: string): Promise<SavedTrack> {
  const record = await request(`/${encodeURIComponent(id)}`);
  if (!isSavedTrack(record)) throw new Error('The server returned an invalid track.');
  return record;
}

export async function saveSharedTrack(name: string, layout: TrackLayout,
  visibility: 'ranked' | 'personal'): Promise<SavedTrack> {
  const record = await request('', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, layout, visibility }) });
  if (!isSavedTrack(record)) throw new Error('The server returned an invalid saved track.');
  return record;
}

export async function deleteSharedTrack(id: string): Promise<void> {
  await request(`/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
