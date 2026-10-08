import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createKeyboardInput } from '../src/input/keyboard.ts';

function fixture() {
  const windowTarget = new EventTarget();
  const documentTarget = Object.assign(new EventTarget(), { hidden: false });
  const input = createKeyboardInput(windowTarget as Window, documentTarget as unknown as Document);
  return {
    windowTarget, documentTarget, input,
    key(type: 'keydown' | 'keyup', code: string): Event {
      const event = new Event(type, { cancelable: true });
      Object.defineProperty(event, 'code', { value: code });
      windowTarget.dispatchEvent(event);
      return event;
    },
  };
}

test('held keys, releases, repeated keydown, and simultaneous inputs map to controls', () => {
  const f = fixture();
  assert.equal(f.key('keydown', 'KeyW').defaultPrevented, true);
  f.key('keydown', 'KeyW');
  f.key('keydown', 'KeyA');
  assert.deepEqual(f.input.sample(), { throttle: 1, steering: 1, brake: false });
  f.key('keydown', 'KeyS');
  f.key('keydown', 'KeyD');
  assert.deepEqual(f.input.sample(), { throttle: 0, steering: 0, brake: true });
  f.key('keyup', 'KeyW');
  f.key('keyup', 'KeyA');
  assert.deepEqual(f.input.sample(), { throttle: -1, steering: -1, brake: false });
  f.input.dispose();
});

test('blur clears all held controls even without keyup events', () => {
  const f = fixture();
  f.key('keydown', 'KeyW');
  f.key('keydown', 'KeyD');
  f.windowTarget.dispatchEvent(new Event('blur'));
  assert.deepEqual(f.input.sample(), { throttle: 0, steering: 0, brake: false });
  f.input.dispose();
});

test('hiding the document clears held controls', () => {
  const f = fixture();
  f.key('keydown', 'KeyS');
  f.documentTarget.hidden = true;
  f.documentTarget.dispatchEvent(new Event('visibilitychange'));
  assert.deepEqual(f.input.sample(), { throttle: 0, steering: 0, brake: false });
  f.input.dispose();
});

test('unrelated keys are untouched and disposal removes listeners', () => {
  const f = fixture();
  assert.equal(f.key('keydown', 'Space').defaultPrevented, false);
  f.input.dispose();
  assert.equal(f.key('keydown', 'KeyW').defaultPrevented, false);
  assert.equal(f.input.sample().throttle, 0);
});
