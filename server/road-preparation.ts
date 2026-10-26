import { Worker } from 'node:worker_threads';
import { trackLayoutHash } from './accounts.ts';
import type { SplineTrack } from '../src/track/spline-records.ts';
import type { RoadGeometry } from '../src/track/road-geometry.ts';

export type PreparedRaceRoad = Pick<RoadGeometry, 'triangles' | 'spawns' | 'finish' | 'checkpoints'>;

const MAX_CACHED_ROADS = 4;
const cache = new Map<string, PreparedRaceRoad>();
const pending = new Map<string, Promise<PreparedRaceRoad>>();
const requests = new Map<number, { resolve: (road: PreparedRaceRoad) => void; reject: (error: Error) => void }>();
let worker: Worker | null = null;
let nextRequestId = 1;

function getWorker(): Worker {
  if (worker) return worker;
  const instance = new Worker(new URL('./road-preparation-worker.ts', import.meta.url));
  worker = instance;
  instance.on('message', ({ id, road, error }: { id: number; road?: PreparedRaceRoad; error?: string }) => {
    const request = requests.get(id);
    if (!request) return;
    requests.delete(id);
    if (requests.size === 0) instance.unref();
    if (road) request.resolve(road);
    else request.reject(new Error(error ?? 'Could not prepare the track.'));
  });
  const fail = (error: Error) => {
    if (worker !== instance) return;
    worker = null;
    for (const request of requests.values()) request.reject(error);
    requests.clear();
  };
  instance.on('error', fail);
  instance.on('exit', code => fail(new Error(`Track preparation worker exited (${code}).`)));
  instance.unref();
  return instance;
}

function buildInWorker(layout: SplineTrack): Promise<PreparedRaceRoad> {
  return new Promise((resolve, reject) => {
    const id = nextRequestId++;
    requests.set(id, { resolve, reject });
    try {
      const instance = getWorker();
      instance.ref();
      instance.postMessage({ id, layout });
    } catch (error) {
      requests.delete(id);
      if (requests.size === 0) worker?.unref();
      reject(error instanceof Error ? error : new Error('Could not send track to preparation worker.'));
    }
  });
}

export function prepareRaceRoad(layout: SplineTrack): Promise<PreparedRaceRoad> {
  // Content, rather than the track ID, is the identity: edits cannot reuse stale geometry.
  const key = trackLayoutHash(layout);
  const cached = cache.get(key);
  if (cached) {
    cache.delete(key);
    cache.set(key, cached);
    return Promise.resolve(cached);
  }
  const existing = pending.get(key);
  if (existing) return existing;
  const job = buildInWorker(layout).then(road => {
    cache.set(key, road);
    if (cache.size > MAX_CACHED_ROADS) cache.delete(cache.keys().next().value!);
    return road;
  }).finally(() => pending.delete(key));
  pending.set(key, job);
  return job;
}
