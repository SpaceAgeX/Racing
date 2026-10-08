import type { VehicleBody } from './box.ts';
import type { CollisionWorld, SurfaceContact, Vector3Data } from './collision.ts';

const CONTACT_SKIN = 1e-6;
const MAX_CONTACTS = 8;

/** Remove only motion into a face, retaining tangential motion instead of bouncing. */
function slide(vector: Vector3Data, normal: Vector3Data): void {
  const incoming = vector.x * normal.x + vector.y * normal.y + vector.z * normal.z;
  if (incoming >= 0) return;
  vector.x -= incoming * normal.x;
  vector.y -= incoming * normal.y;
  vector.z -= incoming * normal.z;
}

/** Move a full box through the world, resolving successive faces at an inside corner. */
export function moveVehicleBody(
  position: Vector3Data,
  movement: Vector3Data,
  velocity: Vector3Data,
  body: Readonly<VehicleBody>,
  world: CollisionWorld,
  includeGround: boolean,
  onImpact?: (contact: SurfaceContact, position: Readonly<Vector3Data>, velocity: Vector3Data) => void,
): boolean {
  let landed = false;
  for (let iteration = 0; iteration < MAX_CONTACTS; iteration++) {
    const overlap = world.getBodyPenetration(position, body);
    if (!overlap) break;
    position.x += overlap.normal.x * (overlap.depth + CONTACT_SKIN);
    position.y += overlap.normal.y * (overlap.depth + CONTACT_SKIN);
    position.z += overlap.normal.z * (overlap.depth + CONTACT_SKIN);
    slide(movement, overlap.normal);
    if (onImpact) onImpact(overlap, position, velocity);
    else slide(velocity, overlap.normal);
    if (overlap.normal.y > 0.5) landed = true;
  }

  for (let iteration = 0; iteration < MAX_CONTACTS; iteration++) {
    if (Math.hypot(movement.x, movement.y, movement.z) < 1e-10) break;
    const target = { x: position.x + movement.x, y: position.y + movement.y, z: position.z + movement.z };
    const solid = world.sweepBody(position, target, body);
    const tilted = Math.abs(body.pitch ?? 0) + Math.abs(body.roll ?? 0) > 1e-8;
    const ground = includeGround && !tilted ? world.sweepGround(position, target, body) : null;
    const hit = ground && (!solid || ground.fraction < solid.fraction) ? ground : solid;
    if (!hit) {
      Object.assign(position, target);
      return landed;
    }

    position.x += movement.x * hit.fraction;
    position.y += movement.y * hit.fraction;
    position.z += movement.z * hit.fraction;
    if (hit.normal.y > 0.5) {
      landed = true;
      if (!tilted) position.y = hit.point.y;
    } else {
      position.x += hit.normal.x * CONTACT_SKIN;
      position.y += hit.normal.y * CONTACT_SKIN;
      position.z += hit.normal.z * CONTACT_SKIN;
    }
    movement.x *= 1 - hit.fraction;
    movement.y *= 1 - hit.fraction;
    movement.z *= 1 - hit.fraction;
    slide(movement, hit.normal);
    if (onImpact) onImpact(hit, position, velocity);
    else slide(velocity, hit.normal);
  }
  // If too many faces are encountered, discard unresolved travel rather than tunneling.
  return landed;
}
