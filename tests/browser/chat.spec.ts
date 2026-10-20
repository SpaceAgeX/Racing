import { test, expect } from '@playwright/test';

test('room chat survives race start, displays text safely and releases driving controls', async ({ page, browser }) => {
  test.setTimeout(60000);
  const context = await browser.newContext();
  const guest = await context.newPage();
  try {
    for (const p of [page, guest]) {
      p.on('pageerror', e => console.log('PAGE ERROR', e));
      p.on('websocket', s => {s.on('framesent', f => {if(String(f.payload).includes('start-lobby')) console.log('START SENT',Date.now());});s.on('framereceived', f => {if(String(f.payload).includes('multiplayer:room')||String(f.payload).includes('multiplayer:error'))console.log('ROOM',Date.now(),String(f.payload).slice(0,250));});});
      await p.goto('http://127.0.0.1:3100/');
      await p.getByRole('button', { name: /Multiplayer Race/ }).click();
      await expect(p.locator('#home-status')).toContainText('Connected');
    }
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await page.locator('#home-lobby-name').fill('Chat test');
    await page.getByRole('button', { name: 'Create lobby', exact: true }).click();
    await expect(page.locator('#lobby-screen')).toBeVisible();
    await guest.locator('#home-lobby-list article').filter({ hasText: 'Chat test' }).getByRole('button', { name: 'Join lobby' }).click();
    await expect(guest.locator('#lobby-screen')).toBeVisible();
    await page.keyboard.press('t');
    await expect(page.getByRole('textbox', { name: 'Chat message' })).toBeFocused();
    await page.getByRole('textbox', { name: 'Chat message' }).fill('<img src=x onerror=alert(1)> hello');
    await page.keyboard.press('Enter');
    await guest.keyboard.press('t');
    await expect(guest.locator('.chat-messages')).toContainText('<img src=x onerror=alert(1)> hello');
    await expect(guest.locator('.chat-messages img')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Start race', exact: true }).click();
    await expect(page.locator('#race-screen')).toBeVisible({ timeout: 20_000 });
    await page.bringToFront();
    await page.keyboard.down('w');
    await page.keyboard.press('t');
    await expect(page.locator('.chat-panel')).toBeVisible();
    const before = await page.evaluate(async () => {
      const path = '/assets/main.js'; const { prototype } = await import(path);
      prototype.state.speed = 4;
      return { ...prototype.state.position };
    });
    await expect.poll(()=>page.evaluate(async()=>{
      const path='/assets/main.js'; const {prototype}=await import(path);return prototype.state.speed;
    })).toBeLessThan(4);
    const after = await page.evaluate(async () => {
      const path = '/assets/main.js'; const { prototype } = await import(path);
      return { speed: prototype.state.speed, position: { ...prototype.state.position } };
    });
    expect(after.speed).toBeGreaterThan(0);
    expect(after.speed).toBeLessThan(4);
    expect(Math.hypot(after.position.x-before.x,after.position.z-before.z)).toBeGreaterThan(0);
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
