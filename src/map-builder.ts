import { serializeSpline, splineTrackError } from './track/spline-records.ts';
import { listSharedTracks, getSharedTrack, saveSharedTrack, deleteSharedTrack } from './track/api.ts';
import { selectTrackForPlay, clearActiveTrack } from './track/storage.ts';
import { splinePresets } from './track/spline-presets.ts';
import { startAdmissionHeartbeat } from './admission.ts';
import { createSplinePreview } from './rendering/spline-preview.ts';
import { requireAccount } from './auth/session.ts';
import {
  addSplineCheckpoint,
  addSplineConnection,
  addSplineNode,
  clearSplineFinishLine,
  createSplineGraph,
  cubicBezierPoint,
  flipSplineFinishLine,
  getSplineStartGrid,
  getSplineTrackFrame,
  getSplineTrackFrameBehind,
  interpolateSplineWidth,
  getSplineNode,
  MAX_SPLINE_CHECKPOINTS,
  moveSplineConnectionHandleAtNode,
  moveSplineNode,
  resetSplineNodeWidth,
  removeSplineConnection,
  removeSplineCheckpoint,
  removeSplineNode,
  setSplineFinishLine,
  setSplineNodeHandleMode,
  setSplineNodeHeight,
  setSplineNodeHeightSteepness,
  setSplineDefaultWidth,
  setSplineNodeWidth,
  SPLINE_EDITOR_WORLD_SIZE,
  SPLINE_START_GRID_CAR_LENGTH,
  SPLINE_START_GRID_CAR_WIDTH,
  SPLINE_START_SECTION_LENGTH,
  type SplineConnection,
  type SplineHandleMode,
  type SplineNode,
  type SplinePoint,
  type SplineTrackLocation,
} from './track/spline.ts';

function initializeMapBuilder(canPublishRankedTracks: boolean): void {
startAdmissionHeartbeat();

const canvas = document.querySelector<HTMLCanvasElement>('#map-canvas')!;
const canvasArea = canvas.parentElement!;
const context = canvas.getContext('2d')!;
const coordinates = document.querySelector<HTMLOutputElement>('#pointer-position')!;
const summary = document.querySelector<HTMLOutputElement>('#spline-summary')!;
const selectionSummary = document.querySelector<HTMLOutputElement>('#selection-summary')!;
const message = document.querySelector<HTMLElement>('#builder-message')!;
const addButton = document.querySelector<HTMLButtonElement>('#add-point')!;
const connectButton = document.querySelector<HTMLButtonElement>('#connect-points')!;
const editButton = document.querySelector<HTMLButtonElement>('#edit-curve')!;
const widthButton = document.querySelector<HTMLButtonElement>('#edit-width')!;
const raceButton = document.querySelector<HTMLButtonElement>('#edit-race')!;
const heightButton = document.querySelector<HTMLButtonElement>('#edit-height')!;
const deleteButton = document.querySelector<HTMLButtonElement>('#delete-selection')!;
const clearButton = document.querySelector<HTMLButtonElement>('#clear-track')!;
const handleOptions = document.querySelector<HTMLElement>('#handle-options')!;
const widthPanel = document.querySelector<HTMLElement>('#width-panel')!;
const defaultWidthInput = document.querySelector<HTMLInputElement>('#default-width')!;
const defaultWidthValue = document.querySelector<HTMLOutputElement>('#default-width-value')!;
const pointWidthOptions = document.querySelector<HTMLElement>('#point-width-options')!;
const pointWidthInput = document.querySelector<HTMLInputElement>('#point-width')!;
const pointWidthValue = document.querySelector<HTMLOutputElement>('#point-width-value')!;
const resetPointWidthButton = document.querySelector<HTMLButtonElement>('#reset-point-width')!;
const heightPanel = document.querySelector<HTMLElement>('#height-panel')!;
const heightEmpty = document.querySelector<HTMLElement>('#height-empty')!;
const pointHeightOptions = document.querySelector<HTMLElement>('#point-height-options')!;
const pointHeightInput = document.querySelector<HTMLInputElement>('#point-height')!;
const pointHeightValue = document.querySelector<HTMLOutputElement>('#point-height-value')!;
const pointSteepnessInput = document.querySelector<HTMLInputElement>('#point-steepness')!;
const pointSteepnessValue = document.querySelector<HTMLOutputElement>('#point-steepness-value')!;
const racePanel = document.querySelector<HTMLElement>('#race-panel')!;
const placeFinishButton = document.querySelector<HTMLButtonElement>('#place-finish')!;
const placeCheckpointButton = document.querySelector<HTMLButtonElement>('#place-checkpoint')!;
const finishStatus = document.querySelector<HTMLOutputElement>('#finish-status')!;
const flipFinishButton = document.querySelector<HTMLButtonElement>('#flip-finish')!;
const clearFinishButton = document.querySelector<HTMLButtonElement>('#clear-finish')!;
const checkpointCount = document.querySelector<HTMLOutputElement>('#checkpoint-count')!;
const checkpointList = document.querySelector<HTMLElement>('#checkpoint-list')!;
const visualWorkspace = document.querySelector<HTMLElement>('#visual-workspace')!;
const previewPanel = document.querySelector<HTMLElement>('#preview-panel')!;
const previewCanvas = document.querySelector<HTMLCanvasElement>('#preview-canvas')!;
const previewStatus = document.querySelector<HTMLOutputElement>('#preview-status')!;
const preview = createSplinePreview(previewCanvas);

const graph = createSplineGraph();
const trackName=document.querySelector<HTMLInputElement>('#track-name')!;
const trackVisibility=document.querySelector<HTMLSelectElement>('#track-visibility')!;
const rankedOption=trackVisibility.querySelector<HTMLOptionElement>('option[value="ranked"]')!;
rankedOption.disabled=!canPublishRankedTracks;
document.querySelector<HTMLElement>('#publish-approval')!.textContent=canPublishRankedTracks
  ? 'Approved creator: you can publish ranked multiplayer tracks or save personal tracks.'
  : 'Personal tracks are private and unranked. Ranked multiplayer publishing requires account approval.';
const librarySelect=document.querySelector<HTMLSelectElement>('#saved-tracks')!;
const libraryStatus=document.querySelector<HTMLElement>('#library-status')!;
const saveButton=document.querySelector<HTMLButtonElement>('#save-track')!;
const playButton=document.querySelector<HTMLButtonElement>('#play-track')!;
let libraryBusy=false;
function updateSaveState(){
  const error=splineTrackError(serializeSpline(graph));
  document.querySelector('#save-requirement')!.textContent=error ?? 'Finished track. Ready to save.';
  saveButton.disabled=playButton.disabled=libraryBusy||!!error||!trackName.value.trim();
}
trackName.addEventListener('input',updateSaveState);
let nextNodeId = 1;
let nextConnectionId = 1;
let nextCheckpointId = 1;
let selectedNodeId: number | null = null;
let selectedConnectionId: number | null = null;
let connectionStartId: number | null = null;
type EditorTool = 'add' | 'connect' | 'edit' | 'width' | 'race' | 'height';
let tool: EditorTool = 'add';
let racePlacementMode: 'finish' | 'checkpoint' = 'finish';
let drawnInsetCheckpointMarkers = 0;
let drag: ({ kind: 'node'; nodeId: number } | { kind: 'handle'; connectionId: number; nodeId: number })
  & { pointerId: number } | null = null;
let size = { width: 1, height: 1, pixelRatio: 1 };

function selectedConnection(): SplineConnection | undefined {
  return graph.connections.find((connection) => connection.id === selectedConnectionId);
}

function toCanvas(point: Readonly<SplinePoint>): SplinePoint {
  return { x: point.x * size.width, y: point.y * size.height };
}

function fromPointer(event: PointerEvent): SplinePoint {
  const bounds = canvas.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
    y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)),
  };
}

function pixelDistance(a: Readonly<SplinePoint>, b: Readonly<SplinePoint>): number {
  return Math.hypot((a.x - b.x) * size.width, (a.y - b.y) * size.height);
}

function connectionControlPoint(connection: SplineConnection, endpoint: 'start' | 'end'): SplinePoint {
  const nodeId = endpoint === 'start' ? connection.startNodeId : connection.endNodeId;
  const node = getSplineNode(graph, nodeId)!;
  const handle = endpoint === 'start' ? connection.startHandle : connection.endHandle;
  return { x: node.position.x + handle.x, y: node.position.y + handle.y };
}

function hitNode(point: SplinePoint): SplineNode | null {
  for (let index = graph.nodes.length - 1; index >= 0; index--) {
    const node = graph.nodes[index]!;
    if (pixelDistance(point, node.position) <= 12) return node;
  }
  return null;
}

function visibleHandles(): { connection: SplineConnection; nodeId: number; control: SplinePoint }[] {
  if (selectedNodeId !== null) return graph.connections.flatMap((connection) => {
    if (connection.startNodeId === selectedNodeId) return [{ connection, nodeId: selectedNodeId, control: connectionControlPoint(connection, 'start') }];
    if (connection.endNodeId === selectedNodeId) return [{ connection, nodeId: selectedNodeId, control: connectionControlPoint(connection, 'end') }];
    return [];
  });
  const connection = selectedConnection();
  return connection ? [
    { connection, nodeId: connection.startNodeId, control: connectionControlPoint(connection, 'start') },
    { connection, nodeId: connection.endNodeId, control: connectionControlPoint(connection, 'end') },
  ] : [];
}

function hitVisibleHandle(point: SplinePoint): { connectionId: number; nodeId: number } | null {
  for (const handle of visibleHandles()) {
    if (pixelDistance(point, handle.control) <= 13) return { connectionId: handle.connection.id, nodeId: handle.nodeId };
  }
  return null;
}

function pointToSegmentDistance(point: SplinePoint, start: SplinePoint, end: SplinePoint): number {
  const px = point.x * size.width, py = point.y * size.height;
  const ax = start.x * size.width, ay = start.y * size.height;
  const bx = end.x * size.width, by = end.y * size.height;
  const dx = bx - ax, dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

function hitConnectionPlacement(point: SplinePoint): { connection: SplineConnection; progress: number } | null {
  let closest: { connection: SplineConnection; progress: number; distance: number } | null = null;
  for (let connectionIndex = graph.connections.length - 1; connectionIndex >= 0; connectionIndex--) {
    const connection = graph.connections[connectionIndex]!;
    let previous = cubicBezierPoint(graph, connection, 0);
    for (let sample = 1; sample <= 32; sample++) {
      const current = cubicBezierPoint(graph, connection, sample / 32);
      const distance = pointToSegmentDistance(point, previous, current);
      if (distance <= 9 && (!closest || distance < closest.distance)) {
        const px = point.x * size.width, py = point.y * size.height;
        const ax = previous.x * size.width, ay = previous.y * size.height;
        const bx = current.x * size.width, by = current.y * size.height;
        const dx = bx - ax, dy = by - ay;
        const lengthSquared = dx * dx + dy * dy;
        const along = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
        closest = { connection, progress: (sample - 1 + along) / 32, distance };
      }
      previous = current;
    }
  }
  return closest ? { connection: closest.connection, progress: closest.progress } : null;
}

function hitConnection(point: SplinePoint): SplineConnection | null {
  return hitConnectionPlacement(point)?.connection ?? null;
}

function feedback(text: string): void {
  message.textContent = text;
}

function updateInterface(): void {
  const points = graph.nodes.length;
  const connections = graph.connections.length;
  summary.value = `${points} point${points === 1 ? '' : 's'} · ${connections} connection${connections === 1 ? '' : 's'}`;
  if (connectionStartId !== null) selectionSummary.value = `Connecting from point ${connectionStartId}`;
  else if (selectedNodeId !== null) selectionSummary.value = `Point ${selectedNodeId} selected`;
  else if (selectedConnectionId !== null) selectionSummary.value = `Connection ${selectedConnectionId} selected`;
  else selectionSummary.value = 'Nothing selected';
  deleteButton.disabled = selectedNodeId === null && selectedConnectionId === null;
  deleteButton.textContent = selectedNodeId !== null ? 'Delete selected point'
    : selectedConnectionId !== null ? 'Delete selected connection' : 'Delete selection';
  clearButton.disabled = points === 0;
  const selectedNode = selectedNodeId === null ? undefined : getSplineNode(graph, selectedNodeId);
  const selectedDegree = selectedNode ? graph.connections.filter((connection) => (
    connection.startNodeId === selectedNode.id || connection.endNodeId === selectedNode.id
  )).length : 0;
  handleOptions.hidden = tool !== 'edit' || !selectedNode;
  widthPanel.hidden = tool !== 'width';
  heightPanel.hidden = tool !== 'height';
  heightEmpty.hidden = tool !== 'height' || Boolean(selectedNode);
  pointHeightOptions.hidden = tool !== 'height' || !selectedNode;
  racePanel.hidden = tool !== 'race';
  placeFinishButton.setAttribute('aria-pressed', String(racePlacementMode === 'finish'));
  placeCheckpointButton.setAttribute('aria-pressed', String(racePlacementMode === 'checkpoint'));
  placeCheckpointButton.disabled = graph.checkpoints.length >= MAX_SPLINE_CHECKPOINTS;
  finishStatus.value = graph.finishLine
    ? `Finish line on connection ${graph.finishLine.connectionId} · ${graph.finishLine.reversed ? 'Reversed' : 'Forward'}`
    : 'No finish line placed';
  flipFinishButton.disabled = graph.finishLine === null;
  clearFinishButton.disabled = graph.finishLine === null;
  checkpointCount.value = `${graph.checkpoints.length} / ${MAX_SPLINE_CHECKPOINTS}`;
  checkpointList.replaceChildren();
  if (!graph.checkpoints.length) {
    const empty = document.createElement('p');
    empty.className = 'help';
    empty.textContent = 'No checkpoints added.';
    checkpointList.append(empty);
  } else {
    graph.checkpoints.forEach((checkpoint) => {
      const entry = document.createElement('div');
      entry.className = 'checkpoint-entry';
      const label = document.createElement('span');
      label.textContent = `Checkpoint · Connection ${checkpoint.connectionId}`;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = 'Remove';
      remove.setAttribute('aria-label', 'Remove checkpoint');
      remove.addEventListener('click', () => {
        removeSplineCheckpoint(graph, checkpoint.id);
        feedback('Checkpoint removed.');
        draw();
      });
      entry.append(label, remove);
      checkpointList.append(entry);
    });
  }
  const isThreeDimensional = tool === 'height';
  previewPanel.hidden = !isThreeDimensional;
  visualWorkspace.classList.toggle('preview-active', isThreeDimensional);
  preview.setActive(isThreeDimensional);
  for (const button of handleOptions.querySelectorAll<HTMLButtonElement>('[data-handle-mode]')) {
    const mode = button.dataset.handleMode as SplineHandleMode;
    button.setAttribute('aria-pressed', String(selectedNode?.handleMode === mode));
    button.disabled = selectedDegree > 2 && mode !== 'corner';
  }
  defaultWidthInput.value = String(graph.defaultWidth);
  defaultWidthValue.value = `${graph.defaultWidth.toFixed(1)} m`;
  pointWidthOptions.hidden = tool !== 'width' || !selectedNode;
  if (selectedNode) {
    pointWidthInput.value = String(selectedNode.width);
    pointWidthValue.value = `${selectedNode.width.toFixed(1)} m`;
    resetPointWidthButton.disabled = selectedNode.usesDefaultWidth;
    pointHeightInput.value = String(selectedNode.height);
    pointHeightValue.value = `${selectedNode.height.toFixed(1)} m`;
    pointSteepnessInput.value = String(selectedNode.heightSteepness);
    pointSteepnessValue.value = `${Math.round(selectedNode.heightSteepness)}%`;
  }
  if (isThreeDimensional) {
    preview.update(graph, selectedNodeId);
    const diagnostics = preview.getDiagnostics();
    previewStatus.value = diagnostics.warnings
      ? `${diagnostics.warnings} tight-curve warning${diagnostics.warnings === 1 ? '' : 's'}`
      : `${diagnostics.polygons} continuous surface${diagnostics.polygons === 1 ? '' : 's'}`;
  }
}

function strokeConnection(connection: SplineConnection): void {
  const start = toCanvas(getSplineNode(graph, connection.startNodeId)!.position);
  const end = toCanvas(getSplineNode(graph, connection.endNodeId)!.position);
  const startControl = toCanvas(connectionControlPoint(connection, 'start'));
  const endControl = toCanvas(connectionControlPoint(connection, 'end'));
  context.beginPath();
  context.moveTo(start.x, start.y);
  context.bezierCurveTo(startControl.x, startControl.y, endControl.x, endControl.y, end.x, end.y);
  context.stroke();
}

function drawGrid(): void {
  context.strokeStyle = '#ffffff0c';
  context.lineWidth = 1;
  context.beginPath();
  for (let x = 40; x < size.width; x += 40) { context.moveTo(x, 0); context.lineTo(x, size.height); }
  for (let y = 40; y < size.height; y += 40) { context.moveTo(0, y); context.lineTo(size.width, y); }
  context.stroke();
}

function drawConnectionSurface(connection: SplineConnection): void {
  const startNode = getSplineNode(graph, connection.startNodeId)!;
  const endNode = getSplineNode(graph, connection.endNodeId)!;
  const points = Array.from({ length: 49 }, (_, index) => cubicBezierPoint(graph, connection, index / 48));
  const distances = [0];
  for (let index = 1; index < points.length; index++) {
    const previous = points[index - 1]!, current = points[index]!;
    distances.push(distances[index - 1]! + Math.hypot(current.x - previous.x, current.y - previous.y));
  }
  const totalDistance = distances.at(-1) || 1;
  const left: SplinePoint[] = [], right: SplinePoint[] = [];
  const widthScale = Math.min(size.width, size.height) / SPLINE_EDITOR_WORLD_SIZE;

  for (let index = 0; index < points.length; index++) {
    const center = toCanvas(points[index]!);
    const before = toCanvas(points[Math.max(0, index - 1)]!);
    const after = toCanvas(points[Math.min(points.length - 1, index + 1)]!);
    const dx = after.x - before.x, dy = after.y - before.y;
    const tangentLength = Math.hypot(dx, dy) || 1;
    const halfWidth = interpolateSplineWidth(startNode.width, endNode.width, distances[index]! / totalDistance) * widthScale / 2;
    const normalX = -dy / tangentLength, normalY = dx / tangentLength;
    left.push({ x: center.x + normalX * halfWidth, y: center.y + normalY * halfWidth });
    right.push({ x: center.x - normalX * halfWidth, y: center.y - normalY * halfWidth });
  }

  context.fillStyle = '#53636c';
  context.beginPath();
  context.moveTo(left[0]!.x, left[0]!.y);
  for (let index = 1; index < left.length; index++) context.lineTo(left[index]!.x, left[index]!.y);
  for (let index = right.length - 1; index >= 0; index--) context.lineTo(right[index]!.x, right[index]!.y);
  context.closePath();
  context.fill();
}

function drawJunctionSurfaces(): void {
  const widthScale = Math.min(size.width, size.height) / SPLINE_EDITOR_WORLD_SIZE;
  context.fillStyle = '#53636c';
  for (const node of graph.nodes) {
    if (!graph.connections.some((connection) => connection.startNodeId === node.id || connection.endNodeId === node.id)) continue;
    const point = toCanvas(node.position);
    context.beginPath();
    context.arc(point.x, point.y, node.width * widthScale / 2, 0, Math.PI * 2);
    context.fill();
  }
}

function markerGeometry(location: Readonly<SplineTrackLocation>) {
  const frame = getSplineTrackFrame(graph, location);
  if (!frame) return null;
  const center = toCanvas(frame.position);
  const tangentLength = Math.hypot(frame.direction.x * size.width, frame.direction.y * size.height) || 1;
  const tangent = {
    x: frame.direction.x * size.width / tangentLength,
    y: frame.direction.y * size.height / tangentLength,
  };
  return {
    frame,
    center,
    tangent,
    normal: { x: -tangent.y, y: tangent.x },
    worldScale: Math.min(size.width, size.height) / SPLINE_EDITOR_WORLD_SIZE,
  };
}

function drawCrossTrackLine(location: Readonly<SplineTrackLocation>, color: string, label?: string): void {
  const geometry = markerGeometry(location);
  if (!geometry) return;
  const halfWidth = geometry.frame.width * geometry.worldScale / 2;
  context.lineCap = 'butt';
  context.lineWidth = 4;
  const segments = label ? 8 : 1;
  for (let index = 0; index < segments; index++) {
    const from = -halfWidth + index / segments * halfWidth * 2;
    const to = -halfWidth + (index + 1) / segments * halfWidth * 2;
    context.strokeStyle = label && index % 2 ? '#101a21' : color;
    context.beginPath();
    context.moveTo(geometry.center.x + geometry.normal.x * from, geometry.center.y + geometry.normal.y * from);
    context.lineTo(geometry.center.x + geometry.normal.x * to, geometry.center.y + geometry.normal.y * to);
    context.stroke();
  }
  if (!label) return;
  context.fillStyle = color;
  context.font = '700 10px system-ui, sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.beginPath();
  context.arc(geometry.center.x, geometry.center.y - 13, 9, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = '#101a21';
  context.fillText(label, geometry.center.x, geometry.center.y - 13);
}

function drawStartGrid(): void {
  if (!graph.finishLine) return;
  const geometry = markerGeometry(graph.finishLine);
  if (!geometry) return;
  const sectionLength = SPLINE_START_SECTION_LENGTH;
  const sectionFrames = Array.from({ length: 25 }, (_, index) => (
    getSplineTrackFrameBehind(
      graph,
      graph.finishLine!,
      sectionLength * index / 24 * (graph.finishLine!.reversed ? -1 : 1),
    )
  )).filter((frame): frame is NonNullable<typeof frame> => frame !== null);
  const leftEdge = sectionFrames.map((frame) => {
    const point = toCanvas(frame.position);
    const normalLength = Math.hypot(frame.direction.x * size.width, frame.direction.y * size.height) || 1;
    return {
      x: point.x - frame.direction.y * size.height / normalLength * frame.width * geometry.worldScale / 2,
      y: point.y + frame.direction.x * size.width / normalLength * frame.width * geometry.worldScale / 2,
    };
  });
  const rightEdge = sectionFrames.map((frame) => {
    const point = toCanvas(frame.position);
    const normalLength = Math.hypot(frame.direction.x * size.width, frame.direction.y * size.height) || 1;
    return {
      x: point.x + frame.direction.y * size.height / normalLength * frame.width * geometry.worldScale / 2,
      y: point.y - frame.direction.x * size.width / normalLength * frame.width * geometry.worldScale / 2,
    };
  }).reverse();
  context.fillStyle = '#ee71361c';
  context.strokeStyle = '#ee713677';
  context.lineWidth = 1.5;
  context.beginPath();
  [...leftEdge, ...rightEdge].forEach((point, index) => {
    if (index === 0) context.moveTo(point.x, point.y);
    else context.lineTo(point.x, point.y);
  });
  context.closePath();
  context.fill();
  context.stroke();

  const slots = getSplineStartGrid(graph);
  for (const slot of slots) {
    const point = toCanvas(slot.position);
    const angle = Math.atan2(slot.direction.y * size.height, slot.direction.x * size.width);
    context.save();
    context.translate(point.x, point.y);
    context.rotate(angle);
    context.fillStyle = slot.column === 0 ? '#6bc5ffcc' : '#ee7136cc';
    context.strokeStyle = '#101a21';
    context.lineWidth = 1;
    context.fillRect(
      -SPLINE_START_GRID_CAR_LENGTH * geometry.worldScale / 2,
      -SPLINE_START_GRID_CAR_WIDTH * geometry.worldScale / 2,
      SPLINE_START_GRID_CAR_LENGTH * geometry.worldScale,
      SPLINE_START_GRID_CAR_WIDTH * geometry.worldScale,
    );
    context.strokeRect(
      -SPLINE_START_GRID_CAR_LENGTH * geometry.worldScale / 2,
      -SPLINE_START_GRID_CAR_WIDTH * geometry.worldScale / 2,
      SPLINE_START_GRID_CAR_LENGTH * geometry.worldScale,
      SPLINE_START_GRID_CAR_WIDTH * geometry.worldScale,
    );
    context.restore();
  }
}

function drawRaceMarkers(): void {
  drawnInsetCheckpointMarkers = 0;
  if (graph.finishLine) {
    if (tool === 'race') drawStartGrid();
    drawCrossTrackLine(graph.finishLine, '#f5f7f8', 'F');
  }
  if (tool !== 'height') {
    graph.checkpoints.forEach((checkpoint) => {
      drawCrossTrackLine(checkpoint, '#4bb9ff');
      drawnInsetCheckpointMarkers++;
    });
  }
}

function draw(): void {
  updateSaveState();
  context.setTransform(size.pixelRatio, 0, 0, size.pixelRatio, 0, 0);
  context.clearRect(0, 0, size.width, size.height);
  context.fillStyle = '#101a21';
  context.fillRect(0, 0, size.width, size.height);
  drawGrid();

  for (const connection of graph.connections) drawConnectionSurface(connection);
  drawJunctionSurfaces();

  context.lineCap = 'round';
  context.lineJoin = 'round';
  for (const connection of graph.connections) {
    const selected = connection.id === selectedConnectionId || (selectedNodeId !== null
      && (connection.startNodeId === selectedNodeId || connection.endNodeId === selectedNodeId));
    context.strokeStyle = selected ? '#ee7136' : '#d9e4e9';
    context.lineWidth = selected ? 5 : 4;
    strokeConnection(connection);
  }

  drawRaceMarkers();

  if (tool === 'edit') {
    for (const handle of visibleHandles()) {
      const node = toCanvas(getSplineNode(graph, handle.nodeId)!.position);
      const control = toCanvas(handle.control);
      context.strokeStyle = '#ee7136aa';
      context.lineWidth = 1.5;
      context.beginPath();
      context.moveTo(node.x, node.y);
      context.lineTo(control.x, control.y);
      context.stroke();
      context.fillStyle = '#142028';
      context.strokeStyle = '#ee7136';
      context.lineWidth = 2;
      context.beginPath();
      context.rect(control.x - 5, control.y - 5, 10, 10);
      context.fill();
      context.stroke();
    }
  }

  for (const node of graph.nodes) {
    const point = toCanvas(node.position);
    const isConnectionStart = node.id === connectionStartId;
    context.fillStyle = isConnectionStart ? '#8ce5ad' : node.id === selectedNodeId ? '#ee7136' : '#6bc5ff';
    context.strokeStyle = '#101a21';
    context.lineWidth = 3;
    context.beginPath();
    context.arc(point.x, point.y, isConnectionStart || node.id === selectedNodeId ? 8 : 7, 0, Math.PI * 2);
    context.fill();
    context.stroke();
  }
  updateInterface();
}

function selectNode(id: number | null): void {
  selectedNodeId = id;
  selectedConnectionId = null;
}

function selectConnection(id: number | null): void {
  selectedConnectionId = id;
  selectedNodeId = null;
}

function addNodeAt(point: SplinePoint): SplineNode | null {
  const node = addSplineNode(graph, point, nextNodeId);
  if (!node) {
    feedback('That point is too close to another point. Leave a small gap between them.');
    return null;
  }
  nextNodeId++;
  return node;
}

function connectTo(endNode: SplineNode): void {
  if (connectionStartId === null) {
    connectionStartId = endNode.id;
    selectNode(endNode.id);
    feedback('Starting point selected. Choose another point or click empty space to extend the route.');
    return;
  }
  const connection = addSplineConnection(graph, connectionStartId, endNode.id, nextConnectionId);
  if (!connection) {
    feedback(connectionStartId === endNode.id
      ? 'Choose a different point to create a connection.'
      : 'Those points are already connected.');
    return;
  }
  nextConnectionId++;
  selectedConnectionId = connection.id;
  selectedNodeId = endNode.id;
  connectionStartId = endNode.id;
  feedback('Connection created. Keep selecting points to continue, or press Escape to end this route.');
}

function setTool(next: EditorTool): void {
  tool = next;
  if (tool !== 'connect') connectionStartId = null;
  if (tool === 'race') selectedNodeId = selectedConnectionId = null;
  if (tool === 'height' && selectedConnectionId !== null) selectedConnectionId = null;
  for (const button of [addButton, connectButton, editButton, widthButton, raceButton, heightButton]) button.setAttribute('aria-pressed', String(
    (button === addButton && tool === 'add') || (button === connectButton && tool === 'connect')
      || (button === editButton && tool === 'edit') || (button === widthButton && tool === 'width')
      || (button === raceButton && tool === 'race') || (button === heightButton && tool === 'height'),
  ));
  canvas.className = tool;
  feedback(tool === 'add' ? 'Click empty space to add independent points.'
    : tool === 'connect' ? 'Choose two existing points to connect. Click empty space to clear the selection.'
      : tool === 'edit' ? 'Select a point to reveal its curve handles, then drag the handles or the point.'
        : tool === 'width' ? 'Select a point to customize its width, or change the default width for inherited points.'
          : tool === 'race' ? 'Click a curve to place the finish line and its 10-car starting grid.'
            : 'Select a point to set its height and rounded steepness, then orbit or zoom the 3D preview.');
  draw();
}

canvas.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
  const point = fromPointer(event);

  if (tool === 'edit') {
    const handle = hitVisibleHandle(point);
    if (handle) {
      drag = { kind: 'handle', connectionId: handle.connectionId, nodeId: handle.nodeId, pointerId: event.pointerId };
      canvas.setPointerCapture(event.pointerId);
      event.preventDefault();
      return;
    }
  }

  if (tool === 'race') {
    const placement = hitConnectionPlacement(point);
    if (!placement) {
      feedback(`Click directly on a curve to place the ${racePlacementMode === 'finish' ? 'finish line' : 'checkpoint'}.`);
    } else if (racePlacementMode === 'finish') {
      const finishLine = setSplineFinishLine(graph, placement.connection.id, placement.progress);
      feedback(finishLine
        ? `Finish line and 10-car grid placed on connection ${placement.connection.id}.`
        : `Cannot place the finish line that close to a point. Leave at least ${SPLINE_START_SECTION_LENGTH.toFixed(0)} m on both sides.`);
    } else {
      const checkpoint = addSplineCheckpoint(graph, placement.connection.id, placement.progress, nextCheckpointId);
      if (checkpoint) {
        nextCheckpointId++;
        feedback('Checkpoint added.');
        if (graph.checkpoints.length >= MAX_SPLINE_CHECKPOINTS) racePlacementMode = 'finish';
      } else feedback('The maximum of three checkpoints has already been reached.');
    }
    draw();
    return;
  }

  const node = hitNode(point);
  if (node) {
    if (tool === 'connect') connectTo(node);
    else {
      selectNode(node.id);
      if (tool === 'edit') {
        drag = { kind: 'node', nodeId: node.id, pointerId: event.pointerId };
        canvas.setPointerCapture(event.pointerId);
        event.preventDefault();
      }
    }
    draw();
    return;
  }

  if (tool === 'edit') {
    const connection = hitConnection(point);
    if (connection) {
      selectConnection(connection.id);
      feedback('Connection selected. Select either endpoint to edit that point’s handles.');
    } else {
      selectConnection(null);
      feedback('Nothing selected.');
    }
    draw();
    return;
  }

  if (tool === 'connect') {
    connectionStartId = null;
    selectedNodeId = null;
    selectedConnectionId = null;
    feedback('Connection selection cleared. Choose a new starting point.');
    draw();
    return;
  }

  if (tool === 'width' || tool === 'height') {
    selectNode(null);
    feedback(tool === 'width' ? 'Width selection cleared. Select a point to edit its width.'
      : 'Height selection cleared. Select a point to edit its elevation.');
    draw();
    return;
  }

  const added = addNodeAt(point);
  if (!added) return;
  selectNode(added.id);
  feedback('Point added. Add more points or use Connect to join them.');
  draw();
});

canvas.addEventListener('pointermove', (event) => {
  const point = fromPointer(event);
  coordinates.value = `X ${Math.round(point.x * 100)} · Y ${Math.round(point.y * 100)}`;
  if (!drag || drag.pointerId !== event.pointerId) return;
  if (drag.kind === 'node') {
    const resolved = moveSplineNode(graph, drag.nodeId, point);
    if (resolved && Math.hypot(resolved.x - point.x, resolved.y - point.y) > 1e-5) {
      feedback('Sliding along another point’s spacing radius.');
    }
  } else {
    const node = getSplineNode(graph, drag.nodeId);
    if (!node) return;
    moveSplineConnectionHandleAtNode(graph, drag.connectionId, drag.nodeId, {
      x: point.x - node.position.x,
      y: point.y - node.position.y,
    });
  }
  draw();
});

function endDrag(event: PointerEvent): void {
  if (drag?.pointerId === event.pointerId) drag = null;
}
for (const event of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) canvas.addEventListener(event, endDrag);

addButton.addEventListener('click', () => setTool('add'));
connectButton.addEventListener('click', () => setTool('connect'));
editButton.addEventListener('click', () => setTool('edit'));
widthButton.addEventListener('click', () => setTool('width'));
raceButton.addEventListener('click', () => setTool('race'));
heightButton.addEventListener('click', () => setTool('height'));
for (const button of handleOptions.querySelectorAll<HTMLButtonElement>('[data-handle-mode]')) {
  button.addEventListener('click', () => {
    if (selectedNodeId === null) return;
    const mode = button.dataset.handleMode as SplineHandleMode;
    if (setSplineNodeHandleMode(graph, selectedNodeId, mode)) {
      feedback(`${button.textContent} handle behavior selected.`);
      draw();
    }
  });
}
defaultWidthInput.addEventListener('input', () => {
  setSplineDefaultWidth(graph, Number(defaultWidthInput.value));
  feedback('Default width updated. Points using the default changed with it.');
  draw();
});
pointWidthInput.addEventListener('input', () => {
  if (selectedNodeId === null) return;
  setSplineNodeWidth(graph, selectedNodeId, Number(pointWidthInput.value));
  feedback(`Point ${selectedNodeId} now has a custom width.`);
  draw();
});
resetPointWidthButton.addEventListener('click', () => {
  if (selectedNodeId === null) return;
  resetSplineNodeWidth(graph, selectedNodeId);
  feedback(`Point ${selectedNodeId} now follows the default width.`);
  draw();
});
pointHeightInput.addEventListener('input', () => {
  if (selectedNodeId === null) return;
  setSplineNodeHeight(graph, selectedNodeId, Number(pointHeightInput.value));
  feedback(`Point ${selectedNodeId} height updated.`);
  draw();
});
pointSteepnessInput.addEventListener('input', () => {
  if (selectedNodeId === null) return;
  setSplineNodeHeightSteepness(graph, selectedNodeId, Number(pointSteepnessInput.value));
  feedback(`Point ${selectedNodeId} steepness updated.`);
  draw();
});
placeFinishButton.addEventListener('click', () => {
  racePlacementMode = 'finish';
  feedback('Click a curve to place or move the finish line and starting grid.');
  draw();
});
placeCheckpointButton.addEventListener('click', () => {
  if (graph.checkpoints.length >= MAX_SPLINE_CHECKPOINTS) return;
  racePlacementMode = 'checkpoint';
  feedback('Click a curve to add a checkpoint. Up to three are allowed.');
  draw();
});
clearFinishButton.addEventListener('click', () => {
  clearSplineFinishLine(graph);
  feedback('Finish line cleared.');
  draw();
});
flipFinishButton.addEventListener('click', () => {
  if (!graph.finishLine) return;
  const reversed = flipSplineFinishLine(graph);
  feedback(`Finish direction flipped to ${reversed ? 'reversed' : 'forward'}.`);
  draw();
});
deleteButton.addEventListener('click', () => {
  if (selectedNodeId !== null) {
    const removedId = selectedNodeId;
    removeSplineNode(graph, removedId);
    if (connectionStartId === removedId) connectionStartId = null;
    selectNode(null);
    feedback('Point and its connected curves deleted.');
  } else if (selectedConnectionId !== null) {
    removeSplineConnection(graph, selectedConnectionId);
    selectConnection(null);
    feedback('Connection deleted.');
  }
  draw();
});
clearButton.addEventListener('click', () => {
  graph.nodes.length = 0;
  graph.connections.length = 0;
  graph.finishLine = null;
  graph.checkpoints.length = 0;
  selectedNodeId = selectedConnectionId = connectionStartId = null;
  feedback('Canvas cleared.');
  draw();
});

window.addEventListener('keydown', (event) => {
  if(event.target instanceof HTMLElement && (event.target.isContentEditable || event.target.closest('input,select,textarea'))) return;
  if ((event.key === 'Delete' || event.key === 'Backspace') && !deleteButton.disabled) {
    event.preventDefault();
    deleteButton.click();
  } else if (event.key === 'Escape') {
    selectedNodeId = selectedConnectionId = connectionStartId = null;
    feedback(tool === 'connect' ? 'Route ended. Choose a new starting point.' : 'Selection cleared.');
    draw();
  }
});

new ResizeObserver(() => {
  const bounds = canvasArea.getBoundingClientRect();
  size = {
    width: Math.max(1, Math.floor(bounds.width)),
    height: Math.max(1, Math.floor(bounds.height)),
    pixelRatio: Math.min(devicePixelRatio, 2),
  };
  canvas.style.width = `${size.width}px`;
  canvas.style.height = `${size.height}px`;
  canvas.width = Math.round(size.width * size.pixelRatio);
  canvas.height = Math.round(size.height * size.pixelRatio);
  draw();
}).observe(canvasArea);

// Editor diagnostics used by integration tests.
Object.assign(window, {
  splineBuilder: {
    graph,
    cubicBezierPoint,
    getStartGrid: () => getSplineStartGrid(graph),
    getEditorDiagnostics: () => ({ drawnInsetCheckpointMarkers }),
    getPreviewDiagnostics: preview.getDiagnostics,
  },
});
window.addEventListener('pagehide', () => preview.dispose(), { once: true });
setTool('add');

async function refreshLibrary(){
  try {
    const previous=librarySelect.value;
    const tracks=[...splinePresets.map(p=>({id:p.id,name:p.name})),
      ...(await listSharedTracks()).map(track=>({id:track.id,
        name:`${track.visibility === 'personal' ? 'Personal' : 'Ranked'} · ${track.name}`}))];
    librarySelect.replaceChildren(new Option('Select a track',''));
    for(const track of tracks)librarySelect.add(new Option(track.name,track.id));
    if(tracks.some(t=>t.id===previous))librarySelect.value=previous;
  }catch(error){libraryStatus.textContent=(error as Error).message;}
}
async function save(play=false){
  const layout=serializeSpline(graph),name=trackName.value.trim();
  const error=splineTrackError(layout);if(error){libraryStatus.textContent=error;return;}
  libraryBusy=true;updateSaveState();
  try {
    const track=await saveSharedTrack(name,layout,trackVisibility.value as 'ranked' | 'personal');
    libraryStatus.textContent=track.visibility === 'ranked'
      ? 'Ranked track saved. It is available for leaderboards and multiplayer.'
      : 'Personal track saved. Only you can see or race it; laps are unranked.';
    await refreshLibrary();librarySelect.value=track.id;
    if(play){selectTrackForPlay(localStorage,track.name,track.layout,track.id);location.href='/?mode=time-trial';}
  }catch(error){libraryStatus.textContent=(error as Error).message;}
  finally{libraryBusy=false;updateSaveState();}
}
saveButton.onclick=()=>void save();playButton.onclick=()=>void save(true);
document.querySelector<HTMLButtonElement>('#load-track')!.onclick=async()=>{
  const id=librarySelect.value;if(!id)return;
  try{
    const preset=splinePresets.find(p=>p.id===id);
    const record=preset?{name:preset.name,layout:preset.create()}:await getSharedTrack(id);
    Object.assign(graph,structuredClone(record.layout));trackName.value=record.name;
    trackVisibility.value='visibility' in record && record.visibility === 'ranked' && canPublishRankedTracks
      ? 'ranked' : 'personal';
    nextNodeId=Math.max(...graph.nodes.map(n=>n.id))+1;
    nextConnectionId=Math.max(...graph.connections.map(n=>n.id))+1;
    nextCheckpointId=Math.max(0,...graph.checkpoints.map(n=>n.id))+1;
    selectedNodeId=selectedConnectionId=connectionStartId=null;
    draw();libraryStatus.textContent='Track loaded.';
  }catch(error){libraryStatus.textContent=(error as Error).message;}
};
document.querySelector<HTMLButtonElement>('#delete-track')!.onclick=async()=>{
  const id=librarySelect.value;if(!id)return;
  if(splinePresets.some(p=>p.id===id)){libraryStatus.textContent='Presets cannot be deleted.';return;}
  try{await deleteSharedTrack(id);clearActiveTrack(localStorage,id);await refreshLibrary();libraryStatus.textContent='Deleted from the shared library.';}
  catch(error){libraryStatus.textContent=(error as Error).message;}
};
void refreshLibrary();
const libraryRefresh=setInterval(()=>{if(!document.hidden&&!libraryBusy)void refreshLibrary();},5000);
window.addEventListener('pagehide',()=>clearInterval(libraryRefresh),{once:true});
}

const account = await requireAccount();
initializeMapBuilder(account.profile.canPublishRankedTracks);
document.body.dataset.authState = 'ready';
