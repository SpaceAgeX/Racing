import { PerspectiveCamera, Scene, WebGLRenderer } from 'three';
import { createCarVisual } from './car.ts';
import { createVehicleState } from '../simulation/vehicle.ts';
import { getActiveAccentColor, onActiveAccentColorChange } from '../ui/accent.ts';
import { addStagingAtmosphere, addStagingRoad } from './staging-scene.ts';

// Local car forward is -Z. The finish stripe is at Z = 0.
const finishSeconds = 2.5;
const placement = { x: -0.8, startZ: 18, finishZ: 3.1, heading: -0.02 } as const;

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
  // The shared atmosphere fades the road into the same near-black backdrop.
  const key = addStagingAtmosphere(scene);
  const camera = new PerspectiveCamera(42, 1, 0.1, 100);
  const road = addStagingRoad(scene, { length: 90, center: 11 });

  const visual = createCarVisual(Number.parseInt(accent.slice(1), 16));
  const state = createVehicleState();
  state.position.x = placement.x;
  state.position.z = placement.startZ;
  state.heading = placement.heading;
  visual.update(state);
  scene.add(visual.object);

  const unsubscribeAccent = onActiveAccentColorChange(color => {
    visual.setColor(Number.parseInt(color.slice(1), 16));
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
    state.position.z = placement.startZ + (placement.finishZ - placement.startZ) * eased;
    visual.update(state);
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
  void visual.ready.then(() => { if (active && !disposed) render(); });

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
      visual.dispose();
      road.dispose();
      key.shadow.dispose();
      renderer.dispose();
      canvas.remove();
    },
  };
}
