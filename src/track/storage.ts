import type { TrackLayout, TrackTile } from './layout.ts';
import { cloneTrack, playableTrackError } from './model.ts';

export interface TrackStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface SavedTrack {
  id: string;
  name: string;
  layout: TrackTile[][];
  updatedAt: number;
}

const libraryKey = 'racing-track-library-v1';
const activeKey = 'racing-active-track-v1';

function validRecord(value: unknown): value is SavedTrack {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<SavedTrack>;
  return typeof record.id === 'string' && typeof record.name === 'string' && record.name.trim().length > 0
    && typeof record.updatedAt === 'number' && Number.isFinite(record.updatedAt) && playableTrackError(record.layout) === null;
}

export function listSavedTracks(storage: TrackStorage): SavedTrack[] {
  try {
    const records: unknown = JSON.parse(storage.getItem(libraryKey) ?? '[]');
    return Array.isArray(records) ? records.filter(validRecord) : [];
  } catch { return []; }
}

export function saveTrack(storage: TrackStorage, name: string, layout: TrackLayout): SavedTrack {
  const error = playableTrackError(layout);
  if (error) throw new Error(error);
  const cleanName = name.trim();
  if (!cleanName || cleanName.length > 60) throw new Error('Give the track a name between 1 and 60 characters.');
  const records = listSavedTracks(storage);
  const existing = records.find((record) => record.name.toLowerCase() === cleanName.toLowerCase());
  const record: SavedTrack = {
    id: existing?.id ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
    name: cleanName,
    layout: cloneTrack(layout),
    updatedAt: Date.now(),
  };
  const index = existing ? records.indexOf(existing) : -1;
  if (index === -1) records.push(record); else records[index] = record;
  storage.setItem(libraryKey, JSON.stringify(records));
  return record;
}

export function loadActiveTrack(storage: TrackStorage): SavedTrack | null {
  try {
    const record: unknown = JSON.parse(storage.getItem(activeKey) ?? 'null');
    return validRecord(record) ? record : null;
  } catch { return null; }
}

export function selectTrackForPlay(storage: TrackStorage, name: string, layout: TrackLayout, id = 'draft'): void {
  const error = playableTrackError(layout);
  if (error) throw new Error(error);
  const record: SavedTrack = { id, name: name.trim() || 'Untitled track', layout: cloneTrack(layout), updatedAt: Date.now() };
  storage.setItem(activeKey, JSON.stringify(record));
}

export function deleteTrack(storage: TrackStorage, id: string): void {
  storage.setItem(libraryKey, JSON.stringify(listSavedTracks(storage).filter((record) => record.id !== id)));
  if (loadActiveTrack(storage)?.id === id) storage.removeItem(activeKey);
}
