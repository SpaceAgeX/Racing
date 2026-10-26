import assert from 'node:assert/strict';
import { test } from 'node:test';
import { prepareRaceRoad } from '../server/road-preparation.ts';
import { createRaceSimulation, RACE_TIMESTEP } from '../src/simulation/race.ts';
import { drivingParameters, physicsParameters } from '../src/simulation/parameters.ts';
import { splinePresets } from '../src/track/spline-presets.ts';

test('preparing another track leaves an active race ticking and reuses identical geometry', async () => {
  const firstLayout = splinePresets[0]!.create();
  const firstRoad = await prepareRaceRoad(firstLayout);
  const race = createRaceSimulation(firstRoad, { driving: drivingParameters, physics: physicsParameters });
  race.addPlayer('existing-player', 0);

  const timer = setInterval(() => race.step(performance.now()), RACE_TIMESTEP * 1000);
  try {
    const secondRoad = await prepareRaceRoad(splinePresets[1]!.create());
    assert.ok(secondRoad.triangles.length > 0);
    assert.ok(race.tick >= 5, `the active race advanced only ${race.tick} ticks during preparation`);
    assert.strictEqual(await prepareRaceRoad(firstLayout), firstRoad);
  } finally {
    clearInterval(timer);
  }
});
