import type { DrivingControls } from '../simulation/types.ts';

const drivingKeys = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD']);

export function createKeyboardInput(windowTarget: Window, documentTarget: Document) {
  const held = new Set<string>();

  const onKeyDown = (event: KeyboardEvent): void => {
    if (!drivingKeys.has(event.code)) return;
    event.preventDefault();
    held.add(event.code);
  };
  const onKeyUp = (event: KeyboardEvent): void => {
    if (!drivingKeys.has(event.code)) return;
    event.preventDefault();
    held.delete(event.code);
  };
  const clear = (): void => held.clear();
  const onVisibilityChange = (): void => {
    if (documentTarget.hidden) clear();
  };

  windowTarget.addEventListener('keydown', onKeyDown);
  windowTarget.addEventListener('keyup', onKeyUp);
  windowTarget.addEventListener('blur', clear);
  documentTarget.addEventListener('visibilitychange', onVisibilityChange);

  return {
    sample(): DrivingControls {
      const forward = held.has('KeyW');
      const reverse = held.has('KeyS');
      return {
        throttle: (Number(forward) - Number(reverse)) as DrivingControls['throttle'],
        steering: (Number(held.has('KeyA')) - Number(held.has('KeyD'))) as DrivingControls['steering'],
        brake: forward && reverse,
      };
    },
    clear,
    dispose(): void {
      clear();
      windowTarget.removeEventListener('keydown', onKeyDown);
      windowTarget.removeEventListener('keyup', onKeyUp);
      windowTarget.removeEventListener('blur', clear);
      documentTarget.removeEventListener('visibilitychange', onVisibilityChange);
    },
  };
}
