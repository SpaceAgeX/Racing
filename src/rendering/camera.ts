import { Euler, PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { wrapAngle } from '../simulation/math.ts';
import type { VehicleState } from '../simulation/types.ts';

export const cameraParameters = {
  distance: 6.8,
  height: 4.6,
  targetHeight: 0.25,
  firstPersonOffset: { x: 0, y: 1.08, z: -0.2 },
  firstPersonLookOffset: { x: 0, y: 0.78, z: -16 },
  positionSmoothing: 12,
  headingSmoothing: 10,
  targetSmoothing: 16,
} as const;

export function createFollowCamera(camera: PerspectiveCamera, initial: Readonly<VehicleState>) {
  const desiredPosition = new Vector3();
  const desiredTarget = new Vector3();
  const target = new Vector3();
  const vehicleRotation = new Euler(0, 0, 0, 'YXZ');
  const vehicleQuaternion = new Quaternion();
  const localOffset = new Vector3();
  const vehiclePosition = new Vector3();
  let heading = initial.heading;
  let mode: 'third-person' | 'first-person' = 'third-person';

  function calculateTargets(state: Readonly<VehicleState>): void {
    if (mode === 'first-person') {
      // Mount the camera to the car's stable chassis frame. Pitch and roll are
      // visual crash effects and must not move or tilt the driver's viewpoint.
      vehicleRotation.set(0, heading, 0, 'YXZ');
      vehicleQuaternion.setFromEuler(vehicleRotation);
      desiredPosition.set(
        cameraParameters.firstPersonOffset.x,
        cameraParameters.firstPersonOffset.y,
        cameraParameters.firstPersonOffset.z,
      ).applyQuaternion(vehicleQuaternion).add(vehiclePosition.set(state.position.x, state.position.y, state.position.z));
      localOffset.set(
        cameraParameters.firstPersonLookOffset.x,
        cameraParameters.firstPersonLookOffset.y,
        cameraParameters.firstPersonLookOffset.z,
      );
      desiredTarget.copy(localOffset).applyQuaternion(vehicleQuaternion).add(vehiclePosition);
      return;
    }
    desiredPosition.set(
      state.position.x + Math.sin(heading) * cameraParameters.distance,
      state.position.y + cameraParameters.height,
      state.position.z + Math.cos(heading) * cameraParameters.distance,
    );
    desiredTarget.set(state.position.x, state.position.y + cameraParameters.targetHeight, state.position.z);
  }

  function reset(state: Readonly<VehicleState>): void {
    heading = state.heading;
    calculateTargets(state);
    camera.position.copy(desiredPosition);
    target.copy(desiredTarget);
    camera.lookAt(target);
  }

  reset(initial);

  return {
    reset,
    toggleMode(): 'third-person' | 'first-person' {
      mode = mode === 'third-person' ? 'first-person' : 'third-person';
      return mode;
    },
    get mode(): 'third-person' | 'first-person' { return mode; },
    update(state: Readonly<VehicleState>, elapsed: number): void {
      const dt = Math.max(0, Math.min(elapsed, 0.1));
      if (mode === 'first-person') {
        // No positional damping in first person: smoothing makes the camera
        // visibly slide backward under acceleration instead of staying fixed.
        heading = state.heading;
        calculateTargets(state);
        camera.position.copy(desiredPosition);
        target.copy(desiredTarget);
        camera.lookAt(target);
        return;
      }
      // Exponential smoothing has the same response at different rendering rates.
      heading += wrapAngle(state.heading - heading)
        * (1 - Math.exp(-cameraParameters.headingSmoothing * dt));
      calculateTargets(state);
      camera.position.lerp(desiredPosition, 1 - Math.exp(-cameraParameters.positionSmoothing * dt));
      target.lerp(desiredTarget, 1 - Math.exp(-cameraParameters.targetSmoothing * dt));
      camera.lookAt(target);
    },
  };
}
