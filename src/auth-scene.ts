import { createAuthCarScene } from './rendering/auth-car-scene.ts';

const canvas = document.querySelector<HTMLCanvasElement>('#auth-car-scene');
if (canvas) {
  const scene = createAuthCarScene(canvas);
  window.addEventListener('pagehide', () => scene.dispose(), { once: true });
}
