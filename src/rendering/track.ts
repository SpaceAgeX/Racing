import { BoxGeometry, BufferGeometry, Color, Float32BufferAttribute, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry } from 'three';
import { getTilePosition } from '../track/grid.ts';
import type { TrackLayout } from '../track/layout.ts';
import { trackArchDimensions, trackTileThickness } from '../track/layout.ts';

const TRACK_CHUNK_TILES = 16;

/** The grid is fixed in world space. Zero cells create no surface or visual objects. */
export function createTrackVisual(layout: TrackLayout, tileSize: number) {
  const object = new Group();
  object.name = 'track';

  const thickness = trackTileThickness;
  const tiles: { row: number; column: number; value: number; position: { x: number; y: number; z: number } }[] = [];
  for (let row = 0; row < layout.length; row++) for (let column = 0; column < layout[row]!.length; column++) {
    const value = layout[row]![column]!;
    if (value === 1 || value === 2) tiles.push({ row, column, value, position: getTilePosition(layout, row, column, tileSize) });
  }
  const colors = [new Color(0x657178), new Color(0x6b777e)];
  const sideColor = new Color(0x505b61);
  const bottomColor = new Color(0x414a4f);
  const trackMaterial = new MeshStandardMaterial({ vertexColors: true, roughness: 1 });
  const trackGeometries: BufferGeometry[] = [];

  function isTrack(row: number, column: number): boolean {
    const value = layout[row]?.[column];
    return value === 1 || value === 2;
  }

  function createChunk(startRow: number, startColumn: number): void {
    const positions: number[] = [];
    const vertexColors: number[] = [];
    const indices: number[] = [];
    const origin = getTilePosition(layout, startRow, startColumn, tileSize);

    function quad(points: readonly [number, number, number][], color: Color): void {
      const base = positions.length / 3;
      for (const [x, y, z] of points) {
        positions.push(x, y, z);
        vertexColors.push(color.r, color.g, color.b);
      }
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }

    for (let row = startRow; row < Math.min(startRow + TRACK_CHUNK_TILES, layout.length); row++) {
      for (let column = startColumn; column < Math.min(startColumn + TRACK_CHUNK_TILES, layout[row]!.length); column++) {
        if (!isTrack(row, column)) continue;
        const x0 = (column - startColumn) * tileSize - tileSize / 2;
        const x1 = x0 + tileSize;
        const z0 = (row - startRow) * tileSize - tileSize / 2;
        const z1 = z0 + tileSize;
        const top = 0;
        const bottom = -thickness;
        quad([[x0, top, z0], [x0, top, z1], [x1, top, z1], [x1, top, z0]], colors[(row + column) % 2]!);
        quad([[x0, bottom, z0], [x1, bottom, z0], [x1, bottom, z1], [x0, bottom, z1]], bottomColor);
        if (!isTrack(row - 1, column)) quad([[x0, bottom, z0], [x0, top, z0], [x1, top, z0], [x1, bottom, z0]], sideColor);
        if (!isTrack(row + 1, column)) quad([[x0, bottom, z1], [x1, bottom, z1], [x1, top, z1], [x0, top, z1]], sideColor);
        if (!isTrack(row, column - 1)) quad([[x0, bottom, z0], [x0, bottom, z1], [x0, top, z1], [x0, top, z0]], sideColor);
        if (!isTrack(row, column + 1)) quad([[x1, bottom, z0], [x1, top, z0], [x1, top, z1], [x1, bottom, z1]], sideColor);
      }
    }

    if (positions.length === 0) return;
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new Float32BufferAttribute(vertexColors, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    trackGeometries.push(geometry);
    const chunk = new Mesh(geometry, trackMaterial);
    chunk.position.set(origin.x, 0, origin.z);
    chunk.receiveShadow = true;
    chunk.name = `track-chunk:${startRow}:${startColumn}`;
    object.add(chunk);
  }

  for (let row = 0; row < layout.length; row += TRACK_CHUNK_TILES) {
    for (let column = 0; column < layout[row]!.length; column += TRACK_CHUNK_TILES) createChunk(row, column);
  }
  const archHeight = trackArchDimensions.height;
  const postGeometry = new BoxGeometry(trackArchDimensions.postWidth, archHeight, trackArchDimensions.depth);
  const beamGeometry = new BoxGeometry(tileSize, trackArchDimensions.beamHeight, trackArchDimensions.depth);
  const archMaterial = new MeshStandardMaterial({ color: 0xf1f3f5, roughness: 0.8 });
  const lineColumns = 12;
  const checkerGeometry = new PlaneGeometry(tileSize / lineColumns, 0.6);
  const checkerMaterials = [
    new MeshBasicMaterial({ color: 0xffffff }),
    new MeshBasicMaterial({ color: 0x20272d }),
  ];

  function createStartFinish(): Group {
    const arch = new Group();
    arch.name = 'start-finish-arch';
    for (const side of [-1, 1]) {
      const post = new Mesh(postGeometry, archMaterial);
      post.position.set(side * (tileSize / 2 - trackArchDimensions.postInset), archHeight / 2, 0);
      post.castShadow = true;
      arch.add(post);
    }
    const beam = new Mesh(beamGeometry, archMaterial);
    beam.position.y = archHeight + trackArchDimensions.beamHeight / 2;
    beam.castShadow = true;
    arch.add(beam);

    // The line and overhead beam pass through the center of the start/finish tile.
    for (let row = 0; row < 2; row++) {
      for (let column = 0; column < lineColumns; column++) {
        const checker = new Mesh(checkerGeometry, checkerMaterials[(row + column) % 2]!);
        checker.rotation.x = -Math.PI / 2;
        checker.position.set(
          (column + 0.5) * tileSize / lineColumns - tileSize / 2,
          0.01,
          (row - 0.5) * 0.6,
        );
        arch.add(checker);
      }
    }
    return arch;
  }

  for (const tile of tiles) {
    if (tile.value === 2) {
      const arch = createStartFinish();
      arch.position.set(tile.position.x, 0, tile.position.z);
      object.add(arch);
    }
  }

  return {
    object,
    tiles,
    dispose(): void {
      for (const geometry of trackGeometries) geometry.dispose();
      postGeometry.dispose();
      beamGeometry.dispose();
      checkerGeometry.dispose();
      trackMaterial.dispose();
      for (const material of [archMaterial, ...checkerMaterials]) material.dispose();
    },
  };
}
