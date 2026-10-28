import type { SplineTrack } from './spline-records.ts';
import { splineTrackError as playableTrackError } from './spline-records.ts';

export interface SavedTrack {
  id: string;
  name: string;
  layout: SplineTrack;
  updatedAt: number;
  createdAt?: number;
  visibility?: 'ranked' | 'personal';
  popularityMs?: number;
  completedLaps?: number;
}

export function trackNameError(name: unknown): string | null {
  return typeof name === 'string' && name.trim().length > 0 && name.trim().length <= 60
    ? null : 'Give the track a name between 1 and 60 characters.';
}

export function isSavedTrack(value: unknown): value is SavedTrack {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<SavedTrack>;
  return typeof record.id === 'string' && record.id.length > 0 && trackNameError(record.name) === null
    && typeof record.updatedAt === 'number' && Number.isFinite(record.updatedAt)
    && (record.createdAt === undefined || typeof record.createdAt === 'number' && Number.isFinite(record.createdAt))
    && (record.popularityMs === undefined || typeof record.popularityMs === 'number' && Number.isFinite(record.popularityMs))
    && (record.completedLaps === undefined || typeof record.completedLaps === 'number' && Number.isFinite(record.completedLaps))
    && (record.visibility === undefined || record.visibility === 'ranked' || record.visibility === 'personal')
    && playableTrackError(record.layout) === null;
}
