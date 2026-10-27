import { expect, test } from '@playwright/test';
import { io, type Socket } from 'socket.io-client';
import { startMultiplayerRace, testAccessToken } from './race-helpers.ts';
import type { ClientToServerEvents, ServerToClientEvents, LobbySnapshot, CreateLobbyPayload, JoinLobbyPayload } from '../../src/multiplayer/protocol.ts';

test('lobby previews, colors and host settings update live for guests', async ({ page, browser }) => {
  test.setTimeout(60_000);
  const guestContext = await browser.newContext({ baseURL: 'http://127.0.0.1:3100' });
  try {
    const guest = await guestContext.newPage();
    for (const client of [page, guest]) {
      await client.goto('/');
      await client.getByRole('button', { name: /Multiplayer Race/ }).click();
      await expect(client.locator('#home-status')).toContainText('Connected');
      await expect(client.locator('#home-multiplayer-menu select')).toHaveCount(0);
    }
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await page.getByRole('button', { name: 'Create lobby', exact: true }).click();
    await expect(page.locator('#lobby-screen')).toBeVisible();
    const lobbyName = await page.locator('#lobby-room-name').textContent();
    expect(lobbyName).toMatch(/'s Lobby$/);
    await guest.getByRole('button', { name: 'Join', exact: true }).click();
    await guest.locator('#home-lobby-list article').filter({ hasText: lobbyName! }).getByRole('button', { name: 'Join lobby' }).click();
    await expect(guest.locator('#lobby-player-count')).toHaveText('2 / 10');
    await expect(guest.locator('#lobby-preview')).toBeVisible();
    await expect(page.locator('#lobby-colors button')).toHaveCount(15);
    await page.locator('#lobby-colors').getByRole('button', { name: 'Lime', exact: true }).click();
    await expect(guest.locator('#lobby-colors').getByRole('button', { name: 'Lime', exact: true })).toBeDisabled();
    await expect(page.locator('#lobby-color-name')).toHaveText('Lime');
    await page.locator('#lobby-colors').getByRole('button', { name: 'Sky blue', exact: true }).click();
    await expect(guest.locator('#lobby-colors').getByRole('button', { name: 'Sky blue', exact: true })).toBeDisabled();
    await guest.locator('#lobby-colors').getByRole('button', { name: 'Pink', exact: true }).click();
    await expect(page.locator('#lobby-colors').getByRole('button', { name: 'Pink', exact: true })).toBeDisabled();
    await expect(page.locator('#lobby-player-list .player-dot').last()).toHaveCSS('background-color', 'rgb(255, 138, 176)');
    await page.locator('#lobby-track-select').selectOption('simple-loop');
    await expect(guest.locator('#lobby-track-name')).toHaveText('Simple loop track');
    await expect(guest.locator('#lobby-track-select')).toBeDisabled();
    await expect(guest.locator('#lobby-track-permission')).toHaveText('Only the host can change the track.');
    await expect(guest.locator('#lobby-handling-acceleration')).toBeDisabled();
    await page.locator('#lobby-handling-acceleration').evaluate((input: HTMLInputElement) => {
      input.value = '18';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await expect(guest.locator('#lobby-handling-acceleration')).toHaveValue('18');
    await expect(guest.locator('#lobby-start')).toBeHidden();
    await page.screenshot({ path: 'test-results/lobby-setup.png', fullPage: true });
    await guest.getByRole('button', { name: 'Leave lobby' }).click();
    await expect(page.locator('#lobby-player-count')).toHaveText('1 / 10');
    await expect(page.locator('#lobby-colors').getByRole('button', { name: 'Pink', exact: true })).toBeEnabled();
    await startMultiplayerRace(page);
  } finally { await guestContext.close(); }
});

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;
function nextRoom(client: Client): Promise<LobbySnapshot> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Room update timed out')), 5000);
    client.once('multiplayer:room', ({ lobby }) => {
      clearTimeout(timeout);
      if (lobby) resolve(lobby);
      else reject(new Error('Unexpected empty room'));
    });
  });
}
function nextError(client: Client): Promise<string> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Expected server rejection')), 5000);
    client.once('multiplayer:error', ({ message }) => { clearTimeout(timeout); resolve(message); });
  });
}

test('server rejects taken colors and an eleventh player, then reuses released slots safely', async () => {
  const clients: Client[] = [];
  const usernames: string[] = [];
  try {
    for (let index = 0; index < 11; index++) {
      const client: Client = io('http://127.0.0.1:3100', { autoConnect: false, forceNew: true,
        auth: { token: await testAccessToken() } });
      clients.push(client);
      const ready = new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Bootstrap timed out')), 5000);
        client.once('multiplayer:bootstrap', ({ playerName }) => { usernames.push(playerName); clearTimeout(timeout); resolve(); });
      });
      client.connect();
      await ready;
    }
    const host = clients[0]!;
    const created = nextRoom(host);
    host.emit('multiplayer:create-lobby', { trackId: 'default', lobbyName: 'Forged', playerName: 'Forged' } as CreateLobbyPayload);
    let room = await created;
    expect(room.name).toBe(`${usernames[0]}'s Lobby`);
    expect(room.players[0]!.name).toBe(usernames[0]);
    const lobbyId = room.id;
    for (let index = 1; index < 10; index++) {
      const joined = nextRoom(clients[index]!);
      clients[index]!.emit('multiplayer:join-lobby', { lobbyId, playerName: 'Forged' } as JoinLobbyPayload);
      room = await joined;
      expect(room.players[index]!.name).toBe(usernames[index]);
    }
    expect(room.players).toHaveLength(10);
    expect(new Set(room.players.map(player => player.color)).size).toBe(10);
    const rejected = nextError(clients[10]!);
    clients[10]!.emit('multiplayer:join-lobby', { lobbyId });
    expect(await rejected).toContain('full');
    const colorError = nextError(clients[1]!);
    clients[1]!.emit('multiplayer:set-color', { color: room.players[0]!.color });
    expect(await colorError).toContain('taken');
    const invalidColor = nextError(clients[1]!);
    clients[1]!.emit('multiplayer:set-color', { color: '#000001' });
    expect(await invalidColor).toContain('palette');
    const left = nextRoom(host);
    clients[3]!.disconnect();
    expect((await left).players).toHaveLength(9);
    const joined = nextRoom(clients[10]!);
    clients[10]!.emit('multiplayer:join-lobby', { lobbyId });
    room = await joined;
    expect(room.players).toHaveLength(10);
    expect(new Set(room.players.map(player => player.color)).size).toBe(10);
  } finally { clients.forEach(client => client.disconnect()); }
});
