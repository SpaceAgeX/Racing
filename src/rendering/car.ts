import { BoxGeometry, Group, Mesh, MeshStandardMaterial } from 'three';
import type { VehicleState } from '../simulation/types.ts';
import { vehicleDimensions } from '../simulation/parameters.ts';

/** Visual adapter: replace the box inside this group with a model facing local -Z. */
export function createCarVisual() {
  const object = new Group();
  object.rotation.order = 'YXZ';
  const geometry = new BoxGeometry(vehicleDimensions.width, vehicleDimensions.height, vehicleDimensions.length);
  const material = new MeshStandardMaterial({ color: 0xee7136, roughness: 0.85 });
  const prism = new Mesh(geometry, material);
  prism.position.y = vehicleDimensions.height / 2;
  prism.castShadow = true;
  object.add(prism);

  return {
    object,
    update(state: Readonly<VehicleState>): void {
      object.position.set(state.position.x, state.position.y, state.position.z);
      object.rotation.set(state.pitch, state.heading, state.roll, 'YXZ');
    },
    dispose(): void {
      geometry.dispose();
      material.dispose();
    },
  };
}
