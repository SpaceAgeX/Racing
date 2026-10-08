import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { startPrototype } from '../../src/prototype.ts';

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
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('racing-track-library-v1')!));
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
  await expect(page.locator('#active-track-name')).toHaveText('Test track A');
  const game = await page.evaluate(async () => {
    const path = '/assets/main.js';
    const { prototype } = await import(path) as { prototype: ReturnType<typeof startPrototype> };
    return { name: prototype.trackName, tiles: prototype.view.trackTiles.length, layout: prototype.layout };
  });
  expect(game.tiles).toBe(9);
  expect(game.layout[11]![11]).toBe(2);
  await page.getByRole('link', { name: 'Map Builder', exact: true }).click();
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
