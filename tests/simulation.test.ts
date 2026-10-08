import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FixedStepClock, FIXED_TIMESTEP } from '../src/simulation/fixed-step.ts';
import { drivingParameters } from '../src/simulation/parameters.ts';
import { createVehicleState, interpolateVehicleState, stepVehicle } from '../src/simulation/vehicle.ts';
import type { DrivingControls, VehicleState } from '../src/simulation/types.ts';

const idle: DrivingControls = { throttle: 0, steering: 0, brake: false };
const forward: DrivingControls = { ...idle, throttle: 1 };
const reverse: DrivingControls = { ...idle, throttle: -1 };

function drive(state: VehicleState, controls: DrivingControls, seconds: number): void {
  for (let tick = 0; tick < Math.round(seconds / FIXED_TIMESTEP); tick++) {
    stepVehicle(state, controls, FIXED_TIMESTEP);
  }
}

test('forward acceleration is gradual and uses meters along local -Z', () => {
  const state = createVehicleState();
  stepVehicle(state, forward, FIXED_TIMESTEP);
  assert.ok(state.speed > 0 && state.speed < drivingParameters.acceleration * FIXED_TIMESTEP);
  drive(state, forward, 1);
  assert.ok(state.speed > drivingParameters.acceleration * .85 && state.speed < drivingParameters.acceleration);
  assert.ok(state.position.z < -4);
  assert.equal(state.position.x, 0);
  assert.equal(state.position.y, 0);
});

test('forward and reverse speed caps are respected under sustained throttle', () => {
  const state = createVehicleState();
  drive(state, forward, 20);
  assert.equal(state.speed, drivingParameters.maxSpeed);
  drive(state, reverse, 20);
  assert.equal(state.speed, -drivingParameters.maxReverseSpeed);
});

test('coasting slows both directions to zero without reversing their sign', () => {
  for (const speed of [15, -7]) {
    const state = createVehicleState();
    state.speed = speed;
    drive(state, idle, 0.5);
    assert.ok(Math.abs(state.speed) < Math.abs(speed));
    assert.equal(Math.sign(state.speed), Math.sign(speed));
    drive(state, idle, 30);
    assert.equal(state.speed, 0);
  }
});

test('S brakes forward travel to zero before accelerating backward', () => {
  const state = createVehicleState();
  state.speed = 0.05;
  stepVehicle(state, reverse, FIXED_TIMESTEP);
  assert.equal(state.speed, 0);
  assert.ok(state.position.z < 0);
  stepVehicle(state, reverse, FIXED_TIMESTEP);
  assert.ok(state.speed < 0);
});

test('W brakes reverse travel to zero before accelerating forward', () => {
  const state = createVehicleState();
  state.speed = -0.05;
  stepVehicle(state, forward, FIXED_TIMESTEP);
  assert.equal(state.speed, 0);
  stepVehicle(state, forward, FIXED_TIMESTEP);
  assert.ok(state.speed > 0);
});

test('both pedals brake to a stop and hold there', () => {
  const state = createVehicleState();
  state.speed = 12;
  drive(state, { ...idle, brake: true }, 2);
  assert.equal(state.speed, 0);
  drive(state, { ...idle, brake: true }, 2);
  assert.equal(state.speed, 0);
});

test('steering at rest changes wheel angle without turning or moving the car', () => {
  const state = createVehicleState();
  drive(state, { ...idle, steering: 1 }, 2);
  assert.equal(state.steeringAngle, drivingParameters.maxSteeringAngle);
  assert.equal(state.heading, 0);
  assert.deepEqual(state.position, { x: 0, y: 0, z: 0 });
});

test('A and D turn in opposite directions through forward movement', () => {
  for (const steering of [1, -1] as const) {
    const state = createVehicleState();
    drive(state, { ...forward, steering }, 1);
    assert.equal(Math.sign(state.heading), steering);
    assert.equal(Math.sign(state.position.x), -steering);
    assert.ok(state.position.z < 0);
  }
});

test('reverse speed reverses the heading response to the same steering input', () => {
  const state = createVehicleState();
  drive(state, { ...reverse, steering: 1 }, 1);
  assert.ok(state.heading < 0);
  assert.ok(state.position.z > 0);
});

test('steering returns to center at the configured rate', () => {
  const state = createVehicleState();
  state.steeringAngle = 0.5;
  stepVehicle(state, idle, FIXED_TIMESTEP);
  assert.ok(Math.abs(state.steeringAngle - (0.5 - drivingParameters.steeringReturnSpeed * FIXED_TIMESTEP)) < 1e-12);
  drive(state, idle, 0.3);
  assert.equal(state.steeringAngle, 0);
});

test('high-speed steering is limited and remains finite through repeated turns', () => {
  const state = createVehicleState();
  state.speed = drivingParameters.maxSpeed;
  drive(state, { ...forward, steering: 1 }, 20);
  assert.ok(Math.abs(state.steeringAngle - drivingParameters.highSpeedSteeringAngle) < 1e-12);
  assert.ok(Number.isFinite(state.position.x) && Number.isFinite(state.position.z));
  assert.ok(state.heading >= -Math.PI && state.heading < Math.PI);
});

test('configuration can be supplied independently of rendering or default tuning', () => {
  const state = createVehicleState();
  const tuning = { ...drivingParameters, acceleration: 4, rollingDrag: 0, linearDrag: 0, quadraticDrag: 0 };
  for (let tick = 0; tick < 120; tick++) stepVehicle(state, forward, FIXED_TIMESTEP, tuning);
  assert.ok(Math.abs(state.speed - 4) < 1e-10);
  assert.ok(Math.abs(state.position.z + 2) < 1e-10);
});

test('fixed-step simulation gives the same trajectory at 30, 60, 144, and 240 FPS', () => {
  const results = [30, 60, 144, 240].map((fps) => {
    const clock = new FixedStepClock();
    const state = createVehicleState();
    let steps = 0;
    for (let frame = 0; frame < fps * 10; frame++) {
      clock.advance(1 / fps, (dt) => {
        steps++;
        stepVehicle(state, { ...forward, steering: 1 }, dt);
      });
    }
    assert.equal(steps, 1200);
    return state;
  });
  for (const state of results) assert.deepEqual(state, results[0]);
});

test('accumulator carries sub-step time and caps catch-up work', () => {
  const clock = new FixedStepClock();
  let steps = 0;
  const step = (): void => { steps++; };
  const alpha = clock.advance(FIXED_TIMESTEP * 0.5, step);
  assert.equal(steps, 0);
  assert.equal(alpha, 0.5);
  clock.advance(FIXED_TIMESTEP * 0.5, step);
  assert.equal(steps, 1);
  clock.advance(0.2, step);
  assert.equal(steps, 13);
});

test('long frame pauses discard elapsed time without a movement jump', () => {
  const clock = new FixedStepClock();
  const state = createVehicleState();
  state.speed = 20;
  const before = structuredClone(state);
  assert.equal(clock.advance(30, (dt) => stepVehicle(state, forward, dt)), 0);
  assert.deepEqual(state, before);
  clock.advance(FIXED_TIMESTEP, (dt) => stepVehicle(state, idle, dt));
  assert.ok(Math.abs(state.position.z) < 0.2);
});

test('render interpolation follows the shortest angle across the heading boundary', () => {
  const previous = createVehicleState();
  const current = createVehicleState();
  const output = createVehicleState();
  previous.heading = Math.PI - 0.1;
  current.heading = -Math.PI + 0.1;
  current.position.z = -2;
  interpolateVehicleState(previous, current, 0.5, output);
  assert.ok(Math.abs(output.heading - Math.PI) < 1e-10);
  assert.equal(output.position.z, -1);
  assert.equal(current.position.z, -2);
});
