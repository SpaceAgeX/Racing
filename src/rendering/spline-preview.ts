import { buildRoadGeometry, TRACK_THICKNESS } from '../track/road-geometry.ts';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { buildSplineSurface, splineSurfaceHeightAt } from '../track/spline-surface.ts';
import { getSplineTrackFrame, SPLINE_EDITOR_WORLD_SIZE, type SplineGraph } from '../track/spline.ts';

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

    const data = buildRoadGeometry(graph);
    const surface = data.surface;
    finishMarkerMeshes = 0; checkpointMarkerMeshes = 0;
    warningCount=surface.warnings.length;polygonCount=surface.polygons.length;
    const topPositions:number[]=[],bottomPositions:number[]=[],sidePositions:number[]=[];
    maximumTopTriangleEdge=0;
    let minimumTopHeight=Infinity,maximumTopHeight=-Infinity;
    for(const t of data.triangles){
      if(t.kind==='obstacle')continue;
      const positions=t.kind==='top'?topPositions:t.kind==='bottom'?bottomPositions:sidePositions;
      positions.push(...[t.a,t.b,t.c].flatMap(p=>[p.x,p.y,p.z]));
      if(t.kind==='top'){
        for(const p of [t.a,t.b,t.c]){minimumTopHeight=Math.min(minimumTopHeight,p.y);maximumTopHeight=Math.max(maximumTopHeight,p.y);}
        maximumTopTriangleEdge=Math.max(maximumTopTriangleEdge,...[[t.a,t.b],[t.b,t.c],[t.c,t.a]].map(([a,b])=>Math.hypot(a!.x-b!.x,a!.z-b!.z)));
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
            checker.position.set(x, data.heightAt(x,z) + markerThickness / 2 + .025, z);
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
          const baseHeight = data.heightAt(x,z);
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
        marker.position.set(x, data.heightAt(x,z) + markerThickness / 2 + .03, z);
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
