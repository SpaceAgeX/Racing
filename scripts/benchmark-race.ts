import { buildRoadGeometry } from '../src/track/road-geometry.ts';
import { splinePresets } from '../src/track/spline-presets.ts';
import { drivingParameters, physicsParameters } from '../src/simulation/parameters.ts';
import { createRaceSimulation, RACE_TIMESTEP } from '../src/simulation/race.ts';

const started = performance.now();
const road = buildRoadGeometry(splinePresets[0]!.create());
const buildMs = performance.now() - started;
const race = createRaceSimulation(road, { driving: drivingParameters, physics: physicsParameters });
for (let i = 0; i < 10; i++) race.addPlayer(`driver-${i}`, i);
const durations: number[] = [];
for (let tick = 1; tick <= 600; tick++) {
  const now = tick * RACE_TIMESTEP * 1000;
  for (let i = 0; i < 10; i++) race.input(`driver-${i}`, {
    sequence: tick, controls: { throttle: 1, steering: tick % 180 < 90 ? 0 : i % 2 ? 1 : -1, brake: false },
  }, now);
  const before = performance.now();
  race.step(now);
  if (tick % 3 === 0) race.snapshot();
  durations.push(performance.now() - before);
}
durations.sort((a, b) => a - b);
const average = durations.reduce((sum, n) => sum + n, 0) / durations.length;
console.log(JSON.stringify({ players: 10, secondsSimulated: 10, simulationHz: 60,
  roadBuildMs: Number(buildMs.toFixed(2)), tickMs: {
    average: Number(average.toFixed(2)), p95: Number(durations[Math.floor(durations.length * 0.95)]!.toFixed(2)),
    max: Number(durations.at(-1)!.toFixed(2)), budget: Number((RACE_TIMESTEP * 1000).toFixed(2)),
  } }, null, 2));
