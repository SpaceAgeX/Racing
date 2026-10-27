import { wrapAngle } from '../simulation/math.ts';
import { copyVehicleState } from '../simulation/vehicle.ts';
import type { VehicleState } from '../simulation/types.ts';

// A remote car is drawn at the estimated current server time, like the locally
// predicted car. Keep the prediction short: snapshots remain authoritative.
export const MAX_REMOTE_PREDICTION_MS = 200;

export function projectRemoteVehicle(
  source: Readonly<VehicleState>,
  elapsedMs: number,
  wheelbase: number,
  output: VehicleState,
): void {
  copyVehicleState(source, output);
  const seconds = Math.max(0, Math.min(MAX_REMOTE_PREDICTION_MS, elapsedMs)) / 1000;
  if (seconds === 0) return;

  // yawSpeed is crash spin. Normal steering yaw is derived from the front-wheel
  // angle; yawSpeed is zero during ordinary driving.
  const steeringYaw = wheelbase > 0 ? source.speed / wheelbase * Math.tan(source.steeringAngle) : 0;
  const yaw = steeringYaw + source.yawSpeed;
  const midpointHeading = source.heading + yaw * seconds * 0.5;
  const forward = source.speed * seconds;
  const sideways = source.lateralSpeed * seconds;
  output.position.x += -Math.sin(midpointHeading) * forward + Math.cos(midpointHeading) * sideways;
  output.position.z += -Math.cos(midpointHeading) * forward - Math.sin(midpointHeading) * sideways;
  output.position.y += source.verticalSpeed * seconds;
  output.heading = wrapAngle(source.heading + yaw * seconds);
}
