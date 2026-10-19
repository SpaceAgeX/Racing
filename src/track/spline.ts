export interface SplinePoint {
  x: number;
  y: number;
}

export interface SplineNode {
  id: number;
  position: SplinePoint;
  handleMode: SplineHandleMode;
  height: number;
  heightSteepness: number;
  width: number;
  usesDefaultWidth: boolean;
}

export type SplineHandleMode = 'smooth' | 'symmetric' | 'corner';

export interface SplineConnection {
  id: number;
  startNodeId: number;
  endNodeId: number;
  /** Control-point offsets relative to the corresponding node. */
  startHandle: SplinePoint;
  endHandle: SplinePoint;
}

export interface SplineGraph {
  nodes: SplineNode[];
  connections: SplineConnection[];
  defaultWidth: number;
  finishLine: SplineFinishLine | null;
  checkpoints: SplineCheckpoint[];
}

export interface SplineTrackLocation {
  connectionId: number;
  progress: number;
}

export interface SplineFinishLine extends SplineTrackLocation {
  reversed: boolean;
}

export interface SplineCheckpoint extends SplineTrackLocation {
  id: number;
}

export interface SplineStartSlot {
  row: number;
  column: number;
  position: SplinePoint;
  direction: SplinePoint;
}

export interface SplineTrackFrame {
  position: SplinePoint;
  direction: SplinePoint;
  width: number;
}

/** Minimum node-center spacing in normalized editor coordinates. */
export const MIN_SPLINE_NODE_DISTANCE = 0.05;
export const DEFAULT_SPLINE_WIDTH = 12;
export const MIN_SPLINE_WIDTH = 4;
export const MAX_SPLINE_WIDTH = 30;
export const SPLINE_EDITOR_WORLD_SIZE = 400;
export const MIN_SPLINE_HEIGHT = -50;
export const MAX_SPLINE_HEIGHT = 50;
export const DEFAULT_SPLINE_HEIGHT_STEEPNESS = 35;
export const MIN_SPLINE_HEIGHT_STEEPNESS = 0;
export const MAX_SPLINE_HEIGHT_STEEPNESS = 100;
export const MAX_SPLINE_CHECKPOINTS = 3;
export const SPLINE_START_GRID_CARS = 10;
export const SPLINE_START_GRID_COLUMNS = 2;
export const SPLINE_START_GRID_CAR_WIDTH = 1.8;
export const SPLINE_START_GRID_CAR_LENGTH = 3.8;
export const SPLINE_START_GRID_ROW_GAP = 1.5;
export const SPLINE_START_SECTION_LENGTH = 2 + SPLINE_START_GRID_CAR_LENGTH
  + (SPLINE_START_GRID_CARS / SPLINE_START_GRID_COLUMNS - 1)
    * (SPLINE_START_GRID_CAR_LENGTH + SPLINE_START_GRID_ROW_GAP) + 2;

export function createSplineGraph(): SplineGraph {
  return { nodes: [], connections: [], defaultWidth: DEFAULT_SPLINE_WIDTH, finishLine: null, checkpoints: [] };
}

export function getSplineNode(graph: Readonly<SplineGraph>, id: number): SplineNode | undefined {
  return graph.nodes.find((node) => node.id === id);
}

export function splineNodePositionAvailable(
  graph: Readonly<SplineGraph>,
  position: Readonly<SplinePoint>,
  ignoredNodeId: number | null = null,
): boolean {
  return graph.nodes.every((node) => node.id === ignoredNodeId
    || Math.hypot(position.x - node.position.x, position.y - node.position.y) >= MIN_SPLINE_NODE_DISTANCE - 1e-10);
}

export function addSplineNode(graph: SplineGraph, position: SplinePoint, id: number): SplineNode | null {
  if (!splineNodePositionAvailable(graph, position)) return null;
  const node: SplineNode = {
    id,
    position: { ...position },
    handleMode: 'smooth',
    height: 0,
    heightSteepness: DEFAULT_SPLINE_HEIGHT_STEEPNESS,
    width: graph.defaultWidth,
    usesDefaultWidth: true,
  };
  graph.nodes.push(node);
  return node;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * Moves a node toward a requested position and slides it around neighboring
 * exclusion circles instead of freezing when those circles are reached.
 */
export function moveSplineNode(graph: SplineGraph, id: number, requested: SplinePoint): SplinePoint | null {
  const node = getSplineNode(graph, id);
  if (!node) return null;
  const previous = { ...node.position };
  const resolved = { x: clamp(requested.x), y: clamp(requested.y) };

  for (let iteration = 0; iteration < Math.max(4, graph.nodes.length * 2); iteration++) {
    let changed = false;
    for (const other of graph.nodes) {
      if (other.id === id) continue;
      let dx = resolved.x - other.position.x;
      let dy = resolved.y - other.position.y;
      let distance = Math.hypot(dx, dy);
      if (distance >= MIN_SPLINE_NODE_DISTANCE - 1e-10) continue;
      if (distance < 1e-10) {
        dx = previous.x - other.position.x;
        dy = previous.y - other.position.y;
        distance = Math.hypot(dx, dy);
        if (distance < 1e-10) { dx = 1; dy = 0; distance = 1; }
      }
      resolved.x = clamp(other.position.x + dx / distance * MIN_SPLINE_NODE_DISTANCE);
      resolved.y = clamp(other.position.y + dy / distance * MIN_SPLINE_NODE_DISTANCE);
      changed = true;
    }
    if (!changed) break;
  }

  if (!splineNodePositionAvailable(graph, resolved, id)) return previous;
  node.position = resolved;
  return { ...resolved };
}

function clampWidth(width: number): number {
  return Math.max(MIN_SPLINE_WIDTH, Math.min(MAX_SPLINE_WIDTH, width));
}

export function setSplineDefaultWidth(graph: SplineGraph, width: number): number {
  const next = clampWidth(width);
  graph.defaultWidth = next;
  for (const node of graph.nodes) if (node.usesDefaultWidth) node.width = next;
  return next;
}

export function setSplineNodeWidth(graph: SplineGraph, nodeId: number, width: number): number | null {
  const node = getSplineNode(graph, nodeId);
  if (!node) return null;
  node.width = clampWidth(width);
  node.usesDefaultWidth = false;
  return node.width;
}

export function resetSplineNodeWidth(graph: SplineGraph, nodeId: number): number | null {
  const node = getSplineNode(graph, nodeId);
  if (!node) return null;
  node.width = graph.defaultWidth;
  node.usesDefaultWidth = true;
  return node.width;
}

export function interpolateSplineWidth(startWidth: number, endWidth: number, progress: number): number {
  const amount = Math.max(0, Math.min(1, progress));
  return startWidth + (endWidth - startWidth) * amount;
}

export function setSplineNodeHeight(graph: SplineGraph, nodeId: number, height: number): number | null {
  const node = getSplineNode(graph, nodeId);
  if (!node) return null;
  node.height = Math.max(MIN_SPLINE_HEIGHT, Math.min(MAX_SPLINE_HEIGHT, height));
  return node.height;
}

export function setSplineNodeHeightSteepness(graph: SplineGraph, nodeId: number, steepness: number): number | null {
  const node = getSplineNode(graph, nodeId);
  if (!node) return null;
  node.heightSteepness = Math.max(MIN_SPLINE_HEIGHT_STEEPNESS, Math.min(MAX_SPLINE_HEIGHT_STEEPNESS, steepness));
  return node.heightSteepness;
}

export function interpolateSplineHeight(
  graph: Readonly<SplineGraph>,
  connection: Readonly<SplineConnection>,
  t: number,
): number {
  const start = getSplineNode(graph, connection.startNodeId);
  const end = getSplineNode(graph, connection.endNodeId);
  if (!start || !end) throw new Error('Spline connection references a missing node.');
  const amount = Math.max(0, Math.min(1, t));
  if (amount === 0) return start.height;
  if (amount === 1) return end.height;
  const steepness = start.heightSteepness + (end.heightSteepness - start.heightSteepness) * amount;
  const exponent = 1.25 + steepness / 100 * 3.75;
  const forward = amount ** exponent;
  const backward = (1 - amount) ** exponent;
  const rounded = forward / (forward + backward);
  return start.height + (end.height - start.height) * rounded;
}

export function setSplineFinishLine(graph: SplineGraph, connectionId: number, progress: number): SplineFinishLine | null {
  if (!canPlaceSplineFinishLine(graph, connectionId, progress)) return null;
  graph.finishLine = { connectionId, progress: clamp(progress), reversed: false };
  return { ...graph.finishLine };
}

export function flipSplineFinishLine(graph: SplineGraph): boolean {
  if (!graph.finishLine) return false;
  graph.finishLine.reversed = !graph.finishLine.reversed;
  return graph.finishLine.reversed;
}

export function clearSplineFinishLine(graph: SplineGraph): void {
  graph.finishLine = null;
}

export function addSplineCheckpoint(
  graph: SplineGraph,
  connectionId: number,
  progress: number,
  id: number,
): SplineCheckpoint | null {
  if (graph.checkpoints.length >= MAX_SPLINE_CHECKPOINTS
    || !graph.connections.some((connection) => connection.id === connectionId)
    || graph.checkpoints.some((checkpoint) => checkpoint.id === id)) return null;
  const checkpoint = { id, connectionId, progress: clamp(progress) };
  graph.checkpoints.push(checkpoint);
  return { ...checkpoint };
}

export function removeSplineCheckpoint(graph: SplineGraph, id: number): boolean {
  const index = graph.checkpoints.findIndex((checkpoint) => checkpoint.id === id);
  if (index < 0) return false;
  graph.checkpoints.splice(index, 1);
  return true;
}

export function addSplineConnection(
  graph: SplineGraph,
  startNodeId: number,
  endNodeId: number,
  id: number,
): SplineConnection | null {
  if (startNodeId === endNodeId) return null;
  const start = getSplineNode(graph, startNodeId);
  const end = getSplineNode(graph, endNodeId);
  if (!start || !end) return null;
  const duplicate = graph.connections.some((connection) => (
    connection.startNodeId === startNodeId && connection.endNodeId === endNodeId
  ) || (
    connection.startNodeId === endNodeId && connection.endNodeId === startNodeId
  ));
  if (duplicate) return null;

  const third = {
    x: (end.position.x - start.position.x) / 3,
    y: (end.position.y - start.position.y) / 3,
  };
  const connection: SplineConnection = {
    id,
    startNodeId,
    endNodeId,
    startHandle: third,
    endHandle: { x: -third.x, y: -third.y },
  };
  graph.connections.push(connection);
  for (const node of [start, end]) {
    const degree = graph.connections.filter((entry) => entry.startNodeId === node.id || entry.endNodeId === node.id).length;
    if (degree > 2) node.handleMode = 'corner';
    else if (degree === 2 && node.handleMode !== 'corner') setSplineNodeHandleMode(graph, node.id, node.handleMode);
  }
  return connection;
}

export function removeSplineNode(graph: SplineGraph, id: number): boolean {
  const index = graph.nodes.findIndex((node) => node.id === id);
  if (index < 0) return false;
  graph.nodes.splice(index, 1);
  graph.connections = graph.connections.filter((connection) => (
    connection.startNodeId !== id && connection.endNodeId !== id
  ));
  const validConnectionIds = new Set(graph.connections.map((connection) => connection.id));
  if (graph.finishLine && !validConnectionIds.has(graph.finishLine.connectionId)) graph.finishLine = null;
  graph.checkpoints = graph.checkpoints.filter((checkpoint) => validConnectionIds.has(checkpoint.connectionId));
  return true;
}

export function removeSplineConnection(graph: SplineGraph, id: number): boolean {
  const index = graph.connections.findIndex((connection) => connection.id === id);
  if (index < 0) return false;
  graph.connections.splice(index, 1);
  if (graph.finishLine?.connectionId === id) graph.finishLine = null;
  graph.checkpoints = graph.checkpoints.filter((checkpoint) => checkpoint.connectionId !== id);
  return true;
}

export function moveSplineConnectionHandle(
  connection: SplineConnection,
  endpoint: 'start' | 'end',
  offset: SplinePoint,
): void {
  if (endpoint === 'start') connection.startHandle = { ...offset };
  else connection.endHandle = { ...offset };
}

function connectionHandleAtNode(connection: SplineConnection, nodeId: number): SplinePoint | null {
  if (connection.startNodeId === nodeId) return connection.startHandle;
  if (connection.endNodeId === nodeId) return connection.endHandle;
  return null;
}

export function setSplineNodeHandleMode(graph: SplineGraph, nodeId: number, mode: SplineHandleMode): boolean {
  const node = getSplineNode(graph, nodeId);
  if (!node) return false;
  const attached = graph.connections.filter((connection) => connection.startNodeId === nodeId || connection.endNodeId === nodeId);
  if (attached.length > 2 && mode !== 'corner') return false;
  node.handleMode = mode;
  if (mode !== 'corner' && attached.length === 2) {
    const reference = connectionHandleAtNode(attached[0]!, nodeId)!;
    moveSplineConnectionHandleAtNode(graph, attached[0]!.id, nodeId, reference);
  }
  return true;
}

export function moveSplineConnectionHandleAtNode(
  graph: SplineGraph,
  connectionId: number,
  nodeId: number,
  offset: SplinePoint,
): boolean {
  const node = getSplineNode(graph, nodeId);
  const connection = graph.connections.find((entry) => entry.id === connectionId);
  if (!node || !connection) return false;
  const endpoint = connection.startNodeId === nodeId ? 'start' : connection.endNodeId === nodeId ? 'end' : null;
  if (!endpoint) return false;
  moveSplineConnectionHandle(connection, endpoint, offset);

  const attached = graph.connections.filter((entry) => entry.startNodeId === nodeId || entry.endNodeId === nodeId);
  if (node.handleMode === 'corner' || attached.length !== 2) return true;
  const other = attached.find((entry) => entry.id !== connectionId)!;
  const otherHandle = connectionHandleAtNode(other, nodeId)!;
  const length = Math.hypot(offset.x, offset.y);
  const otherLength = node.handleMode === 'symmetric' ? length : Math.hypot(otherHandle.x, otherHandle.y);
  const mirrored = length < 1e-10 ? { x: 0, y: 0 } : {
    x: -offset.x / length * otherLength,
    y: -offset.y / length * otherLength,
  };
  moveSplineConnectionHandle(other, other.startNodeId === nodeId ? 'start' : 'end', mirrored);
  return true;
}

export function cubicBezierPoint(
  graph: Readonly<SplineGraph>,
  connection: Readonly<SplineConnection>,
  t: number,
): SplinePoint {
  const start = getSplineNode(graph, connection.startNodeId);
  const end = getSplineNode(graph, connection.endNodeId);
  if (!start || !end) throw new Error('Spline connection references a missing node.');
  const inverse = 1 - t;
  const startControl = { x: start.position.x + connection.startHandle.x, y: start.position.y + connection.startHandle.y };
  const endControl = { x: end.position.x + connection.endHandle.x, y: end.position.y + connection.endHandle.y };
  return {
    x: inverse ** 3 * start.position.x + 3 * inverse ** 2 * t * startControl.x
      + 3 * inverse * t ** 2 * endControl.x + t ** 3 * end.position.x,
    y: inverse ** 3 * start.position.y + 3 * inverse ** 2 * t * startControl.y
      + 3 * inverse * t ** 2 * endControl.y + t ** 3 * end.position.y,
  };
}

export function getSplineTrackFrame(
  graph: Readonly<SplineGraph>,
  location: Readonly<SplineTrackLocation>,
): SplineTrackFrame | null {
  const connection = graph.connections.find((entry) => entry.id === location.connectionId);
  if (!connection) return null;
  const start = getSplineNode(graph, connection.startNodeId)!;
  const end = getSplineNode(graph, connection.endNodeId)!;
  const t = clamp(location.progress);
  const inverse = 1 - t;
  const p0 = start.position;
  const p1 = { x: p0.x + connection.startHandle.x, y: p0.y + connection.startHandle.y };
  const p3 = end.position;
  const p2 = { x: p3.x + connection.endHandle.x, y: p3.y + connection.endHandle.y };
  let dx = 3 * inverse ** 2 * (p1.x - p0.x) + 6 * inverse * t * (p2.x - p1.x) + 3 * t ** 2 * (p3.x - p2.x);
  let dy = 3 * inverse ** 2 * (p1.y - p0.y) + 6 * inverse * t * (p2.y - p1.y) + 3 * t ** 2 * (p3.y - p2.y);
  const length = Math.hypot(dx, dy);
  if (length < 1e-10) {
    const before = cubicBezierPoint(graph, connection, Math.max(0, t - .001));
    const after = cubicBezierPoint(graph, connection, Math.min(1, t + .001));
    dx = after.x - before.x;
    dy = after.y - before.y;
  }
  const resolvedLength = Math.hypot(dx, dy) || 1;
  return {
    position: cubicBezierPoint(graph, connection, t),
    direction: { x: dx / resolvedLength, y: dy / resolvedLength },
    width: interpolateSplineWidth(start.width, end.width, t),
  };
}

function sampleSplineConnectionDistances(
  graph: Readonly<SplineGraph>,
  connection: Readonly<SplineConnection>,
  sampleCount = 256,
): { progress: number; distance: number }[] {
  const points: { progress: number; distance: number }[] = [{ progress: 0, distance: 0 }];
  let previous = cubicBezierPoint(graph, connection, 0);
  for (let index = 1; index <= sampleCount; index++) {
    const progress = index / sampleCount;
    const point = cubicBezierPoint(graph, connection, progress);
    points.push({
      progress,
      distance: points.at(-1)!.distance
        + Math.hypot(point.x - previous.x, point.y - previous.y) * SPLINE_EDITOR_WORLD_SIZE,
    });
    previous = point;
  }
  return points;
}

function distanceAtProgress(points: readonly { progress: number; distance: number }[], progress: number): number {
  const clamped = clamp(progress);
  const scaled = clamped * (points.length - 1);
  const before = points[Math.floor(scaled)]!;
  const after = points[Math.ceil(scaled)]!;
  return before.distance + (after.distance - before.distance) * (scaled - Math.floor(scaled));
}

export function canPlaceSplineFinishLine(
  graph: Readonly<SplineGraph>,
  connectionId: number,
  progress: number,
): boolean {
  const connection = graph.connections.find((entry) => entry.id === connectionId);
  if (!connection) return false;
  const distances = sampleSplineConnectionDistances(graph, connection);
  const fromStart = distanceAtProgress(distances, progress);
  const fromEnd = distances.at(-1)!.distance - fromStart;
  return fromStart >= SPLINE_START_SECTION_LENGTH && fromEnd >= SPLINE_START_SECTION_LENGTH;
}

/** Finds a track frame a measured distance behind a location on the same directed connection. Negative distances move ahead. */
export function getSplineTrackFrameBehind(
  graph: Readonly<SplineGraph>,
  location: Readonly<SplineTrackLocation>,
  distanceMeters: number,
): SplineTrackFrame | null {
  const connection = graph.connections.find((entry) => entry.id === location.connectionId);
  if (!connection) return null;
  const finishProgress = clamp(location.progress);
  if (distanceMeters === 0) return getSplineTrackFrame(graph, { ...location, progress: finishProgress });

  const points = sampleSplineConnectionDistances(graph, connection);
  const finishDistance = distanceAtProgress(points, finishProgress);
  const targetDistance = Math.max(0, Math.min(points.at(-1)!.distance, finishDistance - distanceMeters));
  let high = 1;
  while (high < points.length && points[high]!.distance < targetDistance) high++;
  const after = points[Math.min(high, points.length - 1)]!;
  const before = points[Math.max(0, high - 1)]!;
  const span = after.distance - before.distance;
  const amount = span > 1e-10 ? (targetDistance - before.distance) / span : 0;
  return getSplineTrackFrame(graph, {
    connectionId: location.connectionId,
    progress: before.progress + (after.progress - before.progress) * amount,
  });
}

/** Returns the five rows of two cars shown behind the finish line. */
export function getSplineStartGrid(graph: Readonly<SplineGraph>): SplineStartSlot[] {
  if (!graph.finishLine) return [];
  const rows = SPLINE_START_GRID_CARS / SPLINE_START_GRID_COLUMNS;
  const rowPitch = SPLINE_START_GRID_CAR_LENGTH + SPLINE_START_GRID_ROW_GAP;
  const firstRowDistance = SPLINE_START_GRID_CAR_LENGTH / 2 + 2;
  const slots: SplineStartSlot[] = [];
  for (let row = 0; row < rows; row++) {
    const directionSign = graph.finishLine.reversed ? -1 : 1;
    const frame = getSplineTrackFrameBehind(
      graph,
      graph.finishLine,
      (firstRowDistance + row * rowPitch) * directionSign,
    );
    if (!frame) continue;
    frame.direction.x *= directionSign;
    frame.direction.y *= directionSign;
    const desiredLateralOffset = SPLINE_START_GRID_CAR_WIDTH / 2 + .6;
    const availableLateralOffset = Math.max(0, frame.width / 2 - SPLINE_START_GRID_CAR_WIDTH / 2);
    const lateralOffset = Math.min(desiredLateralOffset, availableLateralOffset) / SPLINE_EDITOR_WORLD_SIZE;
    const left = { x: -frame.direction.y, y: frame.direction.x };
    for (let column = 0; column < SPLINE_START_GRID_COLUMNS; column++) {
      const lateral = column === 0 ? lateralOffset : -lateralOffset;
      slots.push({
        row,
        column,
        position: {
          x: frame.position.x + left.x * lateral,
          y: frame.position.y + left.y * lateral,
        },
        direction: { ...frame.direction },
      });
    }
  }
  return slots;
}
