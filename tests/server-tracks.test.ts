import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import express from 'express';
import { createTrackStore } from '../server/track-store.ts';
import { createTracksApi } from '../server/tracks-api.ts';
import { splinePresets } from '../src/track/spline-presets.ts';
import { createSplineGraph } from '../src/track/spline.ts';

async function directory(t: TestContext): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'racing-tracks-'));
  t.after(async () => {
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    assert.ok(basename(root).startsWith('racing-tracks-'));
    await rm(root, { recursive: true, force: true });
  });
  return root;
}

function track() { return splinePresets[0]!.create(); }

test('server tracks survive reopening, concurrent saves retain every map, and delete persists', async (t) => {
  const file = join(await directory(t), 'maps', 'tracks.json');
  const store = await createTrackStore(file);
  assert.deepEqual(await store.list(), []);
  const saved = await Promise.all(Array.from({ length: 12 }, (_, index) => store.save(`Track ${index}`, track())));
  const updated = track(); updated.nodes[0]!.height = 1;
  const replacement = await store.save('track 0', updated);
  assert.equal(replacement.id, saved[0]!.id);
  assert.equal((await store.list()).length, 12);
  replacement.layout.nodes[0]!.height = 0;
  assert.equal((await store.get(replacement.id))!.layout.nodes[0]!.height, 1);
  assert.equal(await store.delete(saved[1]!.id), true);
  assert.equal(await store.delete(saved[1]!.id), false);
  await store.flush();
  const reopened = await createTrackStore(file);
  assert.equal((await reopened.list()).length, 11);
  assert.equal(await reopened.get(saved[1]!.id), null);
  assert.equal((await reopened.get(replacement.id))!.layout.nodes[0]!.height, 1);
  assert.equal(JSON.parse(await readFile(file, 'utf8')).length, 11);
});

test('invalid libraries are preserved and failed writes do not create phantom saved tracks', async (t) => {
  const root = await directory(t);
  const broken = join(root, 'broken.json');
  await writeFile(broken, '{invalid');
  await assert.rejects(createTrackStore(broken), /Could not read track library/);
  assert.equal(await readFile(broken, 'utf8'), '{invalid');
  const blocked = join(root, 'blocked');
  const store = await createTrackStore(join(blocked, 'tracks.json'));
  await writeFile(blocked, 'A file prevents creating the directory.');
  await assert.rejects(store.save('Map', track()));
  assert.deepEqual(await store.list(), []);
  await unlink(blocked);
  await store.save('Map', track());
  assert.equal((await store.list()).length, 1);
});

test('HTTP clients share save/load/delete results and the server rejects malformed maps and requests', async (t) => {
  const store = await createTrackStore(join(await directory(t), 'tracks.json'));
  const app = express(); app.use('/api/tracks', createTracksApi(store));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolveListening, reject) => { server.once('listening', resolveListening); server.once('error', reject); });
  t.after(() => new Promise<void>((close) => server.close(() => close())));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}/api/tracks`;
  const save = (body: unknown) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const created = await save({ name: 'Shared map', layout: track() });
  assert.equal(created.status, 200);
  const record = await created.json();
  const fromOtherClient = await fetch(url);
  assert.equal(fromOtherClient.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await fromOtherClient.json(), [record]);
  assert.deepEqual(await (await fetch(`${url}/${record.id}`)).json(), record);
  for (const body of [{ name: '', layout: track() }, { name: 'x'.repeat(61), layout: track() }, { name: 7, layout: track() }, { name: 'Bad', layout: [[2]] }, { name: 'No start', layout: createSplineGraph() }]) {
    const invalid = await save(body);
    assert.equal(invalid.status, 400);
    assert.equal(typeof (await invalid.json()).error, 'string');
  }
  const twoStarts = track(); twoStarts.finishLine = null;
  assert.equal((await save({ name: 'Two starts', layout: twoStarts })).status, 400);
  const invalidTile = track(); invalidTile.nodes[0]!.width = NaN;
  assert.equal((await save({ name: 'Wrong tile', layout: invalidTile })).status, 400);
  assert.equal((await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad' })).status, 400);
  assert.equal((await save({ name: 'Huge', layout: 'x'.repeat(300_000) })).status, 413);
  assert.equal((await fetch(`${url}/missing`)).status, 404);
  assert.equal((await fetch(`${url}/${record.id}`, { method: 'DELETE' })).status, 204);
  assert.equal((await fetch(`${url}/${record.id}`)).status, 404);
  assert.deepEqual(await (await fetch(url)).json(), []);
});
