import { OrthographicCamera, Scene, Vector3, WebGLRenderer } from 'three';
import { createCarVisual } from './car.ts';
import { createVehicleState } from '../simulation/vehicle.ts';
import { SPLINE_START_GRID_CAR_LENGTH, SPLINE_START_GRID_CAR_WIDTH, SPLINE_START_GRID_COLUMNS, SPLINE_START_GRID_ROW_GAP } from '../track/spline.ts';
import type { LobbyPlayerSnapshot } from '../multiplayer/protocol.ts';
import { countryFlagImageUrl } from '../ui/countries.ts';
import { addStagingAtmosphere, addStagingRoad } from './staging-scene.ts';

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
  labelKey: string;
  x: number;
  targetX: number;
  z: number;
  startX: number;
  startedAt: number;
  duration: number;
  leaving: boolean;
  color: string;
  upper: boolean;
}

export function createLobbyGrid(canvas: HTMLCanvasElement, labels: HTMLElement) {
  let renderer: WebGLRenderer;
  try { renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'low-power' }); }
  catch { return { setPlayers(_players: LobbyPlayerSnapshot[], _localId: string) {}, setActive(_active: boolean) {}, dispose() {} }; }
  renderer.shadowMap.enabled = true;
  const scene = new Scene();
  const key = addStagingAtmosphere(scene, true);
  const camera = new OrthographicCamera(-18, 18, 9, -9, .1, 100);
  const road = addStagingRoad(scene, { length: 140, center: 24, width: 16, horizontal: true });
  const cars = new Map<string, GridCar>();
  let active = false;
  let disposed = false;
  let frame = 0;
  let occupiedIndex = 0;
  let cameraCenter = 0, targetCenter = 0, cameraWidth = 0, targetWidth = 0;
  let lastDraw = 0;
  const position = new Vector3();

  function resize(): void {
    if (disposed || !active) return;
    const width = Math.max(1, canvas.clientWidth), height = Math.max(1, canvas.clientHeight);
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
    renderer.setSize(width, height, false);
    updateCameraTarget(!cameraWidth);
    draw(performance.now());
  }
  function updateCameraTarget(immediate = false): void {
    const farthest = lobbyGridSlot(occupiedIndex).x;
    const aspect = Math.max(1, canvas.clientWidth) / Math.max(1, canvas.clientHeight);
    // Reserve the left side for the HTML track overlay, even when all ten slots are occupied.
    const finishFraction = canvas.clientWidth < 850 ? .16 : Math.max(.26, .34 - occupiedIndex * .01);
    const right = farthest + 5;
    targetWidth = Math.max(right / (.93 - finishFraction), aspect * 7.1) * (1 + .15 * occupiedIndex / 9);
    // Keep the full checker stripe clear of the selected-track overlay.
    targetCenter = (.5 - finishFraction) * targetWidth - (canvas.clientWidth >= 900 ? 3 : 0);
    if (immediate || reducedMotion.matches) { cameraCenter = targetCenter; cameraWidth = targetWidth; }
  }
  function updateCamera(now: number): void {
    const dt = Math.min(64, Math.max(0, now - (lastDraw || now)));
    lastDraw = now;
    const factor = reducedMotion.matches ? 1 : 1 - Math.exp(-dt / 220);
    cameraCenter += (targetCenter - cameraCenter) * factor;
    cameraWidth += (targetWidth - cameraWidth) * factor;
    if (Math.abs(cameraCenter - targetCenter) < .001) cameraCenter = targetCenter;
    if (Math.abs(cameraWidth - targetWidth) < .001) cameraWidth = targetWidth;
    const height = cameraWidth * Math.max(1, canvas.clientHeight) / Math.max(1, canvas.clientWidth);
    camera.left = -cameraWidth / 2; camera.right = cameraWidth / 2;
    camera.top = height / 2; camera.bottom = -height / 2;
    // Keep the viewpoint high while centering the cars and checker in the
    // space beside the track preview.
    camera.position.set(cameraCenter - 7.5, 11, 24);
    camera.lookAt(cameraCenter + .5, 1.35, 0);
    camera.updateProjectionMatrix();
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
    position.set(car.x, .65, car.z).project(camera);
    car.label.style.left = `${(position.x + 1) * 50}%`;
    const offset = Math.max(24, Math.min(38, canvas.clientHeight * 1.05 / (cameraWidth * canvas.clientHeight / Math.max(1, canvas.clientWidth))));
    car.label.style.top = `${(1 - position.y) * 50 + (car.upper ? -offset : offset) * 100 / Math.max(1, canvas.clientHeight)}%`;
    car.label.hidden = car.leaving || (progress < .7 && car.duration > 0);
  }
  function draw(now: number): void {
    if (!active || disposed) return;
    updateCamera(now);
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
      occupiedIndex = Math.max(0, ...players.map(player => player.gridIndex));
      updateCameraTarget();
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
            startedAt: now, duration: entrance ? 1250 : 0, leaving: false, color: player.color,
            upper: player.gridIndex % 2 === 0, labelKey: '' };
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
        car.upper = player.gridIndex % 2 === 0;
        car.label.classList.toggle('is-upper', car.upper);
        car.label.classList.toggle('is-lower', !car.upper);
        car.label.classList.toggle('is-you', player.id === localId);
        const labelKey = `${player.name}|${player.countryCode}|${player.isHost}|${player.id === localId}`;
        if (car.labelKey !== labelKey) {
          car.labelKey = labelKey;
          const flag = document.createElement('img'); flag.src = countryFlagImageUrl(player.countryCode ?? 'US');
          flag.alt = ''; flag.width = 17; flag.height = 13;
          const name = document.createElement('span'); name.className = 'lobby-grid-name'; name.textContent = player.name;
          car.label.replaceChildren(flag, name);
          if (player.isHost) { const badge = document.createElement('small'); badge.textContent = 'HOST'; car.label.append(badge); }
          if (player.id === localId) { const badge = document.createElement('small'); badge.textContent = 'YOU'; badge.className = 'is-you'; car.label.append(badge); }
        }
      });
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
      cars.clear(); road.dispose(); key.shadow.dispose(); renderer.dispose();
    },
  };
}
