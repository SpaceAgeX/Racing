import {
  AmbientLight, Color, DirectionalLight,
  PCFShadowMap, PerspectiveCamera, Scene, WebGLRenderer,
} from 'three';
import { createTrackVisual } from './track.ts';
import type { TrackLayout } from '../track/layout.ts';

const MAX_RENDER_PIXEL_RATIO = 1.5;
const SHADOW_MAP_SIZE = 512;

export function createScene(canvas: HTMLCanvasElement, layout: TrackLayout, tileSize: number) {
  const scene = new Scene();
  scene.background = new Color(0xa8d2ed);
  const renderer = new WebGLRenderer({ canvas, antialias: true });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  const camera = new PerspectiveCamera(65, 1, 0.1, 1000);

  const track = createTrackVisual(layout, tileSize);
  scene.add(track.object);

  scene.add(new AmbientLight(0xffffff, 1.8));
  const sun = new DirectionalLight(0xfff4e6, 2.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
  sun.shadow.camera.left = -14;
  sun.shadow.camera.right = 14;
  sun.shadow.camera.top = 14;
  sun.shadow.camera.bottom = -14;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 60;
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);

  function resize(): void {
    const width = Math.max(1, canvas.clientWidth);
    const height = Math.max(1, canvas.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_RENDER_PIXEL_RATIO));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvas);
  window.addEventListener('resize', resize);
  resize();

  return {
    scene,
    camera,
    renderer,
    trackTiles: track.tiles,
    tileSize,
    followSun(position: { x: number; y: number; z: number }): void {
      sun.position.set(position.x + 12, position.y + 18, position.z + 10);
      sun.target.position.set(position.x, position.y, position.z);
    },
    dispose(): void {
      resizeObserver.disconnect();
      window.removeEventListener('resize', resize);
      track.dispose();
      sun.shadow.map?.dispose();
      renderer.dispose();
    },
  };
}
