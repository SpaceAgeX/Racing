import type { TrackLayout, TrackTile } from './layout.ts';

export const MAP_SIZE = 64;

export function emptyTrack(): TrackTile[][] {
  return Array.from({ length: MAP_SIZE }, () => Array<TrackTile>(MAP_SIZE).fill(0));
}

export function cloneTrack(layout: TrackLayout): TrackTile[][] {
  return layout.map((row) => [...row]);
}

export function isTrackGrid(value: unknown): value is TrackTile[][] {
  return Array.isArray(value) && value.length === MAP_SIZE && value.every((row: unknown) => (
    Array.isArray(row) && row.length === MAP_SIZE && Array.from(row).every((tile: unknown) => tile === 0 || tile === 1 || tile === 2)
  ));
}

export function trackSummary(layout: TrackLayout) {
  let startCount = 0;
  let tileCount = 0;
  for (const row of layout) for (const tile of row) {
    if (tile !== 0) tileCount++;
    if (tile === 2) startCount++;
  }
  return { startCount, tileCount, playable: startCount === 1 };
}

export function playableTrackError(layout: unknown): string | null {
  if (!isTrackGrid(layout)) return 'Use a 64 × 64 grid containing only empty, track, and start/finish tiles.';
  if (trackSummary(layout).startCount !== 1) return 'Place exactly one start/finish tile before saving or playing.';
  return null;
}

/** Placing the start moves the old one, leaving ordinary track in its place. */
export function paintTrack(layout: TrackTile[][], row: number, column: number, value: TrackTile): void {
  if (row < 0 || column < 0 || row >= MAP_SIZE || column >= MAP_SIZE) return;
  if (value === 2) {
    for (const cells of layout) for (let index = 0; index < cells.length; index++) if (cells[index] === 2) cells[index] = 1;
  }
  if (value === 1 && layout[row]![column] === 2) return;
  layout[row]![column] = value;
}

export function paintTrackStroke(layout: TrackTile[][], from: { row: number; column: number }, to: { row: number; column: number }, value: TrackTile): void {
  let x = from.column, y = from.row;
  const dx = Math.abs(to.column - x), dy = -Math.abs(to.row - y);
  const sx = x < to.column ? 1 : -1, sy = y < to.row ? 1 : -1;
  let error = dx + dy;
  while (true) {
    paintTrack(layout, y, x, value);
    if (x === to.column && y === to.row) break;
    const doubled = error * 2;
    if (doubled >= dy) { error += dy; x += sx; }
    if (doubled <= dx) { error += dx; y += sy; }
  }
}
