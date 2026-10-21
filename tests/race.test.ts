import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRoadGeometry } from '../src/track/road-geometry.ts';
import { splinePresets } from '../src/track/spline-presets.ts';
import { drivingParameters, physicsParameters } from '../src/simulation/parameters.ts';
import { createRaceSimulation, RACE_TIMESTEP, validRaceInput } from '../src/simulation/race.ts';

const handling = { driving: drivingParameters, physics: physicsParameters };

test('server accepts only numbered controls and owns the resulting vehicle state', () => {
  const race = createRaceSimulation(buildRoadGeometry(splinePresets[1]!.create()), handling);
  const player = race.addPlayer('driver', 0);
  const start = { ...player.state.position };
  assert.equal(validRaceInput({ sequence: 1, controls: { throttle: 1, steering: 0, brake: false }, state: { position: { x: 9000 } } }), true);
  assert.equal(validRaceInput({ sequence: 2, controls: { throttle: 7, steering: 0, brake: false } }), false);
  assert.equal(race.input('driver', { sequence: 1, controls: { throttle: 1, steering: 0, brake: false } }, 1000), true);
  assert.equal(race.input('driver', { sequence: 1, controls: { throttle: 1, steering: 0, brake: false } }, 1000), false);
  for (let i = 0; i < 12; i++) race.step(1000 + i * RACE_TIMESTEP * 1000);
  const snapshot = race.snapshot();
  assert.equal(snapshot.tick, 12);
  assert.equal(snapshot.players[0]!.acknowledgedInput, 1);
  assert.ok(snapshot.players[0]!.state.speed > 0);
  assert.ok(Math.hypot(player.state.position.x - start.x, player.state.position.z - start.z) > 0.1);
  snapshot.players[0]!.state.position.x = 9000;
  assert.notEqual(race.snapshot().players[0]!.state.position.x, 9000);
});

test('overlapping players pass through one another without affecting each other', () => {
  const race = createRaceSimulation(buildRoadGeometry(splinePresets[1]!.create()), handling);
  const a = race.addPlayer('a', 0), b = race.addPlayer('b', 0);
  const bStart = { ...b.state.position };
  assert.deepEqual(a.state.position, b.state.position);
  race.input('a', { sequence: 1, controls: { throttle: 1, steering: 0, brake: false } }, 1000);
  for (let i = 0; i < 30; i++) race.step(1000 + i * RACE_TIMESTEP * 1000);
  assert.ok(a.state.speed > 0);
  assert.equal(b.state.speed, 0);
  assert.deepEqual(b.state.position, bStart);
  // No separation impulse moves the stationary car even when both bodies overlap.
  a.state.position = { ...b.state.position };
  race.step(1500);
  assert.deepEqual(b.state.position, bStart);
});

test('server alone advances the lap timer on a finish crossing', () => {
  const road = buildRoadGeometry(splinePresets[1]!.create());
  const race = createRaceSimulation(road, handling);
  const player = race.addPlayer('driver', 0);
  const finish = road.finish!;
  const direction = finish.direction!;
  player.state.position = { x: finish.center.x - direction.x * 0.2, y: finish.center.y,
    z: finish.center.z - direction.z * 0.2 };
  player.state.heading = Math.atan2(-direction.x, -direction.z);
  player.state.speed = 30;
  race.step(1000);
  assert.equal(race.snapshot().players[0]!.lapTimer.running, true);
});

test('server requires every checkpoint before recording a lap', () => {
  const layout = splinePresets[1]!.create();
  layout.checkpoints = [{ id: 1, connectionId: 1, progress: 0.5 }];
  const road = buildRoadGeometry(layout);
  const race = createRaceSimulation(road, handling);
  const player = race.addPlayer('driver', 0);
  function cross(gate: NonNullable<typeof road.finish>, now: number): void {
    const direction = gate.direction!;
    player.state.position = { x: gate.center.x - direction.x * 0.2, y: gate.center.y,
      z: gate.center.z - direction.z * 0.2 };
    player.state.heading = Math.atan2(-direction.x, -direction.z);
    player.state.speed = 30;
    race.step(now);
  }
  cross(road.finish!, 1000);
  assert.equal(race.snapshot().players[0]!.lapTimer.running, true);
  cross(road.finish!, 2000);
  assert.equal(race.snapshot().players[0]!.lapTimer.completedLaps, 0);
  assert.equal(race.snapshot().players[0]!.lapTimer.missedCheckpoints, true);
  cross(road.checkpoints[0]!, 3000);
  assert.deepEqual(race.snapshot().players[0]!.lapTimer.checkpointsVisited, [1]);
  cross(road.finish!, 4000);
  const result = race.snapshot().players[0]!.lapTimer;
  assert.equal(result.completedLaps, 1);
  assert.ok(result.last !== null && result.last > 0);
  assert.deepEqual(result.checkpointsVisited, []);
});
