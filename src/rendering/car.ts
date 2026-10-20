import { Box3, BoxGeometry, CanvasTexture, Group, LoadingManager, Mesh, MeshStandardMaterial, Vector3 } from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import type { Texture } from 'three';
import type { VehicleState } from '../simulation/types.ts';
import { vehicleDimensions } from '../simulation/parameters.ts';

const modelPath = '/assets/car/race.fbx';
const modelScale = 0.015;
const sourcePaintColor = rgbToHsl(0xeb, 0x63, 0x46);
const wheelRadius = 30 * modelScale;

interface WheelRig {
  mesh: Mesh;
  steeringPivot: Group | null;
}

let modelTemplatePromise: Promise<Group> | null = null;
const teamMaps = new Map<number, CanvasTexture>();

function rgbToHsl(red: number, green: number, blue: number): { h: number; s: number; l: number } {
  red /= 255;
  green /= 255;
  blue /= 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  const l = (max + min) / 2;
  if (delta === 0) return { h: 0, s: 0, l };
  const s = delta / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (max === red) h = ((green - blue) / delta) % 6;
  else if (max === green) h = (blue - red) / delta + 2;
  else h = (red - green) / delta + 4;
  return { h: (h / 6 + 1) % 1, s, l };
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const segment = h * 6;
  const secondary = chroma * (1 - Math.abs(segment % 2 - 1));
  const offset = l - chroma / 2;
  let rgb: [number, number, number];
  if (segment < 1) rgb = [chroma, secondary, 0];
  else if (segment < 2) rgb = [secondary, chroma, 0];
  else if (segment < 3) rgb = [0, chroma, secondary];
  else if (segment < 4) rgb = [0, secondary, chroma];
  else if (segment < 5) rgb = [secondary, 0, chroma];
  else rgb = [chroma, 0, secondary];
  return rgb.map((value) => Math.round((value + offset) * 255)) as [number, number, number];
}

function createTeamColorMap(base: Texture, color: number): CanvasTexture | null {
  const cached = teamMaps.get(color);
  if (cached) return cached;
  const image = base.image as CanvasImageSource & { width?: number; height?: number } | undefined;
  if (!image || !image.width || !image.height) return null;

  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  const data = pixels.data;
  const team = rgbToHsl((color >> 16) & 0xff, (color >> 8) & 0xff, color & 0xff);

  // Re-hue only the FBX's orange paint swatch. Luminance and alpha remain, so
  // shading, outlines, glass, tires, and other atlas colors are retained.
  for (let index = 0; index < data.length; index += 4) {
    const source = rgbToHsl(data[index]!, data[index + 1]!, data[index + 2]!);
    const hueDistance = Math.min(Math.abs(source.h - sourcePaintColor.h), 1 - Math.abs(source.h - sourcePaintColor.h));
    if (source.s < 0.22 || hueDistance > 0.06 || source.l < 0.12 || source.l > 0.9) continue;
    const saturation = Math.min(1, source.s * (team.s / Math.max(sourcePaintColor.s, 0.01)));
    const lightness = Math.max(0.06, Math.min(0.96, team.l + source.l - sourcePaintColor.l));
    const [red, green, blue] = hslToRgb(team.h, saturation, lightness);
    data[index] = red;
    data[index + 1] = green;
    data[index + 2] = blue;
  }
  context.putImageData(pixels, 0, 0);

  const texture = new CanvasTexture(canvas);
  texture.name = `${base.name || 'car-colormap'}-team-${color.toString(16)}`;
  texture.mapping = base.mapping;
  texture.wrapS = base.wrapS;
  texture.wrapT = base.wrapT;
  texture.magFilter = base.magFilter;
  texture.minFilter = base.minFilter;
  texture.anisotropy = base.anisotropy;
  texture.colorSpace = base.colorSpace;
  texture.flipY = base.flipY;
  texture.offset.copy(base.offset);
  texture.repeat.copy(base.repeat);
  texture.center.copy(base.center);
  texture.rotation = base.rotation;
  texture.generateMipmaps = base.generateMipmaps;
  teamMaps.set(color, texture);
  return texture;
}

function loadCarModel(): Promise<Group> {
  if (!modelTemplatePromise) {
    const manager = new LoadingManager();
    let markAssetsLoaded!: () => void;
    const assetsLoaded = new Promise<void>((resolve) => { markAssetsLoaded = resolve; });
    manager.onLoad = markAssetsLoaded;
    modelTemplatePromise = new FBXLoader(manager).loadAsync(modelPath).then(async (model) => {
      // FBXLoader returns its scene while external textures may still be in flight.
      let timeout = 0;
      await Promise.race([
        assetsLoaded,
        new Promise<void>((resolve) => { timeout = window.setTimeout(resolve, 8000); }),
      ]);
      window.clearTimeout(timeout);
      const textureImages: Promise<void>[] = [];
      model.traverse((node) => {
        if (!(node instanceof Mesh)) return;
        node.castShadow = true;
        const materials = Array.isArray(node.material) ? node.material : [node.material];
        for (const material of materials) {
          const image = material.map?.image as (CanvasImageSource & { decode?: () => Promise<void> }) | undefined;
          if (image?.decode) textureImages.push(image.decode().catch(() => undefined));
        }
      });
      await Promise.all(textureImages);
      return model;
    }).catch((error: unknown) => {
      modelTemplatePromise = null;
      console.error(`Could not load car model at ${modelPath}.`, error);
      throw error;
    });
  }
  return modelTemplatePromise;
}

function createWheelRig(model: Group, name: string, steering: boolean): WheelRig | null {
  const mesh = model.getObjectByName(name);
  if (!(mesh instanceof Mesh)) {
    console.warn(`Car model is missing the ${name} wheel mesh.`);
    return null;
  }
  mesh.geometry.computeBoundingBox();
  const center = new Box3().copy(mesh.geometry.boundingBox!).getCenter(new Vector3());
  const pivot = new Group();
  pivot.name = `${name}-pivot`;
  pivot.position.copy(mesh.position).add(center);
  mesh.parent?.add(pivot);
  mesh.position.set(-center.x, -center.y, -center.z);
  pivot.add(mesh);
  return { mesh, steeringPivot: steering ? pivot : null };
}

/** FBX model adapter: local forward is rotated from FBX +Z to game -Z. */
export function createCarVisual(color = 0xee7136) {
  const object = new Group();
  object.rotation.order = 'YXZ';

  const modelRoot = new Group();
  modelRoot.name = 'car-model';
  modelRoot.scale.setScalar(modelScale);
  modelRoot.rotation.y = Math.PI;

  // Keep a visible fallback until the browser has fetched the FBX and its map.
  const fallbackGeometry = new BoxGeometry(vehicleDimensions.width, vehicleDimensions.height, vehicleDimensions.length);
  const fallbackMaterial = new MeshStandardMaterial({ color, roughness: 0.85 });
  const fallback = new Mesh(fallbackGeometry, fallbackMaterial);
  fallback.position.y = vehicleDimensions.height / 2;
  fallback.castShadow = true;
  modelRoot.add(fallback);
  object.add(modelRoot);

  let disposed = false;
  let latestState: Readonly<VehicleState> | null = null;
  let lastPosition: { x: number; z: number } | null = null;
  const wheels: WheelRig[] = [];
  const ownedMaterials: MeshStandardMaterial[] = [];

  function updateModelPose(state: Readonly<VehicleState>): void {
    if (lastPosition) {
      const dx = state.position.x - lastPosition.x;
      const dz = state.position.z - lastPosition.z;
      const forwardDistance = dx * -Math.sin(state.heading) + dz * -Math.cos(state.heading);
      const spin = forwardDistance / wheelRadius;
      for (const wheel of wheels) wheel.mesh.rotation.x += spin;
    }
    lastPosition = { x: state.position.x, z: state.position.z };
    for (const wheel of wheels) {
      if (wheel.steeringPivot) wheel.steeringPivot.rotation.y = state.steeringAngle;
    }
  }

  const ready = loadCarModel().then((template) => {
    if (disposed) return;
    const model = template.clone(true);
    model.traverse((node) => {
      if (!(node instanceof Mesh)) return;
      node.castShadow = true;
      if (node.name !== 'body') return;
      const recolorMaterial = (source: MeshStandardMaterial): MeshStandardMaterial => {
        const material = source.clone() as MeshStandardMaterial;
        const teamMap = source.map ? createTeamColorMap(source.map, color) : null;
        if (teamMap) {
          material.map = teamMap;
          material.needsUpdate = true;
        }
        ownedMaterials.push(material);
        return material;
      };
      node.material = Array.isArray(node.material)
        ? node.material.map((material) => recolorMaterial(material as MeshStandardMaterial))
        : recolorMaterial(node.material as MeshStandardMaterial);
    });
    for (const name of ['wheel-front-left', 'wheel-front-right']) {
      const wheel = createWheelRig(model, name, true);
      if (wheel) wheels.push(wheel);
    }
    for (const name of ['wheel-back-left', 'wheel-back-right']) {
      const wheel = createWheelRig(model, name, false);
      if (wheel) wheels.push(wheel);
    }
    modelRoot.add(model);
    fallback.visible = false;
    lastPosition = latestState ? { x: latestState.position.x, z: latestState.position.z } : null;
    if (latestState) updateModelPose(latestState);
  }).catch(() => {
    // The colored box remains visible if the FBX or map cannot be loaded.
  });

  return {
    object,
    ready,
    update(state: Readonly<VehicleState>): void {
      latestState = state;
      object.position.set(state.position.x, state.position.y, state.position.z);
      object.rotation.set(state.pitch, state.heading, state.roll, 'YXZ');
      updateModelPose(state);
    },
    dispose(): void {
      disposed = true;
      fallbackGeometry.dispose();
      fallbackMaterial.dispose();
      for (const material of ownedMaterials) material.dispose();
    },
  };
}
