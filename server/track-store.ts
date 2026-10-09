import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { cloneTrack, playableTrackError } from '../src/track/model.ts';
import type { TrackLayout } from '../src/track/layout.ts';
import { isSavedTrack, trackNameError } from '../src/track/records.ts';
import type { SavedTrack } from '../src/track/records.ts';

export class TrackValidationError extends Error {}

/** One Express process owns this file. Writes are serialized and replace it atomically. */
export async function createTrackStore(filename: string) {
  const file = resolve(filename);
  let records: SavedTrack[] = [];
  try {
    const saved: unknown = JSON.parse(await readFile(file, 'utf8'));
    if (!Array.isArray(saved) || !saved.every(isSavedTrack)
      || new Set(saved.map((record) => record.id)).size !== saved.length
      || new Set(saved.map((record) => record.name.toLowerCase())).size !== saved.length) {
      throw new Error('The track library contains invalid or duplicate records.');
    }
    records = saved;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new Error(`Could not read track library ${file}. Preserve the file and fix it before restarting.`, { cause: error });
    }
  }

  let queue: Promise<void> = Promise.resolve();
  function serialized<T>(action: () => Promise<T>): Promise<T> {
    const result = queue.then(action);
    queue = result.then(() => undefined, () => undefined);
    return result;
  }

  async function persist(next: SavedTrack[]): Promise<void> {
    await mkdir(dirname(file), { recursive: true });
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
      await rename(temporary, file);
      records = next;
    } finally {
      await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') console.error('Could not remove temporary track file:', error.message);
      });
    }
  }

  return {
    list(): Promise<SavedTrack[]> {
      return serialized(async () => structuredClone(records));
    },
    get(id: string): Promise<SavedTrack | null> {
      return serialized(async () => structuredClone(records.find((record) => record.id === id) ?? null));
    },
    async save(name: unknown, layout: unknown): Promise<SavedTrack> {
      const error = trackNameError(name) ?? playableTrackError(layout);
      if (error) throw new TrackValidationError(error);
      const cleanName = (name as string).trim();
      const grid = cloneTrack(layout as TrackLayout);
      return serialized(async () => {
        const existing = records.find((record) => record.name.toLowerCase() === cleanName.toLowerCase());
        const record: SavedTrack = { id: existing?.id ?? randomUUID(), name: cleanName, layout: grid, updatedAt: Date.now() };
        const next = existing ? records.map((entry) => entry.id === existing.id ? record : entry) : [...records, record];
        await persist(next);
        return structuredClone(record);
      });
    },
    delete(id: string): Promise<boolean> {
      return serialized(async () => {
        const next = records.filter((record) => record.id !== id);
        if (next.length === records.length) return false;
        await persist(next);
        return true;
      });
    },
    async flush(): Promise<void> { await queue; },
  };
}

export type TrackStore = Awaited<ReturnType<typeof createTrackStore>>;
