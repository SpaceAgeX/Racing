import { PerspectiveCamera, Vector3 } from 'three';
import { wrapAngle } from '../simulation/math.ts';
import type { VehicleState } from '../simulation/types.ts';

export const cameraParameters = {
  distance: 6.8,
  height: 4.6,
  targetHeight: 0.25,
  positionSmoothing: 12,
  headingSmoothing: 10,
  targetSmoothing: 16,
} as const;

export function createFollowCamera(camera: PerspectiveCamera, initial: Readonly<VehicleState>) {
  const desiredPosition = new Vector3();
  const desiredTarget = new Vector3();
  const target = new Vector3();
  let heading = initial.heading;

  function calculateTargets(state: Readonly<VehicleState>): void {
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
    update(state: Readonly<VehicleState>, elapsed: number): void {
      const dt = Math.max(0, Math.min(elapsed, 0.1));
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
