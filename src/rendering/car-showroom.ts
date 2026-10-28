import { AmbientLight, Color, DirectionalLight, PerspectiveCamera, Scene, WebGLRenderer } from 'three';
import { createCarVisual } from './car.ts';
import { createVehicleState } from '../simulation/vehicle.ts';

/** One lightweight car view for the time-trial selector; never creates a driving world. */
export function createCarShowroom(canvas: HTMLCanvasElement, color: string) {
  let renderer: WebGLRenderer;
  try { renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'low-power' }); }
  catch { return { setColor(_color: string) {}, dispose() {} }; }
  const scene = new Scene();
  scene.background = new Color(0x111417);
  const camera = new PerspectiveCamera(34, 1, .1, 40);
  scene.add(new AmbientLight(0xdcebf2, 1.5));
  const light = new DirectionalLight(0xfff1e9, 3.5);
  light.position.set(-4, 7, 3);
  scene.add(light);
  const car = createCarVisual(Number.parseInt(color.slice(1), 16));
  car.update(createVehicleState());
  scene.add(car.object);
  let disposed = false;
  let frame = 0;
  let lastDraw = 0;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  function draw(now: number): void {
    if (disposed) return;
    camera.position.set(3.1 + (reducedMotion.matches ? 0 : Math.sin(now * .0003) * .25), 2.2, -4.3);
    camera.lookAt(0, .55, 0);
    renderer.render(scene, camera);
  }
  function animate(now: number): void {
    frame = requestAnimationFrame(animate);
    if (now - lastDraw < 1000 / 30 || document.hidden) return;
    lastDraw = now;
    draw(now);
  }
  function resize(): void {
    if (disposed) return;
    const width = Math.max(1, canvas.clientWidth), height = Math.max(1, canvas.clientHeight);
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    draw(performance.now());
  }
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();
  frame = requestAnimationFrame(animate);
  void car.ready.then(() => draw(performance.now()));
  return {
    setColor(next: string): void { car.setColor(Number.parseInt(next.slice(1), 16)); draw(performance.now()); },
    dispose(): void { disposed = true; cancelAnimationFrame(frame); observer.disconnect(); car.dispose(); renderer.dispose(); },
  };
}
