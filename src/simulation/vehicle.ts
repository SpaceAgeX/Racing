import { drivingParameters } from './parameters.ts';
import { moveTowards, wrapAngle } from './math.ts';
import type { DrivingControls, DrivingParameters, VehicleState } from './types.ts';

export function createVehicleState(): VehicleState {
  return {
    position: { x: 0, y: 0, z: 0 },
    heading: 0,
    yawSpeed: 0,
    crashTime: 0,
    pitch: 0,
    roll: 0,
    pitchSpeed: 0,
    rollSpeed: 0,
    tipping: false,
    supportFraction: 1,
    speed: 0,
    lateralSpeed: 0,
    steeringAngle: 0,
    verticalSpeed: 0,
    grounded: true,
    airborneTime: 0,
  };
}

/**
 * Advances only plain data by one fixed timestep. No DOM, input devices, or Three.js.
 * A grippy kinematic bicycle model: yaw rate = speed / wheelbase * tan(steering).
 * Signed speed naturally reverses the turning direction when backing up.
 */
export function stepVehicle(
  state: VehicleState,
  controls: Readonly<DrivingControls>,
  timestep: number,
  parameters: Readonly<DrivingParameters> = drivingParameters,
): void {
  if (!Number.isFinite(timestep) || timestep <= 0) return;

  const oldSpeed = state.speed;
  const oldSteering = state.steeringAngle;
  const speedFraction = Math.min(Math.abs(oldSpeed) / parameters.steeringLimitSpeed, 1);
  const steeringLimit = parameters.maxSteeringAngle
    + (parameters.highSpeedSteeringAngle - parameters.maxSteeringAngle) * speedFraction;
  const steeringTarget = controls.steering * steeringLimit;
  const steeringRate = controls.steering === 0
    ? parameters.steeringReturnSpeed
    : parameters.steeringSpeed;

  state.steeringAngle = moveTowards(oldSteering, steeringTarget, steeringRate * timestep);
  state.steeringAngle = Math.max(-steeringLimit, Math.min(steeringLimit, state.steeringAngle));

  if (controls.brake || oldSpeed * controls.throttle < 0) {
    // Stop at zero; opposite acceleration begins on the following simulation tick.
    state.speed = moveTowards(oldSpeed, 0, parameters.braking * timestep);
  } else if (controls.throttle !== 0) {
    const acceleration = controls.throttle > 0
      ? parameters.acceleration
      : parameters.reverseAcceleration;
    state.speed += controls.throttle * acceleration * timestep;
  }

  const speedMagnitude = Math.abs(state.speed);
  const drag = parameters.rollingDrag
    + parameters.linearDrag * speedMagnitude
    + parameters.quadraticDrag * speedMagnitude * speedMagnitude;
  state.speed = moveTowards(state.speed, 0, drag * timestep);
  state.speed = Math.max(-parameters.maxReverseSpeed, Math.min(parameters.maxSpeed, state.speed));

  const averageSpeed = (oldSpeed + state.speed) * 0.5;
  const averageSteering = (oldSteering + state.steeringAngle) * 0.5;
  const headingChange = averageSpeed / parameters.wheelbase
    * Math.tan(averageSteering) * timestep;
  const midpointHeading = state.heading + headingChange * 0.5;

  // Local forward is -Z, transformed by a positive Y-axis rotation.
  state.position.x -= Math.sin(midpointHeading) * averageSpeed * timestep;
  state.position.z -= Math.cos(midpointHeading) * averageSpeed * timestep;
  state.heading = wrapAngle(state.heading + headingChange);
}

export function copyVehicleState(source: Readonly<VehicleState>, target: VehicleState): void {
  Object.assign(target.position, source.position);
  target.heading = source.heading;
  target.yawSpeed = source.yawSpeed;
  target.crashTime = source.crashTime;
  target.pitch = source.pitch;
  target.roll = source.roll;
  target.pitchSpeed = source.pitchSpeed;
  target.rollSpeed = source.rollSpeed;
  target.tipping = source.tipping;
  target.supportFraction = source.supportFraction;
  target.speed = source.speed;
  target.lateralSpeed = source.lateralSpeed;
  target.steeringAngle = source.steeringAngle;
  target.verticalSpeed = source.verticalSpeed;
  target.grounded = source.grounded;
  target.airborneTime = source.airborneTime;
}

/** Rendering interpolation only; the actual simulation state is never interpolated. */
export function interpolateVehicleState(
  previous: Readonly<VehicleState>,
  current: Readonly<VehicleState>,
  alpha: number,
  output: VehicleState,
): void {
  output.position.x = previous.position.x + (current.position.x - previous.position.x) * alpha;
  output.position.y = previous.position.y + (current.position.y - previous.position.y) * alpha;
  output.position.z = previous.position.z + (current.position.z - previous.position.z) * alpha;
  output.heading = previous.heading + wrapAngle(current.heading - previous.heading) * alpha;
  output.yawSpeed = current.yawSpeed;
  output.crashTime = current.crashTime;
  output.pitch = previous.pitch + (current.pitch - previous.pitch) * alpha;
  output.roll = previous.roll + (current.roll - previous.roll) * alpha;
  output.pitchSpeed = current.pitchSpeed;
  output.rollSpeed = current.rollSpeed;
  output.tipping = current.tipping;
  output.supportFraction = current.supportFraction;
  output.speed = previous.speed + (current.speed - previous.speed) * alpha;
  output.lateralSpeed = previous.lateralSpeed + (current.lateralSpeed - previous.lateralSpeed) * alpha;
  output.steeringAngle = previous.steeringAngle
    + (current.steeringAngle - previous.steeringAngle) * alpha;
  output.verticalSpeed = previous.verticalSpeed + (current.verticalSpeed - previous.verticalSpeed) * alpha;
  output.grounded = current.grounded;
  output.airborneTime = current.airborneTime;
}
