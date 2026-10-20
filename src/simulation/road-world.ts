import type { CollisionWorld, Vector3Data as Vec, GroundSupport, SweptContact } from './collision.ts';
import { bodyAxes, bodyBounds, type VehicleBody, type BodyPenetration } from './box.ts';
import { footprintVertices, footprintArea, footprintCentroid } from './footprint.ts';
import { createSpatialGrid } from './spatial-grid.ts';
import type { RoadGeometry, RoadTriangle } from '../track/road-geometry.ts';

const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a: Vec, b: Vec) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: Vec, b: Vec): Vec => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
const unit = (a: Vec): Vec => {
  const n = Math.hypot(a.x, a.y, a.z) || 1;
  return { x: a.x / n, y: a.y / n, z: a.z / n };
};
const mul = (a: Vec, n: number): Vec => ({ x: a.x * n, y: a.y * n, z: a.z * n });

/** Triangle mesh collisions in plain meters. Static broad phase, continuous OBB/triangle SAT.
 * Only exposed road faces participate; there are no interior tile/triangle-prism walls. */
export function createRoadWorld(road: RoadGeometry) {
  const faces = road.triangles.map((t, id) => ({
    ...t,
    id: String(id),
    normal: unit(cross(sub(t.b, t.a), sub(t.c, t.a))),
    minX: Math.min(t.a.x, t.b.x, t.c.x),
    maxX: Math.max(t.a.x, t.b.x, t.c.x),
    minZ: Math.min(t.a.z, t.b.z, t.c.z),
    maxZ: Math.max(t.a.z, t.b.z, t.c.z),
    minY: Math.min(t.a.y, t.b.y, t.c.y),
    maxY: Math.max(t.a.y, t.b.y, t.c.y),
  }));
  type Face = (typeof faces)[number];
  // Small cells match the road tessellation and keep fixed-step queries local.
  const index = createSpatialGrid(faces, (t) => t, 8);
  let driving = false;
  function clip(points: Vec[], t: RoadTriangle): Vec[] {
    let result = points;
    const orientation = (t.b.x - t.a.x) * (t.c.z - t.a.z) - (t.b.z - t.a.z) * (t.c.x - t.a.x);
    const sign = Math.sign(orientation);
    for (const [a, b] of [
      [t.a, t.b],
      [t.b, t.c],
      [t.c, t.a],
    ] as [Vec, Vec][]) {
      const input = result;
      result = [];
      if (!input.length) break;
      const distance = (p: Vec) => sign * ((b.x - a.x) * (p.z - a.z) - (b.z - a.z) * (p.x - a.x));
      let prev = input.at(-1)!,
        d0 = distance(prev);
      for (const cur of input) {
        const d1 = distance(cur);
        if (d0 >= 0 !== d1 >= 0) {
          const f = d0 / (d0 - d1);
          result.push({ x: prev.x + (cur.x - prev.x) * f, y: 0, z: prev.z + (cur.z - prev.z) * f });
        }
        if (d1 >= 0) result.push(cur);
        prev = cur;
        d0 = d1;
      }
    }
    return result;
  }
  function height(t: Face, x: number, z: number) {
    return t.a.y - (t.normal.x * (x - t.a.x) + t.normal.z * (z - t.a.z)) / t.normal.y;
  }
  function projections(position: Readonly<Vec>, body: Readonly<VehicleBody>, face: Face) {
    const local = bodyAxes(body),
      up = local[1]!;
    const center = {
      x: position.x + (up.x * body.height) / 2,
      y: position.y + (up.y * body.height) / 2,
      z: position.z + (up.z * body.height) / 2,
    };
    const axes = [face.normal, ...local];
    for (const edge of [sub(face.b, face.a), sub(face.c, face.b), sub(face.a, face.c)])
      for (const axis of local) {
        const n = cross(edge, axis);
        if (Math.hypot(n.x, n.y, n.z) > 1e-9) axes.push(unit(n));
      }
    return axes.map((axis) => {
      const r =
        (Math.abs(dot(axis, local[0]!)) * body.width) / 2 +
        (Math.abs(dot(axis, up)) * body.height) / 2 +
        (Math.abs(dot(axis, local[2]!)) * body.length) / 2;
      const p = dot(center, axis),
        values = [dot(face.a, axis), dot(face.b, axis), dot(face.c, axis)];
      return { axis, min: p - r, max: p + r, low: Math.min(...values), high: Math.max(...values) };
    });
  }
  function sweep(from: Readonly<Vec>, to: Readonly<Vec>, body: Readonly<VehicleBody>, face: Face): SweptContact | null {
    const movement = sub(to, from);
    // Back faces cannot snag a car leaving the road, and tangential travel does not hit seams.
    if (dot(movement, face.normal) >= -1e-8) return null;
    let enter = -Infinity,
      exit = Infinity;
    for (const p of projections(from, body, face)) {
      const speed = dot(movement, p.axis);
      if (Math.abs(speed) < 1e-10) {
        if (p.max <= p.low + 1e-7 || p.min >= p.high - 1e-7) return null;
        continue;
      }
      const a = (p.low - p.max) / speed,
        b = (p.high - p.min) / speed;
      enter = Math.max(enter, Math.min(a, b));
      exit = Math.min(exit, Math.max(a, b));
      if (enter > exit + 1e-8) return null;
    }
    if (enter < -1e-6 || enter > 1 || exit < 0) return null;
    const fraction = Math.max(0, enter);
    const center = {
      x: from.x + movement.x * fraction,
      y: from.y + movement.y * fraction,
      z: from.z + movement.z * fraction,
    };
    // Closest point on the contact plane gives a useful impact lever arm.
    const distance = dot(sub(center, face.a), face.normal);
    const point = sub(center, mul(face.normal, distance));
    return { colliderId: face.id, point, normal: face.normal, fraction };
  }
  const world: CollisionWorld & { setDriving(value: boolean): void } = {
    setDriving(value) {
      driving = value;
    },
    getGroundSupport(position, maxRise, maxDrop, body): GroundSupport {
      const bottom = footprintVertices(position, body);
      const bounds = {
        minX: Math.min(...bottom.map((p) => p.x)),
        maxX: Math.max(...bottom.map((p) => p.x)),
        minZ: Math.min(...bottom.map((p) => p.z)),
        maxZ: Math.max(...bottom.map((p) => p.z)),
      };
      let area = 0,
        x = 0,
        z = 0,
        y = 0;
      const normal = { x: 0, y: 0, z: 0 };
      for (const t of index.query(bounds)) {
        if (t.kind !== 'top' || t.normal.y < 0.05) continue;
        const overlap = clip(bottom, t),
          a = footprintArea(overlap);
        if (a < 1e-9) continue;
        const centerHeight = height(t, position.x, position.z);
        if (centerHeight - position.y > maxRise || position.y - centerHeight > maxDrop) continue;
        const c = footprintCentroid(overlap);
        area += a;
        x += c.x * a;
        z += c.z * a;
        y += centerHeight * a;
        normal.x += t.normal.x * a;
        normal.y += t.normal.y * a;
        normal.z += t.normal.z * a;
      }
      const full = footprintArea(bottom);
      return {
        fraction: Math.min(1, area / Math.max(full, 1e-8)),
        centroid: area ? { x: x / area, y: y / area, z: z / area } : null,
        contact: area
          ? { colliderId: 'road-support', point: { x: position.x, y: y / area, z: position.z }, normal: unit(normal) }
          : null,
      };
    },
    findGround(position, maxRise, maxDrop, body) {
      if (body) return world.getGroundSupport(position, maxRise, maxDrop, body).contact;
      for (const t of index.query({ minX: position.x, maxX: position.x, minZ: position.z, maxZ: position.z })) {
        if (t.kind !== 'top' || t.normal.y < 0.05) continue;
        const p = { ...position };
        if (!clip([p], t).length) continue;
        const y = height(t, p.x, p.z);
        if (y - p.y > maxRise || p.y - y > maxDrop) continue;
        return { colliderId: t.id, point: { ...p, y }, normal: t.normal };
      }
      return null;
    },
    sweepGround() {
      return null;
    }, // The complete triangle surface is handled by sweepBody.
    sweepBody(from, to, body) {
      const a = bodyBounds(from, body),
        b = bodyBounds(to, body);
      const bounds = {
        minX: Math.min(a.minX, b.minX),
        maxX: Math.max(a.maxX, b.maxX),
        minZ: Math.min(a.minZ, b.minZ),
        maxZ: Math.max(a.maxZ, b.maxZ),
      };
      let hit: SweptContact | null = null;
      for (const t of index.query(bounds)) {
        if (driving && t.kind === 'top') continue;
        if (t.maxY < Math.min(a.minY, b.minY) - 1e-6 || t.minY > Math.max(a.maxY, b.maxY) + 1e-6) continue;
        const h = sweep(from, to, body, t);
        if (h && (!hit || h.fraction < hit.fraction)) hit = h;
      }
      return hit;
    },
    getBodyPenetration(position, body) {
      const bounds = bodyBounds(position, body);
      let result: BodyPenetration | null = null;
      for (const t of index.query(bounds)) {
        if (driving && t.kind === 'top') continue;
        if (t.maxY < bounds.minY || t.minY > bounds.maxY) continue;
        const p = projections(position, body, t);
        if (p.some((p) => p.max <= p.low + 1e-7 || p.min >= p.high - 1e-7)) continue;
        const plane = p[0]!;
        // Recover through the exterior face only, never through an internal triangulation edge.
        if ((plane.min + plane.max) / 2 < plane.low - 1e-6) continue;
        const depth = plane.low - plane.min;
        if (depth > 0 && (!result || depth < result.depth))
          result = { colliderId: t.id, normal: t.normal, point: t.a, depth };
      }
      return result;
    },
  };
  return world;
}
