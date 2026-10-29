import assert from 'node:assert/strict';
import test from 'node:test';
import { createMultiplayerRound, validRoundOptions } from '../server/multiplayer-round.ts';
import { createRaceSimulation, type RaceStepResult } from '../src/simulation/race.ts';
import { drivingParameters, physicsParameters } from '../src/simulation/parameters.ts';
import { buildRoadGeometry } from '../src/track/road-geometry.ts';
import { splinePresets } from '../src/track/spline-presets.ts';

const road = buildRoadGeometry(splinePresets[0]!.create());
const players = [
  { id: 'one', name: 'One', color: '#6bc5ff' },
  { id: 'two', name: 'Two', color: '#ee7136' },
];
const empty: RaceStepResult = { laps: [], falls: [], transitions: [], activity: [] };
function setup(options: { laps: number; fallMode: 'respawn' | 'elimination'; qualifying: boolean }) {
  const race = createRaceSimulation(road, { driving: drivingParameters, physics: physicsParameters });
  race.addPlayer('one', 0);
  race.addPlayer('two', 1);
  return { race, round: createMultiplayerRound(race, players, 'Test track', options) };
}

test('race options reject impossible lap counts and malformed rules', () => {
  assert.equal(validRoundOptions({ laps: 3, fallMode: 'respawn', qualifying: false }), true);
  assert.equal(validRoundOptions({ laps: 0, fallMode: 'respawn', qualifying: false }), false);
  assert.equal(validRoundOptions({ laps: 21, fallMode: 'elimination', qualifying: true }), false);
  assert.equal(validRoundOptions({ laps: 3, fallMode: 'ghost', qualifying: false }), false);
});

test('all players must load before the locked grid countdown releases them', () => {
  const { race, round } = setup({ laps: 3, fallMode: 'respawn', qualifying: false });
  assert.equal(round.ready('one', 100).changed, false);
  assert.equal(round.stage, 'loading');
  const prepared = round.ready('two', 100);
  assert.equal(prepared.changed, true);
  assert.equal(prepared.resets.length, 2);
  assert.equal(round.stage, 'countdown');
  assert.equal(race.input('one', { sequence: 1, lifeId: 1,
    controls: { throttle: 1, steering: 0, brake: false } }, 110), false);
  assert.equal(round.advance(3099).changed, false);
  assert.equal(round.advance(3100).changed, true);
  assert.equal(round.stage, 'race');
  assert.equal(race.input('one', { sequence: 2, lifeId: 1,
    controls: { throttle: 1, steering: 0, brake: false } }, 3110), true);
});

test('qualifying finishers start ahead of fallers and later falls beat earlier falls', () => {
  const { race, round } = setup({ laps: 2, fallMode: 'respawn', qualifying: true });
  round.ready('one', 0);
  round.ready('two', 0);
  round.advance(3000);
  assert.equal(round.stage, 'qualifying');
  for (let i = 0; i < 60; i++) round.step(empty, 3000 + i * 16);
  const fall = round.step({ ...empty, falls: [{ playerId: 'one' }] }, 4000);
  assert.equal(fall.resets.length, 1);
  assert.equal(round.snapshot(4000).players.find(p => p.id === 'one')?.status, 'qualifying-fall');
  const qualified = round.step({ ...empty, laps: [{ playerId: 'two', durationSeconds: 42, checkpointSplits: [] }] }, 5000);
  assert.equal(qualified.changed, true);
  assert.equal(round.stage, 'countdown');
  assert.equal(round.snapshot(5000).players.find(p => p.id === 'two')?.gridPosition, 1);
  assert.equal(round.snapshot(5000).players.find(p => p.id === 'one')?.gridPosition, 2);
  assert.deepEqual(race.snapshot().players.find(p => p.id === 'two')?.state.position, road.spawns[0]?.position);

  const second = setup({ laps: 1, fallMode: 'elimination', qualifying: true });
  second.round.ready('one', 0); second.round.ready('two', 0); second.round.advance(3000);
  second.round.step({ ...empty, falls: [{ playerId: 'one' }] }, 3017);
  for (let i = 0; i < 60; i++) second.round.step(empty, 3017 + i * 16);
  second.round.step({ ...empty, falls: [{ playerId: 'two' }] }, 4017);
  assert.equal(second.round.snapshot(4017).players.find(p => p.id === 'two')?.gridPosition, 1);
});

test('lap target and elimination produce server-ordered final results', () => {
  const { round } = setup({ laps: 2, fallMode: 'elimination', qualifying: false });
  round.ready('one', 0); round.ready('two', 0); round.advance(3000);
  round.step({ ...empty, laps: [{ playerId: 'one', durationSeconds: 30, checkpointSplits: [] }] }, 3017);
  const finish = round.step({ ...empty, laps: [{ playerId: 'one', durationSeconds: 28, checkpointSplits: [] }] }, 3034);
  assert.equal(finish.results, null);
  const end = round.step({ ...empty, falls: [{ playerId: 'two' }] }, 3051);
  assert.equal(end.results?.players[0]?.id, 'one');
  assert.deepEqual(end.results?.players[0]?.lapTimes, [30, 28]);
  assert.equal(end.results?.players[1]?.status, 'eliminated');
});

test('respawn mode counts a fall without eliminating the driver', () => {
  const { round, race } = setup({ laps: 1, fallMode: 'respawn', qualifying: false });
  round.ready('one', 0); round.ready('two', 0); round.advance(3000);
  const player = race.snapshot().players.find(entry => entry.id === 'one')!;
  round.step({ ...empty, transitions: [{ kind: 'respawn', tick: 1, player }] }, 3017);
  const status = round.snapshot(3017).players.find(entry => entry.id === 'one')!;
  assert.equal(status.falls, 1);
  assert.equal(status.status, 'racing');
});

test('qualifying finish parks the car at its start position while others continue', () => {
  const { race, round } = setup({ laps: 3, fallMode: 'respawn', qualifying: true });
  round.ready('one', 0); round.ready('two', 0); round.advance(3000);
  const lap = round.step({ ...empty, laps: [{ playerId: 'one', durationSeconds: 31, checkpointSplits: [] }] }, 3017);
  assert.equal(round.stage, 'qualifying');
  assert.equal(round.snapshot(3017).players.find(player => player.id === 'one')?.status, 'qualified');
  assert.equal(lap.resets.length, 1);
  assert.deepEqual(lap.resets[0]?.state.position, road.spawns[0]?.position);
  assert.equal(lap.resets[0]?.state.speed, 0);
  assert.equal(race.input('one', { sequence: 1, lifeId: lap.resets[0]!.lifeId,
    controls: { throttle: 1, steering: 0, brake: false } }, 3034), false);
});

test('race finish locks the result but leaves the driver able to keep moving', () => {
  const { race, round } = setup({ laps: 1, fallMode: 'elimination', qualifying: false });
  round.ready('one', 0); round.ready('two', 0); round.advance(3000);
  round.step({ ...empty, laps: [{ playerId: 'one', durationSeconds: 30, checkpointSplits: [] }] }, 3017);
  assert.equal(round.snapshot(3017).players.find(player => player.id === 'one')?.status, 'finished');
  assert.equal(round.isRacing('one'), false);
  assert.equal(race.input('one', { sequence: 1, lifeId: 1,
    controls: { throttle: 1, steering: 0, brake: false } }, 3034), true);
  const continued = race.step(3034).activity.find(player => player.playerId === 'one');
  assert.ok(continued);
  assert.ok(race.snapshot().players.find(player => player.id === 'one')!.state.speed > 0);
});
