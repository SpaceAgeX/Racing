import assert from 'node:assert/strict';
import test from 'node:test';
import { createFrameLimiter } from '../src/rendering/frame-limiter.ts';

test('draws close to 60 FPS on common high-refresh displays without exceeding the cap', () => {
  for (const refreshRate of [60, 120, 144, 165, 240]) {
    const limiter = createFrameLimiter(60);
    const draws: number[] = [];
    for (let frame = 0; frame < refreshRate * 10; frame++) {
      const now = frame * 1000 / refreshRate;
      if (limiter.shouldDraw(now)) draws.push(now);
    }
    assert.ok(draws.length >= 580 && draws.length <= 600, `${refreshRate} Hz produced ${draws.length} draws`);
    for (let index = 60; index < draws.length; index++) {
      assert.ok(draws[index]! - draws[index - 60]! >= 1000 - 1e-6);
    }
  }
});

test('resumes immediately after a long pause or a timing reset', () => {
  const limiter = createFrameLimiter(60);
  assert.equal(limiter.shouldDraw(0), true);
  assert.equal(limiter.shouldDraw(5), false);
  assert.equal(limiter.shouldDraw(5000), true);
  limiter.reset();
  assert.equal(limiter.shouldDraw(5001), true);
});
