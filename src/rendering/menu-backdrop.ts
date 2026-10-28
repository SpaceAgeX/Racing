import {
  AmbientLight, BoxGeometry, Color, DirectionalLight, Fog, Group, Mesh,
  MeshStandardMaterial, PerspectiveCamera, PlaneGeometry, Scene, WebGLRenderer,
} from 'three';
import { createCarVisual } from './car.ts';
import { createVehicleState } from '../simulation/vehicle.ts';
import { carColorNames } from '../ui/car-colors.ts';
import { getActiveAccentColor, onActiveAccentColorChange } from '../ui/accent.ts';

// Local car forward is -Z. The finish stripe is at Z = 0.
const finishSeconds = 2.5;
const placements = [
  { x: -1.85, startZ: 18, finishZ: 1.85 },
  { x: 1.65, startZ: 20, finishZ: 2.12 },
  { x: 0.1, startZ: 25, finishZ: 7.1 },
] as const;

function companionColors(accent: string): number[] {
  const palette = [...carColorNames.keys()];
  const preferred = ['#f5d76e', '#ef5350', '#6bc5ff', '#8ce5ad', '#c38fff'];
  const chosen = preferred.filter(color => color !== accent);
  for (const color of palette) if (color !== accent && !chosen.includes(color)) chosen.push(color);
  return chosen.slice(0, 2).map(color => Number.parseInt(color.slice(1), 16));
}

/** Decorative scene only: no gameplay simulation or network connection. */
export function createMenuBackdrop(canvas: HTMLCanvasElement) {
  const accent = getActiveAccentColor();
  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'low-power' });
  } catch {
    canvas.hidden = true;
    return { setActive(_value: boolean): void {}, dispose(): void { canvas.remove(); } };
  }

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.shadowMap.enabled = true;
  const scene = new Scene();
  scene.background = new Color(0x111417);
  scene.fog = new Fog(0x111417, 32, 75);
  const camera = new PerspectiveCamera(42, 1, 0.1, 100);
  const resources: Mesh[] = [];
  const environment = new Group();
  scene.add(environment);

  function addBox(width: number, height: number, length: number, color: number, x: number, y: number, z: number): Mesh {
    const mesh = new Mesh(new BoxGeometry(width, height, length), new MeshStandardMaterial({ color, roughness: 0.9 }));
    mesh.position.set(x, y, z);
    mesh.receiveShadow = true;
    environment.add(mesh);
    resources.push(mesh);
    return mesh;
  }

  const road = new Mesh(new PlaneGeometry(12, 90), new MeshStandardMaterial({ color: 0x252c30, roughness: 1 }));
  road.rotation.x = -Math.PI / 2;
  road.position.set(0, -0.065, 11);
  road.receiveShadow = true;
  environment.add(road);
  resources.push(road);

  for (let side = -1; side <= 1; side += 2) {
    addBox(0.12, 0.02, 70, 0xa5adb1, side * 5.67, -0.034, 11);
    addBox(0.28, 0.7, 70, 0x414b50, side * 6.2, 0.24, 11);
    addBox(0.055, 0.045, 70, 0x839097, side * 6.2, 0.62, 11);
  }

  // Individual tiles keep the finish line crisp from a low camera angle.
  const tilesAcross = 20;
  const tileWidth = 11.25 / tilesAcross;
  const tileLength = 0.42;
  for (let row = 0; row < 4; row++) {
    for (let column = 0; column < tilesAcross; column++) {
      addBox(tileWidth - 0.006, 0.012, tileLength - 0.006,
        (row + column) % 2 === 0 ? 0xe4e9ea : 0x121719,
        -5.625 + (column + 0.5) * tileWidth, -0.048, (row - 1.5) * tileLength);
    }
  }

  scene.add(new AmbientLight(0xb8cad1, 0.7));
  const key = new DirectionalLight(0xfff2e3, 3.2);
  key.position.set(-5, 11, -4);
  key.target.position.set(0, 0, 3);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -13;
  key.shadow.camera.right = 13;
  key.shadow.camera.top = 17;
  key.shadow.camera.bottom = -17;
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 35;
  key.shadow.normalBias = 0.025;
  scene.add(key, key.target);
  const fill = new DirectionalLight(0x9dc6e2, 1.2);
  fill.position.set(5, 5, 12);
  scene.add(fill);

  const palette = companionColors(accent);
  const visuals = placements.map((placement, index) => {
    const visual = createCarVisual(index === 0 ? Number.parseInt(accent.slice(1), 16) : palette[index - 1]!);
    const state = createVehicleState();
    state.position.x = placement.x;
    state.position.z = placement.startZ;
    visual.update(state);
    scene.add(visual.object);
    return { visual, state };
  });

  const unsubscribeAccent = onActiveAccentColorChange(color => {
    visuals[0]!.visual.setColor(Number.parseInt(color.slice(1), 16));
    if (active) render();
  });
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let active = false;
  let disposed = false;
  let frame = 0;
  let elapsed = 0;
  let lastTime = 0;
  let lastPaint = 0;

  function render(): void {
    if (disposed) return;
    const seconds = motion.matches ? finishSeconds : Math.min(elapsed, finishSeconds);
    const progress = seconds / finishSeconds;
    // Cubic deceleration makes the first second fast and the last second slow.
    const eased = 1 - (1 - progress) ** 3;
    for (let index = 0; index < placements.length; index++) {
      const placement = placements[index]!;
      const { visual, state } = visuals[index]!;
      state.position.z = placement.startZ + (placement.finishZ - placement.startZ) * eased;
      visual.update(state);
    }
    const hold = Math.max(0, elapsed - finishSeconds);
    const drift = motion.matches ? 0 : Math.sin(hold * 0.24) * 0.28;
    const arrival = motion.matches ? 1 : eased;
    camera.position.set(-7.8 + drift, 3.7, -10.5 - (1 - arrival) * 1.6);
    camera.lookAt(0.25 + drift * 0.2, 0.55, 3.1);
    renderer.render(scene, camera);
  }

  function animate(time: number): void {
    if (!active || disposed || document.hidden || motion.matches) return;
    if (lastTime) elapsed += Math.min((time - lastTime) / 1000, 0.25);
    lastTime = time;
    if (time - lastPaint >= 1000 / 30) {
      lastPaint = time;
      render();
    }
    frame = requestAnimationFrame(animate);
  }

  function schedule(): void {
    cancelAnimationFrame(frame);
    frame = 0;
    lastTime = 0;
    if (!active || disposed || document.hidden) return;
    if (motion.matches) render();
    else frame = requestAnimationFrame(animate);
  }

  function resize(): void {
    if (disposed) return;
    const width = Math.max(1, canvas.clientWidth);
    const height = Math.max(1, canvas.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, width < 700 ? 1 : 1.5));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.fov = width < 700 ? 50 : 42;
    camera.updateProjectionMatrix();
    if (active) render();
  }

  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  window.addEventListener('resize', resize);
  document.addEventListener('visibilitychange', schedule);
  motion.addEventListener('change', schedule);
  resize();
  void Promise.all(visuals.map(item => item.visual.ready)).then(() => { if (active && !disposed) render(); });

  return {
    setActive(value: boolean): void {
      if (active === value) return;
      active = value;
      canvas.hidden = !value;
      if (value) resize();
      schedule();
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      active = false;
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', schedule);
      motion.removeEventListener('change', schedule);
      unsubscribeAccent();
      for (const item of visuals) item.visual.dispose();
      for (const mesh of resources) {
        mesh.geometry.dispose();
        (mesh.material as MeshStandardMaterial).dispose();
      }
      key.shadow.dispose();
      renderer.dispose();
      canvas.remove();
    },
  };
}
