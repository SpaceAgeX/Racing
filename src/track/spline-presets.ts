import { addSplineNode, addSplineConnection, createSplineGraph, setSplineFinishLine } from './spline.ts';
import { serializeSpline } from './spline-records.ts';

function loop(chicane: boolean) {
  const graph = createSplineGraph();
  const points = chicane
    ? [
        [0.25, 0.8],
        [0.25, 0.2],
        [0.75, 0.2],
        [0.65, 0.5],
        [0.75, 0.8],
      ]
    : [
        [0.25, 0.8],
        [0.25, 0.2],
        [0.75, 0.2],
        [0.75, 0.8],
      ];
  points.forEach(([x, y], id) => addSplineNode(graph, { x: x!, y: y! }, id));
  graph.nodes.forEach((n, i) => {
    const next = graph.nodes[(i + 1) % graph.nodes.length]!;
    addSplineConnection(graph, n.id, next.id, i);
  });
  // Rounded, continuous corners from neighboring point tangents.
  for (const c of graph.connections) {
    const i = c.startNodeId,
      j = c.endNodeId,
      count = graph.nodes.length;
    const a = graph.nodes[(i + count - 1) % count]!.position,
      b = graph.nodes[j]!.position;
    const d = graph.nodes[(j + 1) % count]!.position,
      e = graph.nodes[i]!.position;
    c.startHandle = { x: (b.x - a.x) / 6, y: (b.y - a.y) / 6 };
    c.endHandle = { x: -(d.x - e.x) / 6, y: -(d.y - e.y) / 6 };
  }
  setSplineFinishLine(graph, 0, 0.5);
  return serializeSpline(graph);
}
export const splinePresets = [
  { id: 'default', name: 'Default circuit', create: () => loop(true) },
  { id: 'simple-loop', name: 'Simple loop track', create: () => loop(false) },
];
