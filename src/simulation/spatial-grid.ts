import type { GroundBounds } from './footprint.ts';

/** Static XZ buckets keep large tile maps from scanning every collider on every step. */
export function createSpatialGrid<T>(items: readonly T[], boundsOf: (item: T) => GroundBounds, cellSize = 24) {
  const buckets = new Map<string, T[]>();
  for (const item of items) {
    const bounds = boundsOf(item);
    for (let x = Math.floor(bounds.minX / cellSize); x <= Math.floor(bounds.maxX / cellSize); x++) {
      for (let z = Math.floor(bounds.minZ / cellSize); z <= Math.floor(bounds.maxZ / cellSize); z++) {
        const key = `${x}:${z}`;
        const bucket = buckets.get(key);
        if (bucket) bucket.push(item); else buckets.set(key, [item]);
      }
    }
  }
  return {
    query(bounds: GroundBounds): T[] {
      const result = new Set<T>();
      for (let x = Math.floor((bounds.minX - 1e-6) / cellSize); x <= Math.floor((bounds.maxX + 1e-6) / cellSize); x++) {
        for (let z = Math.floor((bounds.minZ - 1e-6) / cellSize); z <= Math.floor((bounds.maxZ + 1e-6) / cellSize); z++) {
          for (const item of buckets.get(`${x}:${z}`) ?? []) result.add(item);
        }
      }
      return [...result];
    },
  };
}
