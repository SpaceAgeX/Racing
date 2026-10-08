import { clipFootprint, footprintArea, footprintCentroid, footprintVertices, sweepFootprint } from './footprint.ts';
import type { VehicleFootprint } from './footprint.ts';
import { bodyBounds, bodyPenetration, sweepBodyBox } from './box.ts';
import type { BodyPenetration, SolidBoxCollider, VehicleBody } from './box.ts';
import { createSpatialGrid } from './spatial-grid.ts';

export interface Vector3Data {
  x: number;
  y: number;
  z: number;
}

/** A bounded ground plane. Its point and normal also describe an inclined surface. */
export interface GroundCollider {
  id: string;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  point: Vector3Data;
  normal: Vector3Data;
}

/** Geometric contact data, independent of meshes and vehicle handling. */
export interface SurfaceContact {
  colliderId: string;
  point: Vector3Data;
  normal: Vector3Data;
}

export interface SweptContact extends SurfaceContact {
  fraction: number;
}

export interface GroundSupport {
  fraction: number;
  centroid: Vector3Data | null;
  contact: SurfaceContact | null;
}

/** Ground support and complete solid-body contacts, independent of rendering. */
export interface CollisionWorld {
  findGround(position: Readonly<Vector3Data>, maxRise: number, maxDrop: number, footprint?: Readonly<VehicleFootprint>): SurfaceContact | null;
  sweepGround(from: Readonly<Vector3Data>, to: Readonly<Vector3Data>, footprint?: Readonly<VehicleFootprint>): SweptContact | null;
  sweepBody(from: Readonly<Vector3Data>, to: Readonly<Vector3Data>, body: Readonly<VehicleBody>): SweptContact | null;
  getBodyPenetration(position: Readonly<Vector3Data>, body: Readonly<VehicleBody>): BodyPenetration | null;
  getGroundSupport(position: Readonly<Vector3Data>, maxRise: number, maxDrop: number, footprint: Readonly<VehicleFootprint>): GroundSupport;
}

const CONTACT_EPSILON = 1e-7;

export function createCollisionWorld(colliders: readonly GroundCollider[], solidColliders: readonly SolidBoxCollider[] = []): CollisionWorld {
  const solids = solidColliders.map((box) => ({ ...box, min: { ...box.min }, max: { ...box.max } }));
  const explicitGround = new Set(colliders.map((collider) => collider.id));
  const groundColliders = [...colliders, ...solids.filter((box) => !explicitGround.has(box.id)).map((box): GroundCollider => ({
    id: box.id,
    bounds: { minX: box.min.x, maxX: box.max.x, minZ: box.min.z, maxZ: box.max.z },
    point: { x: (box.min.x + box.max.x) / 2, y: box.max.y, z: (box.min.z + box.max.z) / 2 },
    normal: { x: 0, y: 1, z: 0 },
  }))];
  // Copy the collider data and normalize normals once, rather than reading render objects.
  const surfaces = groundColliders.map((collider) => {
    const length = Math.hypot(collider.normal.x, collider.normal.y, collider.normal.z);
    if (!Number.isFinite(length) || length === 0 || collider.normal.y <= 0) {
      throw new Error(`Ground collider ${collider.id} needs an upward-facing normal.`);
    }
    return {
      ...collider,
      bounds: { ...collider.bounds },
      point: { ...collider.point },
      normal: {
        x: collider.normal.x / length,
        y: collider.normal.y / length,
        z: collider.normal.z / length,
      },
    };
  });
  const solidIndex = createSpatialGrid(solids, (box) => ({ minX: box.min.x, maxX: box.max.x, minZ: box.min.z, maxZ: box.max.z }));
  const surfaceIndex = createSpatialGrid(surfaces, (surface) => surface.bounds);

  function rectangle(points: readonly Vector3Data[]) {
    return { minX: Math.min(...points.map((point) => point.x)), maxX: Math.max(...points.map((point) => point.x)), minZ: Math.min(...points.map((point) => point.z)), maxZ: Math.max(...points.map((point) => point.z)) };
  }

  function contains(surface: GroundCollider, x: number, z: number): boolean {
    return x >= surface.bounds.minX - CONTACT_EPSILON && x <= surface.bounds.maxX + CONTACT_EPSILON
      && z >= surface.bounds.minZ - CONTACT_EPSILON && z <= surface.bounds.maxZ + CONTACT_EPSILON;
  }

  function heightAt(surface: GroundCollider, x: number, z: number): number {
    return surface.point.y - (
      surface.normal.x * (x - surface.point.x) + surface.normal.z * (z - surface.point.z)
    ) / surface.normal.y;
  }

  function contact(surface: GroundCollider, point: Vector3Data): SurfaceContact {
    return { colliderId: surface.id, point, normal: { ...surface.normal } };
  }

  function highestPoint(surface: GroundCollider, overlap: readonly Vector3Data[]): Vector3Data {
    let result = { ...overlap[0]!, y: heightAt(surface, overlap[0]!.x, overlap[0]!.z) };
    for (const point of overlap) {
      const y = heightAt(surface, point.x, point.z);
      if (y > result.y) result = { x: point.x, y, z: point.z };
    }
    return result;
  }

  return {
    getGroundSupport(position, maxRise, maxDrop, footprint): GroundSupport {
      const bottom = footprintVertices(position, footprint);
      const minX = Math.min(...bottom.map((point) => point.x)), maxX = Math.max(...bottom.map((point) => point.x));
      const minZ = Math.min(...bottom.map((point) => point.z)), maxZ = Math.max(...bottom.map((point) => point.z));
      let area = 0;
      let x = 0, z = 0;
      let ground: SurfaceContact | null = null;
      for (const surface of surfaceIndex.query({ minX, maxX, minZ, maxZ })) {
        if (surface.bounds.maxX < minX || surface.bounds.minX > maxX || surface.bounds.maxZ < minZ || surface.bounds.minZ > maxZ) continue;
        const overlap = clipFootprint(bottom, surface.bounds);
        const pieceArea = footprintArea(overlap);
        if (pieceArea <= 1e-8) continue;
        const point = highestPoint(surface, overlap);
        if (point.y - position.y > maxRise + CONTACT_EPSILON || position.y - point.y > maxDrop + CONTACT_EPSILON) continue;
        const centroid = footprintCentroid(overlap);
        area += pieceArea;
        x += centroid.x * pieceArea;
        z += centroid.z * pieceArea;
        if (!ground || point.y > ground.point.y) ground = contact(surface, point);
      }
      return {
        fraction: Math.min(1, area / (footprint.width * footprint.length)),
        centroid: area > 0 ? { x: x / area, y: ground!.point.y, z: z / area } : null,
        contact: ground,
      };
    },
    sweepBody(from, to, body): SweptContact | null {
      let result: SweptContact | null = null;
      const a = bodyBounds(from, body), b = bodyBounds(to, body);
      const bounds = { minX: Math.min(a.minX, b.minX), maxX: Math.max(a.maxX, b.maxX), minZ: Math.min(a.minZ, b.minZ), maxZ: Math.max(a.maxZ, b.maxZ) };
      for (const box of solidIndex.query(bounds)) {
        if (box.max.y < Math.min(a.minY, b.minY) - 1e-7 || box.min.y > Math.max(a.maxY, b.maxY) + 1e-7) continue;
        const hit = sweepBodyBox(from, to, body, box);
        if (hit && (!result || hit.fraction < result.fraction)) result = hit;
      }
      return result;
    },

    getBodyPenetration(position, body): BodyPenetration | null {
      let result: BodyPenetration | null = null;
      const bounds = bodyBounds(position, body);
      for (const box of solidIndex.query(bounds)) {
        if (box.max.y < bounds.minY - 1e-7 || box.min.y > bounds.maxY + 1e-7) continue;
        const overlap = bodyPenetration(position, body, box);
        if (overlap && (!result || overlap.depth > result.depth)) result = overlap;
      }
      return result;
    },

    findGround(position, maxRise, maxDrop, footprint): SurfaceContact | null {
      let result: SurfaceContact | null = null;
      const bottom = footprint ? footprintVertices(position, footprint) : null;
      for (const surface of surfaceIndex.query(rectangle(bottom ?? [position]))) {
        let point: Vector3Data;
        if (bottom) {
          const overlap = clipFootprint(bottom, surface.bounds);
          if (footprintArea(overlap) <= 1e-8) continue;
          point = highestPoint(surface, overlap);
        } else {
          if (!contains(surface, position.x, position.z)) continue;
          point = { x: position.x, y: heightAt(surface, position.x, position.z), z: position.z };
        }
        const difference = point.y - position.y;
        if (difference > maxRise + CONTACT_EPSILON || difference < -maxDrop - CONTACT_EPSILON) continue;
        if (!result || point.y > result.point.y) {
          result = contact(surface, point);
        }
      }
      return result;
    },

    sweepGround(from, to, footprint): SweptContact | null {
      let result: SweptContact | null = null;
      let firstHit = Infinity;
      const bottom = footprint ? footprintVertices(from, footprint) : null;
      const end = footprint ? footprintVertices(to, footprint) : [to];
      for (const surface of surfaceIndex.query(rectangle([...(bottom ?? [from]), ...end]))) {
        const distance = (point: Readonly<Vector3Data>): number => (
          (point.x - surface.point.x) * surface.normal.x
          + (point.y - surface.point.y) * surface.normal.y
          + (point.z - surface.point.z) * surface.normal.z
        );
        const startDistance = distance(from);
        const endDistance = distance(to);
        if (bottom && footprint) {
          if (Math.max(...bottom.map(distance)) < -CONTACT_EPSILON || endDistance >= startDistance) continue;
          const { minX, maxX, minZ, maxZ } = surface.bounds;
          const surfaceVertices = [[minX, minZ], [maxX, minZ], [maxX, maxZ], [minX, maxZ]].map(([x, z]) => ({
            x: x!, y: heightAt(surface, x!, z!), z: z!,
          }));
          const fraction = sweepFootprint(bottom, {
            x: to.x - from.x, y: to.y - from.y, z: to.z - from.z,
          }, surfaceVertices, surface.normal);
          if (fraction === null || fraction >= firstHit) continue;
          const center = {
            x: from.x + (to.x - from.x) * fraction,
            y: from.y + (to.y - from.y) * fraction,
            z: from.z + (to.z - from.z) * fraction,
          };
          const overlap = clipFootprint(footprintVertices(center, footprint), surface.bounds);
          if (overlap.length === 0) continue;
          firstHit = fraction;
          result = { ...contact(surface, highestPoint(surface, overlap)), fraction };
          continue;
        }
        // Only downward crossings can land. Starting below a floor never teleports onto it.
        if (startDistance < -CONTACT_EPSILON || endDistance > CONTACT_EPSILON
          || endDistance >= startDistance) continue;
        const fraction = Math.max(0, Math.min(1, startDistance / (startDistance - endDistance)));
        if (fraction >= firstHit) continue;
        const point = {
          x: from.x + (to.x - from.x) * fraction,
          y: from.y + (to.y - from.y) * fraction,
          z: from.z + (to.z - from.z) * fraction,
        };
        if (!contains(surface, point.x, point.z)) continue;
        firstHit = fraction;
        result = { ...contact(surface, point), fraction };
      }
      return result;
    },
  };
}
