import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/** Exercise the real multiplayer flow, including solo rooms used for driving checks. */
export async function enterRace(page: Page, trackId?: string): Promise<void> {
  if (await page.locator('#race-screen').isVisible()) return;
  await expect(page.locator('#home-track-select option')).not.toHaveCount(0);
  if (trackId) await page.locator('#home-track-select').selectOption(trackId);
  await page.locator('#home-player-name').fill('Test driver');
  await page.locator('#home-lobby-name').fill(`Test room ${Date.now()}`);
  await page.getByRole('button', { name: 'Create lobby', exact: true }).click();
  await expect(page.locator('#lobby-screen')).toBeVisible();
  await page.getByRole('button', { name: 'Start race', exact: true }).click();
  await expect(page.locator('#race-screen')).toBeVisible();
}
