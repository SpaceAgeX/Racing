import polygonClipping, { type MultiPolygon, type Pair } from 'polygon-clipping';
import earcut from 'earcut';
import { buildSplineSurface, splineSurfaceHeightAt } from './spline-surface.ts';
import {
  getSplineTrackFrame,
  getSplineStartGrid,
  SPLINE_EDITOR_WORLD_SIZE,
  type SplineGraph,
  type SplineTrackLocation,
} from './spline.ts';
import type { Vector3Data } from '../simulation/collision.ts';
import type { VehicleSpawn } from '../simulation/types.ts';
import type { FinishLine } from '../simulation/lap-timer.ts';
export const TRACK_THICKNESS = 1.5;
export interface RoadTriangle {
  a: Vector3Data;
  b: Vector3Data;
  c: Vector3Data;
  kind: 'top' | 'bottom' | 'wall' | 'obstacle';
}
export function buildRoadGeometry(graph: SplineGraph) {
  const surface = buildSplineSurface(graph);
  const triangles: RoadTriangle[] = [];
  function tri(a: Vector3Data, b: Vector3Data, c: Vector3Data, kind: RoadTriangle['kind']) {
    triangles.push({ a, b, c, kind });
  }
  const vertices: Vector3Data[] = [];
  const byPosition = new Map<string, number>();
  const edges = new Map<string, { a: number; b: number; count: number }>();
  const pending: [number, number, number][] = [];
  const step = 4;
  function rectangle(x: number, z: number, w: number, h: number): MultiPolygon {
    return [
      [
        [
          [x, z],
          [x + w, z],
          [x + w, z + h],
          [x, z + h],
          [x, z],
        ],
      ],
    ];
  }
  function vertex([x, z]: Pair) {
    const key = x.toFixed(6) + ':' + z.toFixed(6),
      known = byPosition.get(key);
    if (known !== undefined) return known;
    const i = vertices.length;
    vertices.push({ x, y: splineSurfaceHeightAt(surface, x, z), z });
    byPosition.set(key, i);
    return i;
  }
  for (const source of surface.polygons) {
    const all = source.flat(),
      minX = Math.floor(Math.min(...all.map((p) => p[0])) / step) * step,
      maxX = Math.max(...all.map((p) => p[0]));
    const minZ = Math.floor(Math.min(...all.map((p) => p[1])) / step) * step,
      maxZ = Math.max(...all.map((p) => p[1]));
    for (let x = minX; x < maxX; x += step) {
      const strip = polygonClipping.intersection([source], rectangle(x, minZ, step, maxZ - minZ + 1));
      if (!strip.length) continue;
      for (let z = minZ; z < maxZ; z += step) {
        const clipped = polygonClipping.intersection(strip, rectangle(x, z, step, step));
        for (const polygon of clipped) {
          const rings = polygon.map((r) => r.slice(0, -1)),
            flat = rings.flat();
          const holes: number[] = [];
          let offset = rings[0]!.length;
          for (const r of rings.slice(1)) {
            holes.push(offset);
            offset += r.length;
          }
          const indices = earcut(flat.flat(), holes, 2),
            map = flat.map(vertex);
          for (let i = 0; i < indices.length; i += 3) {
            let [a, b, c] = indices.slice(i, i + 3).map((j) => map[j]!) as [number, number, number];
            const pa = vertices[a]!,
              pb = vertices[b]!,
              pc = vertices[c]!;
            const area = (pb.z - pa.z) * (pc.x - pa.x) - (pb.x - pa.x) * (pc.z - pa.z);
            if (Math.abs(area) < 1e-9) continue;
            if (area < 0) [b, c] = [c, b];
            pending.push([a, b, c]);
          }
        }
      }
    }
  }
  // Earcut may omit collinear border vertices on only one side of a cell.
  // Split those edges before building faces to keep the elevated solid watertight.
  const byX = new Map<string, number[]>(),
    byZ = new Map<string, number[]>();
  vertices.forEach((p, i) => {
    for (const [map, key] of [
      [byX, p.x.toFixed(6)],
      [byZ, p.z.toFixed(6)],
    ] as [Map<string, number[]>, string][]) {
      const list = map.get(key) ?? [];
      list.push(i);
      map.set(key, list);
    }
  });
  function addFace(a: number, b: number, c: number) {
    tri(vertices[a]!, vertices[b]!, vertices[c]!, 'top');
    const lower = (i: number) => ({ ...vertices[i]!, y: vertices[i]!.y - TRACK_THICKNESS });
    tri(lower(c), lower(b), lower(a), 'bottom');
    for (const [u, v] of [
      [a, b],
      [b, c],
      [c, a],
    ] as [number, number][]) {
      const key = Math.min(u, v) + ':' + Math.max(u, v),
        entry = edges.get(key);
      if (entry) entry.count++;
      else edges.set(key, { a: u, b: v, count: 1 });
    }
  }
  for (const face of pending) {
    const boundary: number[] = [];
    for (let i = 0; i < 3; i++) {
      const a = face[i]!,
        b = face[(i + 1) % 3]!,
        p = vertices[a]!,
        q = vertices[b]!;
      boundary.push(a);
      const alongX = Math.abs(p.z - q.z) < 1e-6,
        alongZ = Math.abs(p.x - q.x) < 1e-6;
      const candidates = alongX ? byZ.get(p.z.toFixed(6)) : alongZ ? byX.get(p.x.toFixed(6)) : undefined;
      if (!candidates) continue;
      const axis = alongX ? 'x' : 'z',
        delta = q[axis] - p[axis];
      const inside = candidates
        .map((j) => ({ j, t: (vertices[j]![axis] - p[axis]) / delta }))
        .filter((v) => v.t > 1e-7 && v.t < 1 - 1e-7)
        .sort((a, b) => a.t - b.t);
      boundary.push(...inside.map((v) => v.j));
    }
    if (boundary.length === 3) addFace(...face);
    else {
      const center = face.reduce(
        (p, i) => ({ x: p.x + vertices[i]!.x / 3, y: p.y + vertices[i]!.y / 3, z: p.z + vertices[i]!.z / 3 }),
        { x: 0, y: 0, z: 0 },
      );
      const index = vertices.length;
      vertices.push(center);
      for (let i = 0; i < boundary.length; i++) addFace(index, boundary[i]!, boundary[(i + 1) % boundary.length]!);
    }
  }
  for (const edge of edges.values())
    if (edge.count === 1) {
      const a = vertices[edge.a]!,
        b = vertices[edge.b]!,
        la = { ...a, y: a.y - TRACK_THICKNESS },
        lb = { ...b, y: b.y - TRACK_THICKNESS };
      tri(b, a, la, 'wall');
      tri(b, la, lb, 'wall');
    }
  const topTriangles = triangles.filter((t) => t.kind === 'top');
  // Barycentric interpolation of the actual triangulated top, not an independent height field.
  function heightAt(x: number, z: number) {
    for (const { a, b, c } of topTriangles) {
      const d = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z);
      if (Math.abs(d) < 1e-10) continue;
      const u = ((b.z - c.z) * (x - c.x) + (c.x - b.x) * (z - c.z)) / d;
      const v = ((c.z - a.z) * (x - c.x) + (a.x - c.x) * (z - c.z)) / d;
      if (u >= -1e-7 && v >= -1e-7 && u + v <= 1 + 1e-7) return u * a.y + v * b.y + (1 - u - v) * c.y;
    }
    return splineSurfaceHeightAt(surface, x, z);
  }
  function gate(location: SplineTrackLocation): FinishLine {
    const frame = getSplineTrackFrame(graph, location)!;
    const x = (frame.position.x - 0.5) * SPLINE_EDITOR_WORLD_SIZE,
      z = (frame.position.y - 0.5) * SPLINE_EDITOR_WORLD_SIZE;
    const right = { x: frame.direction.y, z: -frame.direction.x };
    const h1 = heightAt(x + (right.x * frame.width) / 2, z + (right.z * frame.width) / 2);
    const h0 = heightAt(x - (right.x * frame.width) / 2, z - (right.z * frame.width) / 2);
    return {
      center: { x, y: heightAt(x, z), z },
      width: frame.width,
      direction: { x: frame.direction.x, z: frame.direction.y },
      crossSlope: (h1 - h0) / frame.width,
    };
  }
  const finish = graph.finishLine ? gate(graph.finishLine) : null;
  const checkpoints = graph.checkpoints.map((c) => ({ ...gate(c), id: c.id }));
  const spawns: VehicleSpawn[] = getSplineStartGrid(graph).map((slot) => {
    const x = (slot.position.x - 0.5) * SPLINE_EDITOR_WORLD_SIZE,
      z = (slot.position.y - 0.5) * SPLINE_EDITOR_WORLD_SIZE;
    return { position: { x, y: heightAt(x, z), z }, heading: Math.atan2(-slot.direction.x, -slot.direction.y) };
  });
  const obstacles: { center: Vector3Data; width: number; height: number; depth: number; heading: number }[] = [];
  if (finish) {
    const direction = finish.direction!,
      right = { x: direction.z, z: -direction.x };
    let top = -Infinity;
    for (const side of [-1, 1]) {
      const x = finish.center.x + right.x * (finish.width / 2 - 0.3) * side,
        z = finish.center.z + right.z * (finish.width / 2 - 0.3) * side;
      const y = heightAt(x, z);
      top = Math.max(top, y + 3.8);
      obstacles.push({
        center: { x, y: y + 1.9, z },
        width: 0.4,
        height: 3.8,
        depth: 0.6,
        heading: Math.atan2(direction.x, direction.z),
      });
    }
    obstacles.push({
      center: { ...finish.center, y: top + 0.25 },
      width: finish.width,
      height: 0.5,
      depth: 0.6,
      heading: Math.atan2(direction.x, direction.z),
    });
  }
  for (const box of obstacles) {
    const points = [
      [-1, -1, -1],
      [1, -1, -1],
      [1, 1, -1],
      [-1, 1, -1],
      [-1, -1, 1],
      [1, -1, 1],
      [1, 1, 1],
      [-1, 1, 1],
    ].map(([x, y, z]) => {
      const a = (x! * box.width) / 2,
        b = (z! * box.depth) / 2,
        c = Math.cos(box.heading),
        s = Math.sin(box.heading);
      return {
        x: box.center.x + c * a + s * b,
        y: box.center.y + (y! * box.height) / 2,
        z: box.center.z - s * a + c * b,
      };
    });
    for (const face of [
      [0, 3, 2, 1],
      [4, 5, 6, 7],
      [0, 4, 7, 3],
      [1, 2, 6, 5],
      [3, 7, 6, 2],
      [0, 1, 5, 4],
    ]) {
      tri(points[face[0]!]!, points[face[1]!]!, points[face[2]!]!, 'obstacle');
      tri(points[face[0]!]!, points[face[2]!]!, points[face[3]!]!, 'obstacle');
    }
  }
  return { surface, triangles, finish, checkpoints, spawns, obstacles, heightAt };
}
export type RoadGeometry = ReturnType<typeof buildRoadGeometry>;
