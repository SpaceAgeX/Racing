import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { splinePresets } from '../../src/track/spline-presets.ts';
import { testAccessToken, testAuthHeaders } from './race-helpers.ts';

test('the game requires an account and the dashboard keeps profile changes', async ({ page, browser }) => {
  const anonymous = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  try {
    const visitor = await anonymous.newPage();
    await visitor.goto('http://127.0.0.1:3100/');
    await expect(visitor.getByRole('heading', { name: 'Sign in to race' })).toBeVisible();
    await visitor.screenshot({ path: 'test-results/login-page.png', fullPage: true });
    expect((await visitor.request.get('http://127.0.0.1:3100/api/account')).status()).toBe(401);
  } finally { await anonymous.close(); }

  await page.goto('/');
  const accountLink = page.locator('#home-account-link');
  await expect(accountLink).toBeVisible();
  await expect(accountLink).toHaveCSS('border-radius', '50%');
  await accountLink.click();
  await expect(page).toHaveURL(/\/account\/$/);
  await expect(page.locator('#account-name')).not.toBeEmpty();
  const browserToken = await page.evaluate(() => {
    const session = JSON.parse(localStorage.getItem('sb-127-auth-token')!) as { access_token: string };
    return session.access_token;
  });
  const browserSubject = (JSON.parse(Buffer.from(browserToken.split('.')[1]!, 'base64url').toString()) as { sub: string }).sub;
  const fixtureSubject = (JSON.parse(Buffer.from((await testAccessToken()).split('.')[1]!, 'base64url').toString()) as { sub: string }).sub;
  expect(browserSubject).toBe(fixtureSubject);
  const savedProfile = await page.request.get('/api/account', { headers: await testAuthHeaders() });
  const username = (await savedProfile.json() as { username: string }).username;
  await expect(page.locator('#account-name')).toHaveText(username);
  await expect(page.locator('#account-username')).toHaveText(username);
  await page.screenshot({ path: 'test-results/account-dashboard.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/account-dashboard-mobile.png', fullPage: true });
  await page.reload();
  await expect(page.locator('#account-name')).toHaveText(username);
  await expect(page.locator('#account-metrics')).toContainText('Laps completed');
  const renamed = `Racer${randomUUID().replaceAll('-', '').slice(0, 10)}`;
  try {
    await page.getByRole('button', { name: 'Change username' }).click();
    await page.getByLabel('New username').fill(renamed);
    await page.getByRole('button', { name: 'Save username' }).click();
    await expect(page.locator('#account-name')).toHaveText(renamed);
    await expect(page.locator('#username-feedback')).toHaveText('Username updated.');
    await page.reload();
    await expect(page.locator('#account-username')).toHaveText(renamed);
  } finally {
    const restored = await page.request.patch('/api/account/username', {
      headers: await testAuthHeaders(), data: { username },
    });
    expect(restored.ok()).toBe(true);
  }
});

test('a restored page renews admission after a server restart', async ({ browser }) => {
  const anonymous = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  try {
    const visitor = await anonymous.newPage();
    const cachedDocument = await readFile('public/index.html', 'utf8');
    let entryRequests = 0;
    await visitor.route('http://127.0.0.1:3100/', async route => {
      entryRequests++;
      if (entryRequests === 1) await route.fulfill({ status: 200, contentType: 'text/html', body: cachedDocument });
      else await route.continue();
    });
    let configRequests = 0;
    await visitor.route('http://127.0.0.1:3100/api/auth/config', async route => {
      configRequests++;
      if (configRequests === 1) await route.fulfill({ status: 401, contentType: 'application/json', body: '{}' });
      else await route.continue();
    });
    await visitor.goto('/');
    await expect(visitor.getByRole('heading', { name: 'Sign in to race' })).toBeVisible();
    await expect(visitor.locator('#login-form')).toBeVisible();
    expect(entryRequests).toBe(2);
    expect(configRequests).toBeGreaterThanOrEqual(2);
    expect((await visitor.request.get('/auth.css')).status()).toBe(200);
  } finally { await anonymous.close(); }
});

test('new accounts can build personal tracks but cannot publish ranked tracks or forge laps', async ({ page, browser }) => {
  process.loadEnvFile('.env.local');
  const url = process.env.SUPABASE_URL!;
  const admin = createClient(url, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
  const email = `unapproved-${randomUUID()}@example.test`;
  const password = randomUUID() + 'Aa1!';
  const username = `New${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true,
    user_metadata: { username } });
  if (created.error || !created.data.user) throw created.error ?? new Error('No test user');
  try {
    const login = await createClient(url, process.env.SUPABASE_PUBLISHABLE_KEY!,
      { auth: { persistSession: false } }).auth.signInWithPassword({ email, password });
    if (login.error || !login.data.session) throw login.error ?? new Error('No session');
    const anonymous = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    try {
      const visitor = await anonymous.newPage();
      await visitor.goto('/');
      await visitor.getByLabel('Email').fill(email);
      await visitor.getByLabel('Password').fill(password);
      await visitor.getByRole('button', { name: 'Sign in', exact: true }).click();
      await expect(visitor.getByRole('heading', { name: 'Select an Option' })).toBeVisible();
      await expect(visitor.getByRole('link', { name: /Map Builder/ })).toBeVisible();
      await visitor.reload();
      await expect(visitor.getByRole('heading', { name: 'Select an Option' })).toBeVisible();
    } finally { await anonymous.close(); }
    const unapprovedHeaders = { Authorization: `Bearer ${login.data.session.access_token}` };
    const profile = await page.request.get('/api/account', { headers: unapprovedHeaders });
    expect((await profile.json()).canPublishRankedTracks).toBe(false);
    const trackName = `Personal ${randomUUID()}`;
    const personal = await page.request.post('/api/tracks', { headers: unapprovedHeaders,
      data: { name: trackName, layout: splinePresets[0]!.create(), visibility: 'personal' } });
    expect(personal.ok()).toBe(true);
    const personalId = (await personal.json() as { id: string }).id;
    try {
      const otherUserHeaders = await testAuthHeaders();
      expect((await page.request.get(`/api/tracks/${personalId}`, { headers: otherUserHeaders })).status()).toBe(404);
      const otherTracks = await page.request.get('/api/tracks', { headers: otherUserHeaders });
      expect((await otherTracks.json() as { id: string }[]).some(track => track.id === personalId)).toBe(false);
      const ranked = await page.request.post('/api/tracks', { headers: unapprovedHeaders,
        data: { name: `Ranked ${randomUUID()}`, layout: splinePresets[0]!.create(), visibility: 'ranked' } });
      expect(ranked.status()).toBe(403);
    } finally {
      expect((await page.request.delete(`/api/tracks/${personalId}`, { headers: unapprovedHeaders })).status()).toBe(204);
    }

    const token = await testAccessToken();
    const userId = (JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString()) as { sub: string }).sub;
    const forged = await page.request.post(`${url}/rest/v1/lap_results`, {
      headers: { apikey: process.env.SUPABASE_PUBLISHABLE_KEY!, Authorization: `Bearer ${token}`,
        Prefer: 'return=representation' },
      data: { user_id: userId, track_id: 'default', track_name: 'Default circuit',
        layout_hash: 'fake', duration_ms: 1, ranked: true, mode: 'time_trial' },
    });
    expect(forged.ok()).toBe(false);
    const leaderboard = await page.request.get('/api/leaderboard/default', { headers: await testAuthHeaders() });
    expect(leaderboard.ok()).toBe(true);
  } finally {
    const removed = await admin.auth.admin.deleteUser(created.data.user.id);
    if (removed.error) throw removed.error;
  }
});

test('signup reserves a unique username regardless of letter case', async ({ page, browser }) => {
  process.loadEnvFile('.env.local');
  const admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false } });
  const fixture = await page.request.get('/api/account', { headers: await testAuthHeaders() });
  const existingName = (await fixture.json() as { username: string }).username;
  const chosen = `Driver${randomUUID().replaceAll('-', '').slice(0, 10)}`;
  const email = `signup-${randomUUID()}@example.test`;
  const anonymous = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  let createdId: string | null = null;
  try {
    const visitor = await anonymous.newPage();
    await visitor.goto('/signup/');
    await visitor.screenshot({ path: 'test-results/signup-page.png', fullPage: true });
    await visitor.getByLabel('Username').fill(existingName.toUpperCase());
    await expect(visitor.locator('#username-status')).toHaveText('Username already taken');
    await visitor.getByLabel('Username').fill(chosen);
    await expect(visitor.locator('#username-status')).toHaveText('Username available');
    await visitor.getByLabel('Email address').fill(email);
    await visitor.getByLabel('Password').fill(randomUUID() + 'Aa1!');
    await visitor.getByRole('button', { name: 'Create account' }).click();
    await expect(visitor.getByRole('heading', { name: 'Select an Option' })).toBeVisible();
    const token = await visitor.evaluate(() => {
      const session = JSON.parse(localStorage.getItem('sb-127-auth-token')!) as { access_token: string };
      return session.access_token;
    });
    createdId = (JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString()) as { sub: string }).sub;
    const account = await visitor.request.get('/api/account', { headers: { Authorization: `Bearer ${token}` } });
    expect((await account.json() as { username: string }).username).toBe(chosen);
    const taken = await visitor.request.patch('/api/account/username', {
      headers: { Authorization: `Bearer ${token}` }, data: { username: existingName.toUpperCase() },
    });
    expect(taken.status()).toBe(409);
    expect((await taken.json() as { error: string }).error).toBe('That username is already taken.');
    const duplicate = await admin.auth.admin.createUser({ email: `duplicate-${randomUUID()}@example.test`,
      password: randomUUID() + 'Aa1!', email_confirm: true, user_metadata: { username: chosen.toUpperCase() } });
    expect(duplicate.error).not.toBeNull();
  } finally {
    await anonymous.close();
    if (createdId) {
      const removed = await admin.auth.admin.deleteUser(createdId);
      if (removed.error) throw removed.error;
    }
  }
});

test('an existing account without a username finishes setup before racing', async ({ browser }) => {
  process.loadEnvFile('.env.local');
  const url = process.env.SUPABASE_URL!;
  const admin = createClient(url, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
  const email = `google-style-${randomUUID()}@example.test`;
  const password = randomUUID() + 'Aa1!';
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) throw created.error ?? new Error('No test user');
  try {
    const auth = createClient(url, process.env.SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false } });
    const signedIn = await auth.auth.signInWithPassword({ email, password });
    if (signedIn.error || !signedIn.data.session) throw signedIn.error ?? new Error('No session');
    const anonymous = await browser.newContext({ storageState: { cookies: [], origins: [{
      origin: 'http://127.0.0.1:3100', localStorage: [{ name: 'sb-127-auth-token', value: JSON.stringify(signedIn.data.session) }],
    }] } });
    try {
      const visitor = await anonymous.newPage();
      await visitor.goto('/');
      await expect(visitor.getByRole('heading', { name: 'Choose your username' })).toBeVisible();
      await expect(visitor.locator('#email-fields')).toBeHidden();
      const chosen = `Claim${randomUUID().replaceAll('-', '').slice(0, 10)}`;
      await visitor.getByLabel('Username').fill(chosen);
      await visitor.getByRole('button', { name: 'Finish setup' }).click();
      await expect(visitor.getByRole('heading', { name: 'Select an Option' })).toBeVisible();
      const account = await visitor.request.get('/api/account', {
        headers: { Authorization: `Bearer ${signedIn.data.session.access_token}` },
      });
      expect((await account.json() as { username: string }).username).toBe(chosen);
    } finally { await anonymous.close(); }
  } finally {
    const removed = await admin.auth.admin.deleteUser(created.data.user.id);
    if (removed.error) throw removed.error;
  }
});

test('Google buttons hand off to Supabase OAuth from both account pages', async ({ browser }) => {
  const anonymous = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  try {
    for (const [path, buttonId] of [['/login/', '#google-sign-in'], ['/signup/', '#google-sign-up']] as const) {
      const visitor = await anonymous.newPage();
      await visitor.route('**/api/auth/config', async route => {
        const response = await route.fetch();
        const config = await response.json() as Record<string, unknown>;
        await route.fulfill({ json: { ...config, googleEnabled: true } });
      });
      await visitor.route('http://127.0.0.1:54321/auth/v1/authorize**', route => route.fulfill({
        status: 200, contentType: 'text/html', body: '<!doctype html><title>OAuth handoff</title>',
      }));
      await visitor.goto(path);
      await expect(visitor.locator(buttonId)).toBeEnabled();
      const handoff = visitor.waitForRequest(request => new URL(request.url()).pathname === '/auth/v1/authorize');
      await visitor.locator(buttonId).click();
      const oauth = new URL((await handoff).url());
      expect(oauth.searchParams.get('provider')).toBe('google');
      expect(oauth.searchParams.get('redirect_to')).toContain(path);
      await visitor.close();
    }
  } finally { await anonymous.close(); }
});
