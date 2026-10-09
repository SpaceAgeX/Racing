import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { startPrototype } from '../../src/prototype.ts';
import { enterRace } from './race-helpers.ts';

async function remoteCars(page: Page) {
  return page.evaluate(async () => {
    const path = '/assets/main.js';
    const { prototype } = await import(path) as { prototype: ReturnType<typeof startPrototype> };
    return prototype.view.scene.children.filter((object) => object.type === 'Group' && object !== prototype.car.object && object.name !== 'track' && object.visible)
      .map((object) => ({ x: object.position.x, z: object.position.z }));
  });
}

test('shared maps appear live in multiplayer selectors; host settings, start, and car updates reach a guest', async ({ page, browser }) => {
  test.setTimeout(60_000);
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:3100' });
  let trackId = '';
  try {
    const guest = await context.newPage();
    await page.goto('/'); await guest.goto('/');
    await expect(page.locator('#home-screen')).toBeVisible();
    await expect(page.locator('#game')).toBeHidden();
    await expect(page.locator('#home-track-select option')).not.toHaveCount(0);
    const layout = Array.from({ length: 64 }, () => Array(64).fill(0));
    layout[32]![32] = 2; layout[31]![32] = 1; layout[30]![32] = 1;
    const saved = await (await page.request.post('/api/tracks', { data: { name: 'Multiplayer shared map', layout } })).json();
    trackId = saved.id;
    await expect(page.locator(`#home-track-select option[value="${trackId}"]`)).toHaveCount(1);
    await expect(guest.locator(`#home-track-select option[value="${trackId}"]`)).toHaveCount(1);
    await page.locator('#home-track-select').selectOption(trackId);
    await page.locator('#home-player-name').fill('Host');
    await page.locator('#home-lobby-name').fill('Shared race');
    await page.getByRole('button', { name: 'Create lobby', exact: true }).click();
    await expect(page.locator('#lobby-screen')).toBeVisible();
    await expect(page.locator('#game')).toBeHidden();
    await guest.locator('#home-player-name').fill('Guest');
    await guest.locator('#home-lobby-list article').filter({ hasText: 'Shared race' }).getByRole('button', { name: 'Join lobby' }).click();
    await expect(guest.locator('#lobby-screen')).toBeVisible();
    await expect(page.locator('#lobby-player-list .player-entry')).toHaveCount(2);
    await expect(guest.getByRole('button', { name: 'Start race', exact: true })).toBeHidden();
    await expect(guest.locator('#lobby-track-select')).toBeDisabled();
    await expect(page.locator('#lobby-handling-acceleration')).toBeEnabled();
    await expect(guest.locator('#lobby-handling-acceleration')).toBeDisabled();
    await page.locator('#lobby-handling-acceleration').evaluate((element: HTMLInputElement) => {
      element.value = '1';
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await expect(guest.locator('#lobby-handling-acceleration')).toHaveValue('1');
    await page.locator('#lobby-track-select').selectOption('simple-loop');
    await expect(guest.locator('#lobby-track-select')).toHaveValue('simple-loop');
    await page.locator('#lobby-track-select').selectOption(trackId);
    await expect(guest.locator('#lobby-track-select')).toHaveValue(trackId);
    await page.getByRole('button', { name: 'Start race', exact: true }).click();
    await expect(page.locator('#race-screen')).toBeVisible();
    await expect(guest.locator('#race-screen')).toBeVisible();
    await expect(guest.locator('#active-track-name')).toHaveText('Multiplayer shared map');
    await page.bringToFront();
    await page.keyboard.down('w');
    await page.waitForTimeout(250);
    const hostSpeed = await page.evaluate(async () => {
      const path = '/assets/main.js'; const { prototype } = await import(path) as { prototype: ReturnType<typeof startPrototype> };
      return prototype.state.speed;
    });
    expect(hostSpeed).toBeLessThan(1);
    await page.keyboard.up('w');
    const before = await page.evaluate(async () => {
      const path = '/assets/main.js'; const { prototype } = await import(path) as { prototype: ReturnType<typeof startPrototype> };
      return prototype.state.position.z;
    });
    await page.keyboard.down('w');
    await expect.poll(async () => (await remoteCars(guest))[0]?.z ?? before).toBeLessThan(before - .5);
    await page.keyboard.up('w');
    await page.screenshot({ path: 'test-results/multiplayer-shared-race.png' });
    await guest.getByRole('button', { name: 'Leave game', exact: true }).click();
    await expect(guest.locator('#home-screen')).toBeVisible();
    await expect.poll(async () => (await remoteCars(page)).length).toBe(0);
    await page.getByRole('button', { name: 'Leave game', exact: true }).click();
    await expect(page.locator('#home-screen')).toBeVisible();
    await page.request.delete(`/api/tracks/${trackId}`);
    await expect(page.locator(`#home-track-select option[value="${trackId}"]`)).toHaveCount(0);
  } finally { if (trackId) await page.request.delete(`/api/tracks/${trackId}`, { timeout: 3000 }).catch(() => undefined); await context.close(); }
});

test('a player switching rooms no longer receives car states from the old room', async ({ page, browser }) => {
  test.setTimeout(60_000);
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:3100' });
  try {
    const guest = await context.newPage();
    await page.goto('/'); await guest.goto('/');
    await expect(page.locator('#home-track-select option')).not.toHaveCount(0);
    await page.locator('#home-lobby-name').fill('Original room');
    await page.getByRole('button', { name: 'Create lobby', exact: true }).click();
    await expect(page.locator('#lobby-screen')).toBeVisible();
    await guest.locator('#home-lobby-list article').filter({ hasText: 'Original room' }).getByRole('button', { name: 'Join lobby' }).click();
    await expect(page.locator('#lobby-player-list .player-entry')).toHaveCount(2);
    await page.getByRole('button', { name: 'Start race', exact: true }).click();
    await expect(guest.locator('#race-screen')).toBeVisible();
    await guest.getByRole('button', { name: 'Leave game', exact: true }).click();
    await expect(guest.locator('#home-screen')).toBeVisible();
    await enterRace(guest, 'simple-loop');
    await page.bringToFront();
    await page.keyboard.down('w');
    await expect.poll(async () => page.evaluate(async () => {
      const path = '/assets/main.js'; const { prototype } = await import(path) as { prototype: ReturnType<typeof startPrototype> };
      return prototype.state.speed;
    })).toBeGreaterThan(5);
    await page.keyboard.up('w');
    await guest.bringToFront();
    await guest.waitForTimeout(250);
    expect(await remoteCars(guest)).toEqual([]);
    await expect(guest.locator('#active-track-name')).toHaveText('Simple loop track');
  } finally { await context.close(); }
});
