import { AmbientLight, Color, DirectionalLight, Group, LineBasicMaterial, LineSegments, Mesh, MeshStandardMaterial, OrthographicCamera, PlaneGeometry, Scene, Vector3, BufferGeometry, Float32BufferAttribute, WebGLRenderer } from 'three';
import { createCarVisual } from './car.ts';
import { createVehicleState } from '../simulation/vehicle.ts';
import { SPLINE_START_GRID_CAR_LENGTH, SPLINE_START_GRID_CAR_WIDTH, SPLINE_START_GRID_COLUMNS, SPLINE_START_GRID_ROW_GAP } from '../track/spline.ts';
import type { LobbyPlayerSnapshot } from '../multiplayer/protocol.ts';

const rowPitch = SPLINE_START_GRID_CAR_LENGTH + SPLINE_START_GRID_ROW_GAP;
const firstDistance = SPLINE_START_GRID_CAR_LENGTH / 2 + 2;
const lateral = SPLINE_START_GRID_CAR_WIDTH / 2 + .6;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

/** Matches the two-column row order and distances used by the race spawn grid. */
export function lobbyGridSlot(index: number): { x: number; z: number } {
  const row = Math.floor(index / SPLINE_START_GRID_COLUMNS);
  const column = index % SPLINE_START_GRID_COLUMNS;
  return { x: firstDistance + row * rowPitch + column * .7, z: column === 0 ? -lateral : lateral };
}

interface GridCar {
  visual: ReturnType<typeof createCarVisual>;
  state: ReturnType<typeof createVehicleState>;
  label: HTMLElement;
  x: number;
  targetX: number;
  z: number;
  startX: number;
  startedAt: number;
  duration: number;
  leaving: boolean;
  color: string;
}

export function createLobbyGrid(canvas: HTMLCanvasElement, labels: HTMLElement) {
  let renderer: WebGLRenderer;
  try { renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'low-power' }); }
  catch { return { setPlayers(_players: LobbyPlayerSnapshot[], _localId: string) {}, setActive(_active: boolean) {}, dispose() {} }; }
  const scene = new Scene();
  scene.background = new Color(0x111417);
  const camera = new OrthographicCamera(-18, 18, 9, -9, .1, 100);
  const asphalt = new MeshStandardMaterial({ color: 0x20282c, roughness: 1 });
  const paint = new MeshStandardMaterial({ color: 0x76848a, roughness: 1 });
  const checkerLight = new MeshStandardMaterial({ color: 0xb9c4c7, roughness: 1 });
  const checkerDark = new MeshStandardMaterial({ color: 0x252b2e, roughness: 1 });
  const geometry: PlaneGeometry[] = [];
  const track = new Group(); scene.add(track);
  function plane(width: number, depth: number, x: number, z: number, material: MeshStandardMaterial, y = .005): void {
    const shape = new PlaneGeometry(width, depth); geometry.push(shape);
    const mesh = new Mesh(shape, material); mesh.rotation.x = -Math.PI / 2; mesh.position.set(x, y, z); track.add(mesh);
  }
  plane(90, 12, 21, 0, asphalt);
  for (const z of [-5.65, 5.65]) plane(90, .13, 21, z, paint, .018);
  // Two alternating check rows make the finish line readable from the broadcast camera.
  for (let row = 0; row < 12; row++) for (let column = 0; column < 2; column++)
    plane(.52, .95, column * .52 - .26, -5.225 + row * .95,
      (row + column) % 2 ? checkerLight : checkerDark, .025);
  const slotLines: number[] = [];
  for (let index = 0; index < 10; index++) {
    const slot = lobbyGridSlot(index);
    const x0 = slot.x - 2.1, x1 = slot.x + 2.1, z0 = slot.z - 1.22, z1 = slot.z + 1.22;
    for (const [ax, az, bx, bz] of [[x0,z0,x0+.6,z0], [x0,z0,x0,z0+.6], [x1,z0,x1-.6,z0], [x1,z0,x1,z0+.6],
      [x0,z1,x0+.6,z1], [x0,z1,x0,z1-.6], [x1,z1,x1-.6,z1], [x1,z1,x1,z1-.6]])
      slotLines.push(ax!, .035, az!, bx!, .035, bz!);
  }
  const lineGeometry = new BufferGeometry(); lineGeometry.setAttribute('position', new Float32BufferAttribute(slotLines, 3));
  const lineMaterial = new LineBasicMaterial({ color: 0x819197, transparent: true, opacity: .38 });
  track.add(new LineSegments(lineGeometry, lineMaterial));
  scene.add(new AmbientLight(0xd0dfe5, 1.4));
  const light = new DirectionalLight(0xfff4e8, 3.2); light.position.set(-6, 13, 8); scene.add(light);
  const rim = new DirectionalLight(0x83b9d3, .9); rim.position.set(16, 6, -7); scene.add(rim);
  const cars = new Map<string, GridCar>();
  let active = false;
  let disposed = false;
  let frame = 0;
  let totalSlots = 10;
  let localPlayerId = '';
  const position = new Vector3();

  function resize(): void {
    if (disposed || !active) return;
    const width = Math.max(1, canvas.clientWidth), height = Math.max(1, canvas.clientHeight);
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
    renderer.setSize(width, height, false);
    const farthest = lobbyGridSlot(Math.max(0, totalSlots - 1)).x;
    const worldWidth = Math.max(29, farthest + 7);
    const visibleWidth = Math.max(worldWidth, 17 * width / height);
    const visibleHeight = visibleWidth * height / width;
    camera.left = -visibleWidth / 2; camera.right = visibleWidth / 2;
    camera.top = visibleHeight / 2; camera.bottom = -visibleHeight / 2;
    camera.position.set((farthest + 1) / 2, 27, 12);
    camera.lookAt((farthest + 1) / 2, 0, 0);
    camera.updateProjectionMatrix();
    draw(performance.now());
  }
  const observer = new ResizeObserver(resize); observer.observe(canvas);

  function animateCar(car: GridCar, now: number): void {
    const progress = car.duration ? Math.min(1, (now - car.startedAt) / car.duration) : 1;
    const eased = car.leaving ? progress * progress : 1 - (1 - progress) ** 3;
    car.x = car.startX + (car.targetX - car.startX) * eased;
    car.state.position.x = car.x; car.state.position.y = 0; car.state.position.z = car.z;
    car.visual.update(car.state);
    if (car.leaving && progress >= 1) {
      scene.remove(car.visual.object); car.visual.dispose(); car.label.remove();
      for (const [id, entry] of cars) if (entry === car) cars.delete(id);
      return;
    }
    position.set(car.x, 1.5, car.z).project(camera);
    car.label.style.left = `${(position.x + 1) * 50}%`;
    car.label.style.top = `${(1 - position.y) * 50}%`;
    car.label.hidden = car.leaving || (progress < .7 && car.duration > 0);
  }
  function draw(now: number): void {
    if (!active || disposed) return;
    for (const car of cars.values()) animateCar(car, now);
    renderer.render(scene, camera);
  }
  function loop(now: number): void {
    if (!active || disposed) return;
    frame = requestAnimationFrame(loop);
    if (!document.hidden) draw(now);
  }
  return {
    setPlayers(players: LobbyPlayerSnapshot[], localId: string): void {
      localPlayerId = localId;
      totalSlots = Math.max(10, players.length);
      if (!active && players.length === 0) {
        for (const car of cars.values()) { scene.remove(car.visual.object); car.visual.dispose(); car.label.remove(); }
        cars.clear(); return;
      }
      const now = performance.now();
      const present = new Set(players.map(player => player.id));
      for (const [id, car] of cars) if (!present.has(id) && !car.leaving) {
        car.leaving = true; car.startX = car.x; car.targetX = lobbyGridSlot(9).x + 14;
        car.startedAt = now; car.duration = reducedMotion.matches ? 0 : 580; car.label.hidden = true;
      }
      players.forEach((player) => {
        const slot = lobbyGridSlot(player.gridIndex);
        let car = cars.get(player.id);
        if (!car) {
          const visual = createCarVisual(Number.parseInt(player.color.slice(1), 16));
          const label = document.createElement('span'); label.className = 'lobby-grid-label';
          labels.append(label); scene.add(visual.object);
          const entrance = active && cars.size > 0 && !reducedMotion.matches;
          const state = createVehicleState(); state.heading = Math.PI / 2;
          car = { visual, state, label, x: entrance ? lobbyGridSlot(9).x + 14 : slot.x, targetX: slot.x,
            z: slot.z, startX: entrance ? lobbyGridSlot(9).x + 14 : slot.x,
            startedAt: now, duration: entrance ? 1250 : 0, leaving: false, color: player.color };
          cars.set(player.id, car);
          void visual.ready.then(() => draw(performance.now()));
        } else {
          if (car.leaving) car.leaving = false;
          if (car.targetX !== slot.x || car.z !== slot.z) {
            car.startX = car.x; car.targetX = slot.x; car.z = slot.z;
            car.startedAt = now; car.duration = reducedMotion.matches ? 0 : 480;
          }
          if (car.color !== player.color) {
            car.color = player.color;
            car.visual.setColor(Number.parseInt(player.color.slice(1), 16));
          }
        }
        car.label.textContent = player.id === localPlayerId ? `${player.name} · YOU` : player.name;
        car.label.classList.toggle('is-you', player.id === localPlayerId);
      });
      resize();
    },
    setActive(value: boolean): void {
      if (active === value || disposed) return;
      active = value;
      if (active) { resize(); frame = requestAnimationFrame(loop); }
      else cancelAnimationFrame(frame);
    },
    dispose(): void {
      disposed = true; cancelAnimationFrame(frame); observer.disconnect();
      for (const car of cars.values()) { car.visual.dispose(); car.label.remove(); }
      cars.clear(); geometry.forEach(item => item.dispose()); asphalt.dispose(); paint.dispose();
      checkerLight.dispose(); checkerDark.dispose(); lineGeometry.dispose(); lineMaterial.dispose(); renderer.dispose();
    },
  };
}
