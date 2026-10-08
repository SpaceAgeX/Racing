import { bodyAxes } from './box.ts';
import type { VehicleBody } from './box.ts';
import type { SurfaceContact, Vector3Data } from './collision.ts';

/**
 * Unit-mass impulse against a static solid. Contact offset and box inertia
 * transfer motion into yaw; centered impacts produce no artificial spin.
 * World velocity is mutable; the returned yaw speed is independent of rendering.
 */
export function resolveVehicleImpact(
  position: Readonly<Vector3Data>,
  velocity: Vector3Data,
  yawSpeed: number,
  body: Readonly<VehicleBody>,
  contact: Readonly<SurfaceContact>,
  restitution: number,
): { yawSpeed: number; impactSpeed: number } {
  const normal = contact.normal;
  // Floor/roof contacts retain the existing non-bouncing support response.
  if (Math.abs(normal.y) > 0.5) {
    const incoming = velocity.x * normal.x + velocity.y * normal.y + velocity.z * normal.z;
    if (incoming < 0) {
      velocity.x -= incoming * normal.x;
      velocity.y -= incoming * normal.y;
      velocity.z -= incoming * normal.z;
    }
    return { yawSpeed, impactSpeed: 0 };
  }
  const up = bodyAxes(body)[1]!;
  const rx = contact.point.x - (position.x + up.x * body.height / 2);
  const rz = contact.point.z - (position.z + up.z * body.height / 2);
  const lever = rz * normal.x - rx * normal.z;
  const inertia = (body.width ** 2 + body.length ** 2) / 12;
  const incoming = velocity.x * normal.x + velocity.y * normal.y + velocity.z * normal.z + yawSpeed * lever;
  if (incoming >= 0) return { yawSpeed, impactSpeed: 0 };
  const impulse = -(1 + restitution) * incoming / (1 + lever * lever / inertia);
  velocity.x += impulse * normal.x;
  velocity.y += impulse * normal.y;
  velocity.z += impulse * normal.z;
  return { yawSpeed: yawSpeed + lever * impulse / inertia, impactSpeed: -incoming };
}
