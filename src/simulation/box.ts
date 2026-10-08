import type { SurfaceContact, SweptContact, Vector3Data } from './collision.ts';
import type { VehicleFootprint } from './footprint.ts';

/** Bottom-centered, Y-up vehicle box with heading, pitch, and roll (YXZ order). */
export interface VehicleBody extends VehicleFootprint {
  height: number;
  pitch?: number;
  roll?: number;
}

/** Solid static box, including its top, bottom, and four sides. */
export interface SolidBoxCollider {
  id: string;
  min: Vector3Data;
  max: Vector3Data;
}

export interface BodyPenetration extends SurfaceContact {
  depth: number;
}

const EPSILON = 1e-8;

function axes(body: Readonly<VehicleBody>): Vector3Data[] {
  const world = [{ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }];
  const local = bodyAxes(body);
  if (!body.pitch && !body.roll) return [...world, local[0]!, local[2]!];
  const result = [...world, ...local];
  for (const a of world) for (const b of local) {
    const cross = { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
    const length = Math.hypot(cross.x, cross.y, cross.z);
    if (length > EPSILON) result.push({ x: cross.x / length, y: cross.y / length, z: cross.z / length });
  }
  return result;
}

/** Matches the visual's YXZ rotation order, without importing Three.js. */
export function bodyAxes(body: Readonly<VehicleBody>): Vector3Data[] {
  const cy = Math.cos(body.heading), sy = Math.sin(body.heading);
  const cx = Math.cos(body.pitch ?? 0), sx = Math.sin(body.pitch ?? 0);
  const cz = Math.cos(body.roll ?? 0), sz = Math.sin(body.roll ?? 0);
  return [
    { x: cy * cz + sy * sx * sz, y: cx * sz, z: -sy * cz + cy * sx * sz },
    { x: -cy * sz + sy * sx * cz, y: cx * cz, z: sy * sz + cy * sx * cz },
    { x: sy * cx, y: -sx, z: cy * cx },
  ];
}

export function bodyBounds(position: Readonly<Vector3Data>, body: Readonly<VehicleBody>) {
  const [right, up, back] = bodyAxes(body);
  const center = { x: position.x + up!.x * body.height / 2, y: position.y + up!.y * body.height / 2, z: position.z + up!.z * body.height / 2 };
  const radius = (axis: 'x' | 'y' | 'z'): number => Math.abs(right![axis]) * body.width / 2 + Math.abs(up![axis]) * body.height / 2 + Math.abs(back![axis]) * body.length / 2;
  return { minX: center.x - radius('x'), maxX: center.x + radius('x'), minY: center.y - radius('y'), maxY: center.y + radius('y'), minZ: center.z - radius('z'), maxZ: center.z + radius('z') };
}

function dot(a: Readonly<Vector3Data>, b: Readonly<Vector3Data>): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function project(position: Readonly<Vector3Data>, body: Readonly<VehicleBody>, box: SolidBoxCollider, axis: Vector3Data) {
  const [right, up, back] = bodyAxes(body);
  const center = { x: position.x + up!.x * body.height / 2, y: position.y + up!.y * body.height / 2, z: position.z + up!.z * body.height / 2 };
  const bodyRadius = Math.abs(dot(axis, right!)) * body.width / 2
    + Math.abs(dot(axis, back!)) * body.length / 2 + Math.abs(dot(axis, up!)) * body.height / 2;
  const boxCenter = {
    x: (box.min.x + box.max.x) / 2,
    y: (box.min.y + box.max.y) / 2,
    z: (box.min.z + box.max.z) / 2,
  };
  const boxRadius = Math.abs(axis.x) * (box.max.x - box.min.x) / 2
    + Math.abs(axis.y) * (box.max.y - box.min.y) / 2
    + Math.abs(axis.z) * (box.max.z - box.min.z) / 2;
  const a = dot(center, axis);
  const b = dot(boxCenter, axis);
  return { aMin: a - bodyRadius, aMax: a + bodyRadius, bMin: b - boxRadius, bMax: b + boxRadius };
}

function pointOnBox(position: Readonly<Vector3Data>, body: Readonly<VehicleBody>, box: SolidBoxCollider): Vector3Data {
  return {
    x: Math.max(box.min.x, Math.min(box.max.x, position.x)),
    y: Math.max(box.min.y, Math.min(box.max.y, position.y + body.height / 2)),
    z: Math.max(box.min.z, Math.min(box.max.z, position.z)),
  };
}

/** Minimum translation out of an existing overlap, including overlap caused by rotation. */
export function bodyPenetration(position: Readonly<Vector3Data>, body: Readonly<VehicleBody>, box: SolidBoxCollider): BodyPenetration | null {
  let depth = Infinity;
  let normal: Vector3Data | null = null;
  for (const axis of axes(body)) {
    const { aMin, aMax, bMin, bMax } = project(position, body, box, axis);
    if (aMax <= bMin + EPSILON || aMin >= bMax - EPSILON) return null;
    const positive = bMax - aMin;
    const negative = aMax - bMin;
    const distance = Math.min(positive, negative);
    if (distance < depth) {
      depth = distance;
      const sign = positive < negative ? 1 : -1;
      normal = { x: axis.x * sign, y: axis.y * sign, z: axis.z * sign };
    }
  }
  return normal ? { colliderId: box.id, point: pointOnBox(position, body, box), normal, depth } : null;
}

/** Continuous SAT for the entire vehicle volume; contact normals point out of the solid. */
export function sweepBodyBox(
  from: Readonly<Vector3Data>,
  to: Readonly<Vector3Data>,
  body: Readonly<VehicleBody>,
  box: SolidBoxCollider,
): SweptContact | null {
  const movement = { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z };
  let enter = -Infinity;
  let exit = Infinity;
  let normal: Vector3Data | null = null;
  for (const axis of axes(body)) {
    const { aMin, aMax, bMin, bMax } = project(from, body, box, axis);
    const motion = dot(movement, axis);
    if (Math.abs(motion) < EPSILON) {
      // Sliding across a touching face does not enter the solid or snag a tile seam.
      if (aMax <= bMin + EPSILON || aMin >= bMax - EPSILON) return null;
      continue;
    }
    const first = (bMin - aMax) / motion;
    const last = (bMax - aMin) / motion;
    const entry = Math.min(first, last);
    if (entry > enter) {
      enter = entry;
      const sign = motion > 0 ? -1 : 1;
      normal = { x: axis.x * sign, y: axis.y * sign, z: axis.z * sign };
    }
    exit = Math.min(exit, Math.max(first, last));
    if (enter > exit + EPSILON) return null;
  }
  // Initial overlaps are handled by penetration recovery, not by guessing an impact face.
  if (!normal || enter < -EPSILON || exit < 0 || enter > 1 || dot(movement, normal) >= -EPSILON) return null;
  const fraction = Math.max(0, enter);
  const position = {
    x: from.x + movement.x * fraction,
    y: from.y + movement.y * fraction,
    z: from.z + movement.z * fraction,
  };
  return { colliderId: box.id, point: pointOnBox(position, body, box), normal, fraction };
}
