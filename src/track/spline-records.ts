import { canPlaceSplineFinishLine, type SplineGraph } from './spline.ts';

/** Bounded, versioned wire format. Geometry is derived, never accepted from clients. */
export interface SplineTrack extends SplineGraph {
  version: 2;
}
export function splineTrackError(value: unknown): string | null {
  if (!value || typeof value !== 'object') return 'A spline track is required.';
  const g = value as SplineTrack;
  const number = (n: unknown, low: number, high: number) =>
    typeof n === 'number' && Number.isFinite(n) && n >= low && n <= high;
  const id = (n: unknown) => number(n, 0, 1e6) && Number.isInteger(n);
  const point = (p: { x: number; y: number } | undefined, low: number, high: number) =>
    p && number(p.x, low, high) && number(p.y, low, high);
  if (g.version !== 2) return 'Unsupported track version.';
  if (!Array.isArray(g.nodes) || g.nodes.length < 2 || g.nodes.length > 128)
    return 'A track needs at least 2 points (maximum 128).';
  if (!Array.isArray(g.connections) || !g.connections.length || g.connections.length > 256)
    return 'Connect the track points (maximum 256 connections).';
  if (!number(g.defaultWidth, 4, 30)) return 'Invalid default width.';
  if (
    g.nodes.some(
      (n) =>
        !n ||
        !id(n.id) ||
        !point(n.position, 0, 1) ||
        !number(n.width, 4, 30) ||
        !number(n.height, -50, 50) ||
        !number(n.heightSteepness, 0, 100) ||
        typeof n.usesDefaultWidth !== 'boolean' ||
        !['smooth', 'symmetric', 'corner'].includes(n.handleMode),
    )
  )
    return 'Invalid track point.';
  const nodes = new Set(g.nodes.map((n) => n.id));
  if (nodes.size !== g.nodes.length) return 'Duplicate point IDs.';
  if (
    g.connections.some(
      (c) =>
        !c ||
        !id(c.id) ||
        !nodes.has(c.startNodeId) ||
        !nodes.has(c.endNodeId) ||
        c.startNodeId === c.endNodeId ||
        !point(c.startHandle, -2, 2) ||
        !point(c.endHandle, -2, 2),
    )
  )
    return 'Invalid curve connection.';
  const connections = new Set(g.connections.map((c) => c.id));
  if (connections.size !== g.connections.length) return 'Duplicate connection IDs.';
  const location = (p: { connectionId: number; progress: number } | null) =>
    p && connections.has(p.connectionId) && number(p.progress, 0, 1);
  if (!location(g.finishLine) || typeof g.finishLine?.reversed !== 'boolean')
    return 'Place a finish line before saving.';
  if (!canPlaceSplineFinishLine(g, g.finishLine!.connectionId, g.finishLine!.progress))
    return 'The finish line needs room for the starting grid. Move it farther from the ends.';
  if (
    !Array.isArray(g.checkpoints) ||
    g.checkpoints.length > 3 ||
    g.checkpoints.some((c) => !location(c) || !id(c.id)) ||
    new Set(g.checkpoints.map((c) => c.id)).size !== g.checkpoints.length
  )
    return 'Invalid checkpoints (maximum 3).';
  return null;
}
export function serializeSpline(graph: SplineGraph): SplineTrack {
  return structuredClone({ ...graph, version: 2 as const });
}
