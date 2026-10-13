import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { startPrototype } from '../../src/prototype.ts';
import { enterRace } from './race-helpers.ts';

async function paint(page: Page, row: number, column: number): Promise<void> {
  const box = await page.locator('#map-canvas').boundingBox();
  if (!box) throw new Error('Map canvas is missing.');
  await page.mouse.click(box.x + (column + .5) / 64 * box.width, box.y + (row + .5) / 64 * box.height);
}

test('builder enforces one start and saves, loads, plays, and deletes multiple tracks', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/map-builder/');
  await expect(page.getByRole('heading', { name: 'Map Builder', exact: true })).toBeVisible();
  await page.getByLabel('Presets and saved tracks').selectOption('preset:simple-loop');
  await page.getByRole('button', { name: 'Load track', exact: true }).click();
  await expect(page.getByLabel('Track name', { exact: true })).toHaveValue('Simple loop track');
  await expect(page.getByRole('button', { name: 'Delete track', exact: true })).toBeDisabled();
  await page.screenshot({ path: 'test-results/map-builder-simple-loop.png', fullPage: true });

  await page.getByRole('button', { name: 'New blank track', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save track', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Play track', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Start / finish', exact: true }).click();
  await paint(page, 10, 10);
  await paint(page, 11, 11);
  await expect(page.locator('#map-summary')).toContainText('Start / finish: 1/1');
  await page.getByRole('button', { name: 'Track', exact: true }).click();
  const box = (await page.locator('#map-canvas').boundingBox())!;
  await page.mouse.move(box.x + 12.5 / 64 * box.width, box.y + 11.5 / 64 * box.height);
  await page.mouse.down();
  await page.mouse.move(box.x + 18.5 / 64 * box.width, box.y + 11.5 / 64 * box.height, { steps: 2 });
  await page.mouse.up();
  await page.getByLabel('Track name', { exact: true }).fill('Test track A');
  await page.getByRole('button', { name: 'Save track', exact: true }).click();
  await expect(page.locator('#builder-message')).toContainText('Saved Test track A');
  const saved = await (await page.request.get('/api/tracks')).json();
  expect(saved[0].layout[10][10]).toBe(1);
  expect(saved[0].layout[11][11]).toBe(2);
  expect(saved[0].layout[11].slice(12, 19)).toEqual(Array(7).fill(1));

  await page.getByRole('button', { name: 'New blank track', exact: true }).click();
  await page.getByRole('button', { name: 'Start / finish', exact: true }).click();
  await paint(page, 32, 32);
  await page.getByLabel('Track name', { exact: true }).fill('Test track B');
  await page.getByRole('button', { name: 'Save track', exact: true }).click();
  await page.reload();
  await page.getByLabel('Presets and saved tracks').selectOption({ label: 'Test track A' });
  await page.getByRole('button', { name: 'Load track', exact: true }).click();
  await expect(page.getByLabel('Track name', { exact: true })).toHaveValue('Test track A');
  await page.getByRole('button', { name: 'Play track', exact: true }).click();
  await expect(page).toHaveURL('http://127.0.0.1:3100/');
  await enterRace(page);
  await expect(page.locator('#active-track-name')).toHaveText('Test track A');
  const game = await page.evaluate(async () => {
    const path = '/assets/main.js';
    const { prototype } = await import(path) as { prototype: ReturnType<typeof startPrototype> };
    return { name: prototype.trackName, tiles: prototype.view.trackTiles.length, layout: prototype.layout };
  });
  expect(game.tiles).toBe(9);
  expect(game.layout[11]![11]).toBe(2);
  await page.goto('/map-builder/');
  await page.getByLabel('Presets and saved tracks').selectOption({ label: 'Test track A' });
  await page.getByRole('button', { name: 'Delete track', exact: true }).click();
  await expect(page.locator('#builder-message')).toContainText('Deleted Test track A');
  await expect(page.locator('#track-library option')).toHaveCount(3);
  await page.getByRole('link', { name: 'Back to game', exact: true }).click();
  await expect(page.locator('#active-track-name')).toHaveText('Default circuit');
  expect(errors).toEqual([]);
});

test('the full builder fits desktop, narrow, and short windows without scrolling and still paints accurately', async ({ page }) => {
  await page.goto('/map-builder/');
  for (const viewport of [{ width: 1280, height: 720 }, { width: 1024, height: 600 }, { width: 740, height: 390 }, { width: 390, height: 720 }]) {
    await page.setViewportSize(viewport);
    await expect.poll(async () => page.locator('#map-canvas').evaluate((canvas: HTMLCanvasElement) => {
      const bounds = canvas.getBoundingClientRect();
      return canvas.clientWidth === canvas.clientHeight && bounds.bottom <= innerHeight && bounds.top >= 0
        && document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight;
    })).toBe(true);
    const button = await page.getByRole('button', { name: 'Play track', exact: true }).boundingBox();
    expect(button!.y + button!.height).toBeLessThanOrEqual(viewport.height);
  }
  await page.getByRole('button', { name: 'New blank track', exact: true }).click();
  await page.getByRole('button', { name: 'Start / finish', exact: true }).click();
  await paint(page, 20, 20);
  await expect(page.locator('#map-summary')).toContainText('Start / finish: 1/1');
  await page.screenshot({ path: 'test-results/map-builder-narrow.png', fullPage: true });
});

test('a track saved in one browser is playable in another and deleting it updates the shared library', async ({ page, browser }) => {
  const otherContext = await browser.newContext({ baseURL: 'http://127.0.0.1:3100' });
  try {
    const other = await otherContext.newPage();
    await other.goto('/map-builder/');
    await page.goto('/map-builder/');
    await page.getByRole('button', { name: 'New blank track', exact: true }).click();
    await page.getByRole('button', { name: 'Start / finish', exact: true }).click();
    await paint(page, 32, 32);
    await page.getByRole('button', { name: 'Track', exact: true }).click();
    await paint(page, 31, 32);
    await page.getByLabel('Track name', { exact: true }).fill('Shared browser track');
    await page.getByRole('button', { name: 'Save track', exact: true }).click();
    await expect(page.locator('#builder-message')).toContainText('Saved Shared browser track');
    await other.bringToFront();
    await expect(other.locator('#track-library option').filter({ hasText: /^Shared browser track$/ })).toHaveCount(1);
    await other.getByLabel('Presets and saved tracks').selectOption({ label: 'Shared browser track' });
    await other.getByRole('button', { name: 'Load track', exact: true }).click();
    await expect(other.locator('#map-summary')).toContainText('2 tiles');
    await other.getByRole('button', { name: 'Play track', exact: true }).click();
    await expect(other).toHaveURL('http://127.0.0.1:3100/');
    await enterRace(other);
    await expect(other.locator('#active-track-name')).toHaveText('Shared browser track');
    const result = await other.evaluate(async () => {
      const path = '/assets/main.js';
      const { prototype } = await import(path) as { prototype: ReturnType<typeof startPrototype> };
      return { tiles: prototype.view.trackTiles.length, starts: prototype.layout[32]![32], localLibrary: localStorage.getItem('racing-track-library-v1') };
    });
    expect(result).toEqual({ tiles: 2, starts: 2, localLibrary: null });
    await other.goto('/map-builder/');
    await page.bringToFront();
    await page.getByRole('button', { name: 'Delete track', exact: true }).click();
    await expect(page.locator('#builder-message')).toContainText('Deleted Shared browser track');
    await other.bringToFront();
    await expect(other.locator('#track-library option').filter({ hasText: /^Shared browser track$/ })).toHaveCount(0);
  } finally { await otherContext.close(); }
});

test('an older browser map can be shared and a failed server save retains the drawing for retry', async ({ page }) => {
  await page.addInitScript(() => {
    const layout = Array.from({ length: 64 }, () => Array(64).fill(0));
    layout[20]![20] = 2;
    localStorage.setItem('racing-track-library-v1', JSON.stringify([{ id: 'legacy', name: 'Legacy browser map', layout, updatedAt: 1 }]));
  });
  await page.goto('/map-builder/');
  await page.getByLabel('Presets and saved tracks').selectOption('browser:legacy');
  await page.getByRole('button', { name: 'Load track', exact: true }).click();
  await expect(page.locator('#builder-message')).toContainText('Save track to share');
  await page.route('**/api/tracks', async (route) => {
    if (route.request().method() === 'POST') await route.fulfill({ status: 503, json: { error: 'Server save temporarily unavailable.' } });
    else await route.continue();
  });
  await page.getByRole('button', { name: 'Save track', exact: true }).click();
  await expect(page.locator('#builder-message')).toHaveText('Server save temporarily unavailable.');
  await expect(page.getByLabel('Track name', { exact: true })).toHaveValue('Legacy browser map');
  await expect(page.locator('#map-summary')).toContainText('1 tiles');
  await expect(page.getByRole('button', { name: 'Play track', exact: true })).toBeEnabled();
  await page.unroute('**/api/tracks');
  await page.getByRole('button', { name: 'Save track', exact: true }).click();
  await expect(page.locator('#builder-message')).toContainText('Saved Legacy browser map');
  const records = await (await page.request.get('/api/tracks')).json();
  const record = records.find((entry: { name: string }) => entry.name === 'Legacy browser map');
  expect(record.layout[20][20]).toBe(2);
  await page.getByRole('button', { name: 'Delete track', exact: true }).click();
  await expect(page.locator('#builder-message')).toContainText('Deleted Legacy browser map');
});
