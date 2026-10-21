import { splinePresets } from '../../src/track/spline-presets.ts';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { enterRace, testAuthHeaders } from './race-helpers.ts';

async function pixels(page: Page) {
  return page.locator('#minimap').evaluate((canvas: HTMLCanvasElement) => {
    const { data, width, height } = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
    let x = 0, y = 0, count = 0, blue = 0;
    let left = width, right = 0, top = height, bottom = 0;
    for (let index = 0; index < data.length; index += 4) {
      if (data[index]! < 130 && data[index + 1]! > 140 && data[index + 1]! < 230 && data[index + 2]! > 215) blue++;
      if (data[index]! < 230 || data[index + 1]! < 110 || data[index + 1]! > 170 || data[index + 2]! > 100 || data[index + 3]! < 200) continue;
      const px = (index / 4) % width, py = Math.floor(index / 4 / width);
      x += px; y += py; count++;
      left = Math.min(left, px); right = Math.max(right, px);
      top = Math.min(top, py); bottom = Math.max(bottom, py);
    }
    return { x: x / count, y: y / count, count, blue, left, right, top, bottom, width, height };
  });
}

test('new defaults drive the minimap marker as the car moves', async ({ page }) => {
  await page.addInitScript(()=>localStorage.setItem('racing-time-trial-color-v1','#ee7136'));
  await page.goto('/');
  await enterRace(page);
  await expect(page.locator('#minimap')).toBeVisible();
  await expect(page.locator('#tuning-panel').getByLabel('Acceleration', { exact: true })).toHaveValue('40');
  await expect(page.locator('#tuning-panel').getByLabel('Top speed limit', { exact: true })).toHaveValue('80');
  const initial = await pixels(page);
  expect(initial.count).toBeGreaterThan(10);
  expect(initial.bottom - initial.top).toBeGreaterThan(initial.right - initial.left);
  await page.keyboard.down('w');
  await expect.poll(async () => (await pixels(page)).y).toBeLessThan(initial.y - 2);
  // At spawn the car arrow can cover the small start tile; it appears as we leave.

  await page.keyboard.up('w');
  await page.screenshot({ path: 'test-results/prototype-minimap.png' });
});

test('the minimap loads a saved custom map and stays clear of controls when resized', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('racing-time-trial-color-v1', '#ee7136'));
  const sharedLayout = splinePresets[1]!.create();
  sharedLayout.checkpoints = [{ id: 1, connectionId: 1, progress: .5 }];
  const response = await page.request.post('/api/tracks', { headers: await testAuthHeaders(),
    data: { name: 'Small corner', layout: sharedLayout, visibility: 'ranked' } });
  expect(response.ok()).toBe(true);
  const shared = await response.json();
  await page.goto('/');
  await enterRace(page, shared.id);
  await expect(page.locator('#active-track-name')).toHaveText('Small corner');
  expect((await pixels(page)).blue).toBeGreaterThan(0); // The saved checkpoint is drawn in blue.
  for (const viewport of [{ width: 1280, height: 720 }, { width: 830, height: 720 }, { width: 390, height: 720 }, { width: 740, height: 390 }]) {
    await page.setViewportSize(viewport);
    await expect.poll(async () => page.locator('#minimap').evaluate((canvas: HTMLCanvasElement) => {
      const map = canvas.getBoundingClientRect();
      const controls = document.querySelector('.controls')!.getBoundingClientRect();
      const lap = document.querySelector('#lap-display')!.getBoundingClientRect();
      return map.width === map.height && map.left >= 0 && map.bottom <= innerHeight && map.top >= lap.bottom
        && (map.right <= controls.left || map.bottom <= controls.top);
    })).toBe(true);
    await expect.poll(async () => (await pixels(page)).count).toBeGreaterThan(10);
  }
  await page.screenshot({ path: 'test-results/prototype-minimap-narrow.png' });
  await page.request.delete(`/api/tracks/${shared.id}`, { headers: await testAuthHeaders() });
});
