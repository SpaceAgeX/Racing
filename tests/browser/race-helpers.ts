import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

export async function testAccessToken(): Promise<string> {
  const state = JSON.parse(await readFile('test-results/auth-state.json', 'utf8')) as {
    origins: { localStorage: { name: string; value: string }[] }[];
  };
  const stored = state.origins[0]?.localStorage.find(entry => entry.name.endsWith('-auth-token'));
  if (!stored) throw new Error('Test account session is missing.');
  return (JSON.parse(stored.value) as { access_token: string }).access_token;
}

export async function testAuthHeaders(): Promise<{ Authorization: string }> {
  return { Authorization: `Bearer ${await testAccessToken()}` };
}

/** Enter a solo time trial, optionally selecting a specific available track. */
export async function enterRace(page: Page, trackId?: string): Promise<void> {
  if (await page.locator('#race-screen').isVisible()) return;
  await page.getByRole('button', { name: /Time Trial/ }).click();
  await expect(page.getByRole('heading', { name: 'Time Trial' })).toBeVisible();
  if (trackId) {
    await page.getByRole('button', { name: 'Choose track' }).click();
    const target = page.locator(`.trial-track-card[data-track-id="${trackId}"]`);
    await expect(target).toBeVisible();
    await target.click();
    await page.getByRole('button', { name: 'Use this track' }).click();
  }
  await page.getByRole('button', { name: 'Start Time Trial' }).click();
  await expect(page.locator('#race-screen')).toBeVisible();
}

/** Start a hosted multiplayer round and wait until the server releases the grid. */
export async function startMultiplayerRace(page: Page): Promise<void> {
  if (await page.locator('#lobby-enter-track').isVisible()) {
    await page.locator('#lobby-enter-track').click();
    await expect(page.locator('#race-screen')).toBeVisible({ timeout: 20_000 });
  }
  if (await page.locator('#lobby-screen').isVisible()) await page.locator('#lobby-close-panel').click();
  await page.locator('#round-setup-toggle').click();
  await page.locator('#lobby-round-confirm').click();
  await expect(page.locator('#race-screen')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('#race-room-status')).toHaveText('Race in progress', { timeout: 20_000 });
}
