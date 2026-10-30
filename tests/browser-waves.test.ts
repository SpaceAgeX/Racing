import assert from 'node:assert/strict';
import test from 'node:test';
import { browserCarFootprint, browserRoadWidth, generateBrowserWave } from '../src/rendering/browser-waves.ts';

function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
}

test('generated racing waves remain separated for their whole trajectories', () => {
  const formations = new Set<string>();
  for (let seed = 1; seed <= 500; seed++) {
    const cars = generateBrowserWave(seeded(seed));
    assert.ok(cars.length >= 2 && cars.length <= 5);
    assert.equal(new Set(cars.map(car => car.color)).size, cars.length);
    assert.ok(new Set(cars.map(car => car.lane)).size >= 2);
    formations.add(`${cars.length}:${cars.map(car => car.lane).join('')}:${cars.map(car => Math.round(car.offset)).join(',')}`);
    for (const car of cars) {
      assert.ok(Math.abs(car.x) + browserCarFootprint.width / 2 + .5 < browserRoadWidth / 2);
    }
    // Constant-speed paths can meet long after spawn, so sample through the full pass.
    for (let step = 0; step <= 350; step++) {
      const seconds = step * .05;
      for (let a = 0; a < cars.length; a++) for (let b = a + 1; b < cars.length; b++) {
        const first = cars[a]!, second = cars[b]!;
        const lateral = Math.abs(first.x - second.x);
        const longitudinal = Math.abs((first.offset - first.speed * seconds) - (second.offset - second.speed * seconds));
        assert.ok(lateral >= browserCarFootprint.width + .25 || longitudinal >= browserCarFootprint.length + .8,
          `cars intersect in seed ${seed} at ${seconds}s`);
      }
    }
  }
  assert.ok(formations.size > 100, 'waves should have varied counts, bands, and spacing');
});
