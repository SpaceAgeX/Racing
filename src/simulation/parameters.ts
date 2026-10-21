import type { DrivingParameters, PhysicsParameters } from './types.ts';

/** Shared by the visible prism and its collision footprint. */
export const vehicleDimensions = Object.freeze({ width: 1.8, height: 0.8, length: 3.8 });

/** All driving tuning lives here. Distances in m, speeds in m/s, angles in radians. */
export const drivingParameters: Readonly<DrivingParameters> = Object.freeze({
  acceleration: 40,              // m/s²
  reverseAcceleration: 25,       // m/s²
  braking: 55.5,                // m/s²
  maxSpeed: 70.5,                // 253.8 km/h
  maxReverseSpeed: 30,          // 108 km/h
  rollingDrag: 0.7,             // m/s²
  linearDrag: 0.12,             // 1/s
  quadraticDrag: 0.0015,        // 1/m
  wheelbase: 2.6,               // m
  maxSteeringAngle: 0.55,       // rad at rest / low speed
  highSpeedSteeringAngle: 0.07, // rad at steeringLimitSpeed
  steeringLimitSpeed: 30,       // m/s
  steeringSpeed: 1.8,           // rad/s while steering
  steeringReturnSpeed: 2.5,     // rad/s when released
});

/** Ground contact, falling, and collision recovery; meters, seconds, and radians. */
export const physicsParameters: Readonly<PhysicsParameters> = Object.freeze({
  gravity: 9.81,              // m/s² downward
  respawnDelay: 1,            // seconds continuously airborne
  groundSnapDistance: 0.25,   // m for following nearby ground heights
  collisionRestitution: 0.1,  // fraction of contact speed retained as bounce
  spinDamping: 2.2,           // 1/s; rotation settles gradually on the ground
  crashGrip: 2.5,             // 1/s; lateral velocity settles after a crash
  crashRecoveryTime: 1.4,     // seconds before normal arcade grip returns
});
