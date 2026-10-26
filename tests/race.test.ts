import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRoadGeometry } from '../src/track/road-geometry.ts';
import { splinePresets } from '../src/track/spline-presets.ts';
import { drivingParameters, physicsParameters } from '../src/simulation/parameters.ts';
import { createRaceSimulation, RACE_TIMESTEP, validRaceInput } from '../src/simulation/race.ts';
import { createRoadWorld } from '../src/simulation/road-world.ts';
import { stepSplineVehicle } from '../src/simulation/spline-vehicle.ts';
import { handlingHash } from '../server/accounts.ts';
import { createHash } from 'node:crypto';

const handling = { driving: drivingParameters, physics: physicsParameters };

test('Physics Time scales authoritative driving and lap time without changing old default leaderboard hashes', () => {
  const road = { ...buildRoadGeometry(splinePresets[1]!.create()), finish: null };
  const speeds: number[] = [];
  for (const physicsTime of [0.5, 1, 3]) {
    const race = createRaceSimulation(road, { driving: drivingParameters, physics: { ...physicsParameters, physicsTime } });
    const player = race.addPlayer('driver', 0);
    player.lapTimer.running = true;
    race.input('driver', { sequence: 1, lifeId: 0,
      controls: { throttle: 1, steering: 0, brake: false } }, 1000);
    for (let i = 0; i < 12; i++) race.step(1000 + i * RACE_TIMESTEP * 1000);
    assert.ok(Math.abs(player.lapTimer.elapsed - 12 * RACE_TIMESTEP * physicsTime) < 1e-9);
    speeds.push(player.state.speed);
  }
  assert.ok(speeds[0]! < speeds[1]! && speeds[1]! < speeds[2]!);

  const { physicsTime: _physicsTime, ...oldPhysics } = physicsParameters;
  const previousDefaultHash = createHash('sha256').update(JSON.stringify({ driving: drivingParameters, physics: oldPhysics })).digest('hex');
  assert.equal(handlingHash(handling), previousDefaultHash);
  for (const physicsTime of [0.1, 0.5, 3]) {
    assert.equal(handlingHash({ driving: drivingParameters, physics: { ...physicsParameters, physicsTime } }), previousDefaultHash);
  }
  assert.notEqual(handlingHash({ driving: { ...drivingParameters, acceleration: 20 }, physics: physicsParameters }), previousDefaultHash);
});

test('server accepts only numbered controls and owns the resulting vehicle state', () => {
  const race = createRaceSimulation(buildRoadGeometry(splinePresets[1]!.create()), handling);
  const player = race.addPlayer('driver', 0);
  const start = { ...player.state.position };
  assert.equal(validRaceInput({ sequence: 1, lifeId: 0, controls: { throttle: 1, steering: 0, brake: false }, state: { position: { x: 9000 } } }), true);
  assert.equal(validRaceInput({ sequence: 2, lifeId: 0, controls: { throttle: 7, steering: 0, brake: false } }), false);
  assert.equal(race.input('driver', { sequence: 1, lifeId: 0, controls: { throttle: 1, steering: 0, brake: false } }, 1000), true);
  assert.equal(race.input('driver', { sequence: 1, lifeId: 0, controls: { throttle: 1, steering: 0, brake: false } }, 1000), false);
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
  race.input('a', { sequence: 1, lifeId: 0, controls: { throttle: 1, steering: 0, brake: false } }, 1000);
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
  const result = race.step(1000);
  assert.equal(race.snapshot().players[0]!.lapTimer.running, true);
  assert.equal(result.transitions.length, 1);
  assert.equal(result.transitions[0]!.kind, 'start');
  assert.equal(result.transitions[0]!.tick, race.tick);
  assert.equal(result.transitions[0]!.player.lapTimer.running, true);
  assert.equal(result.transitions[0]!.player.attemptId, 1);
  assert.equal(result.transitions[0]!.player.lastTransition, 'start');
});

test('server confirms respawn and timer reset together, while client prediction waits', () => {
  const road = buildRoadGeometry(splinePresets[1]!.create());
  const race = createRaceSimulation(road, handling);
  const player = race.addPlayer('driver', 0);
  player.state.position = { x: 5000, y: -100, z: 5000 };
  player.state.grounded = false;
  player.state.airborneTime = physicsParameters.respawnDelay;
  player.lapTimer.running = true;
  player.lapTimer.elapsed = 12;

  const predicted = structuredClone(player.state);
  const neutral = { throttle: 0 as const, steering: 0 as const, brake: false };
  const didPredictRespawn = stepSplineVehicle(predicted, neutral, RACE_TIMESTEP,
    createRoadWorld(road), road.spawns[0]!, physicsParameters, drivingParameters, false);
  assert.equal(didPredictRespawn, false);
  assert.ok(predicted.position.x > 4000);

  const result = race.step(1000);
  assert.equal(result.transitions.length, 1);
  const transition = result.transitions[0]!;
  assert.equal(transition.kind, 'respawn');
  assert.equal(transition.tick, race.tick);
  assert.equal(transition.player.lapTimer.running, false);
  assert.equal(transition.player.lapTimer.elapsed, 0);
  assert.equal(transition.player.lifeId, 1);
  assert.equal(transition.player.attemptId, 1);
  assert.equal(transition.player.lastTransition, 'respawn');
  assert.deepEqual(transition.player.state.position, road.spawns[0]!.position);
  assert.deepEqual(race.snapshot().players[0]!.lapTimer, transition.player.lapTimer);
});

test('respawn drops queued controls and rejects late packets from the previous life', () => {
  const road = buildRoadGeometry(splinePresets[1]!.create());
  const race = createRaceSimulation(road, handling);
  const player = race.addPlayer('driver', 0);
  player.state.position = { x: 5000, y: -100, z: 5000 };
  player.state.grounded = false;
  player.state.airborneTime = physicsParameters.respawnDelay;
  const throttle = { throttle: 1 as const, steering: 0 as const, brake: false };
  assert.equal(race.input('driver', { sequence: 1, lifeId: 0, controls: throttle }, 1000), true);
  assert.equal(race.input('driver', { sequence: 2, lifeId: 0, controls: throttle }, 1000), true);
  race.step(1000);
  assert.equal(race.input('driver', { sequence: 3, lifeId: 0, controls: throttle }, 1016), false);
  for (let i = 0; i < 20; i++) race.step(1016 + i * RACE_TIMESTEP * 1000);
  assert.deepEqual(race.snapshot().players[0]!.state.position, road.spawns[0]!.position);
  assert.equal(race.input('driver', { sequence: 3, lifeId: 1, controls: throttle }, 1400), true);
  race.step(1400);
  assert.ok(race.snapshot().players[0]!.state.speed > 0);
});

test('a tab opened before deployment can keep driving with legacy inputs', () => {
  const road = buildRoadGeometry(splinePresets[1]!.create());
  const race = createRaceSimulation(road, handling);
  const player = race.addPlayer('driver', 0);
  const throttle = { throttle: 1 as const, steering: 0 as const, brake: false };
  assert.equal(validRaceInput({ sequence: 1, controls: throttle }), true);
  assert.equal(race.input('driver', { sequence: 1, controls: throttle }, 1000), true);
  race.step(1000);
  assert.ok(player.state.speed > 0);

  player.state.position = { x: 5000, y: -100, z: 5000 };
  player.state.grounded = false;
  player.state.airborneTime = physicsParameters.respawnDelay;
  race.step(1016);
  assert.equal(player.lifeId, 1);
  assert.equal(race.input('driver', { sequence: 2, controls: throttle }, 1032), true);
  race.step(1032);
  assert.ok(player.state.speed > 0);
  assert.equal(race.input('driver', { sequence: 3, lifeId: 0, controls: throttle }, 1048), false);
});

test('death notices report server state without letting a client trigger a reset', () => {
  const road = buildRoadGeometry(splinePresets[1]!.create());
  const race = createRaceSimulation(road, handling);
  const player = race.addPlayer('driver', 0);
  player.lapTimer.running = true;
  player.lapTimer.elapsed = 12;
  assert.equal(race.deathStatus('driver', 0), 'rejected');
  assert.equal(race.deathStatus('driver', 1), 'rejected');
  assert.equal(player.lapTimer.elapsed, 12);
  player.state.grounded = false;
  player.state.position = { x: 5000, y: -100, z: 5000 };
  player.state.airborneTime = 0.5;
  assert.equal(race.deathStatus('driver', 0), 'pending');
  assert.equal(player.lapTimer.elapsed, 12);
  player.state.airborneTime = physicsParameters.respawnDelay;
  race.step(1000);
  assert.equal(race.deathStatus('driver', 0), 'respawned');
  assert.equal(player.lapTimer.elapsed, 0);
});

test('server requires every checkpoint before recording a lap', () => {
  const layout = splinePresets[1]!.create();
  layout.checkpoints = [{ id: 1, connectionId: 1, progress: 0.5 }];
  const road = buildRoadGeometry(layout);
  const race = createRaceSimulation(road, handling);
  const player = race.addPlayer('driver', 0);
  function cross(gate: NonNullable<typeof road.finish>, now: number) {
    const direction = gate.direction!;
    player.state.position = { x: gate.center.x - direction.x * 0.2, y: gate.center.y,
      z: gate.center.z - direction.z * 0.2 };
    player.state.heading = Math.atan2(-direction.x, -direction.z);
    player.state.speed = 30;
    return race.step(now);
  }
  cross(road.finish!, 1000);
  assert.equal(race.snapshot().players[0]!.lapTimer.running, true);
  cross(road.finish!, 2000);
  assert.equal(race.snapshot().players[0]!.lapTimer.completedLaps, 0);
  assert.equal(race.snapshot().players[0]!.lapTimer.missedCheckpoints, true);
  cross(road.checkpoints[0]!, 3000);
  assert.deepEqual(race.snapshot().players[0]!.lapTimer.checkpointsVisited, [1]);
  const completed = cross(road.finish!, 4000);
  const result = race.snapshot().players[0]!.lapTimer;
  assert.equal(result.completedLaps, 1);
  assert.ok(result.last !== null && result.last > 0);
  assert.deepEqual(result.checkpointsVisited, []);
  assert.equal(completed.transitions[0]?.kind, 'lap');
  assert.equal(completed.transitions[0]?.player.lapTimer.completedLaps, 1);
  assert.equal(completed.transitions[0]?.player.attemptId, 2);
  assert.equal(completed.transitions[0]?.player.lastTransition, 'lap');
});
