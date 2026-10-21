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
  const select = page.locator('#time-trial-track-select');
  await expect(select.locator('option')).not.toHaveCount(0);
  if (trackId) {
    await expect(select.locator(`option[value="${trackId}"]`)).toHaveCount(1);
    await select.selectOption(trackId);
  }
  await page.getByRole('button', { name: 'Start Time Trial' }).click();
  await expect(page.locator('#race-screen')).toBeVisible();
}
