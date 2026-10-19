import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSplineSurface, splineSurfaceHeightAt } from '../src/track/spline-surface.ts';
import {
  addSplineCheckpoint,
  addSplineConnection,
  addSplineNode,
  clearSplineFinishLine,
  createSplineGraph,
  cubicBezierPoint,
  flipSplineFinishLine,
  getSplineStartGrid,
  interpolateSplineHeight,
  interpolateSplineWidth,
  MAX_SPLINE_CHECKPOINTS,
  MIN_SPLINE_NODE_DISTANCE,
  moveSplineConnectionHandle,
  moveSplineConnectionHandleAtNode,
  moveSplineNode,
  removeSplineConnection,
  removeSplineCheckpoint,
  removeSplineNode,
  resetSplineNodeWidth,
  setSplineDefaultWidth,
  setSplineFinishLine,
  setSplineNodeWidth,
  setSplineNodeHandleMode,
  setSplineNodeHeight,
  setSplineNodeHeightSteepness,
} from '../src/track/spline.ts';

test('nodes are independent and connections are created explicitly', () => {
  const graph = createSplineGraph();
  const first = addSplineNode(graph, { x: .1, y: .2 }, 1);
  const second = addSplineNode(graph, { x: .5, y: .2 }, 2);
  const branch = addSplineNode(graph, { x: .5, y: .7 }, 3);
  assert.ok(first && second && branch);
  assert.equal(graph.connections.length, 0);

  const main = addSplineConnection(graph, first.id, second.id, 1);
  const alternate = addSplineConnection(graph, second.id, branch.id, 2);
  assert.ok(main && alternate);
  assert.equal(graph.connections.length, 2);
  assert.equal(addSplineConnection(graph, second.id, first.id, 3), null, 'reverse duplicates are rejected');
  assert.equal(addSplineConnection(graph, first.id, first.id, 3), null, 'self-connections are rejected');
});

test('a cubic connection owns its handles and evaluates its endpoints', () => {
  const graph = createSplineGraph();
  const first = addSplineNode(graph, { x: .1, y: .5 }, 1)!;
  const second = addSplineNode(graph, { x: .9, y: .5 }, 2)!;
  const connection = addSplineConnection(graph, first.id, second.id, 1)!;
  assert.deepEqual(cubicBezierPoint(graph, connection, 0), first.position);
  assert.deepEqual(cubicBezierPoint(graph, connection, 1), second.position);

  moveSplineConnectionHandle(connection, 'start', { x: .2, y: -.3 });
  moveSplineConnectionHandle(connection, 'end', { x: -.2, y: .3 });
  const midpoint = cubicBezierPoint(graph, connection, .5);
  assert.ok(Math.abs(midpoint.x - .5) < 1e-10);
  assert.ok(Math.abs(midpoint.y - .5) < 1e-10);
});

test('node movement slides to the edge of a neighboring spacing radius', () => {
  const graph = createSplineGraph();
  const fixed = addSplineNode(graph, { x: .3, y: .5 }, 1)!;
  const moving = addSplineNode(graph, { x: .7, y: .5 }, 2)!;
  const resolved = moveSplineNode(graph, moving.id, { x: .31, y: .5 });
  assert.ok(resolved);
  assert.ok(Math.abs(Math.hypot(resolved.x - fixed.position.x, resolved.y - fixed.position.y) - MIN_SPLINE_NODE_DISTANCE) < 1e-10);
  assert.ok(resolved.x > fixed.position.x, 'the node remains on the approached side');
});

test('new nodes respect spacing and deleting a node removes only its attached connections', () => {
  const graph = createSplineGraph();
  const first = addSplineNode(graph, { x: .2, y: .2 }, 1)!;
  const middle = addSplineNode(graph, { x: .5, y: .5 }, 2)!;
  const last = addSplineNode(graph, { x: .8, y: .2 }, 3)!;
  assert.equal(addSplineNode(graph, { x: .21, y: .21 }, 4), null);
  const firstToMiddle = addSplineConnection(graph, first.id, middle.id, 1)!;
  addSplineConnection(graph, middle.id, last.id, 2);
  addSplineConnection(graph, first.id, last.id, 3);

  assert.equal(removeSplineConnection(graph, firstToMiddle.id), true);
  assert.equal(graph.connections.length, 2);
  assert.equal(removeSplineNode(graph, middle.id), true);
  assert.deepEqual(graph.connections.map(connection => connection.id), [3]);
});

test('point handle modes coordinate two curves while branch points remain independent corners', () => {
  const graph = createSplineGraph();
  const left = addSplineNode(graph, { x: .1, y: .5 }, 1)!;
  const middle = addSplineNode(graph, { x: .5, y: .5 }, 2)!;
  const right = addSplineNode(graph, { x: .9, y: .5 }, 3)!;
  const branch = addSplineNode(graph, { x: .5, y: .9 }, 4)!;
  const incoming = addSplineConnection(graph, left.id, middle.id, 1)!;
  const outgoing = addSplineConnection(graph, middle.id, right.id, 2)!;

  assert.equal(middle.handleMode, 'smooth');
  moveSplineConnectionHandleAtNode(graph, incoming.id, middle.id, { x: -.1, y: .2 });
  assert.ok(Math.abs(incoming.endHandle.x * outgoing.startHandle.y - incoming.endHandle.y * outgoing.startHandle.x) < 1e-10);
  assert.ok(incoming.endHandle.x * outgoing.startHandle.x + incoming.endHandle.y * outgoing.startHandle.y < 0);

  assert.equal(setSplineNodeHandleMode(graph, middle.id, 'symmetric'), true);
  moveSplineConnectionHandleAtNode(graph, outgoing.id, middle.id, { x: .2, y: .1 });
  assert.ok(Math.abs(incoming.endHandle.x + .2) < 1e-10);
  assert.ok(Math.abs(incoming.endHandle.y + .1) < 1e-10);

  addSplineConnection(graph, middle.id, branch.id, 3);
  assert.equal(middle.handleMode, 'corner');
  assert.equal(setSplineNodeHandleMode(graph, middle.id, 'smooth'), false);
});

test('default width cascades to inherited points while custom widths interpolate independently', () => {
  const graph = createSplineGraph();
  const first = addSplineNode(graph, { x: .2, y: .5 }, 1)!;
  const second = addSplineNode(graph, { x: .8, y: .5 }, 2)!;
  assert.deepEqual([first.width, second.width], [12, 12]);

  setSplineDefaultWidth(graph, 16);
  assert.deepEqual([first.width, second.width], [16, 16]);
  setSplineNodeWidth(graph, first.id, 8);
  setSplineDefaultWidth(graph, 20);
  assert.deepEqual([first.width, second.width], [8, 20]);
  assert.equal(interpolateSplineWidth(first.width, second.width, .5), 14);

  resetSplineNodeWidth(graph, first.id);
  assert.equal(first.width, 20);
  assert.equal(first.usesDefaultWidth, true);
});

test('point heights are bounded and interpolate with an always-rounded steepness curve', () => {
  const graph = createSplineGraph();
  const first = addSplineNode(graph, { x: .2, y: .5 }, 1)!;
  const second = addSplineNode(graph, { x: .8, y: .5 }, 2)!;
  const connection = addSplineConnection(graph, first.id, second.id, 1)!;
  assert.deepEqual([first.height, first.heightSteepness], [0, 35]);

  setSplineNodeHeight(graph, second.id, 30);
  const defaultQuarter = interpolateSplineHeight(graph, connection, .25);
  assert.equal(interpolateSplineHeight(graph, connection, 0), 0);
  assert.equal(interpolateSplineHeight(graph, connection, .5), 15);
  assert.equal(interpolateSplineHeight(graph, connection, 1), 30);

  setSplineNodeHeightSteepness(graph, first.id, 100);
  setSplineNodeHeightSteepness(graph, second.id, 100);
  assert.ok(interpolateSplineHeight(graph, connection, .25) < defaultQuarter);
  assert.equal(setSplineNodeHeight(graph, first.id, -100), -50);
  assert.equal(setSplineNodeHeight(graph, second.id, 100), 50);
  assert.equal(setSplineNodeHeightSteepness(graph, first.id, -1), 0);
  assert.equal(setSplineNodeHeightSteepness(graph, second.id, 101), 100);
});

test('the unioned surface receives continuous centerline elevation', () => {
  const graph = createSplineGraph();
  const first = addSplineNode(graph, { x: .2, y: .5 }, 1)!;
  const second = addSplineNode(graph, { x: .8, y: .5 }, 2)!;
  addSplineConnection(graph, first.id, second.id, 1);
  setSplineNodeHeight(graph, second.id, 30);

  const surface = buildSplineSurface(graph);
  assert.equal(surface.polygons.length, 1);
  assert.ok(surface.heightSegments.length > 1);
  assert.ok(Math.abs(splineSurfaceHeightAt(surface, -120, 0)) < 1e-10);
  assert.ok(Math.abs(splineSurfaceHeightAt(surface, 0, 0) - 15) < .1);
  assert.ok(Math.abs(splineSurfaceHeightAt(surface, 120, 0) - 30) < 1e-10);
});

test('the finish line creates five distinct rows of two cars behind it', () => {
  const graph = createSplineGraph();
  const first = addSplineNode(graph, { x: .2, y: .5 }, 1)!;
  const second = addSplineNode(graph, { x: .8, y: .5 }, 2)!;
  const connection = addSplineConnection(graph, first.id, second.id, 1)!;
  assert.equal(setSplineFinishLine(graph, connection.id, 0), null);
  assert.equal(setSplineFinishLine(graph, connection.id, 1), null);
  assert.deepEqual(setSplineFinishLine(graph, connection.id, .5), { connectionId: 1, progress: .5, reversed: false });

  const slots = getSplineStartGrid(graph);
  assert.equal(slots.length, 10);
  assert.deepEqual([...new Set(slots.map(slot => slot.row))], [0, 1, 2, 3, 4]);
  for (let row = 0; row < 5; row++) {
    const rowSlots = slots.filter(slot => slot.row === row);
    assert.deepEqual(rowSlots.map(slot => slot.column), [0, 1]);
    assert.ok(rowSlots.every(slot => slot.position.x < second.position.x));
    assert.ok(rowSlots.every(slot => Math.abs(slot.direction.x - 1) < 1e-10));
    assert.ok(rowSlots.every(slot => Math.abs(slot.direction.y) < 1e-10));
  }
  assert.ok(slots.find(slot => slot.row === 4)!.position.x < slots.find(slot => slot.row === 0)!.position.x);

  setSplineFinishLine(graph, connection.id, .5);
  assert.equal(flipSplineFinishLine(graph), true);
  const reversedSlots = getSplineStartGrid(graph);
  assert.ok(reversedSlots.every(slot => slot.position.x > .5));
  assert.ok(reversedSlots.every(slot => Math.abs(slot.direction.x + 1) < 1e-10));
  assert.equal(flipSplineFinishLine(graph), false);

  moveSplineConnectionHandle(connection, 'start', { x: .2, y: -.3 });
  moveSplineConnectionHandle(connection, 'end', { x: -.2, y: -.3 });
  setSplineFinishLine(graph, connection.id, .75);
  const curvedSlots = getSplineStartGrid(graph);
  const frontCenterY = (curvedSlots[0]!.position.y + curvedSlots[1]!.position.y) / 2;
  const backCenterY = (curvedSlots[8]!.position.y + curvedSlots[9]!.position.y) / 2;
  assert.ok(Math.abs(frontCenterY - backCenterY) > .01, 'rows follow the curved centerline');
  assert.ok(Math.abs(curvedSlots[0]!.direction.y - curvedSlots[8]!.direction.y) > .005, 'each row follows its local tangent');

  clearSplineFinishLine(graph);
  assert.deepEqual(getSplineStartGrid(graph), []);
});

test('checkpoints are limited to three and route removal clears attached race markers', () => {
  const graph = createSplineGraph();
  const first = addSplineNode(graph, { x: .2, y: .5 }, 1)!;
  const second = addSplineNode(graph, { x: .8, y: .5 }, 2)!;
  const connection = addSplineConnection(graph, first.id, second.id, 1)!;
  setSplineFinishLine(graph, connection.id, .2);
  for (let index = 0; index < MAX_SPLINE_CHECKPOINTS; index++) {
    assert.ok(addSplineCheckpoint(graph, connection.id, .4 + index * .1, index + 1));
  }
  assert.equal(addSplineCheckpoint(graph, connection.id, .9, 4), null);
  assert.equal(removeSplineCheckpoint(graph, 2), true);
  assert.equal(removeSplineCheckpoint(graph, 2), false);
  assert.ok(addSplineCheckpoint(graph, connection.id, .9, 4));

  assert.equal(removeSplineConnection(graph, connection.id), true);
  assert.equal(graph.finishLine, null);
  assert.deepEqual(graph.checkpoints, []);
});

test('overlapping roads are unioned into one continuous surface', () => {
  const graph = createSplineGraph();
  const left = addSplineNode(graph, { x: .15, y: .5 }, 1)!;
  const right = addSplineNode(graph, { x: .85, y: .5 }, 2)!;
  const top = addSplineNode(graph, { x: .5, y: .15 }, 3)!;
  const bottom = addSplineNode(graph, { x: .5, y: .85 }, 4)!;
  addSplineConnection(graph, left.id, right.id, 1);
  addSplineConnection(graph, top.id, bottom.id, 2);

  const surface = buildSplineSurface(graph);
  assert.equal(surface.polygons.length, 1);
  assert.equal(surface.polygons[0]!.length, 1, 'the crossing has no internal seam or hole');
});

test('a closed road loop preserves its center as a polygon hole', () => {
  const graph = createSplineGraph();
  const nodes = [
    addSplineNode(graph, { x: .2, y: .2 }, 1)!,
    addSplineNode(graph, { x: .8, y: .2 }, 2)!,
    addSplineNode(graph, { x: .8, y: .8 }, 3)!,
    addSplineNode(graph, { x: .2, y: .8 }, 4)!,
  ];
  for (let index = 0; index < nodes.length; index++) {
    addSplineConnection(graph, nodes[index]!.id, nodes[(index + 1) % nodes.length]!.id, index + 1);
  }

  const surface = buildSplineSurface(graph);
  assert.equal(surface.polygons.length, 1);
  assert.equal(surface.polygons[0]!.length, 2, 'outer contour and inner hole are retained');
});

test('extreme curves produce warnings without blocking surface generation', () => {
  const graph = createSplineGraph();
  const first = addSplineNode(graph, { x: .4, y: .5 }, 1)!;
  const second = addSplineNode(graph, { x: .6, y: .5 }, 2)!;
  const connection = addSplineConnection(graph, first.id, second.id, 1)!;
  moveSplineConnectionHandle(connection, 'start', { x: .35, y: .05 });
  moveSplineConnectionHandle(connection, 'end', { x: -.35, y: -.05 });

  const surface = buildSplineSurface(graph);
  assert.ok(surface.polygons.length > 0);
  assert.ok(surface.warnings.length > 0);
});
