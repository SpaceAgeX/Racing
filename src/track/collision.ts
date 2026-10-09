import { createCollisionWorld } from '../simulation/collision.ts';
import type { SolidBoxCollider } from '../simulation/box.ts';
import { getTilePosition } from './grid.ts';
import type { TrackLayout } from './layout.ts';
import { trackArchDimensions, trackTileThickness } from './layout.ts';

/** Compile the visible track slabs and arches into matching solid collision boxes. */
export function createTrackCollisionWorld(layout: TrackLayout, tileSize: number) {
  const solids: SolidBoxCollider[] = [];
  const halfSize = tileSize / 2;
  const visited = layout.map((row) => new Uint8Array(row.length));

  // Greedily merge each flat tile region into disjoint rectangles. This reduces
  // broad-phase candidates while keeping exactly the same occupied footprint.
  for (let row = 0; row < layout.length; row++) {
    const cells = layout[row]!;
    for (let column = 0; column < cells.length; column++) {
      if ((cells[column] !== 1 && cells[column] !== 2) || visited[row]![column]) continue;
      let width = 1;
      while (column + width < cells.length && !visited[row]![column + width]
        && (cells[column + width] === 1 || cells[column + width] === 2)) width++;
      let height = 1;
      for (;;) {
        const nextRow = row + height;
        if (nextRow >= layout.length || column + width > layout[nextRow]!.length) break;
        let rowFits = true;
        for (let offset = 0; offset < width; offset++) {
          const value = layout[nextRow]![column + offset];
          if (visited[nextRow]![column + offset] || (value !== 1 && value !== 2)) { rowFits = false; break; }
        }
        if (!rowFits) break;
        height++;
      }
      for (let offsetRow = row; offsetRow < row + height; offsetRow++) {
        for (let offsetColumn = column; offsetColumn < column + width; offsetColumn++) visited[offsetRow]![offsetColumn] = 1;
      }
      const point = getTilePosition(layout, row, column, tileSize);
      solids.push({
        id: `track-region:${row}:${column}:${height}x${width}`,
        min: { x: point.x - halfSize, y: point.y - trackTileThickness, z: point.z - halfSize },
        max: { x: point.x + (width - 0.5) * tileSize, y: point.y, z: point.z + (height - 0.5) * tileSize },
      });
    }
  }

  for (let row = 0; row < layout.length; row++) {
    const cells = layout[row]!;
    for (let column = 0; column < cells.length; column++) {
      if (cells[column] === 2) {
        const point = getTilePosition(layout, row, column, tileSize);
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
