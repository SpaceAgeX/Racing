import express from 'express';
import { createServer } from 'node:http';
import { access } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import type { BuildContext } from 'esbuild';
import { createTrackStore } from './track-store.ts';
import { createTracksApi } from './tracks-api.ts';
import type {
  ClientToServerEvents,
  LobbyPlayerSnapshot,
  LobbyPhase,
  LobbySettings,
  LobbySnapshot,
  LobbySummary,
  MultiplayerBootstrap,
  ServerToClientEvents,
  TrackOption,
} from '../src/multiplayer/protocol.ts';
import { trackOptions as presetTrackOptions } from '../src/multiplayer/protocol.ts';
import { getTrackSpawn } from '../src/track/grid.ts';
import { trackTileSize } from '../src/track/layout.ts';
import type { VehicleState } from '../src/simulation/types.ts';
import { createVehicleState } from '../src/simulation/vehicle.ts';

const publicDirectory = fileURLToPath(new URL('../public', import.meta.url));
const bundleDirectory = fileURLToPath(new URL('../dist', import.meta.url));
const development = process.argv.includes('--dev');
let bundler: BuildContext | undefined;

if (development) {
  const [{ context }, { browserBuildOptions }] = await Promise.all([
    import('esbuild'),
    import('../scripts/browser-build.ts'),
  ]);
  bundler = await context({ ...browserBuildOptions, sourcemap: true });
  await bundler.rebuild();
  await bundler.watch();
} else {
  await access(new URL('../dist/main.js', import.meta.url)).catch(() => {
    throw new Error('Browser bundle is missing. Run npm run build before npm start.');
  });
}

const app = express();
app.disable('x-powered-by');
const trackFile = process.env.TRACKS_FILE ?? fileURLToPath(new URL('../data/tracks.json', import.meta.url));
const trackStore = await createTrackStore(trackFile);
app.use('/api/tracks', createTracksApi(trackStore, broadcastTrackOptions));
app.get('/api/ping', (_request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  response.json({ time: Date.now() });
});
app.get('/favicon.ico', (_request, response) => response.sendStatus(204));
app.use('/assets', express.static(bundleDirectory));
app.use(express.static(publicDirectory));

interface LobbyPlayerRecord {
  id: string;
  name: string;
  color: string;
  state: VehicleState | null;
}

interface LobbyRecord {
  id: string;
  name: string;
  hostId: string;
  phase: LobbyPhase;
  settings: LobbySettings;
  players: Map<string, LobbyPlayerRecord>;
}

const httpServer = createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  serveClient: false,
});

const lobbies = new Map<string, LobbyRecord>();
const playerLobby = new Map<string, string>();

const lobbyPalette = ['#ee7136', '#6bc5ff', '#8ce5ad', '#f5d76e', '#c38fff', '#ff8ab0'];

function makeLobbyId(): string {
  return `lobby-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function normalizeName(name: string | undefined, fallback: string): string {
  const trimmed = name?.trim() ?? '';
  return trimmed.length ? trimmed.slice(0, 32) : fallback;
}

function colorForIndex(index: number): string {
  return lobbyPalette[index % lobbyPalette.length]!;
}

function createLobbySummary(lobby: LobbyRecord): LobbySummary {
  const host = lobby.players.get(lobby.hostId);
  return {
    id: lobby.id,
    name: lobby.name,
    hostName: host?.name ?? 'Host',
    settings: {
      trackId: lobby.settings.trackId,
      trackName: lobby.settings.trackName,
    },
    playerCount: lobby.players.size,
  };
}

function createLobbySnapshot(lobby: LobbyRecord): LobbySnapshot {
  return {
    id: lobby.id,
    name: lobby.name,
    hostId: lobby.hostId,
    hostName: lobby.players.get(lobby.hostId)?.name ?? 'Host',
    phase: lobby.phase,
    settings: lobby.settings,
    players: [...lobby.players.values()].map((player) => ({
      id: player.id,
      name: player.name,
      isHost: player.id === lobby.hostId,
      color: player.color,
      state: player.state,
    })) as LobbyPlayerSnapshot[],
  };
}

function broadcastLobbyList(): void {
  io.emit('multiplayer:lobbies', {
    lobbies: [...lobbies.values()].filter((lobby) => lobby.phase === 'lobby').map(createLobbySummary),
  });
}

function broadcastLobbyRoom(lobby: LobbyRecord): void {
  io.to(lobby.id).emit('multiplayer:room', { lobby: createLobbySnapshot(lobby) });
}

function destroyLobby(lobbyId: string): void {
  const lobby = lobbies.get(lobbyId);
  if (!lobby) return;

  for (const playerId of lobby.players.keys()) {
    playerLobby.delete(playerId);
    const socket = io.sockets.sockets.get(playerId);
    if (socket) {
      void socket.leave(lobbyId);
      socket.emit('multiplayer:room', { lobby: null });
    }
  }

  lobbies.delete(lobbyId);
  broadcastLobbyList();
}

async function availableTracks(): Promise<TrackOption[]> {
  return [...presetTrackOptions, ...await trackStore.list()];
}

async function resolveTrack(trackId: string): Promise<TrackOption> {
  const preset = presetTrackOptions.find((track) => track.id === trackId);
  const track = preset ?? await trackStore.get(trackId);
  if (!track) throw new Error('That track no longer exists. Choose another track.');
  return track;
}

async function broadcastTrackOptions(): Promise<void> {
  io.emit('multiplayer:tracks', { trackOptions: await availableTracks() });
}

async function emitBootstrap(socket: Parameters<typeof io.on>[1] extends (arg: infer T) => void ? T : never): Promise<void> {
  const bootstrap: MultiplayerBootstrap = {
    playerId: socket.id,
    playerName: 'Player',
    activeLobbyId: playerLobby.get(socket.id) ?? null,
    activeLobbyPhase: playerLobby.get(socket.id) ? lobbies.get(playerLobby.get(socket.id)!)?.phase ?? null : null,
    trackOptions: await availableTracks(),
    lobbies: [...lobbies.values()].filter((lobby) => lobby.phase === 'lobby').map(createLobbySummary),
  };
  socket.emit('multiplayer:bootstrap', bootstrap);
}

function leaveLobby(socketId: string): void {
  const lobbyId = playerLobby.get(socketId);
  if (!lobbyId) return;
  void io.sockets.sockets.get(socketId)?.leave(lobbyId);
  const lobby = lobbies.get(lobbyId);
  if (!lobby) return;

  if (lobby.hostId === socketId) {
    destroyLobby(lobbyId);
    return;
  }

  playerLobby.delete(socketId);
  lobby.players.delete(socketId);
  if (lobby.players.size === 0) {
    lobbies.delete(lobbyId);
    broadcastLobbyList();
    return;
  }
  broadcastLobbyRoom(lobby);
  broadcastLobbyList();
}

async function createLobby(socketId: string, playerName: string, lobbyName: string, trackId: string): Promise<LobbyRecord> {
  const track = await resolveTrack(trackId);
  if (!io.sockets.sockets.has(socketId)) throw new Error('The player disconnected.');
  leaveLobby(socketId);
  const lobby: LobbyRecord = {
    id: makeLobbyId(),
    name: normalizeName(lobbyName, `${playerName}'s lobby`),
    hostId: socketId,
    phase: 'lobby',
    settings: {
      trackId: track.id,
      trackName: track.name,
      layout: track.layout,
    },
    players: new Map(),
  };
  lobby.players.set(socketId, {
    id: socketId,
    name: normalizeName(playerName, 'Player'),
    color: colorForIndex(0),
    state: null,
  });
  lobbies.set(lobby.id, lobby);
  playerLobby.set(socketId, lobby.id);
  return lobby;
}

function joinLobby(socketId: string, lobbyId: string, playerName: string): LobbyRecord | null {
  const lobby = lobbies.get(lobbyId);
  if (!lobby || lobby.phase !== 'lobby') return null;
  leaveLobby(socketId);
  const player = {
    id: socketId,
    name: normalizeName(playerName, 'Player'),
    color: colorForIndex(lobby.players.size),
    state: null,
  } satisfies LobbyPlayerRecord;
  lobby.players.set(socketId, player);
  playerLobby.set(socketId, lobby.id);
  return lobby;
}

function applyState(socketId: string, state: VehicleState): LobbyRecord | null {
  const lobbyId = playerLobby.get(socketId);
  if (!lobbyId) return null;
  const lobby = lobbies.get(lobbyId);
  if (!lobby) return null;
  const player = lobby.players.get(socketId);
  if (!player) return null;
  player.state = state;
  return lobby;
}

async function updateLobbySettings(socketId: string, trackId: string): Promise<LobbyRecord | null> {
  const lobbyId = playerLobby.get(socketId);
  if (!lobbyId) return null;
  const lobby = lobbies.get(lobbyId);
  if (!lobby || lobby.hostId !== socketId || lobby.phase !== 'lobby') return null;
  const track = await resolveTrack(trackId);
  if (lobbies.get(lobbyId) !== lobby || playerLobby.get(socketId) !== lobbyId || lobby.hostId !== socketId || lobby.phase !== 'lobby') return null;
  lobby.settings = {
    trackId: track.id,
    trackName: track.name,
    layout: track.layout,
  };
  return lobby;
}

function startLobby(socketId: string): LobbyRecord | null {
  const lobbyId = playerLobby.get(socketId);
  if (!lobbyId) return null;
  const lobby = lobbies.get(lobbyId);
  if (!lobby || lobby.hostId !== socketId || lobby.phase !== 'lobby') return null;
  lobby.phase = 'race';
  const spawn = getTrackSpawn(lobby.settings.layout, trackTileSize);
  const players = [...lobby.players.values()];
  const spread = Math.min(2.4, trackTileSize / Math.max(3, players.length + 1));
  for (let index = 0; index < players.length; index++) {
    const player = players[index]!;
    const offset = index - (players.length - 1) / 2;
    const state = createVehicleState();
    state.position.x = spawn.position.x + offset * spread;
    state.position.y = spawn.position.y;
    state.position.z = spawn.position.z + 2.5;
    state.heading = spawn.heading;
    player.state = state;
  }
  return lobby;
}

io.on('connection', (socket) => {
  void emitBootstrap(socket).catch(() => socket.emit('multiplayer:error', { message: 'Could not load available tracks.' }));

  socket.on('multiplayer:create-lobby', async ({ lobbyName, playerName, trackId }) => {
    try {
      const lobby = await createLobby(socket.id, playerName, lobbyName, trackId);
      await socket.join(lobby.id);
      broadcastLobbyRoom(lobby);
      broadcastLobbyList();
    } catch (error) { socket.emit('multiplayer:error', { message: error instanceof Error ? error.message : 'Could not create lobby.' }); }
  });

  socket.on('multiplayer:join-lobby', ({ lobbyId, playerName }) => {
    const lobby = joinLobby(socket.id, lobbyId, playerName);
    if (!lobby) {
      socket.emit('multiplayer:error', { message: 'That lobby no longer exists.' });
      return;
    }
    socket.join(lobby.id);
    broadcastLobbyRoom(lobby);
    broadcastLobbyList();
  });

  socket.on('multiplayer:leave-lobby', () => {
    leaveLobby(socket.id);
    socket.emit('multiplayer:room', { lobby: null });
    broadcastLobbyList();
  });

  socket.on('multiplayer:update-settings', async ({ trackId }) => {
    try {
      const lobby = await updateLobbySettings(socket.id, trackId);
      if (!lobby) return;
      broadcastLobbyRoom(lobby);
      broadcastLobbyList();
    } catch (error) { socket.emit('multiplayer:error', { message: error instanceof Error ? error.message : 'Could not change track.' }); }
  });

  socket.on('multiplayer:start-lobby', () => {
    const lobby = startLobby(socket.id);
    if (!lobby) {
      socket.emit('multiplayer:error', { message: 'Only the host can start the lobby.' });
      return;
    }
    broadcastLobbyRoom(lobby);
    broadcastLobbyList();
  });

  socket.on('multiplayer:update-state', ({ state }) => {
    const lobby = applyState(socket.id, state);
    if (!lobby) return;
    socket.to(lobby.id).emit('multiplayer:player-state', { playerId: socket.id, state });
  });

  socket.on('disconnect', () => {
    leaveLobby(socket.id);
  });
});

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '0.0.0.0';
const server = httpServer.listen(port, host, () => {
  console.log(`Driving prototype: http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`);
  if (host === '0.0.0.0') {
    for (const addresses of Object.values(networkInterfaces())) {
      for (const address of addresses ?? []) {
        if (address.family === 'IPv4' && !address.internal) {
          console.log(`Network: http://${address.address}:${port}`);
        }
      }
    }
  }
  if (development) console.log('Watching TypeScript files. Refresh the browser after edits.');
});

async function shutdown(): Promise<void> {
  await new Promise<void>((closed) => io.close(() => closed()));
  await trackStore.flush();
  await bundler?.dispose();
  process.exit(0);
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
server.on('error', async (error) => {
  console.error(error.message);
  await bundler?.dispose();
  process.exit(1);
});
