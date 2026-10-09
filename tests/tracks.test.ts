import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Euler, Vector3 } from 'three';
import { bodyAxes } from '../src/simulation/box.ts';
import { cloneTrack, emptyTrack, isTrackGrid, paintTrack, paintTrackStroke, playableTrackError, trackSummary } from '../src/track/model.ts';
import { trackPresets } from '../src/track/presets.ts';
import { clearActiveTrack, listBrowserTracks, loadActiveTrack, selectTrackForPlay } from '../src/track/storage.ts';

function storage() {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } };
}

test('placing a start moves the previous marker and track painting preserves it', () => {
  const grid = emptyTrack();
  paintTrack(grid, 10, 10, 2);
  paintTrack(grid, 11, 11, 2);
  assert.equal(grid[10]![10], 1);
  assert.equal(grid[11]![11], 2);
  paintTrack(grid, 11, 11, 1);
  assert.equal(trackSummary(grid).startCount, 1);
  paintTrack(grid, 11, 11, 0);
  assert.equal(trackSummary(grid).startCount, 0);
  assert.ok(playableTrackError(grid));
});

test('fast drag strokes fill every intermediate cell and ignore out-of-grid painting', () => {
  const grid = emptyTrack();
  paintTrackStroke(grid, { row: 2, column: 3 }, { row: 2, column: 20 }, 1);
  assert.equal(grid[2]!.slice(3, 21).filter((tile) => tile === 1).length, 18);
  paintTrack(grid, -1, 2, 1);
  assert.equal(grid.length, 64);
});

test('saved tracks require the 64 square grid and exactly one start', () => {
  const grid = emptyTrack();
  assert.equal(isTrackGrid(grid), true);
  assert.throws(() => selectTrackForPlay(storage(), 'Empty', grid));
  grid[1]![1] = 2;
  grid[2]![2] = 2;
  assert.throws(() => selectTrackForPlay(storage(), 'Two starts', grid));
  assert.equal(isTrackGrid([[2]]), false);
  grid[2]![2] = 0;
  assert.equal(playableTrackError(grid), null);
});

test('active track selection is per browser and older browser maps remain readable', () => {
  const store = storage();
  const grid = emptyTrack();
  paintTrack(grid, 32, 32, 2);
  const first = { id: 'old-alpha', name: 'Alpha', layout: cloneTrack(grid), updatedAt: 1 };
  store.setItem('racing-track-library-v1', JSON.stringify([first]));
  paintTrack(grid, 32, 33, 1);
  assert.equal(listBrowserTracks(store)[0]!.layout[32]![33], 0);
  selectTrackForPlay(store, first.name, grid, first.id);
  assert.equal(loadActiveTrack(storage()), null);
  clearActiveTrack(store, 'other-track');
  assert.equal(loadActiveTrack(store)?.id, first.id);
  clearActiveTrack(store, first.id);
  assert.equal(loadActiveTrack(store), null);
  assert.equal(listBrowserTracks(store).length, 1);
});

test('preset layouts have one start and a connected rounded course; default differs from simple loop', () => {
  const layouts = trackPresets.map((preset) => preset.create());
  for (const grid of layouts) {
    assert.equal(playableTrackError(grid), null);
    assert.equal(trackSummary(grid).startCount, 1);
    const queue: [number, number][] = [];
    for (let row = 0; row < 64; row++) for (let column = 0; column < 64; column++) if (grid[row]![column] === 2) queue.push([row, column]);
    const seen = new Set<string>();
    while (queue.length) {
      const [row, column] = queue.shift()!;
      const key = `${row}:${column}`;
      if (seen.has(key)) continue;
      seen.add(key);
      for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const r = row + dr!, c = column + dc!;
        if (r >= 0 && r < 64 && c >= 0 && c < 64 && grid[r]![c] !== 0 && !seen.has(`${r}:${c}`)) queue.push([r, c]);
      }
    }
    assert.equal(seen.size, trackSummary(grid).tileCount);
    assert.equal(grid[15]![19], 0); // Rounded outer corner rather than a rectangular square corner.
  }
  assert.notDeepEqual(layouts[0], layouts[1]);
  const modified = cloneTrack(layouts[1]!);
  modified[37]![20] = 0;
  assert.equal(trackPresets[1].create()[37]![20], 2);
});

test('invalid stored data falls back safely and cannot become an active track', () => {
  const store = storage();
  store.setItem('racing-track-library-v1', '{broken');
  store.setItem('racing-active-track-v1', JSON.stringify({ id: 'bad', name: 'Bad', layout: [[2]], updatedAt: 1 }));
  assert.deepEqual(listBrowserTracks(store), []);
  assert.equal(loadActiveTrack(store), null);
});

test('tilted collision axes match the visible car rotation', () => {
  const shape = { width: 1.8, height: .8, length: 3.8, heading: .7, pitch: -.4, roll: .6 };
  const axes = bodyAxes(shape);
  const euler = new Euler(shape.pitch, shape.heading, shape.roll, 'YXZ');
  for (const [index, vector] of [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)].entries()) {
    vector.applyEuler(euler);
    assert.ok(vector.distanceTo(new Vector3(axes[index]!.x, axes[index]!.y, axes[index]!.z)) < 1e-10);
  }
});
