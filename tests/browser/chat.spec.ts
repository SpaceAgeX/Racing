import { test, expect } from '@playwright/test';
import { startMultiplayerRace } from './race-helpers.ts';

test('room chat survives race start, displays text safely and releases driving controls', async ({ page, browser }) => {
  test.setTimeout(60000);
  const context = await browser.newContext();
  const guest = await context.newPage();
  try {
    for (const p of [page, guest]) {
      await p.goto('http://127.0.0.1:3100/');
      await p.getByRole('button', { name: /Multiplayer Race/ }).click();
      await expect(p.locator('#home-status')).toContainText('Connected');
    }
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await page.getByRole('button', { name: 'Create lobby', exact: true }).click();
    await expect(page.locator('#lobby-screen')).toBeVisible();
    const lobbyName = await page.locator('#lobby-room-name').textContent();
    await guest.locator('#home-lobby-list article').filter({ hasText: lobbyName! }).getByRole('button', { name: 'Join lobby' }).click();
    await expect(guest.locator('#lobby-screen')).toBeVisible();
    await page.keyboard.press('t');
    await expect(page.getByRole('textbox', { name: 'Chat message' })).toBeFocused();
    await page.getByRole('textbox', { name: 'Chat message' }).fill('<img src=x onerror=alert(1)> hello');
    await page.keyboard.press('Enter');
    await guest.keyboard.press('t');
    await expect(guest.locator('.chat-messages')).toContainText('<img src=x onerror=alert(1)> hello');
    await expect(guest.locator('.chat-messages img')).toHaveCount(0);
    await page.bringToFront();
    await page.keyboard.press('Escape');
    await startMultiplayerRace(page);
    await page.bringToFront();
    await page.keyboard.down('w');
    await expect.poll(()=>page.evaluate(async()=>{
      const path='/assets/main.js'; const {prototype}=await import(path); return prototype.state.speed;
    })).toBeGreaterThan(3);
    await page.keyboard.press('t');
    await expect(page.locator('.chat-panel')).toBeVisible();
    const before = await page.evaluate(async () => {
      const path = '/assets/main.js'; const { prototype } = await import(path);
      return { speed: prototype.state.speed, position: { ...prototype.state.position } };
    });
    await expect.poll(()=>page.evaluate(async()=>{
      const path='/assets/main.js'; const {prototype}=await import(path);return prototype.state.speed;
    })).toBeLessThan(before.speed - 0.1);
    const after = await page.evaluate(async () => {
      const path = '/assets/main.js'; const { prototype } = await import(path);
      return { speed: prototype.state.speed, position: { ...prototype.state.position } };
    });
    expect(after.speed).toBeGreaterThan(0);
    expect(after.speed).toBeLessThan(before.speed);
    expect(Math.hypot(after.position.x-before.position.x,after.position.z-before.position.z)).toBeGreaterThan(0);
    await page.keyboard.up('w');
    await page.getByRole('textbox', { name: 'Chat message' }).fill('Race chat works');
    await page.keyboard.press('Enter');
    await expect(guest.locator('.chat-messages')).toContainText('Race chat works');
    await page.keyboard.press('Escape');
    await expect(page.locator('.chat-panel')).toBeHidden();
    await page.locator('#race-leave').click();
    await expect(page.locator('.room-chat')).toBeHidden();
  } finally { await context.close(); }
});
