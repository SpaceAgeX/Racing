import { parentPort } from 'node:worker_threads';
import { buildRoadGeometry } from '../src/track/road-geometry.ts';
import type { SplineGraph } from '../src/track/spline.ts';

if (!parentPort) throw new Error('Road preparation must run in a worker.');

parentPort.on('message', ({ id, layout }: { id: number; layout: SplineGraph }) => {
  try {
    const { triangles, spawns, finish, checkpoints } = buildRoadGeometry(layout);
    parentPort!.postMessage({ id, road: { triangles, spawns, finish, checkpoints } });
  } catch (error) {
    parentPort!.postMessage({ id, error: error instanceof Error ? error.message : 'Could not prepare the track.' });
  }
});
