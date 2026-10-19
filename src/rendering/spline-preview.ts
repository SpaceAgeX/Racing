import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { buildSplineSurface, splineSurfaceHeightAt } from '../track/spline-surface.ts';
import { getSplineTrackFrame, SPLINE_EDITOR_WORLD_SIZE, type SplineGraph } from '../track/spline.ts';

const TRACK_THICKNESS = 1.5;
const MAX_SURFACE_TRIANGLE_EDGE = 6;
const MAX_SURFACE_REFINEMENT_PASSES = 8;

interface SurfacePoint {
  x: number;
  z: number;
}

type SurfaceFace = [number, number, number];

function surfaceEdgeLength(a: Readonly<SurfacePoint>, b: Readonly<SurfacePoint>): number {
  return Math.hypot(b.x - a.x, b.z - a.z);
}

function refineSurfaceTriangles(vertices: SurfacePoint[], initialFaces: number[][]): SurfaceFace[] {
  let faces: SurfaceFace[] = initialFaces.map((face) => [face[0]!, face[1]!, face[2]!]);
  for (let pass = 0; pass < MAX_SURFACE_REFINEMENT_PASSES; pass++) {
    const midpointByEdge = new Map<string, number>();
    let refined = false;

    function midpointIndex(firstIndex: number, secondIndex: number): number | null {
      const first = vertices[firstIndex]!;
      const second = vertices[secondIndex]!;
      if (surfaceEdgeLength(first, second) <= MAX_SURFACE_TRIANGLE_EDGE) return null;
      const low = Math.min(firstIndex, secondIndex);
      const high = Math.max(firstIndex, secondIndex);
      const key = `${low}:${high}`;
      const existing = midpointByEdge.get(key);
      if (existing !== undefined) return existing;
      const index = vertices.length;
      vertices.push({ x: (first.x + second.x) / 2, z: (first.z + second.z) / 2 });
      midpointByEdge.set(key, index);
      return index;
    }

    const nextFaces: SurfaceFace[] = [];
    for (const [a, b, c] of faces) {
      const ab = midpointIndex(a, b);
      const bc = midpointIndex(b, c);
      const ca = midpointIndex(c, a);
      if (ab === null && bc === null && ca === null) {
        nextFaces.push([a, b, c]);
        continue;
      }
      refined = true;
      if (ab !== null && bc !== null && ca !== null) {
        nextFaces.push([a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]);
      } else if (ab !== null && bc !== null) {
        nextFaces.push([ab, b, bc], [a, ab, bc], [a, bc, c]);
      } else if (ab !== null && ca !== null) {
        nextFaces.push([a, ab, ca], [ab, b, c], [ab, c, ca]);
      } else if (bc !== null && ca !== null) {
        nextFaces.push([bc, c, ca], [a, b, bc], [a, bc, ca]);
      } else if (ab !== null) {
        nextFaces.push([a, ab, c], [ab, b, c]);
      } else if (bc !== null) {
        nextFaces.push([b, bc, a], [bc, c, a]);
      } else {
        nextFaces.push([c, ca!, b], [ca!, a, b]);
      }
    }
    faces = nextFaces;
    if (!refined) break;
  }
  return faces;
}

export function createSplinePreview(canvas: HTMLCanvasElement) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setClearColor(0x101a21);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xd7efff, 0x26323a, 2.2));
  const sun = new THREE.DirectionalLight(0xffffff, 2.8);
  sun.position.set(120, 180, 80);
  scene.add(sun);

  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 2000);
  camera.position.set(260, 220, 260);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = false;
  controls.target.set(0, 0, 0);
  controls.maxDistance = 1000;
  controls.update();

  const roadMaterial = new THREE.MeshStandardMaterial({ color: 0x687982, roughness: 0.9, metalness: 0.02, side: THREE.DoubleSide });
  const pointMaterial = new THREE.MeshStandardMaterial({ color: 0x6bc5ff, roughness: 0.75 });
  const selectedPointMaterial = new THREE.MeshStandardMaterial({ color: 0xff8a45, emissive: 0x6b2108, roughness: 0.6 });
  const finishArchMaterial = new THREE.MeshStandardMaterial({ color: 0xf1f3f5, roughness: 0.8 });
  const finishCheckerMaterials = [
    new THREE.MeshBasicMaterial({ color: 0xffffff }),
    new THREE.MeshBasicMaterial({ color: 0x20272d }),
  ];
  const checkpointMaterial = new THREE.MeshStandardMaterial({
    color: 0x45f28a,
    emissive: 0x126a36,
    emissiveIntensity: 1.4,
    roughness: 0.7,
  });
  let road: THREE.Mesh | null = null;
  let markers = new THREE.Group();
  let raceMarkers = new THREE.Group();
  scene.add(markers);
  scene.add(raceMarkers);
  let active = false;
  let animationFrame = 0;
  let framed = false;
  let warningCount = 0;
  let polygonCount = 0;
  let topSurfaceHeightRange = 0;
  let maximumTopTriangleEdge = 0;
  let finishMarkerMeshes = 0;
  let checkpointMarkerMeshes = 0;

  function disposeMarkers(): void {
    scene.remove(markers);
    for (const child of markers.children) (child as THREE.Mesh).geometry?.dispose();
    markers = new THREE.Group();
    scene.add(markers);
    scene.remove(raceMarkers);
    raceMarkers.traverse((child) => (child as THREE.Mesh).geometry?.dispose());
    raceMarkers = new THREE.Group();
    scene.add(raceMarkers);
  }

  function rebuild(graph: Readonly<SplineGraph>, selectedNodeId: number | null): void {
    if (road) {
      scene.remove(road);
      road.geometry.dispose();
      road = null;
    }
    disposeMarkers();

    const surface = buildSplineSurface(graph);
    finishMarkerMeshes = 0;
    checkpointMarkerMeshes = 0;
    warningCount = surface.warnings.length;
    polygonCount = surface.polygons.length;
    const topPositions: number[] = [];
    const bottomPositions: number[] = [];
    const sidePositions: number[] = [];
    maximumTopTriangleEdge = 0;
    let minimumTopHeight = Number.POSITIVE_INFINITY;
    let maximumTopHeight = Number.NEGATIVE_INFINITY;

    function topHeight(point: SurfacePoint): number {
      const height = splineSurfaceHeightAt(surface, point.x, point.z);
      minimumTopHeight = Math.min(minimumTopHeight, height);
      maximumTopHeight = Math.max(maximumTopHeight, height);
      return height;
    }

    function pushTriangle(
      positions: number[],
      a: SurfacePoint,
      yA: number,
      b: SurfacePoint,
      yB: number,
      c: SurfacePoint,
      yC: number,
    ): void {
      positions.push(a.x, yA, a.z, b.x, yB, b.z, c.x, yC, c.z);
    }

    function ringPoints(ring: number[][]): SurfacePoint[] {
      const points = ring.map(([x, z]) => ({ x: x!, z: z! }));
      if (points.length > 1 && points[0]!.x === points.at(-1)!.x && points[0]!.z === points.at(-1)!.z) points.pop();
      return points;
    }

    for (const polygon of surface.polygons) {
      if (!polygon.length) continue;
      const contour = ringPoints(polygon[0]!);
      const holes = polygon.slice(1).map(ringPoints);
      const contourVectors = contour.map((point) => new THREE.Vector2(point.x, point.z));
      const holeVectors = holes.map((hole) => hole.map((point) => new THREE.Vector2(point.x, point.z)));
      const flattened = [contour, ...holes].flat();
      const faces = refineSurfaceTriangles(flattened, THREE.ShapeUtils.triangulateShape(contourVectors, holeVectors));
      for (const face of faces) {
        const a = flattened[face[0]!]!;
        const b = flattened[face[1]!]!;
        const c = flattened[face[2]!]!;
        const yA = topHeight(a);
        const yB = topHeight(b);
        const yC = topHeight(c);
        maximumTopTriangleEdge = Math.max(
          maximumTopTriangleEdge,
          surfaceEdgeLength(a, b),
          surfaceEdgeLength(b, c),
          surfaceEdgeLength(c, a),
        );
        const normalY = (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z);
        if (normalY >= 0) {
          pushTriangle(topPositions, a, yA, b, yB, c, yC);
          pushTriangle(bottomPositions, c, yC - TRACK_THICKNESS, b, yB - TRACK_THICKNESS, a, yA - TRACK_THICKNESS);
        } else {
          pushTriangle(topPositions, a, yA, c, yC, b, yB);
          pushTriangle(bottomPositions, b, yB - TRACK_THICKNESS, c, yC - TRACK_THICKNESS, a, yA - TRACK_THICKNESS);
        }
      }

      for (const ring of [contour, ...holes]) {
        for (let index = 0; index < ring.length; index++) {
          const current = ring[index]!;
          const next = ring[(index + 1) % ring.length]!;
          const currentHeight = topHeight(current);
          const nextHeight = topHeight(next);
          pushTriangle(sidePositions, current, currentHeight, current, currentHeight - TRACK_THICKNESS, next, nextHeight);
          pushTriangle(sidePositions, next, nextHeight, current, currentHeight - TRACK_THICKNESS, next, nextHeight - TRACK_THICKNESS);
        }
      }
    }

    topSurfaceHeightRange = Number.isFinite(minimumTopHeight) && Number.isFinite(maximumTopHeight)
      ? maximumTopHeight - minimumTopHeight : 0;

    if (topPositions.length) {
      function surfaceGeometry(positions: number[], smooth: boolean): THREE.BufferGeometry {
        const raw = new THREE.BufferGeometry();
        raw.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        if (!smooth) {
          raw.computeVertexNormals();
          return raw;
        }
        const welded = mergeVertices(raw);
        raw.dispose();
        welded.computeVertexNormals();
        const expanded = welded.toNonIndexed();
        welded.dispose();
        return expanded;
      }

      const parts = [
        surfaceGeometry(topPositions, true),
        surfaceGeometry(bottomPositions, true),
        surfaceGeometry(sidePositions, false),
      ];
      const geometry = mergeGeometries(parts, false);
      for (const part of parts) part.dispose();
      if (!geometry) throw new Error('Could not combine spline preview surface geometry.');
      road = new THREE.Mesh(geometry, roadMaterial);
      scene.add(road);
    }

    for (const node of graph.nodes) {
      const x = (node.position.x - .5) * SPLINE_EDITOR_WORLD_SIZE;
      const z = (node.position.y - .5) * SPLINE_EDITOR_WORLD_SIZE;
      const selected = node.id === selectedNodeId;
      const marker = new THREE.Mesh(
        new THREE.SphereGeometry(selected ? 3.8 : 2.5, 16, 10),
        selected ? selectedPointMaterial : pointMaterial,
      );
      marker.position.set(x, node.height + (selected ? 4.2 : 2.8), z);
      markers.add(marker);
    }

    if (graph.finishLine) {
      const frame = getSplineTrackFrame(graph, graph.finishLine);
      if (frame) {
        const centerX = (frame.position.x - .5) * SPLINE_EDITOR_WORLD_SIZE;
        const centerZ = (frame.position.y - .5) * SPLINE_EDITOR_WORLD_SIZE;
        const tangentX = frame.direction.x;
        const tangentZ = frame.direction.y;
        const acrossX = tangentZ;
        const acrossZ = -tangentX;
        const archHeight = 3.8;
        const postWidth = .4;
        const markerDepth = .6;
        const postInset = .3;
        const beamHeight = .5;
        const lineColumns = 12;
        const lineRows = 2;
        const checkerWidth = frame.width / lineColumns;
        const markerThickness = .07;
        const checkerGeometry = new THREE.BoxGeometry(checkerWidth + .015, markerThickness, markerDepth + .015);

        for (let rowIndex = 0; rowIndex < lineRows; rowIndex++) {
          for (let column = 0; column < lineColumns; column++) {
            const across = (column + .5) * checkerWidth - frame.width / 2;
            const along = (rowIndex - .5) * markerDepth;
            const x = centerX + acrossX * across + tangentX * along;
            const z = centerZ + acrossZ * across + tangentZ * along;
            const checker = new THREE.Mesh(checkerGeometry, finishCheckerMaterials[(rowIndex + column) % 2]!);
            checker.rotation.y = Math.atan2(tangentX, tangentZ);
            checker.position.set(x, splineSurfaceHeightAt(surface, x, z) + markerThickness / 2 + .025, z);
            checker.renderOrder = 2;
            raceMarkers.add(checker);
          }
        }

        const postGeometry = new THREE.BoxGeometry(postWidth, archHeight, markerDepth);
        const postOffset = Math.max(0, frame.width / 2 - postInset);
        const postTopHeights: number[] = [];
        for (const side of [-1, 1]) {
          const x = centerX + acrossX * postOffset * side;
          const z = centerZ + acrossZ * postOffset * side;
          const baseHeight = splineSurfaceHeightAt(surface, x, z);
          const post = new THREE.Mesh(postGeometry, finishArchMaterial);
          post.rotation.y = Math.atan2(tangentX, tangentZ);
          post.position.set(x, baseHeight + archHeight / 2, z);
          raceMarkers.add(post);
          postTopHeights.push(baseHeight + archHeight);
        }
        const beam = new THREE.Mesh(
          new THREE.BoxGeometry(frame.width, beamHeight, markerDepth),
          finishArchMaterial,
        );
        beam.rotation.y = Math.atan2(tangentX, tangentZ);
        beam.position.set(centerX, Math.max(...postTopHeights) + beamHeight / 2, centerZ);
        raceMarkers.add(beam);
        finishMarkerMeshes = raceMarkers.children.length;
      }
    }

    for (const checkpoint of graph.checkpoints) {
      const frame = getSplineTrackFrame(graph, checkpoint);
      if (!frame) continue;
      const centerX = (frame.position.x - .5) * SPLINE_EDITOR_WORLD_SIZE;
      const centerZ = (frame.position.y - .5) * SPLINE_EDITOR_WORLD_SIZE;
      const tangentX = frame.direction.x;
      const tangentZ = frame.direction.y;
      const acrossX = tangentZ;
      const acrossZ = -tangentX;
      const segmentCount = 12;
      const segmentWidth = frame.width / segmentCount;
      const markerDepth = 1;
      const markerThickness = .09;
      const segmentGeometry = new THREE.BoxGeometry(segmentWidth + .02, markerThickness, markerDepth);
      for (let segment = 0; segment < segmentCount; segment++) {
        const across = (segment + .5) * segmentWidth - frame.width / 2;
        const x = centerX + acrossX * across;
        const z = centerZ + acrossZ * across;
        const marker = new THREE.Mesh(segmentGeometry, checkpointMaterial);
        marker.rotation.y = Math.atan2(tangentX, tangentZ);
        marker.position.set(x, splineSurfaceHeightAt(surface, x, z) + markerThickness / 2 + .03, z);
        marker.renderOrder = 3;
        raceMarkers.add(marker);
        checkpointMarkerMeshes++;
      }
    }

    if (!framed && graph.nodes.length) {
      const center = graph.nodes.reduce((sum, node) => ({
        x: sum.x + (node.position.x - .5) * SPLINE_EDITOR_WORLD_SIZE,
        y: sum.y + node.height,
        z: sum.z + (node.position.y - .5) * SPLINE_EDITOR_WORLD_SIZE,
      }), { x: 0, y: 0, z: 0 });
      center.x /= graph.nodes.length;
      center.y /= graph.nodes.length;
      center.z /= graph.nodes.length;
      controls.target.set(center.x, center.y, center.z);
      camera.position.set(center.x + 260, center.y + 220, center.z + 260);
      controls.update();
      framed = true;
    }
  }

  function resize(): void {
    const bounds = canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(bounds.width));
    const height = Math.max(1, Math.round(bounds.height));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  function render(): void {
    if (!active) return;
    resize();
    controls.update();
    renderer.render(scene, camera);
    animationFrame = requestAnimationFrame(render);
  }

  return {
    update(graph: Readonly<SplineGraph>, selectedNodeId: number | null = null): void { rebuild(graph, selectedNodeId); },
    setActive(value: boolean): void {
      if (active === value) return;
      active = value;
      if (active) render();
      else cancelAnimationFrame(animationFrame);
    },
    getDiagnostics() {
      return {
        vertices: road?.geometry.getAttribute('position').count ?? 0,
        markers: markers.children.length,
        finishMarkerMeshes,
        checkpointMarkerMeshes,
        selectedMarkers: markers.children.filter((child) => (child as THREE.Mesh).material === selectedPointMaterial).length,
        topSurfaceHeightRange,
        thickness: TRACK_THICKNESS,
        polygons: polygonCount,
        warnings: warningCount,
        maximumTopTriangleEdge,
        orbitTarget: { x: controls.target.x, y: controls.target.y, z: controls.target.z },
      };
    },
    dispose(): void {
      active = false;
      cancelAnimationFrame(animationFrame);
      controls.dispose();
      road?.geometry.dispose();
      scene.remove(markers);
      for (const child of markers.children) (child as THREE.Mesh).geometry?.dispose();
      scene.remove(raceMarkers);
      raceMarkers.traverse((child) => (child as THREE.Mesh).geometry?.dispose());
      roadMaterial.dispose();
      pointMaterial.dispose();
      selectedPointMaterial.dispose();
      finishArchMaterial.dispose();
      for (const material of finishCheckerMaterials) material.dispose();
      checkpointMaterial.dispose();
      renderer.dispose();
    },
  };
}
