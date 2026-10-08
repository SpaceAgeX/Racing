import { createCollisionWorld } from '../simulation/collision.ts';
import type { SolidBoxCollider } from '../simulation/box.ts';
import { getTilePosition } from './grid.ts';
import type { TrackLayout } from './layout.ts';
import { trackArchDimensions, trackTileThickness } from './layout.ts';

/** Compile the visible track slabs and arches into matching solid collision boxes. */
export function createTrackCollisionWorld(layout: TrackLayout, tileSize: number) {
  const solids: SolidBoxCollider[] = [];
  const halfSize = tileSize / 2;
  for (let row = 0; row < layout.length; row++) {
    const cells = layout[row]!;
    for (let column = 0; column < cells.length; column++) {
      if (cells[column] !== 1 && cells[column] !== 2) continue;
      const point = getTilePosition(layout, row, column, tileSize);
      solids.push({
        id: `track-tile:${row}:${column}`,
        min: { x: point.x - halfSize, y: point.y - trackTileThickness, z: point.z - halfSize },
        max: { x: point.x + halfSize, y: point.y, z: point.z + halfSize },
      });
      if (cells[column] === 2) {
        const arch = trackArchDimensions;
        for (const side of [-1, 1]) {
          const x = point.x + side * (halfSize - arch.postInset);
          solids.push({
            id: `start-finish-post:${row}:${column}:${side}`,
            min: { x: x - arch.postWidth / 2, y: point.y, z: point.z - arch.depth / 2 },
            max: { x: x + arch.postWidth / 2, y: point.y + arch.height, z: point.z + arch.depth / 2 },
          });
        }
        solids.push({
          id: `start-finish-beam:${row}:${column}`,
          min: { x: point.x - halfSize, y: point.y + arch.height, z: point.z - arch.depth / 2 },
          max: { x: point.x + halfSize, y: point.y + arch.height + arch.beamHeight, z: point.z + arch.depth / 2 },
        });
      }
    }
  }
  return createCollisionWorld([], solids);
}
