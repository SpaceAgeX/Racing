import { createKeyboardInput } from './input/keyboard.ts';
import { createCarVisual } from './rendering/car.ts';
import { createFollowCamera } from './rendering/camera.ts';
import { createScene } from './rendering/scene.ts';
import { FixedStepClock, PAUSE_THRESHOLD } from './simulation/fixed-step.ts';
import {
  copyVehicleState, createVehicleState, interpolateVehicleState,
} from './simulation/vehicle.ts';
import { respawnVehicle, stepVehicleInWorld } from './simulation/vehicle-world.ts';
import { createTrackCollisionWorld } from './track/collision.ts';
import { getFinishLine, getTrackSpawn } from './track/grid.ts';
import { trackLayout, trackTileSize } from './track/layout.ts';
import { createTuningPanel } from './ui/tuning.ts';
import { createLapTimer, resetCurrentLap, stepLapTimer } from './simulation/lap-timer.ts';
import { createLapDisplay } from './ui/lap-display.ts';
import { loadActiveTrack } from './track/storage.ts';
import { createMinimap } from './ui/minimap.ts';

export function startPrototype(canvas: HTMLCanvasElement) {
  const selectedTrack = loadActiveTrack(localStorage);
  const layout = selectedTrack?.layout ?? trackLayout;
  const trackName = selectedTrack?.name ?? 'Default circuit';
  document.querySelector('#active-track-name')!.textContent = trackName;
  const panel = document.querySelector<HTMLElement>('#tuning-panel');
  const toggle = document.querySelector<HTMLButtonElement>('#tuning-toggle');
  if (!panel || !toggle) throw new Error('Tuning panel is missing.');
  const tuningPanel = createTuningPanel(panel, toggle);
  const tuning = tuningPanel.parameters;
  const lapContainer = document.querySelector<HTMLElement>('#lap-display');
  if (!lapContainer) throw new Error('Lap display is missing.');
  const finishLine = getFinishLine(layout, trackTileSize);
  const lapTimer = createLapTimer();
  const lapDisplay = createLapDisplay(lapContainer, finishLine !== null);
  lapDisplay.update(lapTimer);
  const input = createKeyboardInput(window, document);
  const state = createVehicleState();
  const spawn = getTrackSpawn(layout, trackTileSize);
  respawnVehicle(state, spawn);
  const collisionWorld = createTrackCollisionWorld(layout, trackTileSize);
  const previous = createVehicleState();
  const rendered = createVehicleState();
  copyVehicleState(state, previous);
  copyVehicleState(state, rendered);
  const minimapCanvas = document.querySelector<HTMLCanvasElement>('#minimap');
  if (!minimapCanvas) throw new Error('Minimap canvas is missing.');
  const minimap = createMinimap(minimapCanvas, layout, trackTileSize);
  minimap.update(rendered);
  const clock = new FixedStepClock();
  const view = createScene(canvas, layout, trackTileSize);
  const car = createCarVisual();
  const followCamera = createFollowCamera(view.camera, state);
  view.scene.add(car.object);

  let lastFrameTime: number | null = null;
  let animationFrame = 0;

  function resetTiming(): void {
    lastFrameTime = null;
    clock.reset();
    copyVehicleState(state, previous);
  }

  function frame(): void {
    // Read actual callback time: a queued RAF timestamp can predate a long main-thread pause.
    const time = performance.now();
    animationFrame = requestAnimationFrame(frame);
    if (document.hidden) return;

    const elapsed = lastFrameTime === null ? 0 : (time - lastFrameTime) / 1000;
    lastFrameTime = time;
    if (elapsed > PAUSE_THRESHOLD) copyVehicleState(state, previous);
    const controls = input.sample();
    let respawned = false;
    const alpha = clock.advance(elapsed, (timestep) => {
      copyVehicleState(state, previous);
      if (stepVehicleInWorld(state, controls, timestep, collisionWorld, spawn, tuning.physics, tuning.driving)) {
        resetCurrentLap(lapTimer);
        copyVehicleState(state, previous);
        respawned = true;
      } else {
        stepLapTimer(lapTimer, previous.position, state.position, timestep, finishLine);
      }
    });

    interpolateVehicleState(previous, state, alpha, rendered);
    car.update(rendered);
    if (respawned) followCamera.reset(rendered);
    else followCamera.update(rendered, elapsed);
    view.followSun(rendered.position);
    view.renderer.render(view.scene, view.camera);
    tuningPanel.update(state);
    lapDisplay.update(lapTimer);
    minimap.update(rendered);
  }

  document.addEventListener('visibilitychange', resetTiming);
  window.addEventListener('blur', resetTiming);
  animationFrame = requestAnimationFrame(frame);

  return {
    state,
    view,
    car,
    tuning,
    lapTimer,
    layout,
    trackName,
    dispose(): void {
      cancelAnimationFrame(animationFrame);
      document.removeEventListener('visibilitychange', resetTiming);
      window.removeEventListener('blur', resetTiming);
      input.dispose();
      tuningPanel.dispose();
      minimap.dispose();
      car.dispose();
      view.dispose();
    },
  };
}
