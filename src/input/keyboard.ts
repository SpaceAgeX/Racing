import type { DrivingControls } from '../simulation/types.ts';

const drivingKeys = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD']);
const cameraKey = 'KeyC';

export function createKeyboardInput(windowTarget: Window, documentTarget: Document) {
  const held = new Set<string>();
  let enabled = false;
  let cameraToggleRequested = false;

  const isTextInput = (target: EventTarget | null): boolean => typeof HTMLElement !== 'undefined' && target instanceof HTMLElement
    && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
    && !(target instanceof HTMLInputElement && target.type === 'range');

  const onKeyDown = (event: KeyboardEvent): void => {
    if (!enabled || isTextInput(event.target) || (!drivingKeys.has(event.code) && event.code !== cameraKey)) return;
    event.preventDefault();
    if (event.code === cameraKey && !held.has(cameraKey)) cameraToggleRequested = true;
    held.add(event.code);
  };
  const onKeyUp = (event: KeyboardEvent): void => {
    if (!drivingKeys.has(event.code) && event.code !== cameraKey) return;
    if (!enabled || isTextInput(event.target)) {
      held.delete(event.code);
      return;
    }
    event.preventDefault();
    held.delete(event.code);
  };
  const clear = (): void => {
    held.clear();
    cameraToggleRequested = false;
  };
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
    setEnabled(value: boolean): void {
      enabled = value;
      if (!enabled) clear();
    },
    consumeCameraToggle(): boolean {
      const requested = cameraToggleRequested;
      cameraToggleRequested = false;
      return requested;
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
