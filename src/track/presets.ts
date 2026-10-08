import { emptyTrack } from './model.ts';
import type { TrackTile } from './layout.ts';

function insideRoundedRectangle(x: number, z: number, left: number, top: number, right: number, bottom: number, radius: number): boolean {
  if (x < left || x > right || z < top || z > bottom) return false;
  const dx = Math.max(left + radius - x, 0, x - (right - radius));
  const dz = Math.max(top + radius - z, 0, z - (bottom - radius));
  return dx * dx + dz * dz <= radius * radius;
}

function roundedLoop(chicane: boolean): TrackTile[][] {
  const grid = emptyTrack();
  for (let row = 0; row < 64; row++) for (let column = 0; column < 64; column++) {
    const x = column + 0.5, z = row + 0.5;
    const outer = insideRoundedRectangle(x, z, 19, 15, 45, 49, 7);
    const inner = insideRoundedRectangle(x, z, 22, 18, 42, 46, 4);
    if (!outer || inner) continue;
    const shift = chicane && column > 32 && row >= 25 && row <= 40
      ? Math.round(4 * Math.sin(Math.PI * (row - 25) / 15) ** 2) : 0;
    grid[row]![column - shift] = 1;
  }
  grid[37]![20] = 2;
  return grid;
}

export function createDefaultTrack(): TrackTile[][] { return roundedLoop(true); }
export function createSimpleLoopTrack(): TrackTile[][] { return roundedLoop(false); }

export const trackPresets = [
  { id: 'default', name: 'Default circuit', create: createDefaultTrack },
  { id: 'simple-loop', name: 'Simple loop track', create: createSimpleLoopTrack },
] as const;
