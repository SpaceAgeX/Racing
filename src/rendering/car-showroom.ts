import { AmbientLight, Color, DirectionalLight, Fog, Mesh, MeshStandardMaterial, PCFSoftShadowMap, PerspectiveCamera, PlaneGeometry, Scene, WebGLRenderer } from 'three';
import { createCarVisual } from './car.ts';
import { createVehicleState } from '../simulation/vehicle.ts';

/** One lightweight car view for the time-trial selector; never creates a driving world. */
export function createCarShowroom(canvas: HTMLCanvasElement, color: string) {
  let renderer: WebGLRenderer;
  try { renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'low-power' }); }
  catch { return { setColor(_color: string) {}, setActive(_active: boolean) {}, dispose() {} }; }
  const scene = new Scene();
  scene.background = new Color(0x111417);
  scene.fog = new Fog(0x111417, 8, 24);
  const camera = new PerspectiveCamera(34, 1, .1, 40);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;
  scene.add(new AmbientLight(0xdcebf2, 1.1));
  const light = new DirectionalLight(0xfff1e9, 3.5);
  light.position.set(-6, 6, 4);
  light.castShadow = true;
  light.shadow.mapSize.set(1024, 1024);
  light.shadow.camera.left = light.shadow.camera.bottom = -7;
  light.shadow.camera.right = light.shadow.camera.top = 7;
  light.shadow.camera.near = .5;
  light.shadow.camera.far = 20;
  light.shadow.bias = -.0002;
  scene.add(light);
  const rim = new DirectionalLight(0x9bc8ff, 1.8);
  rim.position.set(4, 4, -5);
  scene.add(rim);
  const ground = new Mesh(new PlaneGeometry(80, 80), new MeshStandardMaterial({ color: 0x15191c, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -.03;
  ground.receiveShadow = true;
  scene.add(ground);
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
    camera.lookAt(0, .08, 0);
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
      car.dispose(); ground.geometry.dispose(); ground.material.dispose(); renderer.dispose();
    },
  };
}
