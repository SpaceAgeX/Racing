import polygonClipping, { type MultiPolygon, type Pair, type Polygon } from 'polygon-clipping';
import {
  cubicBezierPoint,
  getSplineNode,
  interpolateSplineHeight,
  interpolateSplineWidth,
  SPLINE_EDITOR_WORLD_SIZE,
  type SplineConnection,
  type SplineGraph,
  type SplinePoint,
} from './spline.ts';

const INTEGER_SCALE = 1000;
const MAX_SAMPLE_LENGTH = 2;
const MAX_CURVE_ERROR = .015;
const MAX_SUBDIVISION_DEPTH = 12;
const ROUND_SEGMENTS = 96;
const UNION_BATCH_SIZE = 128;
const { union } = polygonClipping;

export interface SplineSurfaceWarning {
  connectionId: number;
  kind: 'tight-curve' | 'degenerate';
  radius?: number;
  halfWidth: number;
}

export interface SplineSurface {
  polygons: MultiPolygon;
  warnings: SplineSurfaceWarning[];
  heightSegments: SplineHeightSegment[];
}

export interface SplineHeightSegment {
  start: Pair;
  end: Pair;
  startHeight: number;
  endHeight: number;
}

interface Sample {
  t: number;
  position: SplinePoint;
  distance: number;
}

function worldPoint(point: Readonly<SplinePoint>): Pair {
  return [
    (point.x - .5) * SPLINE_EDITOR_WORLD_SIZE,
    (point.y - .5) * SPLINE_EDITOR_WORLD_SIZE,
  ];
}

function pointToSegmentDistance(point: Readonly<SplinePoint>, start: Readonly<SplinePoint>, end: Readonly<SplinePoint>): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  const amount = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, (
    (point.x - start.x) * dx + (point.y - start.y) * dy
  ) / lengthSquared));
  return Math.hypot(point.x - start.x - dx * amount, point.y - start.y - dy * amount);
}

function sampleConnection(graph: Readonly<SplineGraph>, connection: Readonly<SplineConnection>): Sample[] {
  const first = cubicBezierPoint(graph, connection, 0);
  const samples: Sample[] = [{ t: 0, position: first, distance: 0 }];

  function subdivide(t0: number, start: SplinePoint, t1: number, end: SplinePoint, depth: number): void {
    const middleT = (t0 + t1) / 2;
    const middle = cubicBezierPoint(graph, connection, middleT);
    const chordLength = Math.hypot(end.x - start.x, end.y - start.y) * SPLINE_EDITOR_WORLD_SIZE;
    const error = Math.max(...[.25,.5,.75].map(f=>pointToSegmentDistance(cubicBezierPoint(graph, connection, t0+(t1-t0)*f),start,end))) * SPLINE_EDITOR_WORLD_SIZE;
    if (depth < MAX_SUBDIVISION_DEPTH && (chordLength > MAX_SAMPLE_LENGTH || error > MAX_CURVE_ERROR)) {
      subdivide(t0, start, middleT, middle, depth + 1);
      subdivide(middleT, middle, t1, end, depth + 1);
      return;
    }
    const previous = samples.at(-1)!;
    samples.push({
      t: t1,
      position: end,
      distance: previous.distance + Math.hypot(end.x - previous.position.x, end.y - previous.position.y),
    });
  }

  subdivide(0, first, 1, cubicBezierPoint(graph, connection, 1), 0);
  return samples;
}

function closeRing(points: Pair[]): Pair[] {
  if (!points.length) return points;
  const first = points[0]!;
  const last = points.at(-1)!;
  return first[0] === last[0] && first[1] === last[1] ? points : [...points, [...first] as Pair];
}

function quantizeRing(points: Pair[]): Pair[] {
  return closeRing(points.map(([x, z]) => [Math.round(x * INTEGER_SCALE), Math.round(z * INTEGER_SCALE)]));
}

function circlePolygon(center: Pair, radius: number): Polygon {
  const points: Pair[] = [];
  for (let index = 0; index < ROUND_SEGMENTS; index++) {
    const angle = index / ROUND_SEGMENTS * Math.PI * 2;
    points.push([center[0] + Math.cos(angle) * radius, center[1] + Math.sin(angle) * radius]);
  }
  return [quantizeRing(points)];
}

function unionInBatches(polygons: Polygon[]): MultiPolygon {
  let result: MultiPolygon = [];
  for (let offset = 0; offset < polygons.length; offset += UNION_BATCH_SIZE) {
    const batch = polygons.slice(offset, offset + UNION_BATCH_SIZE);
    if (!batch.length) continue;
    const batchResult = union(batch[0]!, ...batch.slice(1));
    result = result.length ? union(result, batchResult) : batchResult;
  }
  return result;
}

function connectionWarning(
  graph: Readonly<SplineGraph>,
  connection: Readonly<SplineConnection>,
  samples: Readonly<Sample[]>,
): SplineSurfaceWarning | null {
  const start = getSplineNode(graph, connection.startNodeId)!;
  const end = getSplineNode(graph, connection.endNodeId)!;
  const p0 = start.position;
  const p1 = { x: p0.x + connection.startHandle.x, y: p0.y + connection.startHandle.y };
  const p3 = end.position;
  const p2 = { x: p3.x + connection.endHandle.x, y: p3.y + connection.endHandle.y };
  let tightest: SplineSurfaceWarning | null = null;
  for (const sample of samples) {
    const t = sample.t;
    const inverse = 1 - t;
    const dx = 3 * inverse ** 2 * (p1.x - p0.x) + 6 * inverse * t * (p2.x - p1.x) + 3 * t ** 2 * (p3.x - p2.x);
    const dz = 3 * inverse ** 2 * (p1.y - p0.y) + 6 * inverse * t * (p2.y - p1.y) + 3 * t ** 2 * (p3.y - p2.y);
    const ddx = 6 * inverse * (p2.x - 2 * p1.x + p0.x) + 6 * t * (p3.x - 2 * p2.x + p1.x);
    const ddz = 6 * inverse * (p2.y - 2 * p1.y + p0.y) + 6 * t * (p3.y - 2 * p2.y + p1.y);
    const speed = Math.hypot(dx, dz);
    const totalDistance = samples.at(-1)?.distance || 1;
    const halfWidth = interpolateSplineWidth(start.width, end.width, sample.distance / totalDistance) / 2;
    if (speed < 1e-7) return { connectionId: connection.id, kind: 'degenerate', halfWidth };
    const curvature = Math.abs(dx * ddz - dz * ddx) / speed ** 3 / SPLINE_EDITOR_WORLD_SIZE;
    if (curvature < 1e-9) continue;
    const radius = 1 / curvature;
    if (radius <= halfWidth * 1.05 && (!tightest || radius < tightest.radius!)) {
      tightest = { connectionId: connection.id, kind: 'tight-curve', radius, halfWidth };
    }
  }
  return tightest;
}

export function buildSplineSurface(graph: Readonly<SplineGraph>): SplineSurface {
  const pieces: Polygon[] = [];
  const warnings: SplineSurfaceWarning[] = [];
  const heightSegments: SplineHeightSegment[] = [];
  for (const connection of graph.connections) {
    const start = getSplineNode(graph, connection.startNodeId)!;
    const end = getSplineNode(graph, connection.endNodeId)!;
    const samples = sampleConnection(graph, connection);
    const totalDistance = samples.at(-1)?.distance || 1;
    const widths = samples.map((sample) => interpolateSplineWidth(start.width, end.width, sample.distance / totalDistance));
    // Consecutive cross-sections share endpoints. Unioning a faceted disk at every
    // sample creates periodic teeth where the disk chord meets a road trapezoid.
    const normals=samples.map((sample,index)=>{
      const t=sample.t,u=1-t;
      const p0=start.position,p1={x:p0.x+connection.startHandle.x,y:p0.y+connection.startHandle.y};
      const p3=end.position,p2={x:p3.x+connection.endHandle.x,y:p3.y+connection.endHandle.y};
      let dx=3*u*u*(p1.x-p0.x)+6*u*t*(p2.x-p1.x)+3*t*t*(p3.x-p2.x);
      let dz=3*u*u*(p1.y-p0.y)+6*u*t*(p2.y-p1.y)+3*t*t*(p3.y-p2.y);
      if(Math.hypot(dx,dz)<1e-9){
        const a=samples[Math.max(0,index-1)]!.position,b=samples[Math.min(samples.length-1,index+1)]!.position;
        dx=b.x-a.x;dz=b.y-a.y;
      }
      const length=Math.hypot(dx,dz)||1;return {x:-dz/length,z:dx/length};
    });
    const section=(i:number,side:number):Pair=>{
      const center=worldPoint(samples[i]!.position),n=normals[i]!,half=widths[i]!/2;
      return [center[0]+n.x*half*side,center[1]+n.z*half*side];
    };
    // Round caps/junctions only, rather than an overlapping polygon at every sample.
    pieces.push(circlePolygon(worldPoint(start.position),start.width/2));
    pieces.push(circlePolygon(worldPoint(end.position),end.width/2));
    for(let i=0;i<samples.length-1;i++){
      const a=section(i,1),b=section(i+1,1),c=section(i+1,-1),d=section(i,-1);
      // Triangles remain valid even when an offset folds over itself on a tight bend.
      pieces.push([quantizeRing([a,b,c])],[quantizeRing([a,c,d])]);
      heightSegments.push({start:worldPoint(samples[i]!.position),end:worldPoint(samples[i+1]!.position),
        startHeight:interpolateSplineHeight(graph,connection,samples[i]!.distance/totalDistance),
        endHeight:interpolateSplineHeight(graph,connection,samples[i+1]!.distance/totalDistance)});
    }
    const warning = connectionWarning(graph, connection, samples);
    if (warning) warnings.push(warning);
  }

  const quantized = unionInBatches(pieces);
  return {
    polygons: quantized.map((polygon) => polygon.map((ring) => ring.map(([x, z]) => [x / INTEGER_SCALE, z / INTEGER_SCALE]))),
    warnings,
    heightSegments,
  };
}

/** Returns the elevation of the closest sampled centerline at a world-space point. */
export function splineSurfaceHeightAt(surface: Readonly<SplineSurface>, x: number, z: number): number {
  let closestDistanceSquared = Number.POSITIVE_INFINITY;
  let height = 0;
  for (const segment of surface.heightSegments) {
    const dx = segment.end[0] - segment.start[0];
    const dz = segment.end[1] - segment.start[1];
    const lengthSquared = dx * dx + dz * dz;
    const amount = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, (
      (x - segment.start[0]) * dx + (z - segment.start[1]) * dz
    ) / lengthSquared));
    const offsetX = x - segment.start[0] - dx * amount;
    const offsetZ = z - segment.start[1] - dz * amount;
    const distanceSquared = offsetX * offsetX + offsetZ * offsetZ;
    if (distanceSquared < closestDistanceSquared) {
      closestDistanceSquared = distanceSquared;
      height = segment.startHeight + (segment.endHeight - segment.startHeight) * amount;
    }
  }
  return height;
}
