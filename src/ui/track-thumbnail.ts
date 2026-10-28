import { buildSplineSurface } from '../track/spline-surface.ts';
import { getSplineTrackFrame, SPLINE_EDITOR_WORLD_SIZE } from '../track/spline.ts';
import type { SplineTrack } from '../track/spline-records.ts';

const cache = new Map<string, HTMLCanvasElement>();

/** Static version of the in-race minimap, cached by layout content. */
export function trackThumbnail(layout: SplineTrack): HTMLCanvasElement {
  const key = JSON.stringify(layout);
  const cached = cache.get(key);
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const context = canvas.getContext('2d')!;
  const surface = buildSplineSurface(layout);
  const points = surface.polygons.flat(2);
  const xs = points.map(point => point[0]), zs = points.map(point => point[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
  const span = Math.max(maxX - minX, maxZ - minZ) + 12;
  const centerX = (minX + maxX) / 2, centerZ = (minZ + maxZ) / 2;
  const scale = 236 / span;
  const map = (x: number, z: number) => ({ x: 128 + (x - centerX) * scale, y: 128 + (z - centerZ) * scale });
  context.fillStyle = '#202d35';
  context.fillRect(0, 0, 256, 256);
  context.beginPath();
  for (const polygon of surface.polygons) for (const ring of polygon) {
    ring.forEach(([x, z], index) => {
      const point = map(x, z);
      if (index === 0) context.moveTo(point.x, point.y); else context.lineTo(point.x, point.y);
    });
    context.closePath();
  }
  context.fillStyle = '#9eb2bd';
  context.fill('evenodd');
  for (const marker of [...layout.checkpoints, ...(layout.finishLine ? [layout.finishLine] : [])]) {
    const frame = getSplineTrackFrame(layout, marker);
    if (!frame) continue;
    const x = (frame.position.x - .5) * SPLINE_EDITOR_WORLD_SIZE;
    const z = (frame.position.y - .5) * SPLINE_EDITOR_WORLD_SIZE;
    const right = { x: frame.direction.y, z: -frame.direction.x };
    const a = map(x - right.x * frame.width / 2, z - right.z * frame.width / 2);
    const b = map(x + right.x * frame.width / 2, z + right.z * frame.width / 2);
    context.beginPath(); context.moveTo(a.x, a.y); context.lineTo(b.x, b.y);
    context.lineWidth = 2;
    context.strokeStyle = marker === layout.finishLine ? '#fff' : '#4bb9ff';
    context.stroke();
  }
  cache.set(key, canvas);
  if (cache.size > 80) cache.delete(cache.keys().next().value!);
  return canvas;
}
