import { BoxGeometry, Color, Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry } from 'three';
import { getTilePosition } from '../track/grid.ts';
import type { TrackLayout } from '../track/layout.ts';
import { trackArchDimensions, trackTileThickness } from '../track/layout.ts';

/** The grid is fixed in world space. Zero cells create no surface or visual objects. */
export function createTrackVisual(layout: TrackLayout, tileSize: number) {
  const object = new Group();
  object.name = 'track';

  const thickness = trackTileThickness;
  const tileGeometry = new BoxGeometry(tileSize, thickness, tileSize);
  const tileMaterial = new MeshStandardMaterial({ color: 0xffffff, roughness: 1 });
  const tiles: { row: number; column: number; value: number; position: { x: number; y: number; z: number } }[] = [];
  for (let row = 0; row < layout.length; row++) for (let column = 0; column < layout[row]!.length; column++) {
    const value = layout[row]![column]!;
    if (value === 1 || value === 2) tiles.push({ row, column, value, position: getTilePosition(layout, row, column, tileSize) });
  }
  const floor = new InstancedMesh(tileGeometry, tileMaterial, Math.max(1, tiles.length));
  floor.count = tiles.length;
  floor.receiveShadow = true;
  floor.name = 'track-floor';
  const matrix = new Matrix4();
  const colors = [new Color(0x657178), new Color(0x6b777e)];
  for (let index = 0; index < tiles.length; index++) {
    const tile = tiles[index]!;
    floor.setMatrixAt(index, matrix.makeTranslation(tile.position.x, -thickness / 2, tile.position.z));
    floor.setColorAt(index, colors[(tile.row + tile.column) % 2]!);
  }
  object.add(floor);
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
      tileGeometry.dispose();
      postGeometry.dispose();
      beamGeometry.dispose();
      checkerGeometry.dispose();
      floor.dispose();
      for (const material of [tileMaterial, archMaterial, ...checkerMaterials]) material.dispose();
    },
  };
}
