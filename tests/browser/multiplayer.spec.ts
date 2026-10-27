import { splinePresets } from '../../src/track/spline-presets.ts';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { startPrototype } from '../../src/prototype.ts';
import { testAuthHeaders } from './race-helpers.ts';

async function remoteCars(page: Page) {
  return page.evaluate(async () => {
    const path = '/assets/main.js';
    const { prototype } = await import(path) as { prototype: ReturnType<typeof startPrototype> };
    return prototype.view.scene.children.filter((object) => object.type === 'Group' && object !== prototype.car.object && object.name !== 'track' && object.visible)
      .map((object) => ({ x: object.position.x, z: object.position.z }));
  });
}

test('shared maps, host settings, and server-owned car states reach a guest', async ({ page, browser }) => {
  test.setTimeout(60_000);
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:3100' });
  let trackId = '';
  try {
    const guest = await context.newPage();
    await page.goto('/'); await guest.goto('/');
    await page.getByRole('button', { name: /Multiplayer Race/ }).click();
    await guest.getByRole('button', { name: /Multiplayer Race/ }).click();
    await expect(page.locator('#home-screen')).toBeVisible();
    await expect(page.locator('#game')).toBeHidden();
    await expect(page.locator('#home-status')).toContainText('Connected');
    const layout = splinePresets[0]!.create();
    const saved = await (await page.request.post('/api/tracks', { headers: await testAuthHeaders(),
      data: { name: 'Multiplayer shared map', layout, visibility: 'ranked' } })).json();
    trackId = saved.id;
    await expect(page.locator(`#lobby-track-select option[value="${trackId}"]`)).toHaveCount(1);
    await expect(guest.locator(`#lobby-track-select option[value="${trackId}"]`)).toHaveCount(1);

    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await page.getByRole('button', { name: 'Create lobby', exact: true }).click();
    await expect(page.locator('#lobby-screen')).toBeVisible();
    const lobbyName = await page.locator('#lobby-room-name').textContent();
    expect(lobbyName).toMatch(/'s Lobby$/);
    await expect(page.locator('#game')).toBeHidden();
    await expect(page.locator('#lobby-room-meta')).toContainText('Ranked laps');
    await guest.getByRole('button', { name: 'Join', exact: true }).click();
    await guest.locator('#home-lobby-list article').filter({ hasText: lobbyName! }).getByRole('button', { name: 'Join lobby' }).click();
    await expect(guest.locator('#lobby-screen')).toBeVisible();
    await expect(page.locator('#lobby-player-list .player-entry')).toHaveCount(2);
    await expect(guest.getByRole('button', { name: 'Start race', exact: true })).toBeHidden();
    await expect(guest.locator('#lobby-track-select')).toBeDisabled();
    await page.getByRole('button', { name: 'Edit handling' }).click();
    await expect(page.locator('#lobby-handling-acceleration')).toBeEnabled();
    await expect(page.locator('#lobby-handling-physicsTime')).toHaveCount(0);
    await expect(guest.locator('#lobby-shared-settings')).toBeHidden();
    await page.locator('#lobby-handling-acceleration').evaluate((element: HTMLInputElement) => {
      element.value = '1';
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await expect(page.locator('#lobby-room-meta')).toContainText('Unranked');
    await expect(guest.locator('#lobby-room-meta')).toContainText('Unranked');
    await expect(guest.locator('#lobby-shared-settings')).toBeHidden();
    await page.locator('#lobby-handling-acceleration').evaluate((element: HTMLInputElement) => {
      element.value = '40';
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await expect(page.locator('#lobby-room-meta')).toContainText('Ranked laps');
    await expect(guest.locator('#lobby-room-meta')).toContainText('Ranked laps');
    await expect(guest.locator('#lobby-shared-settings')).toBeHidden();
    await page.locator('#lobby-track-select').selectOption('simple-loop');
    await expect(guest.locator('#lobby-track-select')).toHaveValue('simple-loop');
    await page.locator('#lobby-track-select').selectOption(trackId);
    await expect(guest.locator('#lobby-track-select')).toHaveValue(trackId);
    await page.getByRole('button', { name: 'Start race', exact: true }).click();
    await expect(page.locator('#race-screen')).toBeVisible({ timeout: 20_000 });
    await expect(guest.locator('#race-screen')).toBeVisible({ timeout: 20_000 });
    await expect(guest.locator('#race-leaderboard tbody tr')).toHaveCount(2);
    await expect(guest.locator('#active-track-name')).toHaveText('Multiplayer shared map');
    await page.bringToFront();
    const before = (await remoteCars(guest))[0]!;
    await page.keyboard.down('w');
    await expect.poll(async () => page.evaluate(async () => {
      const path = '/assets/main.js'; const { prototype } = await import(path) as { prototype: ReturnType<typeof startPrototype> };
      return prototype.state.speed;
    })).toBeGreaterThan(5);
    await expect.poll(async () => (await remoteCars(guest))[0]?.z ?? before.z).toBeLessThan(before.z - .5);
    await page.keyboard.up('w');
    const serverPosition = await page.evaluate(async () => {
      const path = '/assets/main.js'; const { prototype } = await import(path) as { prototype: ReturnType<typeof startPrototype> };
      return { ...prototype.state.position };
    });
    await page.evaluate(async () => {
      const path = '/assets/main.js'; const { prototype } = await import(path) as { prototype: ReturnType<typeof startPrototype> };
      prototype.state.position.x += 100;
    });
    await expect.poll(async () => page.evaluate(async () => {
      const path = '/assets/main.js'; const { prototype } = await import(path) as { prototype: ReturnType<typeof startPrototype> };
      return prototype.state.position.x;
    })).toBeLessThan(serverPosition.x + 5);
    expect(Math.abs(((await remoteCars(guest))[0]?.x ?? 0) - serverPosition.x)).toBeLessThan(10);
    await page.evaluate(async () => {
      const path = '/assets/main.js'; const { prototype } = await import(path) as { prototype: ReturnType<typeof startPrototype> };
      prototype.lapTimer.completedLaps = 99;
    });
    await expect.poll(async () => page.evaluate(async () => {
      const path = '/assets/main.js'; const { prototype } = await import(path) as { prototype: ReturnType<typeof startPrototype> };
      return prototype.lapTimer.completedLaps;
    })).toBeLessThan(99);
    await page.screenshot({ path: 'test-results/multiplayer-shared-race.png' });
    await guest.getByRole('button', { name: 'Leave game', exact: true }).click();
    await expect(guest.locator('#home-screen')).toBeVisible();
    await expect.poll(async () => (await remoteCars(page)).length).toBe(0);
    await page.getByRole('button', { name: 'Leave game', exact: true }).click();
    await expect(page.locator('#home-screen')).toBeVisible();
    await page.request.delete(`/api/tracks/${trackId}`, { headers: await testAuthHeaders() });
    expect((await page.request.get('/api/tracks/' + trackId, { headers: await testAuthHeaders() })).status()).toBe(404);
  } finally { if (trackId) await page.request.delete(`/api/tracks/${trackId}`, { headers: await testAuthHeaders(), timeout: 3000 }).catch(() => undefined); await context.close(); }
});

test('a player switching rooms no longer receives car states from the old room', async ({ page, browser }) => {
  test.setTimeout(60_000);
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:3100' });
  try {
    const guest = await context.newPage();
    await page.goto('/'); await guest.goto('/');
    await page.getByRole('button', { name: /Multiplayer Race/ }).click();
    await guest.getByRole('button', { name: /Multiplayer Race/ }).click();
    await guest.getByRole('button', { name: 'Join', exact: true }).click();
    await expect(page.locator('#home-status')).toContainText('Connected');
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await page.getByRole('button', { name: 'Create lobby', exact: true }).click();
    await expect(page.locator('#lobby-screen')).toBeVisible();
    const lobbyName = await page.locator('#lobby-room-name').textContent();
    await guest.locator('#home-lobby-list article').filter({ hasText: lobbyName! }).getByRole('button', { name: 'Join lobby' }).click();
    await expect(page.locator('#lobby-player-list .player-entry')).toHaveCount(2);
    await page.getByRole('button', { name: 'Start race', exact: true }).click();
    await expect(guest.locator('#race-screen')).toBeVisible({ timeout: 20_000 });
    await guest.getByRole('button', { name: 'Leave game', exact: true }).click();
    await expect(guest.locator('#home-screen')).toBeVisible();
    await guest.getByRole('button', { name: /Multiplayer Race/ }).click();
    await guest.getByRole('button', { name: 'Create', exact: true }).click();

    await guest.getByRole('button', { name: 'Create lobby', exact: true }).click();
    await expect(guest.locator('#lobby-screen')).toBeVisible();
    await guest.locator('#lobby-track-select').selectOption('simple-loop');
    await guest.getByRole('button', { name: 'Start race', exact: true }).click();
    await expect(guest.locator('#race-screen')).toBeVisible({ timeout: 20_000 });
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
