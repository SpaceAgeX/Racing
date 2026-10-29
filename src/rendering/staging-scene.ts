import { AmbientLight, BoxGeometry, Color, DirectionalLight, Fog, Group, Mesh, MeshStandardMaterial, PlaneGeometry, Scene } from 'three';

/** Shared road and lighting treatment for the menu and multiplayer staging scenes. */
export const stagingColors = {
  background: 0x111417,
  asphalt: 0x252c30,
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
  return { dispose() {
    scene.remove(group);
    for (const mesh of meshes) {
      mesh.geometry.dispose();
      (mesh.material as MeshStandardMaterial).dispose();
    }
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
