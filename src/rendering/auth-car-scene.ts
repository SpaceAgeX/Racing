import {
  AmbientLight, Color, DirectionalLight, Fog, Mesh, PerspectiveCamera,
  PlaneGeometry, Scene, ShadowMaterial, WebGLRenderer,
} from 'three';
import { createCarVisual } from './car.ts';
import { createVehicleState } from '../simulation/vehicle.ts';
import { carColorNames } from '../ui/car-colors.ts';

const lastColorKey = 'auth-scene-last-car-color';

function chooseCarColor(): number {
  const colors = [...carColorNames.keys()];
  let previous: string | null = null;
  try { previous = sessionStorage.getItem(lastColorKey); } catch { /* Storage may be unavailable. */ }
  const choices = colors.filter((color) => color !== previous);
  const selected = choices[Math.floor(Math.random() * choices.length)]!;
  try { sessionStorage.setItem(lastColorKey, selected); } catch { /* The color still works without storage. */ }
  return Number.parseInt(selected.slice(1), 16);
}

/** A lightweight, reusable studio view of the same car used in races. */
export function createAuthCarScene(canvas: HTMLCanvasElement) {
  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'low-power' });
  } catch {
    // Branding and authentication remain usable on browsers without WebGL.
    return { dispose() {} };
  }

  renderer.shadowMap.enabled = true;
  const scene = new Scene();
  scene.background = new Color(0x111417);
  scene.fog = new Fog(0x111417, 16, 42);
  const camera = new PerspectiveCamera(38, 1, 0.1, 60);
  const floor = new Mesh(new PlaneGeometry(100, 100), new ShadowMaterial({ color: 0x000000, opacity: 0.8 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.08;
  floor.receiveShadow = true;
  scene.add(floor);

  scene.add(new AmbientLight(0xdcebf2, 0.28));
  const key = new DirectionalLight(0xfff1e9, 5);
  key.position.set(-3, 8, -2);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -6;
  key.shadow.camera.right = 6;
  key.shadow.camera.top = 6;
  key.shadow.camera.bottom = -6;
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 25;
  key.shadow.normalBias = 0.025;
  key.shadow.radius = 2;
  key.target.position.set(0, 0.4, 0);
  scene.add(key.target);
  scene.add(key);

  const car = createCarVisual(chooseCarColor());
  car.update(createVehicleState());
  scene.add(car.object);

  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let frame = 0;
  let disposed = false;
  let startTime = performance.now();
  let lastPaint = 0;

  function draw(time: number): void {
    if (disposed) return;
    const seconds = (time - startTime) / 1000;
    const arrival = motion.matches ? 1 : 1 - Math.exp(-seconds * 2.2);
    const orbit = motion.matches ? 0 : Math.sin(seconds * 0.25) * 0.25;
    camera.position.set(4.2 + orbit, 2.9, -5.9 - (1 - arrival) * 1.2);
    camera.lookAt(0, 0.58, 0);
    renderer.render(scene, camera);
  }

  function animate(time: number): void {
    frame = requestAnimationFrame(animate);
    if (time - lastPaint < 1000 / 30) return;
    lastPaint = time;
    draw(time);
  }

  function schedule(): void {
    cancelAnimationFrame(frame);
    frame = 0;
    if (disposed || document.hidden) return;
    if (motion.matches) draw(performance.now());
    else { startTime = performance.now(); frame = requestAnimationFrame(animate); }
  }

  function resize(): void {
    if (disposed) return;
    const width = Math.max(1, canvas.clientWidth);
    const height = Math.max(1, canvas.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, width < 600 ? 1 : 1.5));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    draw(performance.now());
  }

  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  window.addEventListener('resize', resize);
  document.addEventListener('visibilitychange', schedule);
  motion.addEventListener('change', schedule);
  resize();
  schedule();
  void car.ready.then(() => { if (!disposed && !document.hidden) draw(performance.now()); });

  return {
    dispose(): void {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', schedule);
      motion.removeEventListener('change', schedule);
      car.dispose();
      floor.geometry.dispose();
      (floor.material as ShadowMaterial).dispose();
      key.shadow.dispose();
      renderer.dispose();
    },
  };
}
