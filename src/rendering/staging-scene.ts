import { AmbientLight, BoxGeometry, Color, DirectionalLight, Fog, Group, InstancedMesh, Mesh, MeshStandardMaterial, Object3D, PlaneGeometry, Scene } from 'three';

/** Shared road and lighting treatment for the menu and multiplayer staging scenes. */
export const stagingColors = {
  background: 0x111417,
  asphalt: 0x252c30,
  asphaltSide: 0x1a2024,
  edge: 0x747f83,
  checkerLight: 0xe4e9ea,
  checkerDark: 0x121719,
} as const;

export function stagingAsphalt(): MeshStandardMaterial {
  return new MeshStandardMaterial({ color: stagingColors.asphalt, roughness: 1 });
}

/** The same asphalt, raised edge strips, and checkered finish for both staging views. */
export function addStagingRoad(scene: Scene, options: { length: number; center: number; horizontal?: boolean; width?: number }) {
  const group = new Group();
  const width = options.width ?? 12;
  if (options.horizontal) group.rotation.y = Math.PI / 2;
  scene.add(group);
  const meshes: Mesh[] = [];
  const addBox = (width: number, height: number, depth: number, color: number, x: number, y: number, z: number) => {
    const mesh = new Mesh(new BoxGeometry(width, height, depth), new MeshStandardMaterial({ color, roughness: .9 }));
    mesh.position.set(x, y, z);
    mesh.receiveShadow = true;
    group.add(mesh); meshes.push(mesh);
  };
  let checkerGeometry: PlaneGeometry | null = null;
  let checkerMaterials: MeshStandardMaterial[] = [];
  if (options.horizontal) {
    // Only the lobby road gains a shallow slab; the main-menu scene stays as it was.
    const roadThickness = .45;
    const roadTop = -.065;
    const sideMaterial = () => new MeshStandardMaterial({ color: stagingColors.asphaltSide, roughness: 1 });
    const road = new Mesh(new BoxGeometry(width, roadThickness, options.length), [
      sideMaterial(), sideMaterial(), stagingAsphalt(), sideMaterial(), sideMaterial(), sideMaterial(),
    ]);
    road.position.set(0, roadTop - roadThickness / 2, options.center);
    road.receiveShadow = true;
    group.add(road); meshes.push(road);

    const tileLength = .42;
    const finishHalfLength = tileLength * 2;
    const roadStart = options.center - options.length / 2;
    const roadEnd = options.center + options.length / 2;
    // Stop the raised edge strips at the stripe so checkers reach both road edges.
    for (const side of [-1, 1]) {
      const edgeX = side * (width / 2 - .3);
      addBox(.09, .012, -finishHalfLength - roadStart, stagingColors.edge,
        edgeX, -.05, (roadStart - finishHalfLength) / 2);
      addBox(.09, .012, roadEnd - finishHalfLength, stagingColors.edge,
        edgeX, -.05, (roadEnd + finishHalfLength) / 2);
    }
    const columns = Math.max(2, Math.round(width / .55));
    const tileWidth = width / columns;
    checkerGeometry = new PlaneGeometry(tileWidth - .004, tileLength - .004);
    checkerMaterials = [stagingColors.checkerLight, stagingColors.checkerDark]
      .map(color => new MeshStandardMaterial({ color, roughness: 1 }));
    const checkerMeshes = checkerMaterials.map(material => {
      const mesh = new InstancedMesh(checkerGeometry!, material, columns * 2);
      mesh.receiveShadow = true;
      group.add(mesh);
      return mesh;
    });
    const tile = new Object3D();
    tile.rotation.x = -Math.PI / 2;
    const counts = [0, 0];
    for (let row = 0; row < 4; row++) for (let column = 0; column < columns; column++) {
      const shade = (row + column) % 2;
      tile.position.set(-width / 2 + (column + .5) * tileWidth, roadTop + .002, (row - 1.5) * tileLength);
      tile.updateMatrix();
      checkerMeshes[shade]!.setMatrixAt(counts[shade]!, tile.matrix);
      counts[shade] = counts[shade]! + 1;
    }
    for (const mesh of checkerMeshes) mesh.instanceMatrix.needsUpdate = true;
  } else {
    const road = new Mesh(new PlaneGeometry(width, options.length), stagingAsphalt());
    road.rotation.x = -Math.PI / 2;
    road.position.set(0, -.065, options.center);
    road.receiveShadow = true;
    group.add(road); meshes.push(road);
    for (const side of [-1, 1]) addBox(.09, .012, options.length, stagingColors.edge, side * (width / 2 - .3), -.05, options.center);
    const tileWidth = 11.25 / 20;
    const tileLength = .42;
    for (let row = 0; row < 4; row++) for (let column = 0; column < 20; column++) {
      addBox(tileWidth - .006, .012, tileLength - .006,
        (row + column) % 2 === 0 ? stagingColors.checkerLight : stagingColors.checkerDark,
        -5.625 + (column + .5) * tileWidth, -.048, (row - 1.5) * tileLength);
    }
  }
  return { dispose() {
    scene.remove(group);
    for (const mesh of meshes) {
      mesh.geometry.dispose();
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) material.dispose();
    }
    checkerGeometry?.dispose();
    for (const material of checkerMaterials) material.dispose();
  } };
}

export function addStagingAtmosphere(scene: Scene, horizontal = false): DirectionalLight {
  scene.background = new Color(stagingColors.background);
  // The lobby's long, horizontal road must stay sharp all the way to the viewport edge.
  // The menu retains its short-range cinematic fog.
  scene.fog = horizontal ? null : new Fog(stagingColors.background, 24, 48);
  scene.add(new AmbientLight(0xb8cad1, 1.05));
  const key = new DirectionalLight(0xfff2e3, 3.8);
  if (horizontal) { key.position.set(-6, 11, 5); key.target.position.set(5, 0, 0); }
  else { key.position.set(-5, 11, -4); key.target.position.set(0, 0, 3); }
  key.castShadow = true;
  key.shadow.mapSize.set(horizontal ? 512 : 1024, horizontal ? 512 : 1024);
  key.shadow.camera.left = horizontal ? -31 : -13;
  key.shadow.camera.right = horizontal ? 31 : 13;
  key.shadow.camera.top = horizontal ? 18 : 17;
  key.shadow.camera.bottom = horizontal ? -18 : -17;
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = horizontal ? 55 : 35;
  key.shadow.normalBias = 0.025;
  scene.add(key, key.target);
  const fill = new DirectionalLight(0x9dc6e2, 1.7);
  if (horizontal) fill.position.set(12, 5, -5);
  else fill.position.set(5, 5, 12);
  scene.add(fill);
  const rim = new DirectionalLight(0xd7e7f0, 1.0);
  if (horizontal) rim.position.set(-8, 7, -7);
  else rim.position.set(7, 7, -8);
  scene.add(rim);
  return key;
}
