import { test, expect } from '@playwright/test';
import type { startPrototype } from '../../src/prototype.ts';
import { testAuthHeaders } from './race-helpers.ts';

test('finished spline saves, reloads, previews in 2D, races, and deletes from shared library', async ({ page }) => {
  test.setTimeout(90000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/map-builder/');
  await page.locator('#track-name').fill('Playable spline');
  await expect(page.locator('#save-track')).toBeDisabled();
  async function point(x: number, y: number) {
    const b = await page.locator('#map-canvas').boundingBox();
    await page.mouse.click(b!.x + b!.width * x, b!.y + b!.height * y);
  }
  await point(0.5, 0.85);
  await point(0.5, 0.15);
  await page.getByRole('button', { name: 'Connect points', exact: true }).click();
  await point(0.5, 0.85);
  await point(0.5, 0.15);
  await expect(page.locator('#save-track')).toBeDisabled();
  await page.locator('#edit-race').click();
  await point(0.5, 0.5);
  await expect(page.locator('#save-track')).toBeEnabled();
  await page.locator('#place-checkpoint').click();
  await point(0.5, 0.3);
  await page.locator('#track-visibility').selectOption('ranked');
  await page.locator('#save-track').click();
  await expect(page.locator('#library-status')).toContainText('Saved');
  const id = await page.locator('#saved-tracks').inputValue();
  expect(id).toBeTruthy();
  const saved = await (await page.request.get('/api/tracks/' + id, { headers: await testAuthHeaders() })).json();
  expect(saved.layout.version).toBe(2);
  expect(saved.layout.checkpoints).toHaveLength(1);
  expect(saved.visibility).toBe('ranked');
  await page.reload();
  await page.locator('#saved-tracks').selectOption(id);
  await page.locator('#load-track').click();
  await expect(page.locator('#track-name')).toHaveValue('Playable spline');
  await expect(page.locator('#finish-status')).not.toHaveText('No finish line placed');
  await expect(page.locator('#checkpoint-count')).toHaveText('1 / 3');
  // Editing a name must not delete the selected graph node when Backspace is pressed.
  await page.locator('#track-name').focus();
  await page.keyboard.press('End');
  await page.keyboard.press('Backspace');
  await page.locator('#track-name').fill('Playable spline');
  await page.locator('#play-track').click();
  await page.getByRole('button', { name: 'Choose track' }).click();
  await expect(page.locator(`.trial-track-card[data-track-id="${id}"]`)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator(`.trial-track-card[data-track-id="${id}"] canvas`)).toBeVisible();
  await page.getByRole('button', { name: 'Use this track' }).click();
  await page.getByRole('button', { name: 'Start Time Trial' }).click();
  await expect(page.locator('#race-screen')).toBeVisible();
  await page.keyboard.down('w');
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const path = '/assets/main.js';
        const { prototype } = (await import(path)) as { prototype: ReturnType<typeof startPrototype> };
        return prototype.state.speed;
      }),
    )
    .toBeGreaterThan(2);
  await page.keyboard.up('w');
  await expect(page.locator('#lap-status')).toContainText('Checkpoints');
  await page.screenshot({ path: 'test-results/spline-race.png' });
  await page.goto('/map-builder/');
  await page.locator('#saved-tracks').selectOption(id);
  await page.locator('#delete-track').click();
  await expect(page.locator('#library-status')).toContainText('Deleted');
  expect((await page.request.get('/api/tracks/' + id, { headers: await testAuthHeaders() })).status()).toBe(404);
  expect(errors).toEqual([]);
});
