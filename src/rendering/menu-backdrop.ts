import {
  AmbientLight, BoxGeometry, Color, DirectionalLight, Fog, Group, Mesh,
  MeshStandardMaterial, PerspectiveCamera, PlaneGeometry, Scene, WebGLRenderer,
} from 'three';
import { createCarVisual } from './car.ts';
import { createVehicleState } from '../simulation/vehicle.ts';
import { getActiveAccentColor, onActiveAccentColorChange } from '../ui/accent.ts';

// Local car forward is -Z. The finish stripe is at Z = 0.
const finishSeconds = 2.5;
const placements = [
  { x: -0.8, startZ: 18, finishZ: 3.1, heading: -0.02 },
  { x: 4.1, startZ: 23, finishZ: 7.0, heading: 0.075 },
  { x: 3.2, startZ: 32, finishZ: 14.5, heading: -0.11 },
] as const;

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
  // The road ends deep in full fog, so no distant geometry edge is visible.
  scene.fog = new Fog(0x111417, 24, 48);
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
    addBox(0.09, 0.012, 90, 0x747f83, side * 5.7, -0.05, 11);
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

  scene.add(new AmbientLight(0xb8cad1, 1.05));
  const key = new DirectionalLight(0xfff2e3, 3.8);
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
  const fill = new DirectionalLight(0x9dc6e2, 1.7);
  fill.position.set(5, 5, 12);
  scene.add(fill);
  const rim = new DirectionalLight(0xd7e7f0, 1.0);
  rim.position.set(7, 7, -8);
  scene.add(rim);

  const visuals = placements.map((placement, index) => {
    const visual = createCarVisual(index === 0 ? Number.parseInt(accent.slice(1), 16) : 0x101010);
    const state = createVehicleState();
    state.position.x = placement.x;
    state.position.z = placement.startZ;
    state.heading = placement.heading;
    visual.update(state);
    scene.add(visual.object);
    return { visual, state };
  });

  const unsubscribeAccent = onActiveAccentColorChange(color => {
    const nextColor = Number.parseInt(color.slice(1), 16);
    visuals[0]!.visual.setColor(nextColor);
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
    camera.position.set(-4.8 + drift, 2.6, -4.8 - (1 - arrival) * 1.6);
    camera.lookAt(1.0 + drift * 0.2, 0.55, 3.8);
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
    camera.fov = width < 700 ? 50 : 39;
    const shift = width < 700 ? 0 : width < 1000 ? 0.1 : 0.18;
    camera.setViewOffset(width, height, -width * shift, 0, width, height);
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
