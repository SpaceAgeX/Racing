import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { startPrototype } from '../../src/prototype.ts';
import { readFile } from 'node:fs/promises';
import { formatLapTime } from '../../src/ui/lap-display.ts';
import { enterRace } from './race-helpers.ts';
import { trackOptions } from '../../src/multiplayer/protocol.ts';

type Prototype = ReturnType<typeof startPrototype>;

async function snapshot(page: Page) {
  return page.evaluate(async () => {
    const path = '/assets/main.js';
    const { prototype } = await import(path) as { prototype: Prototype };
    const projected = prototype.car.object.position.clone();
    projected.y += 0.4;
    projected.project(prototype.view.camera);
    const track = prototype.view.scene.getObjectByName('track');
    const arch = prototype.view.scene.getObjectByName('start-finish-arch');
    return {
      ...structuredClone(prototype.state),
      projected: { x: projected.x, y: projected.y },
      camera: prototype.view.camera.position.toArray(),
      aspect: prototype.view.camera.aspect,
      canvasHeight: prototype.view.renderer.domElement.clientHeight,
      renderedCar: prototype.car.object.position.toArray(),
      drawCalls: prototype.view.renderer.info.render.calls,
      trackPresent: Boolean(track),
      archPosition: arch?.position.toArray(),
    };
  });
}

async function setSlider(page: Page, label: string, value: number): Promise<void> {
  await page.getByLabel(label, { exact: true }).evaluate((input: HTMLInputElement, next: number) => {
    input.value = String(next);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();
  }, value);
}

async function tuningSnapshot(page: Page) {
  return page.evaluate(async () => {
    const path = '/assets/main.js';
    const { prototype } = await import(path) as { prototype: Prototype };
    return structuredClone(prototype.tuning);
  });
}

async function lapSnapshot(page: Page) {
  return page.evaluate(async () => {
    const path = '/assets/main.js';
    const { prototype } = await import(path) as { prototype: Prototype };
    return structuredClone(prototype.lapTimer);
  });
}

test('the car, tiled track, and start arch render with a controls hint and no browser errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/');
  await enterRace(page);
  await expect(page.locator('#game')).toBeVisible();
  await expect(page.locator('.controls')).toContainText('Brake / reverse');
  await expect.poll(async () => (await snapshot(page)).drawCalls).toBeGreaterThan(0);
  const initial = await snapshot(page);
  expect(initial.trackPresent).toBe(true);
  expect(initial.archPosition).toBeDefined();
  expect(initial.position.x).toBe(initial.archPosition![0]);
  expect(initial.position.z).toBeGreaterThan(initial.archPosition![2]!);
  expect(initial.speed).toBe(0);
  expect(initial.camera[1]).toBeGreaterThan(0);
  expect(initial.camera[2]).toBeGreaterThan(initial.position.z);
  await page.screenshot({ path: 'test-results/prototype-desktop.png' });
  expect(errors).toEqual([]);
});

test('time trial setup previews shared maps, selects car color, and starts solo on the chosen track', async ({ page }) => {
  const duplicate = { ...trackOptions[0]!, id: 'old-default-copy', updatedAt: 1 };
  await page.addInitScript(record => {
    localStorage.setItem('racing-active-track-v1', JSON.stringify(record));
    localStorage.setItem('racing-track-library-v1', JSON.stringify([record]));
  }, duplicate);
  await page.goto('/');
  await expect(page.getByRole('link', { name: /Map Builder/ })).toBeVisible();
  await page.getByRole('button', { name: /Time Trial/ }).click();
  await expect(page.getByRole('heading', { name: 'Choose your track' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sky blue', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#home-screen .trial-color-swatch')).toHaveCount(15);
  const trackSelect = page.locator('#time-trial-track-select');
  await expect(trackSelect.locator('option')).not.toHaveCount(0);
  await expect(trackSelect.locator('option').filter({ hasText: 'Default circuit' })).toHaveCount(1);
  await trackSelect.selectOption('simple-loop');
  await expect(page.locator('[data-track-name]')).toHaveText('Simple loop track');
  await expect(page.locator('[data-preview]')).toBeVisible();
  await page.getByRole('button', { name: 'Pink', exact: true }).click();
  await page.getByRole('button', { name: 'Start Time Trial' }).click();
  await expect(page.locator('#race-screen')).toBeVisible();
  await expect(page.locator('#active-track-name')).toHaveText('Simple loop track');
  const choices = await page.evaluate(() => ({
    color: localStorage.getItem('racing-time-trial-color-v1'),
    track: JSON.parse(localStorage.getItem('racing-active-track-v1') ?? 'null') as { id?: string } | null,
  }));
  expect(choices.color).toBe('#ff8ab0');
  expect(choices.track?.id).toBe('simple-loop');
});

test('connecting to multiplayer keeps the lobby browser visible', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Multiplayer Race/ }).click();
  await expect(page.locator('#home-status')).toContainText('Connected');
  await expect(page.locator('#home-multiplayer-menu')).toBeVisible();
  await expect(page.locator('#home-landing')).toBeHidden();
});

test('keyboard drives acceleration, coasting, steering, braking, reverse, and camera tracking', async ({ page }) => {
  await page.goto('/');
  await enterRace(page);
  await page.keyboard.down('w');
  await expect.poll(async () => (await snapshot(page)).speed).toBeGreaterThan(7);
  await page.keyboard.up('w');
  const accelerating = await snapshot(page);
  await page.waitForTimeout(350);
  const coasting = await snapshot(page);
  expect(coasting.speed).toBeLessThan(accelerating.speed);
  expect(coasting.position.z).toBeLessThan(accelerating.position.z);

  await page.keyboard.down('a');
  await expect.poll(async () => (await snapshot(page)).heading).toBeGreaterThan(0.15);
  await page.keyboard.up('a');
  await expect.poll(async () => (await snapshot(page)).steeringAngle).toBe(0);
  const turning = await snapshot(page);
  expect(turning.position.x).toBeLessThan(accelerating.position.x);
  expect(Math.abs(turning.renderedCar[0]! - turning.position.x)).toBeLessThan(0.15);
  expect(Math.abs(turning.projected.x)).toBeLessThan(0.35);
  expect(Math.abs(turning.projected.y)).toBeLessThan(0.35);

  await page.keyboard.down('s');
  await expect.poll(async () => (await snapshot(page)).speed).toBeLessThan(-2);
  await page.keyboard.up('s');
  const reversing = await snapshot(page);
  await page.keyboard.down('a');
  await expect.poll(async () => (await snapshot(page)).heading).toBeLessThan(reversing.heading - 0.15);
  await page.keyboard.up('a');
  await page.keyboard.down('w');
  await expect.poll(async () => (await snapshot(page)).speed).toBeGreaterThan(2);
  await page.keyboard.up('w');
  expect((await snapshot(page)).camera[2]).not.toBe(accelerating.camera[2]);
});

test('blur releases throttle and steering without receiving keyup', async ({ page }) => {
  await page.goto('/');
  await enterRace(page);
  await page.keyboard.down('w');
  await page.keyboard.down('d');
  await expect.poll(async () => (await snapshot(page)).speed).toBeGreaterThan(3);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  const before = await snapshot(page);
  await expect.poll(async () => (await snapshot(page)).steeringAngle).toBe(0);
  expect((await snapshot(page)).speed).toBeLessThan(before.speed);
  await page.keyboard.up('w');
  await page.keyboard.up('d');
});

test('canvas and projection resize for desktop and narrow windows', async ({ page }) => {
  await page.goto('/');
  await enterRace(page);
  for (const size of [{ width: 640, height: 400 }, { width: 390, height: 720 }]) {
    await page.setViewportSize(size);
    await expect.poll(async () => {
      const expected = await page.locator('#game').evaluate((canvas: HTMLCanvasElement) => canvas.clientWidth / canvas.clientHeight);
      return Math.abs((await snapshot(page)).aspect - expected);
    }).toBeLessThan(1e-10);
    const dimensions = await page.locator('#game').evaluate((canvas: HTMLCanvasElement) => ({
      width: canvas.width, height: canvas.height,
      expectedWidth: canvas.clientWidth * Math.min(devicePixelRatio, 2),
      expectedHeight: canvas.clientHeight * Math.min(devicePixelRatio, 2),
      cssHeight: canvas.clientHeight,
      overflow: document.documentElement.scrollWidth > innerWidth,
    }));
    expect(dimensions.width).toBe(dimensions.expectedWidth);
    expect(dimensions.height).toBe(dimensions.expectedHeight);
    expect(dimensions.cssHeight).toBeGreaterThan(size.height / 2);
    expect(dimensions.overflow).toBe(false);
    expect(Math.abs((await snapshot(page)).projected.x)).toBeLessThan(0.1);
  }
  await page.screenshot({ path: 'test-results/prototype-narrow.png' });
});

test('a long rendering pause causes no catch-up movement jump', async ({ page }) => {
  await page.goto('/');
  await enterRace(page);
  await page.keyboard.down('w');
  await expect.poll(async () => (await snapshot(page)).speed).toBeGreaterThan(10);
  const distance = await page.evaluate(async () => {
    const path = '/assets/main.js';
    const { prototype } = await import(path) as { prototype: Prototype };
    const before = structuredClone(prototype.state.position);
    const started = performance.now();
    while (performance.now() - started < 600) { /* Simulate a suspended rendering thread. */ }
    await new Promise(requestAnimationFrame);
    return Math.hypot(prototype.state.position.x - before.x, prototype.state.position.z - before.z);
  });
  expect(distance).toBeLessThan(0.5);
  await page.keyboard.up('w');
});

test('driving off the track shows a fall then respawns at the start with the camera reset', async ({ page }) => {
  await page.goto('/');
  await enterRace(page);
  const initial = await snapshot(page);
  await page.evaluate(async () => {
    const path = '/assets/main.js';
    const { prototype } = await import(path) as { prototype: Prototype };
    const tiles = prototype.view.trackTiles;
    const tile = [...tiles].sort((a, b) => a.position.x - b.position.x)[0]!;
    Object.assign(prototype.state.position, { x: tile.position.x - prototype.view.tileSize / 2 + 0.2, y: 0, z: tile.position.z });
    prototype.state.heading = Math.PI / 2;
  });
  await page.keyboard.down('w');
  await expect.poll(async () => (await snapshot(page)).airborneTime, { intervals: [25, 50] }).toBeGreaterThan(0.2);
  await page.keyboard.up('w');
  // Tipping can keep a corner against the slab before the body drops below it.
  await expect.poll(async () => (await snapshot(page)).position.y, { intervals: [25, 50] }).toBeLessThan(-0.2);
  const falling = await snapshot(page);
  expect(falling.grounded).toBe(false);
  expect(falling.position.y).toBeLessThan(-0.1);
  expect(falling.verticalSpeed).toBeLessThan(0);
  expect(falling.speed).toBeGreaterThan(0);
  await page.screenshot({ path: 'test-results/prototype-falling.png' });

  await expect.poll(async () => (await snapshot(page)).grounded, { intervals: [25, 50] }).toBe(true);
  const respawned = await snapshot(page);
  expect(respawned.position).toEqual(initial.position);
  expect(respawned.heading).toBe(initial.heading);
  expect(respawned.speed).toBe(0);
  expect(respawned.steeringAngle).toBe(0);
  expect(respawned.verticalSpeed).toBe(0);
  expect(respawned.airborneTime).toBe(0);
  expect(respawned.renderedCar).toEqual(initial.renderedCar);
  expect(respawned.camera).toEqual(initial.camera);
  expect((await lapSnapshot(page)).running).toBe(false);
  expect((await lapSnapshot(page)).elapsed).toBe(0);
  await page.screenshot({ path: 'test-results/prototype-respawned.png' });
});

test('a car tips toward the edge once more than half of it loses support', async ({ page }) => {
  await page.goto('/');
  await enterRace(page);
  await page.evaluate(async () => {
    const path = '/assets/main.js';
    const { prototype } = await import(path) as { prototype: Prototype };
    const tiles = prototype.view.trackTiles;
    const minX = Math.min(...tiles.map((tile) => tile.position.x));
    const edgeTiles = tiles.filter((tile) => tile.position.x === minX);
    const tile = edgeTiles[Math.floor(edgeTiles.length / 2)]!;
    Object.assign(prototype.state.position, { x: tile.position.x - prototype.view.tileSize / 2 + 0.05, y: 0, z: tile.position.z });
    prototype.state.heading = 0;
  });
  await page.waitForTimeout(100);
  const supported = await snapshot(page);
  expect(supported.grounded).toBe(true);
  expect(supported.position.y).toBe(0);

  await page.evaluate(async () => {
    const path = '/assets/main.js';
    const { prototype } = await import(path) as { prototype: Prototype };
    prototype.state.position.x -= 0.1;
  });
  await expect.poll(async () => (await snapshot(page)).roll, { intervals: [25] }).toBeGreaterThan(0.2);
  const tipping = await snapshot(page);
  expect(tipping.grounded).toBe(false);
  expect(tipping.tipping).toBe(true);
  expect(tipping.supportFraction).toBeLessThan(0.5);
  await page.screenshot({ path: 'test-results/prototype-tipping.png' });
});

test('sliders change driving immediately, persist on refresh, save JSON, and reset defaults', async ({ page }) => {
  await page.goto('/');
  await enterRace(page);
  await expect(page.locator('#tuning-panel')).toBeVisible();
  await expect(page.locator('#tuning-panel input[type="range"]')).toHaveCount(21);
  await setSlider(page, 'Top speed limit', 5);
  await setSlider(page, 'Acceleration', 20);
  await setSlider(page, 'Respawn delay', 2);
  const tuned = await tuningSnapshot(page);
  expect(tuned.driving.maxSpeed).toBe(5);
  expect(tuned.driving.acceleration).toBe(20);
  expect(tuned.physics.respawnDelay).toBe(2);

  // Driving still works while a slider has focus.
  await page.keyboard.down('w');
  await expect.poll(async () => (await snapshot(page)).speed, { intervals: [50] }).toBe(5);
  await expect(page.locator('#current-speed')).toHaveText('18.0 km/h');
  await page.keyboard.up('w');
  await page.reload();
  await enterRace(page);
  await expect(page.getByLabel('Top speed limit', { exact: true })).toHaveValue('5');
  await expect(page.getByLabel('Acceleration', { exact: true })).toHaveValue('20');
  expect(await tuningSnapshot(page)).toEqual(tuned);

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save settings', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('racing-handling.json');
  const filename = await download.path();
  expect(JSON.parse(await readFile(filename!, 'utf8'))).toEqual(tuned);

  await setSlider(page, 'Maximum steering', 0.25);
  await setSlider(page, 'High-speed steering', 0.25);
  await setSlider(page, 'Maximum steering', 0.15);
  await expect(page.getByLabel('High-speed steering', { exact: true })).toHaveValue('0.15');
  expect((await tuningSnapshot(page)).driving.highSpeedSteeringAngle).toBe(0.15);

  await page.getByRole('button', { name: 'Reset defaults', exact: true }).click();
  const reset = await tuningSnapshot(page);
  expect(reset.driving.maxSpeed).toBe(62);
  expect(reset.driving.acceleration).toBe(22);
  expect(reset.driving.maxSteeringAngle).toBe(0.55);
  expect(reset.driving.highSpeedSteeringAngle).toBe(0.1);
  expect(reset.physics.respawnDelay).toBe(1);
  await page.reload();
  await enterRace(page);
  expect(await tuningSnapshot(page)).toEqual(reset);
});

test('hiding and showing the tuning panel resizes the canvas and camera', async ({ page }) => {
  await page.goto('/');
  await enterRace(page);
  const initialWidth = await page.locator('#game').evaluate((canvas: HTMLCanvasElement) => canvas.clientWidth);
  await page.getByRole('button', { name: 'Hide', exact: true }).click();
  await expect(page.locator('#tuning-panel')).toBeHidden();
  await expect.poll(async () => page.locator('#game').evaluate((canvas: HTMLCanvasElement) => canvas.clientWidth)).toBe(1280);
  await expect.poll(async () => (await snapshot(page)).aspect).toBe(1280 / (await snapshot(page)).canvasHeight);
  await page.getByRole('button', { name: 'Tuning', exact: true }).click();
  await expect(page.locator('#tuning-panel')).toBeVisible();
  await expect.poll(async () => page.locator('#game').evaluate((canvas: HTMLCanvasElement) => canvas.clientWidth)).toBe(initialWidth);
  await expect.poll(async () => (await snapshot(page)).aspect).toBe(initialWidth / (await snapshot(page)).canvasHeight);
});

test('a falling car hits both solid inside-corner faces and slides down without clipping', async ({ page }) => {
  await page.goto('/');
  await enterRace(page);
  const edge = await page.evaluate(async () => {
    const path = '/assets/main.js';
    const { prototype } = await import(path) as { prototype: Prototype };
    const tiles = prototype.view.trackTiles;
    const tile = tiles.find((candidate) => {
      const size = prototype.view.tileSize;
      const occupied = (dx: number, dz: number): boolean => tiles.some((other) => (
        other.position.x === candidate.position.x + dx * size && other.position.z === candidate.position.z + dz * size
      ));
      return occupied(1, 0) && occupied(0, 1) && !occupied(1, 1);
    });
    if (!tile) return null;
    const halfSize = prototype.view.tileSize / 2;
    const x = tile.position.x + halfSize;
    const z = tile.position.z + halfSize;
    Object.assign(prototype.state.position, { x: x + 2.4, y: -0.25, z: z + 2.4 });
    prototype.state.heading = Math.PI / 4;
    prototype.state.speed = 12;
    prototype.state.lateralSpeed = 0;
    prototype.state.grounded = false;
    prototype.state.verticalSpeed = 0;
    prototype.state.airborneTime = 0;
    return { x, z };
  });
  if (!edge) { test.skip(true, 'The current track has no inside corner.'); return; }
  await expect.poll(async () => (await snapshot(page)).airborneTime, { intervals: [25, 50] }).toBeGreaterThan(0.3);
  const collided = await snapshot(page);
  const radius = (1.8 + 3.8) / 2 / Math.sqrt(2);
  expect(collided.position.x).toBeGreaterThanOrEqual(edge.x + radius - 1e-5);
  expect(collided.position.z).toBeGreaterThanOrEqual(edge.z + radius - 1e-5);
  expect(collided.position.y).toBeLessThan(-0.5);
  expect(collided.grounded).toBe(false);
  expect(Math.hypot(collided.speed, collided.lateralSpeed)).toBeLessThan(12);
  await page.screenshot({ path: 'test-results/prototype-solid-corner-contact.png' });
});

test('an offset finish-post crash spins the visible car and preserves a slide before grip recovers', async ({ page }) => {
  await page.goto('/');
  await enterRace(page);
  await page.evaluate(async () => {
    const path = '/assets/main.js';
    const { prototype } = await import(path) as { prototype: Prototype };
    const arch = prototype.view.scene.getObjectByName('start-finish-arch')!;
    Object.assign(prototype.state.position, { x: arch.position.x + 4.8, y: 0, z: arch.position.z + 3 });
    prototype.state.heading = 0;
    prototype.state.speed = 18;
  });
  await expect.poll(async () => (await snapshot(page)).crashTime, { intervals: [25] }).toBeGreaterThan(0);
  await expect.poll(async () => Math.abs((await snapshot(page)).heading), { intervals: [25] }).toBeGreaterThan(.5);
  const spin = await snapshot(page);
  expect(Math.abs(spin.yawSpeed)).toBeGreaterThan(.5);
  expect(Math.abs(spin.lateralSpeed)).toBeGreaterThan(.1);
  expect(spin.grounded).toBe(true);
  const visible = await page.evaluate(async () => {
    const path = '/assets/main.js';
    const { prototype } = await import(path) as { prototype: Prototype };
    return { heading: prototype.state.heading, visual: prototype.car.object.rotation.y };
  });
  expect(Math.abs(visible.heading - visible.visual)).toBeLessThan(.15);
  await page.screenshot({ path: 'test-results/prototype-post-spin.png' });
  await expect.poll(async () => (await snapshot(page)).yawSpeed).toBe(0);
  expect((await snapshot(page)).crashTime).toBe(0);
});

test('the finish line starts the timer and records laps, best time, and differences in either direction', async ({ page }) => {
  await page.goto('/');
  await enterRace(page);
  await expect(page.locator('#lap-current')).toHaveText('00:00.00');
  await expect(page.locator('#lap-best')).toHaveText('--:--.--');
  await expect(page.locator('#lap-status')).toHaveText('Cross the line to start');
  await page.keyboard.down('w');
  await expect.poll(async () => (await lapSnapshot(page)).running, { intervals: [25, 50] }).toBe(true);
  await page.keyboard.up('w');
  await expect(page.locator('#lap-status')).toHaveText('Lap 1');

  await page.keyboard.down('s');
  await expect.poll(async () => (await lapSnapshot(page)).completedLaps, { intervals: [25, 50] }).toBe(1);
  await page.keyboard.up('s');
  const first = await lapSnapshot(page);
  expect(first.last).toBeGreaterThan(0);
  expect(first.best).toBe(first.last);
  expect(first.delta).toBeNull();
  await expect(page.locator('#lap-best')).toHaveText(formatLapTime(first.best));
  await expect(page.locator('#lap-last')).toHaveText(formatLapTime(first.last));
  await expect(page.locator('#lap-delta')).toHaveText('First lap');

  await page.keyboard.down('w');
  await expect.poll(async () => (await lapSnapshot(page)).completedLaps, { intervals: [25, 50] }).toBe(2);
  await page.keyboard.up('w');
  const second = await lapSnapshot(page);
  expect(second.best).toBe(Math.min(first.best!, second.last!));
  expect(second.delta).toBeCloseTo(second.last! - first.best!, 8);
  await expect(page.locator('#lap-last')).toHaveText(formatLapTime(second.last));
  await expect(page.locator('#lap-best')).toHaveText(formatLapTime(second.best));
  await expect(page.locator('#lap-delta')).toHaveText(/[+\u2212\u00b1]\d+\.\d{2} s vs best/);
  await expect(page.locator('#lap-status')).toHaveText('Lap 3');
  await page.screenshot({ path: 'test-results/prototype-lap-timer.png' });
});
