import { AmbientLight, CanvasTexture, Color, DirectionalLight, Mesh, MeshBasicMaterial, PerspectiveCamera, PlaneGeometry, Scene, WebGLRenderer } from 'three';
import { createCarVisual } from './car.ts';
import { createVehicleState } from '../simulation/vehicle.ts';

/** One lightweight car view for the time-trial selector; never creates a driving world. */
export function createCarShowroom(canvas: HTMLCanvasElement, color: string) {
  let renderer: WebGLRenderer;
  try { renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'low-power' }); }
  catch { return { setColor(_color: string) {}, setActive(_active: boolean) {}, dispose() {} }; }
  const scene = new Scene();
  scene.background = new Color(0x111417);
  const camera = new PerspectiveCamera(34, 1, .1, 40);
  scene.add(new AmbientLight(0xdcebf2, 1.1));
  const light = new DirectionalLight(0xfff1e9, 3.5);
  light.position.set(-4, 7, 3);
  scene.add(light);
  const rim = new DirectionalLight(0x9bc8ff, 1.8);
  rim.position.set(4, 4, -5);
  scene.add(rim);
  const shadowCanvas = document.createElement('canvas');
  shadowCanvas.width = shadowCanvas.height = 128;
  const shadowContext = shadowCanvas.getContext('2d');
  let shadowTexture: CanvasTexture | null = null;
  let shadow: Mesh<PlaneGeometry, MeshBasicMaterial> | null = null;
  if (shadowContext) {
    const gradient = shadowContext.createRadialGradient(64, 64, 8, 64, 64, 64);
    gradient.addColorStop(0, '#0009'); gradient.addColorStop(1, '#0000');
    shadowContext.fillStyle = gradient; shadowContext.fillRect(0, 0, 128, 128);
    shadowTexture = new CanvasTexture(shadowCanvas);
    shadow = new Mesh(new PlaneGeometry(4.3, 3), new MeshBasicMaterial({ map: shadowTexture, transparent: true, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = .012;
    scene.add(shadow);
  }
  const car = createCarVisual(Number.parseInt(color.slice(1), 16));
  car.update(createVehicleState());
  scene.add(car.object);
  let disposed = false;
  let active = true;
  let frame = 0;
  let lastDraw = 0;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let angleOffset = 0;
  let pointerX: number | null = null;
  function draw(now: number): void {
    if (disposed || !active) return;
    const angle = 2.45 + angleOffset + (reducedMotion.matches || pointerX !== null ? 0 : Math.sin(now * .00022) * .18);
    camera.position.set(Math.sin(angle) * 4.45, 2.2, Math.cos(angle) * 4.45);
    camera.lookAt(0, .55, 0);
    renderer.render(scene, camera);
  }
  function animate(now: number): void {
    frame = requestAnimationFrame(animate);
    if (!active || now - lastDraw < 1000 / 30 || document.hidden) return;
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
  function pointerDown(event: PointerEvent): void { pointerX = event.clientX; canvas.setPointerCapture(event.pointerId); }
  function pointerMove(event: PointerEvent): void {
    if (pointerX === null) return;
    angleOffset += (event.clientX - pointerX) * .008;
    pointerX = event.clientX;
    draw(performance.now());
  }
  function pointerUp(): void { pointerX = null; }
  canvas.addEventListener('pointerdown', pointerDown);
  canvas.addEventListener('pointermove', pointerMove);
  canvas.addEventListener('pointerup', pointerUp);
  canvas.addEventListener('pointercancel', pointerUp);
  resize();
  frame = requestAnimationFrame(animate);
  void car.ready.then(() => draw(performance.now()));
  return {
    setColor(next: string): void { car.setColor(Number.parseInt(next.slice(1), 16)); draw(performance.now()); },
    setActive(next: boolean): void { active = next; if (next) resize(); },
    dispose(): void {
      disposed = true; cancelAnimationFrame(frame); observer.disconnect();
      canvas.removeEventListener('pointerdown', pointerDown); canvas.removeEventListener('pointermove', pointerMove);
      canvas.removeEventListener('pointerup', pointerUp); canvas.removeEventListener('pointercancel', pointerUp);
      car.dispose(); shadow?.geometry.dispose(); shadow?.material.dispose(); shadowTexture?.dispose(); renderer.dispose();
    },
  };
}
