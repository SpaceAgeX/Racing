import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCollisionWorld } from '../src/simulation/collision.ts';
import type { GroundCollider } from '../src/simulation/collision.ts';
import type { SolidBoxCollider } from '../src/simulation/box.ts';
import { resolveVehicleImpact } from '../src/simulation/impact.ts';
import { FixedStepClock, FIXED_TIMESTEP } from '../src/simulation/fixed-step.ts';
import { drivingParameters, physicsParameters, vehicleDimensions } from '../src/simulation/parameters.ts';
import { createVehicleState } from '../src/simulation/vehicle.ts';
import { respawnVehicle, stepVehicleInWorld } from '../src/simulation/vehicle-world.ts';
import type { DrivingControls } from '../src/simulation/types.ts';
import { createTrackCollisionWorld } from '../src/track/collision.ts';
import { getTrackSpawn } from '../src/track/grid.ts';
import type { TrackLayout } from '../src/track/layout.ts';

const idle: DrivingControls = { throttle: 0, steering: 0, brake: false };
const forward: DrivingControls = { ...idle, throttle: 1 };
const layout: TrackLayout = [[2]];
const spawn = getTrackSpawn(layout, 12);

function floor(height = 0): GroundCollider {
  return {
    id: `floor:${height}`,
    bounds: { minX: -100, maxX: 100, minZ: -100, maxZ: 100 },
    point: { x: 0, y: height, z: 0 },
    normal: { x: 0, y: 1, z: 0 },
  };
}

function tileBox(): SolidBoxCollider {
  return { id: 'solid-tile', min: { x: -6, y: -0.5, z: -6 }, max: { x: 6, y: 0, z: 6 } };
}

test('full vehicle casts hit all four side faces below the track top', () => {
  const world = createTrackCollisionWorld(layout, 12);
  const body = { ...vehicleDimensions, heading: 0 };
  const cases = [
    { from: { x: 10, y: -0.25, z: 0 }, to: { x: 0, y: -0.25, z: 0 }, normal: { x: 1, y: 0, z: 0 } },
    { from: { x: -10, y: -0.25, z: 0 }, to: { x: 0, y: -0.25, z: 0 }, normal: { x: -1, y: 0, z: 0 } },
    { from: { x: 0, y: -0.25, z: 10 }, to: { x: 0, y: -0.25, z: 0 }, normal: { x: 0, y: 0, z: 1 } },
    { from: { x: 0, y: -0.25, z: -10 }, to: { x: 0, y: -0.25, z: 0 }, normal: { x: 0, y: 0, z: -1 } },
  ];
  for (const example of cases) {
    const hit = world.sweepBody(example.from, example.to, body);
    assert.ok(hit && hit.fraction > 0 && hit.fraction < 1);
    assert.ok(Math.hypot(hit.normal.x - example.normal.x, hit.normal.y - example.normal.y, hit.normal.z - example.normal.z) < 1e-10);
  }
});

test('the car roof hits the slab underside and stops upward motion without becoming grounded', () => {
  const world = createTrackCollisionWorld(layout, 12);
  const state = createVehicleState();
  state.position.y = -1.5;
  state.grounded = false;
  state.verticalSpeed = 8;
  stepVehicleInWorld(state, idle, 0.1, world, spawn);
  assert.ok(Math.abs(state.position.y - (-0.5 - vehicleDimensions.height)) < 2e-6);
  assert.equal(state.verticalSpeed, 0);
  assert.equal(state.grounded, false);
  assert.equal(state.airborneTime, 0.1);
  assert.equal(world.getBodyPenetration(state.position, { ...vehicleDimensions, heading: state.heading }), null);
});

test('a falling car collides with a tile side even though its bottom is below the top surface', () => {
  const world = createTrackCollisionWorld(layout, 12);
  const state = createVehicleState();
  state.position.x = 10;
  state.position.y = -0.25;
  state.heading = Math.PI / 2;
  state.speed = 100;
  state.grounded = false;
  stepVehicleInWorld(state, idle, 0.1, world, spawn);
  assert.ok(state.position.x >= 6 + vehicleDimensions.length / 2);
  assert.ok(state.position.y < -0.25);
  assert.ok(state.speed <= 0 && Math.abs(state.speed) <= 100 * physicsParameters.collisionRestitution + 1e-8);
  assert.equal(state.grounded, false);
  assert.equal(world.getBodyPenetration(state.position, { ...vehicleDimensions, heading: state.heading }), null);
});

test('a glancing side impact preserves tangential momentum and continues falling', () => {
  const world = createTrackCollisionWorld(layout, 12);
  const state = createVehicleState();
  state.position.x = 8.5;
  state.position.y = -0.2;
  state.heading = Math.PI / 4;
  state.speed = 12;
  state.grounded = false;
  stepVehicleInWorld(state, idle, 0.1, world, spawn);
  assert.ok(state.position.z < -0.7);
  assert.ok(state.position.x > 6);
  assert.ok(state.lateralSpeed > 0);
  assert.ok(Math.hypot(state.speed, state.lateralSpeed) <= 12);
  assert.ok(state.position.y < -0.2);
  assert.equal(state.grounded, false);
  assert.equal(world.getBodyPenetration(state.position, { ...vehicleDimensions, heading: state.heading }), null);
});

test('an airborne car resolves both sides of an inside corner without clipping or resetting its fall timer', () => {
  const world = createCollisionWorld([], [
    { id: 'left-arm', min: { x: -6, y: -0.5, z: -6 }, max: { x: 0, y: 0, z: 6 } },
    { id: 'back-arm', min: { x: 0, y: -0.5, z: -6 }, max: { x: 6, y: 0, z: 0 } },
  ]);
  const state = createVehicleState();
  state.position = { x: 2.4, y: -0.25, z: 2.4 };
  state.heading = Math.PI / 4;
  state.speed = 12;
  state.grounded = false;
  for (let tick = 0; tick < 30; tick++) {
    stepVehicleInWorld(state, idle, FIXED_TIMESTEP, world, spawn);
    assert.equal(world.getBodyPenetration(state.position, { ...vehicleDimensions, heading: state.heading }), null);
    assert.equal(state.grounded, false);
  }
  assert.ok(state.position.x > 1.9 && state.position.z > 1.9);
  assert.ok(state.position.y < -0.5);
  assert.ok(Math.abs(state.airborneTime - 0.25) < 1e-10);
});

test('initial side overlap is recovered outward instead of allowing the body to remain inside a tile', () => {
  const world = createCollisionWorld([], [tileBox()]);
  const state = createVehicleState();
  state.position = { x: 6.8, y: -0.25, z: 0 };
  state.grounded = false;
  stepVehicleInWorld(state, idle, FIXED_TIMESTEP, world, spawn);
  assert.ok(state.position.x >= 6 + vehicleDimensions.width / 2);
  assert.ok(state.position.y < 0);
  assert.equal(world.getBodyPenetration(state.position, { ...vehicleDimensions, heading: state.heading }), null);
});

test('solid top contacts land the whole body and support is derived from the box itself', () => {
  const world = createCollisionWorld([], [tileBox()]);
  const state = createVehicleState();
  state.position.y = 5;
  state.verticalSpeed = -100;
  state.grounded = false;
  stepVehicleInWorld(state, idle, 0.1, world, spawn);
  assert.equal(state.position.y, 0);
  assert.equal(state.grounded, true);
  assert.equal(state.verticalSpeed, 0);
});

test('start arch posts and the underside of its beam are solid while the center remains drivable', () => {
  const world = createTrackCollisionWorld(layout, 12);
  const body = { ...vehicleDimensions, heading: 0 };
  const post = world.sweepBody({ x: 4, y: 0, z: 0 }, { x: 6, y: 0, z: 0 }, body);
  assert.ok(post?.colliderId.startsWith('start-finish-post:'));
  const beam = world.sweepBody({ x: 0, y: 2, z: 0 }, { x: 0, y: 4, z: 0 }, body);
  assert.ok(beam);
  assert.ok(beam.colliderId.startsWith('start-finish-beam:'));
  assert.ok(beam.normal.y < 0);
  assert.equal(world.sweepBody({ x: 0, y: 0, z: 3 }, { x: 0, y: 0, z: -3 }, body), null);
});

test('offset impacts produce opposite spins, centered hits bounce without spin, and impulses lose energy', () => {
  const body = { ...vehicleDimensions, heading: 0 };
  const inertia = (body.width ** 2 + body.length ** 2) / 12;
  for (const offset of [-0.7, 0, 0.7]) {
    const velocity = { x: 0, y: 0, z: -20 };
    const result = resolveVehicleImpact({ x: 0, y: 0, z: 2 }, velocity, 0, body, {
      colliderId: 'post', point: { x: offset, y: .4, z: .1 }, normal: { x: 0, y: 0, z: 1 },
    }, .1);
    assert.equal(Math.sign(result.yawSpeed), offset === 0 ? 0 : -Math.sign(offset));
    assert.ok(velocity.z ** 2 + inertia * result.yawSpeed ** 2 <= 20 ** 2);
    if (offset === 0) assert.ok(Math.abs(velocity.z - 2) < 1e-10);
    else assert.ok(Math.abs(result.yawSpeed) > 5);
    const contactSpeed = velocity.z - offset * result.yawSpeed;
    assert.ok(contactSpeed > 0); // The struck point is separating from the solid.
  }
});

test('hitting a finish post starts a sustained spin and slide that settles with grip', () => {
  const track: TrackLayout = [[1, 1, 1], [1, 2, 1], [1, 1, 1]];
  const world = createTrackCollisionWorld(track, 12);
  const start = getTrackSpawn(track, 12);
  const state = createVehicleState();
  state.position = { x: 4.8, y: 0, z: 3 };
  state.speed = 18;
  for (let tick = 0; tick < 15 && state.crashTime === 0; tick++) stepVehicleInWorld(state, idle, FIXED_TIMESTEP, world, start);
  assert.ok(Math.abs(state.yawSpeed) > 2);
  assert.ok(state.crashTime > 0);
  const impacted = { ...state.position };
  for (let tick = 0; tick < 60; tick++) {
    stepVehicleInWorld(state, idle, FIXED_TIMESTEP, world, start);
    assert.equal(world.getBodyPenetration(state.position, { ...vehicleDimensions, heading: state.heading }), null);
  }
  assert.ok(Math.abs(state.heading) > .4);
  assert.ok(Math.abs(state.lateralSpeed) > .05);
  assert.ok(Math.hypot(state.position.x - impacted.x, state.position.z - impacted.z) > .5);
  for (let tick = 0; tick < 600; tick++) stepVehicleInWorld(state, idle, FIXED_TIMESTEP, world, start);
  assert.equal(state.yawSpeed, 0);
  assert.equal(state.lateralSpeed, 0);
  assert.equal(state.crashTime, 0);
  state.yawSpeed = 4;
  state.crashTime = 1;
  respawnVehicle(state, start);
  assert.equal(state.yawSpeed, 0);
  assert.equal(state.crashTime, 0);
});

test('airborne spin preserves world momentum while the heading changes', () => {
  const state = createVehicleState();
  state.grounded = false;
  state.speed = 10;
  state.yawSpeed = 3;
  const world = createCollisionWorld([]);
  for (let tick = 0; tick < 30; tick++) stepVehicleInWorld(state, idle, FIXED_TIMESTEP, world, spawn);
  assert.ok(Math.abs(state.heading) > .6);
  assert.ok(Math.abs(state.position.x) < 1e-10);
  assert.ok(Math.abs(state.position.z + 2.5) < 1e-10);
  assert.ok(Math.abs(Math.hypot(state.speed, state.lateralSpeed) - 10) < 1e-10);
});

test('occupied tiles support the car, while holes and space outside the array do not', () => {
  const world = createTrackCollisionWorld([[1, 0, 2]], 12);
  assert.equal(world.findGround({ x: 0, y: 0, z: 0 }, 0.25, 0.25), null);
  assert.equal(world.findGround({ x: 30, y: 0, z: 0 }, 0.25, 0.25), null);
  assert.equal(world.findGround({ x: -12, y: 0, z: 0 }, 0.25, 0.25)?.point.y, 0);
  assert.equal(world.findGround({ x: 12, y: 0, z: 0 }, 0.25, 0.25)?.point.y, 0);
});

test('crossing adjacent tile seams keeps uninterrupted ground contact', () => {
  const world = createTrackCollisionWorld([[1, 1]], 12);
  const state = createVehicleState();
  state.position.x = -1;
  state.heading = -Math.PI / 2;
  state.speed = 4;
  for (let tick = 0; tick < 120; tick++) {
    assert.equal(stepVehicleInWorld(state, idle, FIXED_TIMESTEP, world, spawn), false);
    assert.equal(state.grounded, true);
    assert.equal(state.position.y, 0);
    assert.equal(state.airborneTime, 0);
  }
  assert.ok(state.position.x > 0);
});

test('moving fully past a track edge begins falling instead of catching the tile behind', () => {
  const world = createTrackCollisionWorld(layout, 12);
  const state = createVehicleState();
  state.position.z = -6 - vehicleDimensions.length / 2 + 0.1;
  state.speed = 32;
  stepVehicleInWorld(state, forward, FIXED_TIMESTEP, world, spawn);
  assert.ok(state.position.z < -6 - vehicleDimensions.length / 2);
  assert.equal(state.grounded, false);
  assert.ok(state.position.y < 0);
  assert.ok(state.verticalSpeed < 0);
  assert.equal(state.airborneTime, FIXED_TIMESTEP);
});

test('airborne motion preserves momentum, ignores pedals and steering, and follows gravity', () => {
  const world = createCollisionWorld([]);
  const state = createVehicleState();
  state.grounded = false;
  state.speed = 12;
  state.heading = 0.3;
  for (let tick = 0; tick < 60; tick++) {
    stepVehicleInWorld(state, { throttle: -1, steering: 1, brake: true }, FIXED_TIMESTEP, world, spawn);
  }
  assert.equal(state.speed, 12);
  assert.equal(state.heading, 0.3);
  assert.ok(Math.abs(Math.hypot(state.position.x, state.position.z) - 6) < 1e-10);
  assert.ok(Math.abs(state.position.y + physicsParameters.gravity * 0.5 * 0.5 / 2) < 1e-10);
  assert.ok(Math.abs(state.verticalSpeed + physicsParameters.gravity * 0.5) < 1e-10);
});

test('one second airborne respawns at the start and resets all motion and falling state', () => {
  const world = createTrackCollisionWorld(layout, 12);
  const state = createVehicleState();
  state.position.x = 20;
  state.grounded = false;
  state.speed = 9;
  state.heading = 0.4;
  state.steeringAngle = 0.2;
  for (let tick = 0; tick < 119; tick++) {
    assert.equal(stepVehicleInWorld(state, forward, FIXED_TIMESTEP, world, spawn), false);
  }
  assert.ok(state.position.y < -4);
  assert.equal(stepVehicleInWorld(state, forward, FIXED_TIMESTEP, world, spawn), true);
  const expected = createVehicleState();
  respawnVehicle(expected, spawn);
  assert.deepEqual(state, expected);
  stepVehicleInWorld(state, forward, FIXED_TIMESTEP, world, spawn);
  assert.ok(state.speed > 0);
});

test('respawn delay and gravity are configurable independently of driving', () => {
  const state = createVehicleState();
  state.grounded = false;
  const world = createCollisionWorld([]);
  const tuning = { ...physicsParameters, gravity: 4, respawnDelay: 2 };
  for (let tick = 0; tick < 120; tick++) {
    assert.equal(stepVehicleInWorld(state, idle, FIXED_TIMESTEP, world, spawn, tuning), false);
  }
  assert.ok(Math.abs(state.position.y + 2) < 1e-10);
});

test('a swept landing catches a floor even when a step would move through it', () => {
  const world = createCollisionWorld([floor()]);
  const state = createVehicleState();
  state.position.y = 5;
  state.verticalSpeed = -100;
  state.grounded = false;
  assert.equal(stepVehicleInWorld(state, idle, 0.1, world, spawn), false);
  assert.equal(state.position.y, 0);
  assert.equal(state.verticalSpeed, 0);
  assert.equal(state.grounded, true);
  assert.equal(state.airborneTime, 0);
});

test('sweeps choose the first surface and never lift a car from beneath a floor', () => {
  const world = createCollisionWorld([floor(), floor(3)]);
  const landing = world.sweepGround({ x: 0, y: 5, z: 0 }, { x: 0, y: -5, z: 0 });
  assert.equal(landing?.point.y, 3);
  assert.equal(world.sweepGround({ x: 0, y: -0.1, z: 0 }, { x: 0, y: -1, z: 0 }), null);
});

test('landing on a lower platform before the timeout cancels the respawn timer', () => {
  const world = createCollisionWorld([floor(-2)]);
  const state = createVehicleState();
  state.grounded = false;
  for (let tick = 0; tick < 180; tick++) {
    assert.equal(stepVehicleInWorld(state, idle, FIXED_TIMESTEP, world, spawn), false);
  }
  assert.equal(state.position.y, -2);
  assert.equal(state.grounded, true);
  assert.equal(state.airborneTime, 0);
});

test('surface queries provide height and normalized contact normals for inclined ground', () => {
  const world = createCollisionWorld([{ ...floor(), normal: { x: -0.5, y: 1, z: 0 } }]);
  const contact = world.findGround({ x: 2, y: 1.1, z: 0 }, 0.25, 0.25);
  assert.equal(contact?.point.y, 1);
  assert.ok(Math.abs(Math.hypot(contact!.normal.x, contact!.normal.y, contact!.normal.z) - 1) < 1e-10);
  const state = createVehicleState();
  state.heading = -Math.PI / 2;
  state.position.y = vehicleDimensions.length / 2 * 0.5;
  state.speed = 4;
  for (let tick = 0; tick < 60; tick++) {
    stepVehicleInWorld(state, idle, FIXED_TIMESTEP, world, spawn);
    assert.equal(state.grounded, true);
    assert.ok(Math.abs(state.position.y - (state.position.x + vehicleDimensions.length / 2) * 0.5) < 1e-10);
  }
});

test('a rotated body with less than half supported tips off a corner and respawns', () => {
  const world = createTrackCollisionWorld(layout, 12);
  const state = createVehicleState();
  state.position.x = 6.8;
  state.position.z = 6.8;
  state.heading = Math.PI / 4;
  for (let tick = 0; tick < 20; tick++) stepVehicleInWorld(state, idle, FIXED_TIMESTEP, world, spawn);
  assert.equal(state.grounded, false);
  assert.equal(state.tipping, true);
  assert.ok(Math.abs(state.pitch) + Math.abs(state.roll) > 0.05);
  for (let tick = 20; tick < 120; tick++) stepVehicleInWorld(state, idle, FIXED_TIMESTEP, world, spawn);
  assert.equal(state.grounded, true);
  assert.equal(state.position.y, 0);
  assert.equal(state.airborneTime, 0);
});

test('a rotated bounding box alone does not falsely support an entirely off-track car', () => {
  const world = createTrackCollisionWorld(layout, 12);
  const state = createVehicleState();
  state.position.x = 7.4;
  state.position.z = 7.4;
  state.heading = Math.PI / 4;
  stepVehicleInWorld(state, idle, FIXED_TIMESTEP, world, spawn);
  assert.equal(state.grounded, false);
  assert.ok(state.position.y < 0);
});

test('front and rear overhangs tip when over half their footprint is off a tile', () => {
  const world = createTrackCollisionWorld(layout, 12);
  for (const z of [-7, 7]) {
    const state = createVehicleState();
    state.position.z = z;
    stepVehicleInWorld(state, idle, FIXED_TIMESTEP, world, spawn);
    assert.equal(state.grounded, false);
    assert.equal(state.tipping, true);
    assert.ok(Math.abs(state.pitch) > 0);
  }
});

test('swept footprint landing preserves the car center when only a side overlaps the platform', () => {
  const world = createTrackCollisionWorld([[1]], 12);
  const state = createVehicleState();
  state.position.x = 6.7;
  state.position.y = 2;
  state.verticalSpeed = -30;
  state.grounded = false;
  stepVehicleInWorld(state, idle, 0.1, world, spawn);
  assert.equal(state.grounded, false);
  assert.equal(state.tipping, true);
  assert.equal(state.position.y, 0);
  assert.equal(state.position.x, 6.7);
});

test('half or more supported stays grounded, less than half tips toward the unsupported side', () => {
  const world = createTrackCollisionWorld([[1]], 12);
  for (const x of [5.99, 6]) {
    const state = createVehicleState();
    state.position.x = x;
    stepVehicleInWorld(state, idle, FIXED_TIMESTEP, world, spawn);
    assert.equal(state.grounded, true);
    assert.ok(state.supportFraction >= 0.5 - 1e-8);
  }
  const state = createVehicleState();
  state.position.x = 6.01;
  for (let tick = 0; tick < 30; tick++) stepVehicleInWorld(state, idle, FIXED_TIMESTEP, world, spawn);
  assert.equal(state.grounded, false);
  assert.ok(state.roll < -0.2);
});

test('support combines adjacent tiles and matches the rotated footprint area', () => {
  const world = createTrackCollisionWorld([[1, 1]], 12);
  const body = { ...vehicleDimensions, heading: Math.PI / 4 };
  const support = world.getGroundSupport({ x: 0, y: 0, z: 0 }, .25, .25, body);
  assert.ok(Math.abs(support.fraction - 1) < 1e-10);
  assert.ok(Math.abs(support.centroid!.x) < 1e-10);
});

test('a falling footprint lands on the high point of an inclined surface without clipping into it', () => {
  const world = createCollisionWorld([{ ...floor(), normal: { x: -0.5, y: 1, z: 0 } }]);
  const state = createVehicleState();
  state.position.y = 5;
  state.verticalSpeed = -100;
  state.grounded = false;
  stepVehicleInWorld(state, idle, 0.1, world, spawn);
  assert.equal(state.grounded, true);
  assert.ok(Math.abs(state.position.y - vehicleDimensions.width / 2 * 0.5) < 1e-10);
});

test('live driving parameters are used by the world simulation without changing the defaults', () => {
  const world = createCollisionWorld([floor()]);
  const state = createVehicleState();
  const tuning = { ...drivingParameters, acceleration: 20, maxSpeed: 3 };
  for (let tick = 0; tick < 60; tick++) {
    stepVehicleInWorld(state, forward, FIXED_TIMESTEP, world, spawn, physicsParameters, tuning);
  }
  assert.equal(state.speed, 3);
  assert.equal(drivingParameters.maxSpeed, 70.5);
  assert.equal(drivingParameters.acceleration, 40);
});

test('falling and repeated respawns are identical at 30, 60, and 144 rendering FPS', () => {
  const world = createTrackCollisionWorld(layout, 12);
  const results = [30, 60, 144].map((fps) => {
    const state = createVehicleState();
    respawnVehicle(state, spawn);
    const clock = new FixedStepClock();
    let respawns = 0;
    for (let frame = 0; frame < fps * 10; frame++) {
      clock.advance(1 / fps, (dt) => {
        if (stepVehicleInWorld(state, forward, dt, world, spawn)) respawns++;
      });
    }
    assert.ok(respawns > 1);
    return { state, respawns };
  });
  for (const result of results) assert.deepEqual(result, results[0]);
});

test('a long rendering pause cannot advance gravity or the respawn timer', () => {
  const world = createCollisionWorld([]);
  const state = createVehicleState();
  state.grounded = false;
  state.airborneTime = 0.5;
  const before = structuredClone(state);
  const clock = new FixedStepClock();
  clock.advance(30, (dt) => stepVehicleInWorld(state, idle, dt, world, spawn));
  assert.deepEqual(state, before);
});
