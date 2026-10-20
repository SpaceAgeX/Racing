import type { SplineTrack as TrackLayout } from './spline-records.ts';
import { splineTrackError as playableTrackError } from './spline-records.ts';
const cloneTrack = structuredClone;
import { isSavedTrack } from './records.ts';
import type { SavedTrack } from './records.ts';

export interface TrackStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const libraryKey = 'racing-spline-library-v2';
const activeKey = 'racing-active-spline-track-v2';

/** Read version-2 spline saves only; legacy tile saves use separate keys. */
export function listBrowserTracks(storage: TrackStorage): SavedTrack[] {
  try {
    const records: unknown = JSON.parse(storage.getItem(libraryKey) ?? '[]');
    return Array.isArray(records) ? records.filter(isSavedTrack) : [];
  } catch { return []; }
}

export function loadActiveTrack(storage: TrackStorage): SavedTrack | null {
  try {
    const record: unknown = JSON.parse(storage.getItem(activeKey) ?? 'null');
    return isSavedTrack(record) ? record : null;
  } catch { return null; }
}

export function selectTrackForPlay(storage: TrackStorage, name: string, layout: TrackLayout, id = 'draft'): void {
  const error = playableTrackError(layout);
  if (error) throw new Error(error);
  const record: SavedTrack = { id, name: name.trim() || 'Untitled track', layout: cloneTrack(layout), updatedAt: Date.now() };
  storage.setItem(activeKey, JSON.stringify(record));
}

export function clearActiveTrack(storage: TrackStorage, id: string): void {
  if (loadActiveTrack(storage)?.id === id) storage.removeItem(activeKey);
}
