import {
  AmbientLight, CircleGeometry, DirectionalLight, Mesh, MeshStandardMaterial,
  PerspectiveCamera, PlaneGeometry, Scene, WebGLRenderer,
} from 'three';
import { createCarVisual } from './car.ts';
import { createVehicleState } from '../simulation/vehicle.ts';
import { playerColorPalette } from '../multiplayer/protocol.ts';

const cars = [
  { x: -5.4, z: 0.8, heading: -2.58 },
  { x: -3.45, z: -0.7, heading: -2.86 },
  { x: 3.45, z: -0.7, heading: 2.86 },
  { x: 5.4, z: 0.8, heading: 2.58 },
] as const;

function randomizedCarColors(): number[] {
  const colors = playerColorPalette.map((color) => Number.parseInt(color.slice(1), 16));
  for (let index = colors.length - 1; index > 0; index--) {
    const other = Math.floor(Math.random() * (index + 1));
    [colors[index], colors[other]] = [colors[other]!, colors[index]!];
  }
  return colors.slice(0, cars.length);
}

export function createMenuBackdrop(canvas: HTMLCanvasElement) {
  const scene = new Scene();
  scene.background = null;
  const camera = new PerspectiveCamera(38, 1, 0.1, 100);
  camera.position.set(0, 8, 12);
  camera.lookAt(0, 2.2, -0.1);

  const renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));

  const ground = new Mesh(
    new PlaneGeometry(200, 200),
    new MeshStandardMaterial({ color: 0x34464b, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.22;
  scene.add(ground);

  const plaza = new Mesh(
    new CircleGeometry(8.3, 72),
    new MeshStandardMaterial({ color: 0x687276, roughness: 0.94 }),
  );
  plaza.rotation.x = -Math.PI / 2;
  plaza.position.y = -0.12;
  scene.add(plaza);

  const rim = new Mesh(
    new CircleGeometry(8.55, 72),
    new MeshStandardMaterial({ color: 0x9c9b8d, roughness: 0.88 }),
  );
  rim.rotation.x = -Math.PI / 2;
  rim.position.y = -0.18;
  scene.add(rim);

  scene.add(new AmbientLight(0xd7e7ed, 2.1));
  const keyLight = new DirectionalLight(0xffeed9, 3.2);
  keyLight.position.set(-7, 12, 10);
  scene.add(keyLight);
  const fillLight = new DirectionalLight(0x8bc9ff, 1.4);
  fillLight.position.set(8, 8, 1);
  scene.add(fillLight);

  const colors = randomizedCarColors();
  const visuals = cars.map(({ x, z, heading }, index) => {
    const color = colors[index]!;
    const visual = createCarVisual(color);
    const state = createVehicleState();
    state.position.x = x;
    state.position.y = 0;
    state.position.z = z;
    state.heading = heading;
    visual.update(state);
    scene.add(visual.object);
    return visual;
  });

  let active = false;
  let disposed = false;

  function resize(): void {
    const width = Math.max(1, canvas.clientWidth);
    const height = Math.max(1, canvas.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    if (active) renderer.render(scene, camera);
  }

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvas);
  window.addEventListener('resize', resize);
  resize();
  // The display cars do not move. Redraw when their models finish loading or
  // when the menu size changes instead of spending a frame on them every tick.
  void Promise.all(visuals.map((visual) => visual.ready)).then(() => {
    if (active && !disposed) renderer.render(scene, camera);
  });

  return {
    setActive(value: boolean): void {
      if (active === value) return;
      active = value;
      canvas.hidden = !active;
      if (active) resize();
    },
    dispose(): void {
      active = false;
      disposed = true;
      resizeObserver.disconnect();
      window.removeEventListener('resize', resize);
      for (const visual of visuals) visual.dispose();
      ground.geometry.dispose();
      (ground.material as MeshStandardMaterial).dispose();
      plaza.geometry.dispose();
      (plaza.material as MeshStandardMaterial).dispose();
      rim.geometry.dispose();
      (rim.material as MeshStandardMaterial).dispose();
      renderer.dispose();
      canvas.remove();
    },
  };
}
