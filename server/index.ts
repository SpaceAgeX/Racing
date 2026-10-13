import express from 'express';
import { createServer } from 'node:http';
import { access } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import type { BuildContext } from 'esbuild';
import { createTrackStore } from './track-store.ts';
import { createTracksApi } from './tracks-api.ts';
import { createGameRecorder } from './game-recorder.ts';
import { createAdmission } from './admission.ts';
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
  ServerDiagnosticsSnapshot,
  UpdateLobbySettingsPayload,
} from '../src/multiplayer/protocol.ts';
import { maxLobbyPlayers, playerColorPalette, trackOptions as presetTrackOptions } from '../src/multiplayer/protocol.ts';
import { getTrackSpawn } from '../src/track/grid.ts';
import { trackTileSize } from '../src/track/layout.ts';
import type { VehicleState } from '../src/simulation/types.ts';
import type { DrivingParameters, HandlingParameters, PhysicsParameters } from '../src/simulation/types.ts';
import { drivingParameters, physicsParameters } from '../src/simulation/parameters.ts';
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
app.use((request, response, next) => {
  const started = performance.now();
  response.once('finish', () => {
    const length = Number(response.getHeader('content-length'));
    recorder.http(request.path.startsWith('/assets/') ? 'assets' : request.path.startsWith('/api/') ? 'api' : 'pages',
      response.statusCode, Number.isFinite(length) ? length : null, performance.now() - started);
  });
  next();
});
const admission = createAdmission(Number(process.env.MAX_BROWSER_SESSIONS ?? 15));
app.get('/healthz', (_request, response) => response.json({ ok: true }));
app.use(admission.middleware);
app.post('/api/session/heartbeat', (_request, response) => response.sendStatus(204));
const trackFile = process.env.TRACKS_FILE ?? fileURLToPath(new URL('../data/tracks.json', import.meta.url));
const trackStore = await createTrackStore(trackFile);
app.use('/api/tracks', createTracksApi(trackStore, broadcastTrackOptions));
app.get('/api/ping', (_request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  response.json({ time: Date.now() });
});
app.get('/favicon.ico', (_request, response) => response.sendStatus(204));
app.use('/assets', express.static(bundleDirectory, {
  setHeaders(response) { response.setHeader('Cache-Control', 'no-cache'); },
}));
app.use(express.static(publicDirectory, {
  setHeaders(response) { response.setHeader('Cache-Control', 'no-cache'); },
}));

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

const drivingBounds: Record<keyof DrivingParameters, readonly [number, number]> = {
  acceleration: [1, 40], reverseAcceleration: [0.5, 25], braking: [1, 80], maxSpeed: [1, 80],
  maxReverseSpeed: [0.5, 30], rollingDrag: [0, 5], linearDrag: [0, 1], quadraticDrag: [0, 0.03],
  wheelbase: [0.5, 6], maxSteeringAngle: [0.05, 1.2], highSpeedSteeringAngle: [0, 1.2],
  steeringLimitSpeed: [1, 80], steeringSpeed: [0.1, 8], steeringReturnSpeed: [0.1, 10],
};
const physicsBounds: Record<keyof PhysicsParameters, readonly [number, number]> = {
  gravity: [0, 30], respawnDelay: [0.2, 5], groundSnapDistance: [0.01, 1],
  collisionRestitution: [0, 0.8], spinDamping: [0.1, 8], crashGrip: [0.1, 12], crashRecoveryTime: [0.1, 4],
};

function normalizeNumericSettings<T extends object>(
  value: unknown,
  defaults: Readonly<T>,
  bounds: Readonly<Record<keyof T, readonly [number, number]>>,
): T | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const result = { ...defaults } as T;
  for (const key of Object.keys(defaults) as (keyof T)[]) {
    const number = candidate[String(key)];
    const [minimum, maximum] = bounds[key];
    if (typeof number !== 'number' || !Number.isFinite(number) || number < minimum || number > maximum) return null;
    result[key] = number as T[keyof T];
  }
  return result;
}

function normalizeHandling(value: unknown): HandlingParameters | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const driving = normalizeNumericSettings(candidate.driving, drivingParameters, drivingBounds);
  const physics = normalizeNumericSettings(candidate.physics, physicsParameters, physicsBounds);
  if (!driving || !physics || driving.highSpeedSteeringAngle > driving.maxSteeringAngle) return null;
  return { driving, physics };
}

const httpServer = createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  serveClient: false,
  allowRequest: (request, done) => done(null, admission.authorized(request)),
});
io.use((socket, next) => {
  const error = admission.socket(socket.request, socket.id, () => socket.disconnect(true));
  if (error) { next(new Error(error)); return; }
  socket.on('disconnect', () => admission.releaseSocket(socket.request, socket.id));
  next();
});

const lobbies = new Map<string, LobbyRecord>();
const playerLobby = new Map<string, string>();

interface TrafficWindow {
  startedAt: number;
  receivedStateMessages: number;
  relayedStateMessages: number;
  approximateJsonBytesReceived: number;
  approximateJsonBytesSent: number;
  lastTelemetryAt: number;
}

const trafficWindows = new Map<string, TrafficWindow>();
const eventLoopDelay = monitorEventLoopDelay({ resolution: 20 });
eventLoopDelay.enable();
let stateMessagesReceivedTotal = 0;
let stateMessagesRelayedTotal = 0;
let approximateJsonBytesReceivedTotal = 0;
let approximateJsonBytesRelayedTotal = 0;
let previousCpuUsage = process.cpuUsage();
let previousCpuSampleAt = performance.now();

function getServerDiagnostics(socket: Parameters<typeof io.on>[1] extends (arg: infer T) => void ? T : never): ServerDiagnosticsSnapshot {
  const now = performance.now();
  const traffic = trafficWindows.get(socket.id) ?? {
    startedAt: now,
    receivedStateMessages: 0,
    relayedStateMessages: 0,
    approximateJsonBytesReceived: 0,
    approximateJsonBytesSent: 0,
    lastTelemetryAt: Number.NEGATIVE_INFINITY,
  };
  const sampleDurationSeconds = Math.max(0.001, (now - traffic.startedAt) / 1000);
  const cpuNow = process.cpuUsage();
  const cpuElapsedMicroseconds = (now - previousCpuSampleAt) * 1000;
  const cpuPercent = cpuElapsedMicroseconds > 0
    ? ((cpuNow.user - previousCpuUsage.user + cpuNow.system - previousCpuUsage.system) / cpuElapsedMicroseconds) * 100
    : null;
  previousCpuUsage = cpuNow;
  previousCpuSampleAt = now;

  const currentLobbyId = playerLobby.get(socket.id) ?? null;
  const memory = process.memoryUsage();
  const asMilliseconds = (nanoseconds: number): number | null => Number.isFinite(nanoseconds) ? nanoseconds / 1e6 : null;
  const p95 = eventLoopDelay.percentile(95);
  const snapshot: ServerDiagnosticsSnapshot = {
    capturedAt: Date.now(),
    server: {
      pid: process.pid,
      nodeVersion: process.version,
      platform: `${process.platform}/${process.arch}`,
      uptimeSeconds: process.uptime(),
      cpuPercent,
      memoryBytes: memory,
      eventLoopDelayMs: {
        mean: asMilliseconds(eventLoopDelay.mean),
        p95: asMilliseconds(p95),
        max: asMilliseconds(eventLoopDelay.max),
      },
      authoritativeSimulation: false,
      simulationTickRateHz: 0,
      connectedSockets: io.engine.clientsCount,
      lobbyCount: lobbies.size,
      playerCount: [...lobbies.values()].reduce((total, lobby) => total + lobby.players.size, 0),
      stateMessagesReceivedTotal,
      stateMessagesRelayedTotal,
      approximateJsonBytesReceivedTotal,
      approximateJsonBytesRelayedTotal,
    },
    connection: {
      id: socket.id,
      transport: socket.conn.transport.name,
      readyState: socket.conn.readyState,
      lobbyId: currentLobbyId,
      receivedStateMessages: traffic.receivedStateMessages,
      relayedStateMessages: traffic.relayedStateMessages,
      approximateJsonBytesReceived: traffic.approximateJsonBytesReceived,
      approximateJsonBytesSent: traffic.approximateJsonBytesSent,
      sampleDurationSeconds,
      receivedStateHz: traffic.receivedStateMessages / sampleDurationSeconds,
      relayedStateHz: traffic.relayedStateMessages / sampleDurationSeconds,
      approximateJsonBytesInPerSecond: traffic.approximateJsonBytesReceived / sampleDurationSeconds,
      approximateJsonBytesOutPerSecond: traffic.approximateJsonBytesSent / sampleDurationSeconds,
    },
    lobbies: [...lobbies.values()].map((lobby) => ({
      id: lobby.id,
      name: lobby.name,
      phase: lobby.phase,
      players: lobby.players.size,
    })),
  };

  traffic.startedAt = now;
  traffic.receivedStateMessages = 0;
  traffic.relayedStateMessages = 0;
  traffic.approximateJsonBytesReceived = 0;
  traffic.approximateJsonBytesSent = 0;
  trafficWindows.set(socket.id, traffic);
  eventLoopDelay.reset();
  return snapshot;
}

const lobbyPalette = playerColorPalette;

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

async function createLobby(socketId: string, playerName: string, lobbyName: string, trackId: string, requestedHandling: unknown): Promise<LobbyRecord> {
  const track = await resolveTrack(trackId);
  const handling = normalizeHandling(requestedHandling) ?? { driving: { ...drivingParameters }, physics: { ...physicsParameters } };
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
      handling,
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
  if (lobby.players.has(socketId)) return lobby;
  if (lobby.players.size >= maxLobbyPlayers) return null;
  const color = lobbyPalette.find(color => ![...lobby.players.values()].some(player => player.color === color));
  if (!color) return null;
  leaveLobby(socketId);
  const player = {
    id: socketId,
    name: normalizeName(playerName, 'Player'),
    color,
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

async function updateLobbySettings(socketId: string, { trackId, handling: requestedHandling }: UpdateLobbySettingsPayload): Promise<LobbyRecord | null> {
  const lobbyId = playerLobby.get(socketId);
  if (!lobbyId) return null;
  const lobby = lobbies.get(lobbyId);
  if (!lobby || lobby.hostId !== socketId || lobby.phase !== 'lobby') return null;
  const handling = requestedHandling === undefined ? null : normalizeHandling(requestedHandling);
  if (requestedHandling !== undefined && !handling) throw new Error('The handling settings are invalid.');
  const track = trackId === undefined ? null : await resolveTrack(trackId);
  if (lobbies.get(lobbyId) !== lobby || playerLobby.get(socketId) !== lobbyId || lobby.hostId !== socketId || lobby.phase !== 'lobby') return null;
  lobby.settings = {
    trackId: track?.id ?? lobby.settings.trackId,
    trackName: track?.name ?? lobby.settings.trackName,
    layout: track?.layout ?? lobby.settings.layout,
    handling: handling ?? lobby.settings.handling,
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
  let pendingSettings: Promise<void> = Promise.resolve();
  recorder.connection(socket.id, true);
  trafficWindows.set(socket.id, {
    startedAt: performance.now(),
    receivedStateMessages: 0,
    relayedStateMessages: 0,
    approximateJsonBytesReceived: 0,
    approximateJsonBytesSent: 0,
    lastTelemetryAt: Number.NEGATIVE_INFINITY,
  });
  void emitBootstrap(socket).catch(() => socket.emit('multiplayer:error', { message: 'Could not load available tracks.' }));

  socket.on('debug:telemetry-request', () => {
    const traffic = trafficWindows.get(socket.id);
    const now = performance.now();
    if (!traffic || now - traffic.lastTelemetryAt < 250) return;
    traffic.lastTelemetryAt = now;
    socket.emit('debug:telemetry', getServerDiagnostics(socket));
  });

  let lastChatAt = -Infinity;
  socket.on('multiplayer:chat', (text) => {
    const roomId = playerLobby.get(socket.id);
    const room = roomId ? lobbies.get(roomId) : undefined;
    const player = room?.players.get(socket.id);
    if (!room || !player || typeof text !== 'string' || text.length > 300) return;
    const cleaned = text.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
    if (!cleaned || performance.now() - lastChatAt < 500) return;
    lastChatAt = performance.now();
    io.to(room.id).emit('multiplayer:chat', { roomId: room.id, playerId: socket.id, name: player.name, text: cleaned });
  });

  socket.on('multiplayer:create-lobby', async (payload) => {
    try {
      const { lobbyName, playerName, trackId, handling } = payload;
      const lobby = await createLobby(socket.id, playerName, lobbyName, trackId, handling);
      await socket.join(lobby.id);
      broadcastLobbyRoom(lobby);
      broadcastLobbyList();
    } catch (error) { socket.emit('multiplayer:error', { message: error instanceof Error ? error.message : 'Could not create lobby.' }); }
  });

  socket.on('multiplayer:join-lobby', (payload) => {
    if (!payload || typeof payload.lobbyId !== 'string' || typeof payload.playerName !== 'string') return;
    const { lobbyId, playerName } = payload;
    const lobby = joinLobby(socket.id, lobbyId, playerName);
    if (!lobby) {
      socket.emit('multiplayer:error', { message: 'That lobby is full, already racing, or no longer exists.' });
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

  socket.on('multiplayer:update-settings', (settings) => {
    pendingSettings = pendingSettings.then(async () => {
    try {
      const lobby = await updateLobbySettings(socket.id, settings);
      if (!lobby) return;
      broadcastLobbyRoom(lobby);
      broadcastLobbyList();
    } catch (error) { socket.emit('multiplayer:error', { message: error instanceof Error ? error.message : 'Could not change track.' }); }
    });
  });

  socket.on('multiplayer:set-color', (payload) => {
    const lobbyId = playerLobby.get(socket.id);
    const lobby = lobbyId ? lobbies.get(lobbyId) : undefined;
    const player = lobby?.players.get(socket.id);
    if (!lobby || !player || lobby.phase !== 'lobby') return;
    const color = payload?.color;
    if (!playerColorPalette.some(value => value === color)) {
      socket.emit('multiplayer:error', { message: 'Choose a color from the palette.' });
      return;
    }
    if ([...lobby.players.values()].some(other => other.id !== socket.id && other.color === color)) {
      socket.emit('multiplayer:error', { message: 'That color is already taken.' });
      return;
    }
    player.color = color;
    broadcastLobbyRoom(lobby);
  });

  socket.on('multiplayer:start-lobby', async () => {
    await pendingSettings;
    const lobby = startLobby(socket.id);
    if (!lobby) {
      socket.emit('multiplayer:error', { message: 'Only the host can start the lobby.' });
      return;
    }
    broadcastLobbyRoom(lobby);
    broadcastLobbyList();
  });

  socket.on('multiplayer:update-state', (message) => {
    if (!message?.state || typeof message.state !== 'object') return;
    const state = createVehicleState();
    for (const key of Object.keys(state) as (keyof VehicleState)[]) {
      const value = message.state[key];
      if (key === 'position') {
        const position = message.state.position;
        if (!position || ![position.x, position.y, position.z].every(n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) < 1e7)) return;
        state.position = { x: position.x, y: position.y, z: position.z };
      } else {
        if (typeof value !== typeof state[key] || (typeof value === 'number' && (!Number.isFinite(value) || Math.abs(value) > 1e7))) return;
        Object.assign(state, { [key]: value });
      }
    }
    const lobby = applyState(socket.id, state);
    if (!lobby) return;
    const incomingBytes = Buffer.byteLength(JSON.stringify(state));
    recorder.received(socket.id, incomingBytes);
    stateMessagesReceivedTotal++;
    approximateJsonBytesReceivedTotal += incomingBytes;
    const senderTraffic = trafficWindows.get(socket.id);
    if (senderTraffic) {
      senderTraffic.receivedStateMessages++;
      senderTraffic.approximateJsonBytesReceived += incomingBytes;
    }
    const payload = { playerId: socket.id, state };
    const relayedBytes = Buffer.byteLength(JSON.stringify(payload));
    for (const playerId of lobby.players.keys()) {
      if (playerId === socket.id || !io.sockets.sockets.has(playerId)) continue;
      const recipientTraffic = trafficWindows.get(playerId);
      recorder.sent(playerId, relayedBytes);
      if (recipientTraffic) {
        recipientTraffic.relayedStateMessages++;
        recipientTraffic.approximateJsonBytesSent += relayedBytes;
      }
      stateMessagesRelayedTotal++;
      approximateJsonBytesRelayedTotal += relayedBytes;
    }
    socket.to(lobby.id).emit('multiplayer:player-state', payload);
  });

  socket.on('disconnect', (reason) => {
    recorder.connection(socket.id, false, reason);
    trafficWindows.delete(socket.id);
    leaveLobby(socket.id);
  });
});

const recorder = createGameRecorder(() => ({
  admittedSessions: admission.count,
  clients: [...io.sockets.sockets.values()],
  rooms: [...lobbies.values()].map(room => ({ id: room.id, phase: room.phase, players: room.players.size, trackId: room.settings.trackId })),
  roomForPlayer: id => playerLobby.get(id) ?? null,
}));

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
  admission.close();
  await recorder.close();
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
