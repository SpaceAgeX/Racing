import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/** Enter a solo time trial, optionally selecting a specific available track. */
export async function enterRace(page: Page, trackId?: string): Promise<void> {
  if (await page.locator('#race-screen').isVisible()) return;
  await page.getByRole('button', { name: /Time Trial/ }).click();
  const select = page.locator('#time-trial-track-select');
  await expect(select.locator('option')).not.toHaveCount(0);
  if (trackId) {
    await expect(select.locator(`option[value="${trackId}"]`)).toHaveCount(1);
    await select.selectOption(trackId);
  }
  await page.getByRole('button', { name: 'Start Time Trial' }).click();
  await expect(page.locator('#race-screen')).toBeVisible();
}
