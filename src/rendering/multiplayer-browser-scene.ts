import { PerspectiveCamera, Scene, Vector3, WebGLRenderer } from 'three';
import { createCarVisual } from './car.ts';
import { createVehicleState } from '../simulation/vehicle.ts';
import { addStagingAtmosphere, addStagingRoad } from './staging-scene.ts';
import { browserCarFootprint, generateBrowserWave } from './browser-waves.ts';

const frameIntervalMs = 1000 / 30;
const modelClearanceHeight = 1.4;

type CarVisual = ReturnType<typeof createCarVisual>;
interface AnimatedCar {
  visual: CarVisual;
  state: ReturnType<typeof createVehicleState>;
  speed: number;
}

/** Decorative racing traffic, independent of multiplayer network state. */
export function createMultiplayerBrowserScene(canvas: HTMLCanvasElement) {
  let renderer: WebGLRenderer;
  try { renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'low-power' }); }
  catch { return { dispose(): void {} }; }

  renderer.shadowMap.enabled = true;
  const scene = new Scene();
  const key = addStagingAtmosphere(scene, false, false);
  key.position.set(-12, 28, 18);
  key.target.position.set(0, 0, -30);
  key.shadow.camera.left = -80;
  key.shadow.camera.right = 80;
  key.shadow.camera.top = 80;
  key.shadow.camera.bottom = -80;
  key.shadow.camera.far = 180;
  key.shadow.camera.updateProjectionMatrix();
  const road = addStagingRoad(scene, { length: 450, center: -70, width: 12, physical: true });
  const camera = new PerspectiveCamera(44, 1, .1, 500);
  camera.position.set(-4, 25, 29);
  camera.lookAt(0, 0, -4);
  camera.updateMatrixWorld();
  const projectedCorner = new Vector3();

  // Test the full conservative model footprint, including its wheels and wings.
  // This makes entrance and exit safe even when the canvas changes size.
  function fullyOutside(x: number, z: number, above: boolean): boolean {
    for (const side of [-1, 1]) for (const end of [-1, 1]) for (const height of [0, modelClearanceHeight]) {
      projectedCorner.set(
        x + side * browserCarFootprint.width / 2,
        height,
        z + end * browserCarFootprint.length / 2,
      ).project(camera);
      if (above ? projectedCorner.y <= 1 : projectedCorner.y >= -1) return false;
    }
    return true;
  }

  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let activeCars: AnimatedCar[] = [];
  let pendingCars: AnimatedCar[] | null = null;
  let waitSeconds = .65;
  let disposed = false;
  let frame = 0;
  let lastFrame = 0;
  let lastPaint = 0;

  function draw(): void { if (!disposed && !document.hidden) renderer.render(scene, camera); }

  function removeCars(cars: AnimatedCar[]): void {
    for (const car of cars) { scene.remove(car.visual.object); car.visual.dispose(); }
  }

  function launchWave(): void {
    if (pendingCars || disposed) return;
    const plans = generateBrowserWave();
    let entryZ = 22;
    while (plans.some(plan => !fullyOutside(plan.x, entryZ + plan.offset, false))) entryZ += 1;
    pendingCars = plans.map(plan => {
      const state = createVehicleState();
      state.position.x = plan.x;
      state.position.z = entryZ + plan.offset;
      const visual = createCarVisual(Number.parseInt(plan.color.slice(1), 16));
      visual.update(state);
      return { visual, state, speed: plan.speed };
    });
    const loading = pendingCars;
    void Promise.all(loading.map(car => car.visual.ready)).then(() => {
      if (disposed || pendingCars !== loading) return;
      activeCars = loading;
      pendingCars = null;
      for (const car of activeCars) scene.add(car.visual.object);
      draw();
    });
  }

  function animate(now: number): void {
    if (disposed || document.hidden || motion.matches) return;
    frame = requestAnimationFrame(animate);
    if (lastFrame === 0) { lastFrame = now; return; }
    const deltaSeconds = Math.min((now - lastFrame) / 1000, .1);
    lastFrame = now;
    if (activeCars.length) {
      for (const car of activeCars) {
        car.state.position.z -= car.speed * deltaSeconds;
        car.visual.update(car.state);
      }
      if (activeCars.every(car => fullyOutside(car.state.position.x, car.state.position.z, true))) {
        removeCars(activeCars);
        activeCars = [];
        waitSeconds = 3 + Math.random() * 7;
        draw();
      } else if (now - lastPaint >= frameIntervalMs) {
        lastPaint = now;
        draw();
      }
    } else if (!pendingCars) {
      waitSeconds -= deltaSeconds;
      if (waitSeconds <= 0) launchWave();
    }
  }

  function schedule(): void {
    cancelAnimationFrame(frame);
    frame = 0;
    lastFrame = 0;
    if (disposed || document.hidden) return;
    if (motion.matches) {
      removeCars(activeCars);
      activeCars = [];
      if (pendingCars) { removeCars(pendingCars); pendingCars = null; }
      waitSeconds = .65;
      draw();
    } else frame = requestAnimationFrame(animate);
  }

  function resize(): void {
    if (disposed) return;
    const width = Math.max(1, canvas.clientWidth), height = Math.max(1, canvas.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, width < 500 ? 1 : 1.4));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    draw();
  }

  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  document.addEventListener('visibilitychange', schedule);
  motion.addEventListener('change', schedule);
  resize();
  schedule();

  return { dispose(): void {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(frame);
    observer.disconnect();
    document.removeEventListener('visibilitychange', schedule);
    motion.removeEventListener('change', schedule);
    removeCars(activeCars);
    if (pendingCars) removeCars(pendingCars);
    activeCars = []; pendingCars = null;
    road.dispose();
    key.shadow.dispose();
    renderer.dispose();
  } };
}
