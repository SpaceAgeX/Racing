import type { Vector3Data } from './collision.ts';

export interface FinishLine {
  center: Vector3Data;
  width: number;
}

export interface LapTimerState {
  running: boolean;
  elapsed: number;
  best: number | null;
  last: number | null;
  /** Completed lap minus the best that existed before it finished. */
  delta: number | null;
  completedLaps: number;
}

export function createLapTimer(): LapTimerState {
  return { running: false, elapsed: 0, best: null, last: null, delta: null, completedLaps: 0 };
}

/** Reset an attempt after respawning, retaining this session's completed results. */
export function resetCurrentLap(timer: LapTimerState): void {
  timer.running = false;
  timer.elapsed = 0;
}

/** Finite line crossing in either direction, using the car origin's swept movement. */
function crossingFraction(from: Readonly<Vector3Data>, to: Readonly<Vector3Data>, line: Readonly<FinishLine>): number | null {
  const before = from.z - line.center.z;
  const after = to.z - line.center.z;
  if (!((before > 0 && after <= 0) || (before < 0 && after >= 0))) return null;
  const fraction = before / (before - after);
  const x = from.x + (to.x - from.x) * fraction;
  const y = from.y + (to.y - from.y) * fraction;
  if (Math.abs(x - line.center.x) > line.width / 2 || Math.abs(y - line.center.y) > 0.25) return null;
  return fraction;
}

/** Plain-data timing only: no route, checkpoint, or travel-direction validation. */
export function stepLapTimer(
  timer: LapTimerState,
  from: Readonly<Vector3Data>,
  to: Readonly<Vector3Data>,
  timestep: number,
  line: Readonly<FinishLine> | null,
): void {
  if (!Number.isFinite(timestep) || timestep <= 0) return;
  if (timer.running) timer.elapsed += timestep;
  if (!line) return;
  const fraction = crossingFraction(from, to, line);
  if (fraction === null) return;

  const remainder = timestep * (1 - fraction);
  if (!timer.running) {
    timer.running = true;
  } else {
    const completed = Math.max(0, timer.elapsed - remainder);
    timer.last = completed;
    timer.delta = timer.best === null ? null : completed - timer.best;
    timer.best = timer.best === null ? completed : Math.min(timer.best, completed);
    timer.completedLaps++;
  }
  timer.elapsed = remainder;
}
