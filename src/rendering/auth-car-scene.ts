import {
  AmbientLight, CircleGeometry, Color, DirectionalLight, Mesh, MeshBasicMaterial,
  MeshStandardMaterial, PerspectiveCamera, PlaneGeometry, Scene, WebGLRenderer,
} from 'three';
import { createCarVisual } from './car.ts';
import { createVehicleState } from '../simulation/vehicle.ts';

/** A lightweight, reusable studio view of the same car used in races. */
export function createAuthCarScene(canvas: HTMLCanvasElement) {
  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'low-power' });
  } catch {
    // Branding and authentication remain usable on browsers without WebGL.
    return { dispose() {} };
  }

  const scene = new Scene();
  scene.background = new Color(0x10212a);
  const camera = new PerspectiveCamera(38, 1, 0.1, 60);
  const floor = new Mesh(new PlaneGeometry(80, 80), new MeshStandardMaterial({ color: 0x0b1921, roughness: 1 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.08;
  scene.add(floor);
  const platform = new Mesh(new CircleGeometry(3.1, 64), new MeshStandardMaterial({ color: 0x1b313a, roughness: 0.92 }));
  platform.rotation.x = -Math.PI / 2;
  platform.position.y = -0.065;
  scene.add(platform);
  const shadow = new Mesh(new CircleGeometry(2.25, 48), new MeshBasicMaterial({ color: 0x071014, transparent: true, opacity: 0.42, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = -0.055;
  scene.add(shadow);

  scene.add(new AmbientLight(0xdcebf2, 2.2));
  const key = new DirectionalLight(0xfff1df, 3);
  key.position.set(-4, 8, -5);
  scene.add(key);
  const fill = new DirectionalLight(0x83b7d3, 1.25);
  fill.position.set(6, 4, 4);
  scene.add(fill);
  const accent = new DirectionalLight(0xf4773e, 1.5);
  accent.position.set(2, 3, 6);
  scene.add(accent);

  const car = createCarVisual(0xf4773e);
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
      (floor.material as MeshStandardMaterial).dispose();
      platform.geometry.dispose();
      (platform.material as MeshStandardMaterial).dispose();
      shadow.geometry.dispose();
      (shadow.material as MeshBasicMaterial).dispose();
      renderer.dispose();
    },
  };
}
