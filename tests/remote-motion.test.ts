import assert from 'node:assert/strict';
import test from 'node:test';
import { MAX_REMOTE_PREDICTION_MS, projectRemoteVehicle } from '../src/multiplayer/remote-motion.ts';
import { createVehicleState } from '../src/simulation/vehicle.ts';

test('remote car is projected to the current server time during straight driving', () => {
  const source = createVehicleState();
  const output = createVehicleState();
  source.speed = 60;
  projectRemoteVehicle(source, 100, 2.6, output);
  assert.equal(output.position.z, -6);
  assert.equal(source.position.z, 0);
});

test('remote projection follows the steering arc instead of continuing straight', () => {
  const source = createVehicleState();
  const output = createVehicleState();
  source.speed = 30;
  source.steeringAngle = 0.2;
  projectRemoteVehicle(source, 100, 2.6, output);
  assert.ok(output.position.x < -0.2);
  assert.ok(output.heading > 0);
  assert.ok(output.position.z < -2.9);
});

test('remote projection is bounded during a delayed snapshot', () => {
  const source = createVehicleState();
  const output = createVehicleState();
  source.speed = 40;
  projectRemoteVehicle(source, 2000, 2.6, output);
  assert.equal(output.position.z, -40 * MAX_REMOTE_PREDICTION_MS / 1000);
});
