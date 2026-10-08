import type { Vector3Data } from './collision.ts';

export interface VehicleFootprint {
  width: number;
  length: number;
  heading: number;
}

export interface GroundBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export function footprintVertices(position: Readonly<Vector3Data>, shape: Readonly<VehicleFootprint>): Vector3Data[] {
  const c = Math.cos(shape.heading);
  const s = Math.sin(shape.heading);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([side, end]) => {
    const x = side! * shape.width / 2;
    const z = end! * shape.length / 2;
    return { x: position.x + x * c + z * s, y: position.y, z: position.z - x * s + z * c };
  });
}

/** Clip the rotated footprint to a tile, including overlaps with no car corner inside it. */
export function clipFootprint(vertices: readonly Vector3Data[], bounds: GroundBounds): Vector3Data[] {
  let polygon = [...vertices];
  const edges: { axis: 'x' | 'z'; bound: number; minimum: boolean }[] = [
    { axis: 'x', bound: bounds.minX, minimum: true },
    { axis: 'x', bound: bounds.maxX, minimum: false },
    { axis: 'z', bound: bounds.minZ, minimum: true },
    { axis: 'z', bound: bounds.maxZ, minimum: false },
  ];
  for (const { axis, bound, minimum } of edges) {
    const input = polygon;
    polygon = [];
    if (input.length === 0) break;
    const inside = (point: Vector3Data): boolean => minimum ? point[axis] >= bound : point[axis] <= bound;
    let previous = input[input.length - 1]!;
    for (const current of input) {
      if (inside(previous) !== inside(current)) {
        const fraction = (bound - previous[axis]) / (current[axis] - previous[axis]);
        polygon.push({
          x: previous.x + (current.x - previous.x) * fraction,
          y: previous.y,
          z: previous.z + (current.z - previous.z) * fraction,
        });
      }
      if (inside(current)) polygon.push(current);
      previous = current;
    }
  }
  return polygon;
}

export function footprintArea(polygon: readonly Vector3Data[]): number {
  let area = 0;
  for (let index = 0; index < polygon.length; index++) {
    const a = polygon[index]!;
    const b = polygon[(index + 1) % polygon.length]!;
    area += a.x * b.z - b.x * a.z;
  }
  return Math.abs(area) / 2;
}

export function footprintCentroid(polygon: readonly Vector3Data[]): Vector3Data {
  let area = 0;
  let x = 0;
  let z = 0;
  for (let index = 0; index < polygon.length; index++) {
    const a = polygon[index]!;
    const b = polygon[(index + 1) % polygon.length]!;
    const weight = a.x * b.z - b.x * a.z;
    area += weight;
    x += (a.x + b.x) * weight;
    z += (a.z + b.z) * weight;
  }
  return { x: x / (3 * area), y: polygon[0]!.y, z: z / (3 * area) };
}

function subtract(a: Vector3Data, b: Vector3Data): Vector3Data {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function cross(a: Vector3Data, b: Vector3Data): Vector3Data {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}

function dot(a: Vector3Data, b: Vector3Data): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

/** Continuous separating-axis test between a translating car bottom and a bounded surface. */
export function sweepFootprint(
  bottom: readonly Vector3Data[],
  displacement: Vector3Data,
  surface: readonly Vector3Data[],
  normal: Vector3Data,
): number | null {
  const up = { x: 0, y: 1, z: 0 };
  const bottomEdges = [subtract(bottom[1]!, bottom[0]!), subtract(bottom[3]!, bottom[0]!)];
  const surfaceEdges = [subtract(surface[1]!, surface[0]!), subtract(surface[3]!, surface[0]!)];
  const axes = [up, normal];
  for (const edge of bottomEdges) axes.push(cross(up, edge));
  for (const edge of surfaceEdges) axes.push(cross(normal, edge));
  for (const a of bottomEdges) for (const b of surfaceEdges) axes.push(cross(a, b));

  let enter = 0;
  let exit = 1;
  const epsilon = 1e-8;
  for (const raw of axes) {
    const length = Math.hypot(raw.x, raw.y, raw.z);
    if (length < epsilon) continue;
    const axis = { x: raw.x / length, y: raw.y / length, z: raw.z / length };
    const a = bottom.map((point) => dot(point, axis));
    const b = surface.map((point) => dot(point, axis));
    const aMin = Math.min(...a);
    const aMax = Math.max(...a);
    const bMin = Math.min(...b);
    const bMax = Math.max(...b);
    const motion = dot(displacement, axis);
    if (Math.abs(motion) < epsilon) {
      if (aMax < bMin - epsilon || bMax < aMin - epsilon) return null;
      continue;
    }
    const first = (bMin - aMax) / motion;
    const last = (bMax - aMin) / motion;
    enter = Math.max(enter, Math.min(first, last));
    exit = Math.min(exit, Math.max(first, last));
    if (enter > exit + epsilon) return null;
  }
  return enter <= 1 && exit >= 0 ? Math.max(0, enter) : null;
}
