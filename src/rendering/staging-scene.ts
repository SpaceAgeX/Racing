import { AmbientLight, Color, DirectionalLight, Fog, MeshStandardMaterial, Scene } from 'three';

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

export function addStagingAtmosphere(scene: Scene, horizontal = false): DirectionalLight {
  scene.background = new Color(stagingColors.background);
  scene.fog = new Fog(stagingColors.background, horizontal ? 22 : 24, horizontal ? 75 : 48);
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
