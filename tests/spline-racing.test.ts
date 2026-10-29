import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  addSplineNode,
  addSplineConnection,
  createSplineGraph,
  setSplineFinishLine,
  SPLINE_EDITOR_WORLD_SIZE,
} from '../src/track/spline.ts';
import { buildSplineSurface } from '../src/track/spline-surface.ts';
import { serializeSpline, splineTrackError } from '../src/track/spline-records.ts';
import { buildRoadGeometry } from '../src/track/road-geometry.ts';
import { splinePresets } from '../src/track/spline-presets.ts';
import { createRoadWorld } from '../src/simulation/road-world.ts';
import { stepSplineVehicle, respawnVehicle } from '../src/simulation/spline-vehicle.ts';
import { createVehicleState } from '../src/simulation/vehicle.ts';
import { vehicleDimensions, physicsParameters } from '../src/simulation/parameters.ts';
import { createLapTimer, stepLapTimer, resetCurrentLap } from '../src/simulation/lap-timer.ts';

export function straightTrack(height = 0) {
  const g = createSplineGraph();
  addSplineNode(g, { x: 0.5, y: 0.9 }, 0);
  addSplineNode(g, { x: 0.5, y: 0.1 }, 1);
  addSplineConnection(g, 0, 1, 0);
  g.nodes[1]!.height = height;
  setSplineFinishLine(g, 0, 0.5);
  return serializeSpline(g);
}
const flat = buildRoadGeometry(straightTrack());
const controls = { throttle: 0, steering: 0, brake: false } as const;
const body = { ...vehicleDimensions, heading: 0 };
test('finished spline validation accepts an open two-point road and rejects unfinished/malformed data', () => {
  const graph = straightTrack();
  assert.equal(splineTrackError(graph), null);
  graph.finishLine = null;
  assert.match(splineTrackError(graph)!, /finish line/);
  graph.nodes.length = 1;
  assert.match(splineTrackError(graph)!, /at least 2/);
  const bad = straightTrack();
  bad.connections[0]!.endNodeId = 999;
  assert.match(splineTrackError(bad)!, /connection/);
});
test('road mesh has bounded triangles, both solid sides, underside and ten distinct elevated spawn positions', () => {
  const road = buildRoadGeometry(straightTrack(30));
  assert.equal(road.spawns.length, 10);
  assert.equal(new Set(road.spawns.map((s) => JSON.stringify(s.position))).size, 10);
  assert.ok(road.spawns.every((s) => s.position.y > 0));
  const world = createRoadWorld(road);
  for (const spawn of road.spawns) assert.ok(world.getGroundSupport(spawn.position, 0.3, 0.3, body).fraction > 0.95);
  assert.ok(road.triangles.some((t) => t.kind === 'bottom'));
  assert.ok(road.triangles.some((t) => t.kind === 'wall'));
  assert.ok(road.triangles.length < 20000);
});
test('swept full body hits exposed road sides, underside, and finish posts at high speed', () => {
  const world = createRoadWorld(flat);
  const side = world.sweepBody({ x: 15, y: -0.5, z: 30 }, { x: -15, y: -0.5, z: 30 }, body);
  assert.ok(side);
  assert.ok(side.normal.x > 0.9);
  assert.ok(side.fraction < 0.5);
  const underside = world.sweepBody({ x: 0, y: -5, z: 30 }, { x: 0, y: 3, z: 30 }, body);
  assert.ok(underside);
  assert.ok(underside.normal.y < -0.9);
  const post = flat.obstacles[0]!;
  assert.ok(world.sweepBody({ x: post.center.x, y: 0, z: 10 }, { x: post.center.x, y: 0, z: -10 }, body));
});
test('support sums triangular pieces and tips below half the body footprint', () => {
  const world = createRoadWorld(flat);
  assert.ok(world.getGroundSupport({ x: 0, y: 0, z: 30 }, 0.1, 0.1, body).fraction > 0.999);
  const near = world.getGroundSupport({ x: 5.95, y: 0, z: 30 }, 0.1, 0.1, body),
    over = world.getGroundSupport({ x: 6.05, y: 0, z: 30 }, 0.1, 0.1, body);
  assert.ok(near.fraction > 0.5);
  assert.ok(over.fraction < 0.5);
  const state = createVehicleState();
  Object.assign(state.position, { x: 6.05, y: 0, z: 30 });
  stepSplineVehicle(state, controls, 1 / 60, world, flat.spawns[0]!);
  assert.equal(state.grounded, false);
  assert.equal(state.tipping, true);
  for (let i = 0; i < 65; i++) stepSplineVehicle(state, controls, 1 / 60, world, flat.spawns[0]!);
  assert.equal(state.grounded, true);
  assert.deepEqual(state.position, flat.spawns[0]!.position);
});
test('car follows elevation with pitch, coasts and crosses mesh seams without speed loss', () => {
  const road = buildRoadGeometry(straightTrack(30)),
    world = createRoadWorld(road),
    state = createVehicleState(),
    spawn = road.spawns[0]!;
  respawnVehicle(state, spawn);
  state.speed = 12;
  const before = state.position.y;
  for (let i = 0; i < 60; i++) stepSplineVehicle(state, controls, 1 / 60, world, spawn);
  assert.equal(state.grounded, true);
  assert.ok(state.position.y > before);
  assert.ok(state.pitch > 0);
  assert.ok(state.speed > 8 && state.speed < 12);
  assert.ok(Math.abs(state.position.y - road.heightAt(state.position.x, state.position.z)) < 0.12);
});
test('offset arch impact produces spin on spline roads', () => {
  const world = createRoadWorld(flat),
    state = createVehicleState(),
    post = flat.obstacles[0]!;
  Object.assign(state.position, { x: post.center.x + 0.5, y: 0, z: 5 });
  state.speed = 20;
  let spin = 0;
  for (let i = 0; i < 25; i++) {
    stepSplineVehicle(state, controls, 1 / 60, world, flat.spawns[0]!, { ...physicsParameters, respawnDelay: 10 });
    spin = Math.max(spin, Math.abs(state.yawSpeed));
  }
  assert.ok(spin > 0.1);
});
test('all checkpoints count once in any order; incomplete finish keeps timing, complete lap resets progress', () => {
  const timer = createLapTimer(),
    line = { center: { x: 0, y: 0, z: 0 }, width: 12 };
  const cps = [
    { id: 1, center: { x: 0, y: 0, z: 10 }, width: 12 },
    { id: 2, center: { x: 0, y: 0, z: 20 }, width: 12 },
  ];
  const cross = (z: number) => stepLapTimer(timer, { x: 0, y: 0, z: z - 1 }, { x: 0, y: 0, z: z + 1 }, 1, line, cps);
  cross(0);
  cross(20);
  cross(20);
  assert.deepEqual(timer.checkpointsVisited, [2]);
  assert.deepEqual(timer.checkpointSplits, [{ checkpointId: 2, elapsedSeconds: 1 }]);
  cross(0);
  assert.equal(timer.completedLaps, 0);
  assert.ok(timer.elapsed > 2);
  assert.equal(timer.best, null);
  cross(10);
  const completed = cross(0);
  assert.equal(timer.completedLaps, 1);
  assert.deepEqual(completed?.checkpointSplits, [
    { checkpointId: 2, elapsedSeconds: 1 },
    { checkpointId: 1, elapsedSeconds: 4 },
  ]);
  assert.equal(completed.durationSeconds, 5);
  assert.deepEqual(timer.checkpointsVisited, []);
  assert.deepEqual(timer.checkpointSplits, []);
  cross(0);
  assert.equal(timer.completedLaps, 1);
  cross(10);
  resetCurrentLap(timer);
  assert.deepEqual(timer.checkpointsVisited, []);
  assert.deepEqual(timer.checkpointSplits, []);
  assert.equal(timer.running, false);
});
test('rotated elevated checkpoint gates reject side misses and crossing below the road', () => {
  const timer = createLapTimer(),
    line = { center: { x: 0, y: 10, z: 0 }, width: 8, direction: { x: 1, z: 0 } };
  stepLapTimer(timer, { x: -2, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }, 1, line);
  assert.equal(timer.running, false);
  stepLapTimer(timer, { x: -2, y: 10, z: 6 }, { x: 2, y: 10, z: 6 }, 1, line);
  assert.equal(timer.running, false);
  stepLapTimer(timer, { x: -2, y: 10, z: 0 }, { x: 2, y: 10, z: 0 }, 1, line);
  assert.equal(timer.running, true);
});

test('leaving a top edge does not hit its vertical side or remove outward momentum', () => {
  const world = createRoadWorld(flat);
  world.setDriving(true);
  assert.equal(
    world.sweepBody({ x: 0, y: 0, z: 30 }, { x: 15, y: 0, z: 30 }, { ...body, heading: -Math.PI / 2 }),
    null,
  );
  const state = createVehicleState();
  Object.assign(state.position, { x: 4, y: 0, z: 30 });
  state.heading = -Math.PI / 2;
  state.speed = 10;
  for (let i = 0; i < 24; i++)
    stepSplineVehicle(state, controls, 1 / 60, world, flat.spawns[0]!, { ...physicsParameters, respawnDelay: 5 });
  assert.equal(state.grounded, false);
  assert.ok(state.position.x > 7);
  assert.ok(state.speed > 9);
  assert.equal(state.crashTime, 0);
});

test('curved boundaries turn continuously without teeth, and elevated mesh cells form a closed solid', () => {
  const graph = createSplineGraph();
  addSplineNode(graph, { x: 0.25, y: 0.5 }, 0);
  addSplineNode(graph, { x: 0.5, y: 0.25 }, 1);
  addSplineConnection(graph, 0, 1, 0);
  graph.connections[0]!.startHandle = { x: 0, y: -0.138071 };
  graph.connections[0]!.endHandle = { x: -0.138071, y: 0 };
  graph.nodes[1]!.height = 25;
  const surface = buildSplineSurface(graph);
  let checked = 0;
  for (const ring of surface.polygons.flat()) {
    for (let i = 1; i < ring.length - 1; i++) {
      const a = ring[i - 1]!,
        b = ring[i]!,
        c = ring[i + 1]!;
      // The outer arc, excluding the end caps, must never alternate inward/outward.
      if (b[0] >= -10 || b[1] >= -10 || Math.hypot(...b) <= SPLINE_EDITOR_WORLD_SIZE / 4 + 1) continue;
      const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
      assert.ok(cross > 0, 'Outer boundary must not have a sawtooth');
      checked++;
    }
  }
  assert.ok(checked > 50);
  const road = buildRoadGeometry(graph);
  const edges = new Map<string, number>();
  const key = (p: { x: number; y: number; z: number }) => [p.x, p.y, p.z].map((n) => n.toFixed(6)).join(',');
  for (const t of road.triangles) {
    for (const [a, b] of [
      [t.a, t.b],
      [t.b, t.c],
      [t.c, t.a],
    ]) {
      const edge = [key(a!), key(b!)].sort().join(':');
      edges.set(edge, (edges.get(edge) ?? 0) + 1);
    }
  }
  assert.ok(
    [...edges.values()].every((count) => count === 2),
    'Every edge must belong to exactly two solid faces',
  );
});

test('visible road edge markings follow the actual surface through elevated bends', () => {
  const graph = splinePresets[0]!.create();
  graph.nodes[1]!.height = 25;
  const road = buildRoadGeometry(graph);
  assert.ok(road.edgeMarkings.length > 100);
  for (const marking of road.edgeMarkings) {
    for (const point of [marking.a, marking.b, marking.c]) {
      assert.ok(Number.isFinite(point.y));
      assert.ok(Math.abs(point.y - road.heightAt(point.x, point.z) - 0.045) < 1e-5);
    }
  }
});
