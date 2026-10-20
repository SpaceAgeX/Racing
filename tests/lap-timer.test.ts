import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLapTimer, resetCurrentLap, stepLapTimer } from '../src/simulation/lap-timer.ts';
import { FixedStepClock } from '../src/simulation/fixed-step.ts';
import { getFinishLine, getTrackSpawn } from '../src/track/grid.ts';
import { formatLapTime } from '../src/ui/lap-display.ts';

const line = { center: { x: 0, y: 0, z: 0 }, width: 12 };
const before = { x: 0, y: 0, z: 1 };
const after = { x: 0, y: 0, z: -1 };

test('first crossing starts timing at the crossing fraction, and the next crossing records a lap', () => {
  const timer = createLapTimer();
  stepLapTimer(timer, before, before, 2, line);
  assert.equal(timer.elapsed, 0);
  stepLapTimer(timer, before, after, 0.1, line);
  assert.equal(timer.running, true);
  assert.equal(timer.elapsed, 0.05);
  assert.equal(timer.completedLaps, 0);
  stepLapTimer(timer, after, after, 5, line);
  stepLapTimer(timer, after, before, 0.1, line);
  assert.ok(Math.abs(timer.last! - 5.1) < 1e-10);
  assert.equal(timer.best, timer.last);
  assert.equal(timer.delta, null);
  assert.equal(timer.completedLaps, 1);
  assert.equal(timer.elapsed, 0.05);
});

test('both crossing directions count without route or checkpoint validation', () => {
  const timer = createLapTimer();
  stepLapTimer(timer, after, before, 1, line);
  stepLapTimer(timer, before, after, 1, line);
  stepLapTimer(timer, after, before, 1, line);
  assert.equal(timer.completedLaps, 2);
  assert.equal(timer.last, 1);
  assert.equal(timer.best, 1);
});

test('staying on the line or leaving its exact crossing endpoint does not trigger duplicate laps', () => {
  const timer = createLapTimer();
  const onLine = { x: 0, y: 0, z: 0 };
  stepLapTimer(timer, before, onLine, 1, line);
  for (let tick = 0; tick < 5; tick++) stepLapTimer(timer, onLine, onLine, 1, line);
  stepLapTimer(timer, onLine, after, 1, line);
  assert.equal(timer.running, true);
  assert.equal(timer.completedLaps, 0);
});

test('crossing outside the line width or below the track does not touch the finish trigger', () => {
  for (const offset of [{ x: 10, y: 0 }, { x: 0, y: -2 }]) {
    const timer = createLapTimer();
    stepLapTimer(timer, { ...before, ...offset }, { ...after, ...offset }, 1, line);
    assert.equal(timer.running, false);
  }
  const timer = createLapTimer();
  stepLapTimer(timer, before, after, 1, null);
  assert.equal(timer.running, false);
});

test('best and delta use the previous best, including faster and slower completed laps', () => {
  const timer = createLapTimer();
  timer.running = true;
  timer.elapsed = 10;
  stepLapTimer(timer, before, { ...after, z: 0 }, 1, line);
  assert.equal(timer.best, 11);
  timer.elapsed = 8;
  stepLapTimer(timer, before, { ...after, z: 0 }, 1, line);
  assert.equal(timer.last, 9);
  assert.equal(timer.best, 9);
  assert.equal(timer.delta, -2);
  timer.elapsed = 12;
  stepLapTimer(timer, before, { ...after, z: 0 }, 1, line);
  assert.equal(timer.last, 13);
  assert.equal(timer.best, 9);
  assert.equal(timer.delta, 4);
});

test('respawn resets the current attempt while retaining session results', () => {
  const timer = createLapTimer();
  Object.assign(timer, { running: true, elapsed: 4, best: 10, last: 12, delta: 2, completedLaps: 3, checkpointCount: 0, checkpointsVisited: [], missedCheckpoints: false });
  resetCurrentLap(timer);
  assert.deepEqual(timer, { running: false, elapsed: 0, best: 10, last: 12, delta: 2, completedLaps: 3, checkpointCount: 0, checkpointsVisited: [], missedCheckpoints: false });
  stepLapTimer(timer, before, after, 1, line);
  assert.equal(timer.completedLaps, 3);
  assert.equal(timer.running, true);
});

test('finish line selection follows the same first start tile as spawning', () => {
  const layout = [[0, 1, 0], [0, 2, 2]] as const;
  const finish = getFinishLine(layout, 12)!;
  const spawn = getTrackSpawn(layout, 12);
  assert.equal(finish.center.x, spawn.position.x);
  assert.equal(finish.center.z + 3, spawn.position.z);
  assert.equal(getFinishLine([[1]], 12), null);
});

test('timing is identical at different rendering rates, and a long pause adds no time', () => {
  const results = [30, 60, 144].map((fps) => {
    const clock = new FixedStepClock();
    const timer = createLapTimer();
    let time = 0;
    let previous = before;
    for (let frame = 0; frame < fps * 4; frame++) {
      clock.advance(1 / fps, (dt) => {
        time += dt;
        const current = { x: 0, y: 0, z: Math.cos(time * Math.PI) };
        stepLapTimer(timer, previous, current, dt, line);
        previous = current;
      });
    }
    const snapshot = structuredClone(timer);
    clock.advance(30, (dt) => stepLapTimer(timer, before, before, dt, line));
    assert.deepEqual(timer, snapshot);
    return timer;
  });
  for (const result of results) assert.deepEqual(result, results[0]);
});

test('time formatting handles hundredths and minute boundaries', () => {
  assert.equal(formatLapTime(null), '--:--.--');
  assert.equal(formatLapTime(0), '00:00.00');
  assert.equal(formatLapTime(59.99), '00:59.99');
  assert.equal(formatLapTime(60), '01:00.00');
  assert.equal(formatLapTime(72.345), '01:12.34');
});
