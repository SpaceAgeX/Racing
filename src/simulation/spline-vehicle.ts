import type { SurfaceContact, Vector3Data } from './collision.ts';
import { drivingParameters, physicsParameters, vehicleDimensions } from './parameters.ts';
import type { DrivingControls, DrivingParameters, PhysicsParameters, VehicleSpawn, VehicleState } from './types.ts';
import { copyVehicleState, createVehicleState, stepVehicle } from './vehicle.ts';
import { moveVehicleBody } from './body-motion.ts';
import { resolveVehicleImpact } from './impact.ts';
import { wrapAngle } from './math.ts';
import type { createRoadWorld } from './road-world.ts';

export function respawnVehicle(state: VehicleState, spawn: Readonly<VehicleSpawn>): void {
  copyVehicleState(createVehicleState(), state);
  Object.assign(state.position, spawn.position);
  state.heading = spawn.heading;
}

/**
 * Fixed-step movement, ground contact, gravity, and respawning, using only plain data.
 * Returns true on respawn so rendering can discard interpolation across the teleport.
 * Spline road surfaces support and orient the body; exposed mesh faces handle crashes and falling.
 */
export function stepSplineVehicle(
  state: VehicleState,
  controls: Readonly<DrivingControls>,
  timestep: number,
  world: ReturnType<typeof createRoadWorld>,
  spawn: Readonly<VehicleSpawn>,
  parameters: Readonly<PhysicsParameters> = physicsParameters,
  driving: Readonly<DrivingParameters> = drivingParameters,
  // Network clients wait for a server transition before teleporting.
  allowRespawn = true,
): boolean {
  if (!Number.isFinite(timestep) || timestep <= 0) return false;

  world.setDriving(state.grounded);
  function align(normal: Vector3Data): void {
    const c = Math.cos(state.heading),
      s = Math.sin(state.heading);
    const nx = c * normal.x - s * normal.z,
      nz = s * normal.x + c * normal.z;
    state.pitch = Math.atan2(nz, normal.y);
    state.roll = Math.atan2(-nx, Math.hypot(normal.y, nz));
    state.pitchSpeed = state.rollSpeed = 0;
  }
  if (state.grounded) {
    const ground = world.getGroundSupport(state.position, 1, 1, { ...vehicleDimensions, heading: state.heading });
    if (ground.contact) align(ground.contact.normal);
  }
  const body = { ...vehicleDimensions, heading: state.heading, pitch: state.pitch, roll: state.roll };
  let justLeftGround = false;
  const recovering = state.crashTime > 0 || Math.abs(state.yawSpeed) > 0.03;
  state.crashTime = Math.max(0, state.crashTime - timestep);

  function velocity() {
    const c = Math.cos(state.heading);
    const s = Math.sin(state.heading);
    return {
      x: -s * state.speed + c * state.lateralSpeed,
      y: state.verticalSpeed,
      z: -c * state.speed - s * state.lateralSpeed,
    };
  }

  function applyVelocity(value: { x: number; y: number; z: number }): void {
    const c = Math.cos(state.heading);
    const s = Math.sin(state.heading);
    state.speed = -s * value.x - c * value.z;
    state.lateralSpeed = c * value.x - s * value.z;
    state.verticalSpeed = value.y;
  }

  function impact(contact: SurfaceContact, position: Readonly<Vector3Data>, currentVelocity: Vector3Data): void {
    const result = resolveVehicleImpact(
      position,
      currentVelocity,
      state.yawSpeed,
      body,
      contact,
      parameters.collisionRestitution,
    );
    state.yawSpeed = result.yawSpeed;
    if (result.impactSpeed > 0.5) state.crashTime = parameters.crashRecoveryTime;
  }

  function rotateFromImpact(): void {
    if (state.yawSpeed === 0) return;
    const oldYawSpeed = state.yawSpeed;
    state.yawSpeed *= Math.exp(-parameters.spinDamping * (state.grounded ? 1 : 0.1) * timestep);
    state.heading = wrapAngle(state.heading + (oldYawSpeed + state.yawSpeed) * 0.5 * timestep);
    body.heading = state.heading;
  }

  if (state.grounded) {
    const from = { ...state.position };
    const momentum = velocity();
    const oldSpeed = state.speed;
    if (!recovering) {
      state.lateralSpeed = 0;
      state.yawSpeed = 0;
    }
    // A spinning car may face backward while still carrying forward world momentum.
    // Speed caps constrain pedal acceleration without abruptly deleting that momentum.
    const speedLimits = recovering
      ? {
          ...driving,
          maxSpeed: Math.max(driving.maxSpeed, oldSpeed),
          maxReverseSpeed: Math.max(driving.maxReverseSpeed, -oldSpeed),
        }
      : driving;
    stepVehicle(state, controls, timestep, speedLimits);
    body.heading = state.heading;
    let movement = { x: state.position.x - from.x, y: 0, z: state.position.z - from.z };
    if (recovering) {
      // Turning the crashed car does not instantly turn its existing world momentum.
      const acceleration = state.speed - oldSpeed;
      momentum.x -= Math.sin(state.heading) * acceleration;
      momentum.z -= Math.cos(state.heading) * acceleration;
      rotateFromImpact();
      applyVelocity(momentum);
      state.lateralSpeed *= Math.exp(-parameters.crashGrip * timestep);
      const current = velocity();
      movement = { x: current.x * timestep, y: 0, z: current.z * timestep };
    }
    // Signed speed is meters along the road, not horizontal meters on a slope.
    const ground = world.getGroundSupport(from, 1, 1, body);
    if (ground.contact) {
      const n = ground.contact.normal;
      const dy = -(n.x * movement.x + n.z * movement.z) / Math.max(0.05, n.y);
      const horizontal = Math.hypot(movement.x, movement.z);
      const factor = horizontal / Math.max(1e-10, Math.hypot(horizontal, dy));
      movement.x *= factor;
      movement.z *= factor;
      movement.y = dy * factor;
      state.verticalSpeed = movement.y / timestep;
    }
    Object.assign(state.position, from);
    const currentVelocity = velocity();
    moveVehicleBody(state.position, movement, currentVelocity, body, world, false, impact);
    applyVelocity(currentVelocity);
    const support = world.getGroundSupport(
      state.position,
      Math.max(0.6, parameters.groundSnapDistance),
      Math.max(0.6, parameters.groundSnapDistance),
      body,
    );
    state.supportFraction = support.fraction;
    if (support.contact && support.fraction >= 0.5 - 1e-8) {
      state.position.y = support.contact.point.y;
      align(support.contact.normal);
      state.airborneTime = 0;
      return false;
    }

    state.grounded = false;
    state.tipping = support.fraction > 0;
    justLeftGround = true;
  }

  world.setDriving(false);
  if (!justLeftGround) {
    const momentum = velocity();
    rotateFromImpact();
    applyVelocity(momentum);
  }

  if (state.tipping) {
    const support = world.getGroundSupport(state.position, 0.5, 1, body);
    state.supportFraction = support.fraction;
    if (support.centroid) {
      const dx = state.position.x - support.centroid.x;
      const dz = state.position.z - support.centroid.z;
      const c = Math.cos(state.heading),
        s = Math.sin(state.heading);
      const pitchInertia = (vehicleDimensions.length ** 2 + vehicleDimensions.height ** 2) / 12;
      const rollInertia = (vehicleDimensions.width ** 2 + vehicleDimensions.height ** 2) / 12;
      state.pitchSpeed += ((parameters.gravity * (s * dx + c * dz)) / pitchInertia) * timestep;
      state.rollSpeed -= ((parameters.gravity * (c * dx - s * dz)) / rollInertia) * timestep;
    }
    state.pitchSpeed = Math.max(-6, Math.min(6, state.pitchSpeed));
    state.rollSpeed = Math.max(-6, Math.min(6, state.rollSpeed));
    state.pitch += state.pitchSpeed * timestep;
    state.roll += state.rollSpeed * timestep;
    body.pitch = state.pitch;
    body.roll = state.roll;
  }

  // After leaving support, horizontal travel has already been performed this step.
  const oldVerticalSpeed = state.verticalSpeed;
  state.verticalSpeed -= parameters.gravity * timestep;
  const airborneVelocity = velocity();
  const movement = {
    x: justLeftGround ? 0 : airborneVelocity.x * timestep,
    y: (oldVerticalSpeed + state.verticalSpeed) * 0.5 * timestep,
    z: justLeftGround ? 0 : airborneVelocity.z * timestep,
  };
  const landed = moveVehicleBody(state.position, movement, airborneVelocity, body, world, true, impact);
  applyVelocity(airborneVelocity);
  state.airborneTime += timestep;

  const support = world.getGroundSupport(
    state.position,
    parameters.groundSnapDistance,
    parameters.groundSnapDistance,
    body,
  );
  state.supportFraction = support.fraction;
  if (landed && support.fraction > 0 && support.fraction < 0.5 - 1e-8) state.tipping = true;
  if (
    landed &&
    support.contact &&
    support.fraction >= 0.5 - 1e-8 &&
    Math.abs(state.pitch) + Math.abs(state.roll) < 1.4
  ) {
    state.position.y = support.contact.point.y;
    align(support.contact.normal);
    state.tipping = false;
    state.verticalSpeed = 0;
    state.grounded = true;
    state.airborneTime = 0;
    return false;
  }

  if (allowRespawn && state.airborneTime + 1e-10 >= parameters.respawnDelay) {
    respawnVehicle(state, spawn);
    body.heading = state.heading;
    body.pitch = state.pitch;
    body.roll = state.roll;
    world.setDriving(true);
    state.grounded =
      world.findGround(state.position, parameters.groundSnapDistance, parameters.groundSnapDistance, body) !== null;
    return true;
  }
  return false;
}
