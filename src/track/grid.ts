import type { TrackLayout } from './layout.ts';

/** Center the grid on the world origin; adjacent tile centers are one tile apart. */
export function getTilePosition(layout: TrackLayout, row: number, column: number, tileSize: number) {
  const columns = layout.reduce((width, cells) => Math.max(width, cells.length), 0);
  return {
    x: (column - (columns - 1) / 2) * tileSize,
    y: 0,
    z: (row - (layout.length - 1) / 2) * tileSize,
  };
}

/** Timing uses the first start/finish tile, matching the spawn selection. */
export function getFinishLine(layout: TrackLayout, tileSize: number) {
  for (let row = 0; row < layout.length; row++) {
    const column = layout[row]!.indexOf(2);
    if (column !== -1) return { center: getTilePosition(layout, row, column, tileSize), width: tileSize };
  }
  return null;
}

/** First start/finish tile wins; a layout without a start uses its first track tile. */
export function getTrackSpawn(layout: TrackLayout, tileSize: number) {
  let firstTrack: { row: number; column: number } | undefined;
  for (let row = 0; row < layout.length; row++) {
    const cells = layout[row]!;
    for (let column = 0; column < cells.length; column++) {
      const tile = cells[column];
      if (tile === 2) {
        const position = getTilePosition(layout, row, column, tileSize);
        // Begin behind the arch, with room for the car to approach the line.
        position.z += tileSize / 4;
        return { position, heading: 0 };
      }
      if (tile === 1 && !firstTrack) firstTrack = { row, column };
    }
  }

  return {
    position: firstTrack
      ? getTilePosition(layout, firstTrack.row, firstTrack.column, tileSize)
      : { x: 0, y: 0, z: 0 },
    heading: 0,
  };
}
