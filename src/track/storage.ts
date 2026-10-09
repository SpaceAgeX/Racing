import type { TrackLayout } from './layout.ts';
import { cloneTrack, playableTrackError } from './model.ts';
import { isSavedTrack } from './records.ts';
import type { SavedTrack } from './records.ts';

export interface TrackStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const libraryKey = 'racing-track-library-v1';
const activeKey = 'racing-active-track-v1';

/** Older browser-only saves remain loadable so the player can save them to the server. */
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
