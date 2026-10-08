import { getTilePosition } from '../track/grid.ts';
import type { TrackLayout } from '../track/layout.ts';
import type { VehicleState } from '../simulation/types.ts';

/** Fixed north-up view: +X is right, +Z is down, vehicle heading zero points up. */
export function createMinimap(canvas: HTMLCanvasElement, layout: TrackLayout, tileSize: number) {
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Minimap canvas is unavailable.');
  const background = document.createElement('canvas');
  const mapContext = background.getContext('2d')!;
  const tiles: { value: 1 | 2; row: number; column: number; x: number; z: number }[] = [];
  for (let row = 0; row < layout.length; row++) for (let column = 0; column < layout[row]!.length; column++) {
    const value = layout[row]![column];
    if (value === 1 || value === 2) tiles.push({ value, row, column, ...getTilePosition(layout, row, column, tileSize) });
  }
  // Fit occupied cells rather than wasting space on the blank part of the 64x64 map.
  const minX = tiles.length ? Math.min(...tiles.map((tile) => tile.x)) - tileSize / 2 : -tileSize;
  const maxX = tiles.length ? Math.max(...tiles.map((tile) => tile.x)) + tileSize / 2 : tileSize;
  const minZ = tiles.length ? Math.min(...tiles.map((tile) => tile.z)) - tileSize / 2 : -tileSize;
  const maxZ = tiles.length ? Math.max(...tiles.map((tile) => tile.z)) + tileSize / 2 : tileSize;
  const span = Math.max(maxX - minX, maxZ - minZ) + tileSize * 2;
  const centerX = (minX + maxX) / 2, centerZ = (minZ + maxZ) / 2;
  let size = 1, ratio = 1, scale = 1;

  function mapPoint(x: number, z: number) {
    return { x: size / 2 + (x - centerX) * scale, y: size / 2 + (z - centerZ) * scale };
  }

  function resize(): void {
    size = Math.max(1, canvas.clientWidth);
    ratio = Math.min(window.devicePixelRatio, 2);
    canvas.width = background.width = Math.round(size * ratio);
    canvas.height = background.height = Math.round(size * ratio);
    scale = Math.max(1, size - 20) / span;
    mapContext.setTransform(ratio, 0, 0, ratio, 0, 0);
    const tileWidth = tileSize * scale;
    for (const tile of tiles) {
      const point = mapPoint(tile.x - tileSize / 2, tile.z - tileSize / 2);
      mapContext.fillStyle = tile.value === 2 ? '#91e5ac' : ((tile.row + tile.column) % 2 ? '#8ca0ab' : '#a2b5bf');
      mapContext.fillRect(point.x, point.y, tileWidth + .1, tileWidth + .1);
      if (tile.value === 2) {
        mapContext.fillStyle = '#f5fffa';
        mapContext.fillRect(point.x, point.y + tileWidth * .45, tileWidth, Math.max(1, tileWidth * .1));
      }
    }
  }

  function update(state: Readonly<VehicleState>): void {
    context!.setTransform(ratio, 0, 0, ratio, 0, 0);
    context!.clearRect(0, 0, size, size);
    context!.drawImage(background, 0, 0, size, size);
    const point = mapPoint(state.position.x, state.position.z);
    // Keep the indicator visible if a crash carries the car beyond the map bounds.
    const margin = 9;
    context!.save();
    context!.translate(Math.max(margin, Math.min(size - margin, point.x)), Math.max(margin, Math.min(size - margin, point.y)));
    context!.rotate(-state.heading);
    context!.beginPath();
    context!.moveTo(0, -7);
    context!.lineTo(4.5, 4.5);
    context!.lineTo(0, 2.5);
    context!.lineTo(-4.5, 4.5);
    context!.closePath();
    context!.fillStyle = '#ff8a3d';
    context!.strokeStyle = '#fff';
    context!.lineWidth = 1.3;
    context!.fill();
    context!.stroke();
    context!.restore();
  }

  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  window.addEventListener('resize', resize);
  resize();

  return {
    update,
    dispose(): void {
      observer.disconnect();
      window.removeEventListener('resize', resize);
    },
  };
}
