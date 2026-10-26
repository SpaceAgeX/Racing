/** Meters, seconds, radians; Y-up. Heading 0 faces -Z; positive heading turns left. */
export interface VehicleState {
  /** Bottom-center car origin. Y follows the supporting surface or free fall. */
  position: { x: number; y: number; z: number };
  heading: number;
  /** Collision-induced rotation about Y, in radians/second. Steering is separate. */
  yawSpeed: number;
  /** Seconds of reduced grip remaining after a crash. */
  crashTime: number;
  pitch: number;
  roll: number;
  pitchSpeed: number;
  rollSpeed: number;
  tipping: boolean;
  supportFraction: number;
  /** Signed longitudinal speed in m/s: positive forward, negative reverse. */
  speed: number;
  /** Signed speed along local +X, retained while sliding after a crash or airborne. */
  lateralSpeed: number;
  /** Virtual front-wheel angle in radians: positive left, negative right. */
  steeringAngle: number;
  verticalSpeed: number;
  grounded: boolean;
  airborneTime: number;
}

export interface VehicleSpawn {
  position: { x: number; y: number; z: number };
  heading: number;
}

export interface PhysicsParameters {
  /** Simulated seconds per real second; 1 is normal speed. */
  physicsTime: number;
  gravity: number;
  respawnDelay: number;
  groundSnapDistance: number;
  collisionRestitution: number;
  spinDamping: number;
  crashGrip: number;
  crashRecoveryTime: number;
}

export interface DrivingControls {
  throttle: -1 | 0 | 1;
  steering: -1 | 0 | 1;
  /** Both pedals held together apply the brakes. */
  brake: boolean;
}

export interface DrivingParameters {
  acceleration: number;
  reverseAcceleration: number;
  braking: number;
  maxSpeed: number;
  maxReverseSpeed: number;
  rollingDrag: number;
  linearDrag: number;
  quadraticDrag: number;
  wheelbase: number;
  maxSteeringAngle: number;
  highSpeedSteeringAngle: number;
  steeringLimitSpeed: number;
  steeringSpeed: number;
  steeringReturnSpeed: number;
}

export interface HandlingParameters {
  driving: DrivingParameters;
  physics: PhysicsParameters;
}
