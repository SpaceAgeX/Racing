import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PerspectiveCamera, Vector3 } from 'three';
import { cameraParameters, createFollowCamera } from '../src/rendering/camera.ts';
import { createVehicleState } from '../src/simulation/vehicle.ts';

test('camera starts above and behind the car and looks toward its body', () => {
  const state = createVehicleState();
  const camera = new PerspectiveCamera();
  createFollowCamera(camera, state);
  assert.ok(camera.position.y > 0 && camera.position.z > 0);
  const expected = new Vector3(0, cameraParameters.targetHeight, 0).sub(camera.position).normalize();
  assert.ok(camera.getWorldDirection(new Vector3()).distanceTo(expected) < 1e-10);
});

test('position follows smoothly with equivalent response at different frame rates', () => {
  const positions = [30, 60, 144].map((fps) => {
    const state = createVehicleState();
    const camera = new PerspectiveCamera();
    const follow = createFollowCamera(camera, state);
    state.position.x = 20;
    follow.update(state, 1 / fps);
    assert.ok(camera.position.x > 0 && camera.position.x < 20);
    for (let frame = 1; frame < fps; frame++) follow.update(state, 1 / fps);
    assert.ok(Math.abs(camera.position.x - 20) < 0.001);
    return camera.position.clone();
  });
  for (const position of positions) assert.ok(position.distanceTo(positions[0]!) < 1e-10);
});

test('camera follows a changed heading and stays aimed at the car', () => {
  const state = createVehicleState();
  const camera = new PerspectiveCamera();
  const follow = createFollowCamera(camera, state);
  state.heading = Math.PI / 2;
  for (let frame = 0; frame < 180; frame++) follow.update(state, 1 / 60);
  assert.ok(camera.position.x > cameraParameters.distance - 0.01);
  assert.ok(Math.abs(camera.position.z) < 0.01);
  const projected = new Vector3(0, cameraParameters.targetHeight, 0).project(camera);
  assert.ok(Math.abs(projected.x) < 1e-8 && Math.abs(projected.y) < 1e-8);
});

test('camera takes the short turn across the -PI / PI boundary', () => {
  const state = createVehicleState();
  state.heading = Math.PI - 0.01;
  const camera = new PerspectiveCamera();
  const follow = createFollowCamera(camera, state);
  const before = camera.position.clone();
  state.heading = -Math.PI + 0.01;
  follow.update(state, 1 / 60);
  assert.ok(camera.position.distanceTo(before) < 0.01);
});

test('respawn resets camera position and target immediately instead of smoothing a teleport', () => {
  const state = createVehicleState();
  const camera = new PerspectiveCamera();
  const follow = createFollowCamera(camera, state);
  const initialPosition = camera.position.clone();
  state.position.x = 30;
  state.position.y = -5;
  state.heading = 1;
  for (let frame = 0; frame < 60; frame++) follow.update(state, 1 / 60);
  follow.reset(createVehicleState());
  assert.ok(camera.position.distanceTo(initialPosition) < 1e-10);
  const expected = new Vector3(0, cameraParameters.targetHeight, 0).sub(camera.position).normalize();
  assert.ok(camera.getWorldDirection(new Vector3()).distanceTo(expected) < 1e-10);
});

test('first-person camera stays centered and fixed to the car during acceleration and body tilt', () => {
  const state = createVehicleState();
  const camera = new PerspectiveCamera();
  const follow = createFollowCamera(camera, state);
  follow.toggleMode();
  follow.update(state, 1 / 60);
  const relativePosition = camera.position.clone().sub(new Vector3(state.position.x, state.position.y, state.position.z));
  assert.equal(relativePosition.x, 0);
  assert.equal(relativePosition.y, cameraParameters.firstPersonOffset.y);
  assert.equal(relativePosition.z, cameraParameters.firstPersonOffset.z);

  state.position.x = 12;
  state.position.z = -18;
  state.pitch = 0.6;
  state.roll = -0.4;
  follow.update(state, 1 / 60);
  const movedRelativePosition = camera.position.clone().sub(new Vector3(state.position.x, state.position.y, state.position.z));
  assert.ok(movedRelativePosition.distanceTo(relativePosition) < 1e-10);
  assert.ok(camera.getWorldDirection(new Vector3()).x === 0);
});
