import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { RoadGeometry } from '../track/road-geometry.ts';

/** Rendering consumes the same triangle data used for physical collisions. */
export function createRoadVisual(road: RoadGeometry) {
  const object = new THREE.Group();
  object.name = 'track';
  const materials = [
    new THREE.MeshStandardMaterial({ color: 0x71838e, roughness: 0.95 }),
    new THREE.MeshStandardMaterial({ color: 0x41515c, roughness: 0.95 }),
    new THREE.MeshStandardMaterial({ color: 0xf2f4f6 }),
  ];
  for (const group of ['top', 'solid', 'obstacle']) {
    const positions = road.triangles
      .filter((t) =>
        group === 'top'
          ? t.kind === 'top'
          : group === 'obstacle'
            ? t.kind === 'obstacle'
            : t.kind === 'wall' || t.kind === 'bottom',
      )
      .flatMap((t) => [t.a, t.b, t.c].flatMap((p) => [p.x, p.y, p.z]));
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, materials[group === 'top' ? 0 : group === 'solid' ? 1 : 2]);
    mesh.receiveShadow = true;
    mesh.castShadow = group === 'obstacle';
    object.add(mesh);
  }
  const white = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
  const dark = new THREE.MeshBasicMaterial({ color: 0x18232b, side: THREE.DoubleSide });
  const green = new THREE.MeshBasicMaterial({ color: 0x45f28a, side: THREE.DoubleSide });
  for (const gate of [
    ...(road.finish ? [{ ...road.finish, finish: true }] : []),
    ...road.checkpoints.map((c) => ({ ...c, finish: false })),
  ]) {
    const direction = gate.direction!,
      right = { x: direction.z, z: -direction.x };
    const count = 24,
      rows = gate.finish ? 2 : 1,
      width = gate.width / count;
    for (let i = 0; i < count; i++)
      for (let row = 0; row < rows; row++) {
        const along = (row - (rows - 1) / 2) * 0.5;
        const points = [
          [-0.5, -0.25],
          [0.5, -0.25],
          [0.5, 0.25],
          [-0.5, 0.25],
        ].map(([dx, dz]) => {
          const lateral = -gate.width / 2 + (i + 0.5 + dx!) * width;
          const x = gate.center.x + right.x * lateral + direction.x * (along + dz!);
          const z = gate.center.z + right.z * lateral + direction.z * (along + dz!);
          return [x, road.heightAt(x, z) + 0.035, z];
        });
        const g = new THREE.BufferGeometry();
        g.setAttribute(
          'position',
          new THREE.Float32BufferAttribute(
            [0, 1, 2, 0, 2, 3].flatMap((j) => points[j]!),
            3,
          ),
        );
        object.add(new THREE.Mesh(g, gate.finish ? ((i + row) % 2 ? dark : white) : green));
      }
  }
  for (const material of [white, dark, green]) {
    const meshes = object.children.filter(
      (o) => o instanceof THREE.Mesh && o.material === material,
    ) as THREE.Mesh<THREE.BufferGeometry>[];
    if (meshes.length) {
      const merged = mergeGeometries(meshes.map((m) => m.geometry));
      for (const m of meshes) {
        object.remove(m);
        m.geometry.dispose();
      }
      if (merged) object.add(new THREE.Mesh(merged, material));
    }
  }
  return {
    object,
    dispose() {
      object.traverse((o) => {
        if (o instanceof THREE.Mesh) o.geometry.dispose();
      });
      [...materials, white, dark, green].forEach((m) => m.dispose());
    },
  };
}
