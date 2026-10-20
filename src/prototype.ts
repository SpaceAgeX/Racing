import { createLobbyScreen } from './ui/lobby.ts';
import { io, type Socket } from 'socket.io-client';
import { createKeyboardInput } from './input/keyboard.ts';
import { createChat } from './ui/chat.ts';
import { createCarVisual } from './rendering/car.ts';
import { createFollowCamera } from './rendering/camera.ts';
import { createScene } from './rendering/scene.ts';
import { createMenuBackdrop } from './rendering/menu-backdrop.ts';
import { FixedStepClock, FIXED_TIMESTEP, PAUSE_THRESHOLD } from './simulation/fixed-step.ts';
import { createLapTimer, resetCurrentLap, stepLapTimer } from './simulation/lap-timer.ts';
import { createMinimap } from './ui/minimap.ts';
import { createLapDisplay } from './ui/lap-display.ts';
import { createPerformanceStats } from './ui/performance-stats.ts';
import { createDeveloperConsole } from './ui/developer-console.ts';
import { createTimeTrialSetup } from './ui/time-trial-setup.ts';
import { copyTuningParameters, createTuningPanel } from './ui/tuning.ts';
import type { TuningParameters } from './ui/tuning.ts';
import { listBrowserTracks, loadActiveTrack, selectTrackForPlay } from './track/storage.ts';
import { listSharedTracks } from './track/api.ts';
import { splinePresets } from './track/spline-presets.ts';
import { buildRoadGeometry } from './track/road-geometry.ts';
const trackLayout = splinePresets[0]!.create();

import { createRoadWorld } from './simulation/road-world.ts';
import { createVehicleState, copyVehicleState, interpolateVehicleState } from './simulation/vehicle.ts';
import { wrapAngle } from './simulation/math.ts';
import { drivingParameters, physicsParameters } from './simulation/parameters.ts';
import { respawnVehicle, stepSplineVehicle } from './simulation/spline-vehicle.ts';
import type { DrivingControls, VehicleState } from './simulation/types.ts';
import type { SplineTrack as TrackLayout } from './track/spline-records.ts';
import type {
  ClientToServerEvents,
  CreateLobbyPayload,
  JoinLobbyPayload,
  LobbyPlayerSnapshot,
  LobbySnapshot,
  LobbySummary,
  MultiplayerBootstrap,
  RecordingClientReport,
  ServerToClientEvents,
  TrackOption,
} from './multiplayer/protocol.ts';
import { maxLobbyPlayers, playerColorPalette, trackOptions as presetTrackOptions } from './multiplayer/protocol.ts';

interface MultiplayerPreferences {
  playerName: string;
  lobbyId: string | null;
}

interface RemoteCarEntry {
  visual: ReturnType<typeof createCarVisual>;
  state: VehicleState;
  snapshots: { state: VehicleState; receivedAt: number }[];
  arrivalIntervalsMs: number[];
  lastSnapshotAt: number | null;
  snapshotsReceived: number;
  bufferUnderruns: number;
  extrapolating: boolean;
  color: string;
  visible: boolean;
}

const remoteInterpolationDelay = 120;
const maxRemoteExtrapolation = 100;
const multiplayerStateInterval = 50;

interface DrivingSession {
  trackId: string;
  trackName: string;
  layout: TrackLayout;
  playerColor: string;
  tuning: TuningParameters;
  state: VehicleState;
  view: ReturnType<typeof createScene>;
  car: ReturnType<typeof createCarVisual>;
  lapTimer: ReturnType<typeof createLapTimer>;
  step(elapsed: number, controls: Readonly<DrivingControls>): void;
  toggleCamera(): void;
  syncRemotePlayers(players: LobbyPlayerSnapshot[], localPlayerId: string): void;
  updateRemotePlayer(playerId: string, state: VehicleState): void;
  getDiagnostics(): unknown;
  dispose(): void;
}

interface HomeScreenController {
  setStatus(message: string): void;
  setTrackOptions(trackOptions: TrackOption[]): void;
  setLobbies(lobbies: LobbySummary[]): void;
  setPlayerName(name: string): void;
  getPlayerName(): string;
  getLobbyName(): string;
  getSelectedTrackId(): string;
  showLanding(): void;
  showMultiplayer(): void;
  showTimeTrialSetup(): void;
  dispose(): void;
}

interface LobbyScreenController {
  setRoom(room: LobbySnapshot | null, localPlayerId: string): void;
  setTrackOptions(trackOptions: TrackOption[]): void;
  setStatus(message: string): void;
  dispose(): void;
}

const multiplayerPlayerNameKey = 'racing-multiplayer-player-name-v1';
const multiplayerLobbyKey = 'racing-multiplayer-lobby-v1';

function loadMultiplayerPreferences(): MultiplayerPreferences {
  try {
    const playerName = localStorage.getItem(multiplayerPlayerNameKey);
    const lobbyId = sessionStorage.getItem(multiplayerLobbyKey);
    return {
      playerName: typeof playerName === 'string' && playerName.trim() ? playerName.trim() : 'Player',
      lobbyId: typeof lobbyId === 'string' && lobbyId.trim() ? lobbyId.trim() : null,
    };
  } catch {
    return { playerName: 'Player', lobbyId: null };
  }
}

function saveMultiplayerPreferences(preferences: MultiplayerPreferences): void {
  try {
    localStorage.setItem(multiplayerPlayerNameKey, preferences.playerName);
    if (preferences.lobbyId) sessionStorage.setItem(multiplayerLobbyKey, preferences.lobbyId);
    else sessionStorage.removeItem(multiplayerLobbyKey);
  } catch {
    // Persistent browser storage is optional.
  }
}

function colorToNumber(color: string): number {
  return Number.parseInt(color.slice(1), 16);
}

function localPlayerColor(room: LobbySnapshot | null, playerId: string): string {
  return room?.players.find((player) => player.id === playerId)?.color ?? '#ee7136';
}

function setScreenVisibility(screen: HTMLElement, visible: boolean): void {
  screen.hidden = !visible;
}

function createDrivingSession(canvas: HTMLCanvasElement, layout: TrackLayout, trackName: string, trackId: string, tuning: TuningParameters, playerColor: string, spawnIndex = 0): DrivingSession {
  document.querySelector('#active-track-name')!.textContent = trackName;
  const lapContainer = document.querySelector<HTMLElement>('#lap-display');
  if (!lapContainer) throw new Error('Lap display is missing.');
  const road = buildRoadGeometry(layout);
  const finishLine = road.finish;
  const lapTimer = createLapTimer();
  const lapDisplay = createLapDisplay(lapContainer, finishLine !== null);
  lapDisplay.update(lapTimer);

  const state = createVehicleState();
  const spawn = road.spawns[spawnIndex] ?? road.spawns[0]!;
  respawnVehicle(state, spawn);
  const collisionWorld = createRoadWorld(road);
  const previous = createVehicleState();
  const rendered = createVehicleState();
  copyVehicleState(state, previous);
  copyVehicleState(state, rendered);

  const minimapCanvas = document.querySelector<HTMLCanvasElement>('#minimap');
  if (!minimapCanvas) throw new Error('Minimap canvas is missing.');
  const minimap = createMinimap(minimapCanvas, layout);

  const clock = new FixedStepClock();
  const view = createScene(canvas, road);
  const car = createCarVisual(colorToNumber(playerColor));
  const followCamera = createFollowCamera(view.camera, state);
  view.scene.add(car.object);
  const remoteCars = new Map<string, RemoteCarEntry>();
  let simulationTicks = 0;
  let lastFrameSteps = 0;
  let lastFramePhysicsMs = 0;
  let lastFrameElapsedMs = 0;
  let latestControls: Readonly<DrivingControls> = { throttle: 0, steering: 0, brake: false };

  function updateMinimap(): void {
    const markers: { state: Readonly<VehicleState>; color: string }[] = [{ state: rendered, color: playerColor }];
    for (const remote of remoteCars.values()) {
      if (!remote.visible) continue;
      markers.push({ state: remote.state, color: remote.color });
    }
    minimap.update(markers);
  }

  function syncRemotePlayers(players: LobbyPlayerSnapshot[], localPlayerId: string): void {
    const wantedIds = new Set(players.filter((player) => player.id !== localPlayerId).map((player) => player.id));
    for (const [playerId, remote] of remoteCars) {
      if (wantedIds.has(playerId)) continue;
      view.scene.remove(remote.visual.object);
      remote.visual.dispose();
      remoteCars.delete(playerId);
    }

    for (const player of players) {
      if (player.id === localPlayerId) continue;
      const existing = remoteCars.get(player.id);
      if (!existing || existing.color !== player.color) {
        if (existing) {
          view.scene.remove(existing.visual.object);
          existing.visual.dispose();
          remoteCars.delete(player.id);
        }
        const visual = createCarVisual(colorToNumber(player.color));
        visual.object.visible = false;
        view.scene.add(visual.object);
        remoteCars.set(player.id, {
          visual, state: createVehicleState(), snapshots: [], arrivalIntervalsMs: [], lastSnapshotAt: null,
          snapshotsReceived: 0, bufferUnderruns: 0, extrapolating: false, color: player.color, visible: false,
        });
      }
      const remote = remoteCars.get(player.id)!;
      remote.color = player.color;
      if (player.state) {
        pushRemoteSnapshot(remote, player.state);
      } else {
        remote.visual.object.visible = false;
        remote.visible = false;
      }
    }
    updateMinimap();
  }

  function updateRemotePlayer(playerId: string, snapshot: VehicleState): void {
    let remote = remoteCars.get(playerId);
    if (!remote) {
      const visual = createCarVisual(0x8ca0ab);
      view.scene.add(visual.object);
      remote = {
        visual, state: createVehicleState(), snapshots: [], arrivalIntervalsMs: [], lastSnapshotAt: null,
        snapshotsReceived: 0, bufferUnderruns: 0, extrapolating: false, color: '#8ca0ab', visible: true,
      };
      remoteCars.set(playerId, remote);
    }
    pushRemoteSnapshot(remote, snapshot);
  }

  function pushRemoteSnapshot(remote: RemoteCarEntry, snapshot: Readonly<VehicleState>): void {
    const state = createVehicleState();
    copyVehicleState(snapshot, state);
    const receivedAt = performance.now();
    const latest = remote.snapshots.at(-1);
    const teleported = latest !== undefined
      && Math.hypot(state.position.x - latest.state.position.x, state.position.z - latest.state.position.z) > 24;
    if (teleported) {
      remote.snapshots.length = 0;
      remote.arrivalIntervalsMs.length = 0;
      remote.lastSnapshotAt = null;
      remote.extrapolating = false;
    }
    if (remote.lastSnapshotAt !== null) {
      remote.arrivalIntervalsMs.push(receivedAt - remote.lastSnapshotAt);
      if (remote.arrivalIntervalsMs.length > 30) remote.arrivalIntervalsMs.shift();
    }
    remote.lastSnapshotAt = receivedAt;
    remote.snapshotsReceived++;
    remote.snapshots.push({ state, receivedAt });
    if (remote.snapshots.length > 12) remote.snapshots.splice(0, remote.snapshots.length - 12);
    remote.visible = true;
    remote.visual.object.visible = true;
    if (remote.snapshots.length === 1) {
      copyVehicleState(state, remote.state);
      remote.visual.update(remote.state);
    }
  }

  function renderRemotePlayers(now: number): void {
    const renderTime = now - remoteInterpolationDelay;
    for (const remote of remoteCars.values()) {
      const snapshots = remote.snapshots;
      if (!remote.visible || snapshots.length === 0) continue;
      while (snapshots.length > 2 && snapshots[1]!.receivedAt <= renderTime) snapshots.shift();
      const older = snapshots[0]!;
      const newer = snapshots[1];
      const newest = snapshots.at(-1)!;
      const underrun = renderTime > newest.receivedAt;
      if (underrun && !remote.extrapolating) remote.bufferUnderruns++;
      remote.extrapolating = underrun;
      if (newer && renderTime <= newer.receivedAt) {
        const span = newer.receivedAt - older.receivedAt;
        const alpha = span > 0 ? Math.max(0, Math.min(1, (renderTime - older.receivedAt) / span)) : 1;
        interpolateVehicleState(older.state, newer.state, alpha, remote.state);
      } else {
        const anchor = newer && renderTime > newer.receivedAt ? newer : older;
        copyVehicleState(anchor.state, remote.state);
        const extrapolation = Math.max(0, Math.min(maxRemoteExtrapolation, renderTime - anchor.receivedAt)) / 1000;
        if (extrapolation > 0) {
          const heading = anchor.state.heading;
          remote.state.position.x += (-Math.sin(heading) * anchor.state.speed + Math.cos(heading) * anchor.state.lateralSpeed) * extrapolation;
          remote.state.position.z += (-Math.cos(heading) * anchor.state.speed - Math.sin(heading) * anchor.state.lateralSpeed) * extrapolation;
          remote.state.position.y += anchor.state.verticalSpeed * extrapolation;
          remote.state.heading = wrapAngle(remote.state.heading + anchor.state.yawSpeed * extrapolation);
        }
      }
      remote.visual.update(remote.state);
    }
  }

  function step(elapsed: number, controls: Readonly<DrivingControls>): void {
    latestControls = { ...controls };
    if (elapsed > PAUSE_THRESHOLD) copyVehicleState(state, previous);
    let respawned = false;
    lastFrameSteps = 0;
    lastFramePhysicsMs = 0;
    lastFrameElapsedMs = elapsed * 1000;
    const alpha = clock.advance(elapsed, (timestep) => {
      const physicsStartedAt = performance.now();
      copyVehicleState(state, previous);
      if (stepSplineVehicle(state, controls, timestep, collisionWorld, spawn, tuning.physics, tuning.driving)) {
        resetCurrentLap(lapTimer);
        copyVehicleState(state, previous);
        respawned = true;
      } else {
        stepLapTimer(lapTimer, previous.position, state.position, timestep, finishLine, road.checkpoints);
      }
      lastFramePhysicsMs += performance.now() - physicsStartedAt;
      lastFrameSteps++;
      simulationTicks++;
    });

    interpolateVehicleState(previous, state, alpha, rendered);
    car.update(rendered);
    renderRemotePlayers(performance.now());
    if (respawned) followCamera.reset(rendered);
    else followCamera.update(rendered, elapsed);
    view.followSun(rendered.position);
    view.renderer.render(view.scene, view.camera);
    lapDisplay.update(lapTimer);
    updateMinimap();
  }

  function getDiagnostics(): unknown {
    const now = performance.now();
    const renderer = view.renderer;
    const drawStats = renderer.info.render;
    const memoryStats = renderer.info.memory;
    return {
      vehicle: { speedMps: state.speed, speedKph: Math.abs(state.speed) * 3.6, grounded: state.grounded,
        airborneSeconds: state.airborneTime, headingRadians: state.heading },
      simulation: { tickRateHz: 1 / FIXED_TIMESTEP, totalTicks: simulationTicks,
        stepsLastFrame: lastFrameSteps, physicsMsLastFrame: lastFramePhysicsMs, frameDeltaMs: lastFrameElapsedMs },
      renderer: { pixelRatio: renderer.getPixelRatio(), drawCalls: drawStats.calls, triangles: drawStats.triangles,
        geometries: memoryStats.geometries, textures: memoryStats.textures, trackTriangles: view.road.triangles.length },
      remotePlayers: [...remoteCars].map(([id, remote]) => {
        const intervals = remote.arrivalIntervalsMs;
        const mean = intervals.length ? intervals.reduce((sum, value) => sum + value, 0) / intervals.length : null;
        const jitter = mean === null ? null : Math.sqrt(intervals.reduce((sum, value) => sum + (value - mean) ** 2, 0) / intervals.length);
        return { id, snapshotAgeMs: remote.lastSnapshotAt === null ? null : now - remote.lastSnapshotAt,
          interarrivalJitterMs: jitter, bufferUnderruns: remote.bufferUnderruns, extrapolating: remote.extrapolating };
      }),
    };
  }

  return {
    trackId,
    trackName,
    layout,
    playerColor,
    tuning,
    state,
    view,
    car,
    lapTimer,
    step,
    toggleCamera(): void { followCamera.toggleMode(); },
    syncRemotePlayers,
    updateRemotePlayer,
    getDiagnostics,
    dispose(): void {
      for (const remote of remoteCars.values()) {
        view.scene.remove(remote.visual.object);
        remote.visual.dispose();
      }
      remoteCars.clear();
      car.dispose();
      minimap.dispose();
      view.dispose();
    },
  };
}

function createHomeScreen(root: HTMLElement, callbacks: {
  onTimeTrial(): void;
  onMultiplayer(): void;
  onBackToLanding(): void;
  onCreateLobby(payload: CreateLobbyPayload): void;
  onJoinLobby(payload: JoinLobbyPayload): void;
}, preferredTrackId = ''): HomeScreenController {
  root.innerHTML = `
    <div class="home-shell">
      <section id="home-landing" class="home-landing">
        <div class="home-title"><span class="menu-eyebrow">RACING</span><h1>Select an Option</h1></div>
        <nav class="home-choice-grid" aria-label="Main options">
          <button id="home-time-trial" class="home-choice" type="button"><strong>Time Trial</strong><span>Race solo on a track.</span></button>
          <button id="home-multiplayer" class="home-choice" type="button"><strong>Multiplayer Race</strong><span>Create a room or join an open lobby.</span></button>
          <a class="home-choice home-choice-link" href="/map-builder/"><strong>Map Builder</strong><span>Design and share a track.</span></a>
        </nav>
      </section>
      <section id="home-multiplayer-menu" class="home-multiplayer" hidden>
        <header class="multiplayer-entry-header">
          <button id="home-back" class="back-button" type="button">&#8592; Back</button>
          <span class="menu-eyebrow">MULTIPLAYER</span><h1>Create or join a lobby</h1>
          <label>Player name<input id="home-player-name" type="text" maxlength="32" /></label>
        </header>
        <div class="multiplayer-entry-tabs" aria-label="Lobby options">
          <button id="home-create-tab" type="button" aria-pressed="false">Create</button>
          <button id="home-join-tab" type="button" aria-pressed="true">Join</button>
        </div>
        <section id="home-create-panel" hidden>
          <div class="multiplayer-launch">
            <label>Lobby name<input id="home-lobby-name" type="text" maxlength="32" /></label>
            <button id="home-create-lobby" class="trial-start-button" type="button">Create lobby</button>
          </div>
        </section>
        <section id="home-join-panel"><h2>Open lobbies</h2><div id="home-lobby-list" class="lobby-list"></div></section>
        <div id="home-status" class="multiplayer-status">Connect to view open lobbies.</div>
      </section>
    </div>
  `;

  const status = root.querySelector<HTMLElement>('#home-status')!;
  const playerNameInput = root.querySelector<HTMLInputElement>('#home-player-name')!;
  const lobbyNameInput = root.querySelector<HTMLInputElement>('#home-lobby-name')!;
  const createButton = root.querySelector<HTMLButtonElement>('#home-create-lobby')!;
  const lobbyList = root.querySelector<HTMLElement>('#home-lobby-list')!;
  const homeShell = root.querySelector<HTMLElement>('.home-shell')!;
  const landing = root.querySelector<HTMLElement>('#home-landing')!;
  const multiplayerMenu = root.querySelector<HTMLElement>('#home-multiplayer-menu')!;
  root.querySelector<HTMLButtonElement>('#home-time-trial')!.addEventListener('click', callbacks.onTimeTrial);
  root.querySelector<HTMLButtonElement>('#home-multiplayer')!.addEventListener('click', callbacks.onMultiplayer);
  root.querySelector<HTMLButtonElement>('#home-back')!.addEventListener('click', () => { callbacks.onBackToLanding(); });
  const createTab = root.querySelector<HTMLButtonElement>('#home-create-tab')!;
  const joinTab = root.querySelector<HTMLButtonElement>('#home-join-tab')!;
  function showEntryTab(create: boolean): void {
    root.querySelector<HTMLElement>('#home-create-panel')!.hidden = !create;
    root.querySelector<HTMLElement>('#home-join-panel')!.hidden = create;
    createTab.setAttribute('aria-pressed', String(create));
    joinTab.setAttribute('aria-pressed', String(!create));
  }
  createTab.addEventListener('click', () => showEntryTab(true));
  joinTab.addEventListener('click', () => showEntryTab(false));
  let trackOptions: TrackOption[] = [];

  function selectedName(): string {
    return playerNameInput.value.trim() || 'Player';
  }

  function selectedLobbyName(): string {
    return lobbyNameInput.value.trim() || `${selectedName()}'s lobby`;
  }

  function selectedTrackId(): string {
    return trackOptions.find(track => track.id === preferredTrackId)?.id ?? trackOptions[0]?.id ?? 'default';
  }

  function renderLobbies(lobbies: LobbySummary[]): void {
    lobbyList.innerHTML = '';
    if (lobbies.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'multiplayer-empty';
      empty.textContent = 'No open lobbies right now.';
      lobbyList.append(empty);
      return;
    }
    for (const lobby of lobbies) {
      const card = document.createElement('article');
      card.className = 'multiplayer-card';
      const title = document.createElement('strong');
      title.textContent = lobby.name;
      const meta = document.createElement('small');
      meta.textContent = `${lobby.playerCount} / ${maxLobbyPlayers} players ? Host: ${lobby.hostName}`;
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = lobby.playerCount >= maxLobbyPlayers ? 'Lobby full' : 'Join lobby';
      button.disabled = lobby.playerCount >= maxLobbyPlayers;
      button.addEventListener('click', () => callbacks.onJoinLobby({ lobbyId: lobby.id, playerName: selectedName() }));
      card.append(title, meta, button);
      lobbyList.append(card);
    }
  }

  createButton.addEventListener('click', () => {
    callbacks.onCreateLobby({
      lobbyName: selectedLobbyName(),
      playerName: selectedName(),
      trackId: selectedTrackId(),
    });
  });

  playerNameInput.addEventListener('change', () => saveMultiplayerPreferences({ playerName: selectedName(), lobbyId: null }));

  return {
    setStatus(message: string): void { status.textContent = message; },
    setTrackOptions(options: TrackOption[]): void {
      trackOptions = options;
    },
    setLobbies(lobbies: LobbySummary[]): void { renderLobbies(lobbies); },
    setPlayerName(name: string): void { playerNameInput.value = name; },
    getPlayerName(): string { return selectedName(); },
    getLobbyName(): string { return selectedLobbyName(); },
    getSelectedTrackId(): string { return selectedTrackId(); },
    showLanding(): void { homeShell.hidden = false; landing.hidden = false; multiplayerMenu.hidden = true; },
    showMultiplayer(): void { showEntryTab(false); homeShell.hidden = false; landing.hidden = true; multiplayerMenu.hidden = false; },
    showTimeTrialSetup(): void { homeShell.hidden = true; landing.hidden = true; multiplayerMenu.hidden = true; },
    dispose(): void { createButton.replaceWith(createButton.cloneNode(true)); },
  };
}

export function startPrototype(canvas: HTMLCanvasElement) {
  const selectedTrack = loadActiveTrack(localStorage);
  const fallbackLayout = selectedTrack?.layout ?? trackLayout;
  const fallbackTrackName = selectedTrack?.name ?? 'Default circuit';
  const fallbackTrackId = selectedTrack?.id ?? 'local-default';
  const timeTrialColorKey = 'racing-time-trial-color-v1';
  let timeTrialColor: string = playerColorPalette[0];
  try {
    const storedColor = localStorage.getItem(timeTrialColorKey);
    if (playerColorPalette.includes(storedColor as typeof playerColorPalette[number])) timeTrialColor = storedColor as typeof timeTrialColor;
  } catch { /* Color preferences are optional. */ }
  let timeTrialTrack: TrackOption = { id: fallbackTrackId, name: fallbackTrackName, layout: fallbackLayout };

  const homeRoot = document.querySelector<HTMLElement>('#home-screen');
  const lobbyRoot = document.querySelector<HTMLElement>('#lobby-screen');
  const raceRoot = document.querySelector<HTMLElement>('#race-screen');
  const tuningPanelElement = document.querySelector<HTMLElement>('#tuning-panel');
  const tuningToggle = document.querySelector<HTMLButtonElement>('#tuning-toggle');
  const raceLeaveButton = document.querySelector<HTMLButtonElement>('#race-leave');
  const raceRoomName = document.querySelector<HTMLElement>('#race-room-name');
  const raceRoomStatus = document.querySelector<HTMLElement>('#race-room-status');
  const performanceStatsElement = document.querySelector<HTMLElement>('#performance-stats');
  const multiplayerSpeed = document.querySelector<HTMLOutputElement>('#multiplayer-speed')!;

  if (!homeRoot || !lobbyRoot || !raceRoot || !tuningPanelElement || !tuningToggle || !raceLeaveButton || !raceRoomName || !raceRoomStatus || !performanceStatsElement) {
    throw new Error('Multiplayer UI is missing.');
  }

  const homeScreenRoot = homeRoot;
  const lobbyScreenRoot = lobbyRoot;
  const raceScreenRoot = raceRoot;
  const tuningPanelRoot = tuningPanelElement;
  const tuningToggleButton = tuningToggle;
  const raceLeaveButtonElement = raceLeaveButton;
  const raceRoomNameElement = raceRoomName;
  const raceRoomStatusElement = raceRoomStatus;
  const performanceStats = createPerformanceStats(performanceStatsElement);
  const menuBackdropCanvas = document.createElement('canvas');
  menuBackdropCanvas.className = 'menu-car-backdrop';
  menuBackdropCanvas.setAttribute('aria-hidden', 'true');
  document.body.prepend(menuBackdropCanvas);
  const menuBackdrop = createMenuBackdrop(menuBackdropCanvas);

  const tuningPanel = createTuningPanel(tuningPanelElement, tuningToggle);
  const input = createKeyboardInput(window, document);
  const preferences = loadMultiplayerPreferences();

  let homeScreen: HomeScreenController;
  let lobbyScreen: LobbyScreenController;
  let timeTrialSetup: ReturnType<typeof createTimeTrialSetup>;
  let session: DrivingSession | null = null;
  let currentMode: 'home' | 'multiplayer' | 'time-trial-setup' | 'lobby' | 'race' = 'home';
  let activeRoom: LobbySnapshot | null = null;
  let localPlayerId = '';
  let bootstrap: MultiplayerBootstrap | null = null;
  let animationFrame = 0;
  let lastFrameTime: number | null = null;
  let lastStateSentAt = Number.NEGATIVE_INFINITY;
  const chat = createChat(text => { if (socket.connected) socket.emit('multiplayer:chat', text); },
    open => input.setEnabled(currentMode === 'race' && !open));
  const networkStats = {
    startedAt: performance.now(),
    stateMessagesSent: 0, stateMessagesReceived: 0, approximateJsonBytesSent: 0, approximateJsonBytesReceived: 0,
    roomEventsReceived: 0, lobbyListEventsReceived: 0, trackListEventsReceived: 0, bootstrapEventsReceived: 0,
    errorsReceived: 0, disconnects: 0, connects: 0, lastStateReceivedAt: null as number | null,
    stateArrivalIntervalsMs: [] as number[],
  };

  function setMode(mode: 'home' | 'multiplayer' | 'time-trial-setup' | 'lobby' | 'race'): void {
    currentMode = mode;
    menuBackdrop.setActive(mode !== 'race');
    setScreenVisibility(homeScreenRoot, mode === 'home' || mode === 'multiplayer' || mode === 'time-trial-setup');
    setScreenVisibility(lobbyScreenRoot, mode === 'lobby');
    setScreenVisibility(raceScreenRoot, mode === 'race');
    const isTimeTrial = mode === 'race' && activeRoom === null;
    tuningPanelRoot.hidden = !isTimeTrial || document.body.classList.contains('tuning-collapsed');
    tuningToggleButton.hidden = !isTimeTrial;
    raceScreenRoot.classList.toggle('multiplayer-race', mode === 'race' && activeRoom !== null);
    chat.setRoom((mode === 'lobby' || mode === 'race') ? activeRoom?.id ?? null : null);
    input.setEnabled(mode === 'race' && !chat.isOpen);
    performanceStats.setActive(mode === 'race');
  }

  function disposeSession(): void {
    session?.dispose();
    session = null;
  }

  function ensureSession(room: LobbySnapshot | null): DrivingSession {
    const desiredLayout = room?.settings.layout ?? timeTrialTrack.layout;
    const desiredTrackName = room?.settings.trackName ?? timeTrialTrack.name;
    const desiredTrackId = room?.settings.trackId ?? timeTrialTrack.id;
    const desiredColor = room ? localPlayerColor(room, localPlayerId) : timeTrialColor;
    if (!session || session.trackId !== desiredTrackId || session.playerColor !== desiredColor) {
      disposeSession();
      session = createDrivingSession(canvas, desiredLayout, desiredTrackName, desiredTrackId, room?.settings.handling ?? tuningPanel.parameters, desiredColor, Math.max(0, room?.players.findIndex(p => p.id === localPlayerId) ?? 0));
    }
    return session;
  }

  function enterHomeScreen(message = 'Choose a lobby or create a new one.'): void {
    disposeSession();
    setMode('home');
    timeTrialSetup?.hide();
    homeScreen.showLanding();
    homeScreen.setStatus(message);
    homeScreen.setLobbies(bootstrap?.lobbies ?? []);
    activeRoom = null;
    raceRoomNameElement.textContent = 'Race room';
    raceRoomStatusElement.textContent = 'Waiting for a race to start';
    saveMultiplayerPreferences({ playerName: homeScreen.getPlayerName(), lobbyId: null });
  }

  function enterLobbyScreen(room: LobbySnapshot): void {
    disposeSession();
    activeRoom = room;
    setMode('lobby');
    lobbyScreen.setRoom(room, localPlayerId);
    raceRoomNameElement.textContent = room.name;
    raceRoomStatusElement.textContent = room.phase === 'race' ? 'Race started' : 'Lobby open';
    saveMultiplayerPreferences({ playerName: homeScreen.getPlayerName(), lobbyId: room.id });
  }

  function enterRaceScreen(room: LobbySnapshot): void {
    activeRoom = room;
    setMode('race');
    raceRoomNameElement.textContent = room.name;
    raceRoomStatusElement.textContent = room.phase === 'race' ? 'Race in progress' : 'Lobby waiting';
    const currentSession = ensureSession(room);
    currentSession.syncRemotePlayers(room.players, localPlayerId);
    saveMultiplayerPreferences({ playerName: homeScreen.getPlayerName(), lobbyId: room.id });
  }

  function enterTimeTrial(track: TrackOption, color: string): void {
    activeRoom = null;
    timeTrialTrack = track;
    timeTrialColor = color;
    timeTrialSetup.hide();
    try {
      selectTrackForPlay(localStorage, track.name, track.layout, track.id);
      localStorage.setItem(timeTrialColorKey, color);
    } catch { /* The current session still uses this selection if storage is unavailable. */ }
    if (socket.connected) socket.emit('multiplayer:leave-lobby');
    socket.disconnect();
    setMode('race');
    raceRoomNameElement.textContent = 'Time Trial';
    raceRoomStatusElement.textContent = 'Solo session';
    ensureSession(null);
  }

  function availableTimeTrialTracks(sharedTracks: Awaited<ReturnType<typeof listSharedTracks>> = []): TrackOption[] {
    const unique = new Map<string, TrackOption>();
    for (const track of presetTrackOptions) unique.set(track.id, track);
    for (const track of listBrowserTracks(localStorage)) unique.set(track.id, { id: track.id, name: track.name, layout: track.layout });
    if (selectedTrack) unique.set(selectedTrack.id, { id: selectedTrack.id, name: selectedTrack.name, layout: selectedTrack.layout });
    for (const track of sharedTracks) unique.set(track.id, { id: track.id, name: track.name, layout: track.layout });
    const layouts = new Set<string>();
    return [...unique.values()].filter(track => {
      const key = JSON.stringify(track.layout);
      if (layouts.has(key)) return false;
      layouts.add(key);
      return true;
    });
  }

  async function refreshTimeTrialTracks(): Promise<void> {
    const localTracks = availableTimeTrialTracks();
    const preferredId = localTracks.find(track => JSON.stringify(track.layout) === JSON.stringify(timeTrialTrack.layout))?.id ?? timeTrialTrack.id;
    timeTrialSetup.setTracks(localTracks, preferredId);
    timeTrialSetup.setStatus('Loading shared tracks…');
    try {
      const sharedTracks = await listSharedTracks();
      // Keep a user's choice if the shared-track request completes after they select a map.
      timeTrialSetup.setTracks(availableTimeTrialTracks(sharedTracks));
      timeTrialSetup.setStatus('');
    } catch {
      timeTrialSetup.setStatus('Shared tracks could not be loaded. Presets and locally saved tracks are available.');
    }
  }

  function enterMultiplayerMenu(): void {
    homeScreen.showMultiplayer();
    setMode('multiplayer');
    homeScreen.setStatus(socket.connected ? 'Choose a lobby or create one.' : 'Connecting to multiplayer...');
    if (!socket.connected) socket.connect();
  }

  function syncRoom(room: LobbySnapshot | null): void {
    if (!room) {
      enterHomeScreen('You left the room. Pick another lobby or create one.');
      return;
    }

    if (room.phase === 'race') {
      enterRaceScreen(room);
      return;
    }

    enterLobbyScreen(room);
  }

  function refreshSessionFromRoom(): void {
    if (!session || !activeRoom || currentMode !== 'race') return;
    const desiredColor = localPlayerColor(activeRoom, localPlayerId);
    const handlingChanged = JSON.stringify(session.tuning) !== JSON.stringify(activeRoom.settings.handling);
    if (session.trackId !== activeRoom.settings.trackId || session.playerColor !== desiredColor || handlingChanged) {
      session.dispose();
      session = createDrivingSession(canvas, activeRoom.settings.layout, activeRoom.settings.trackName, activeRoom.settings.trackId, activeRoom.settings.handling, desiredColor, Math.max(0, activeRoom.players.findIndex(p=>p.id===localPlayerId)));
    }
  }

  const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io({ autoConnect: false });

  const developerConsole = createDeveloperConsole({
    requestServerTelemetry(): void {
      if (socket.connected) socket.emit('debug:telemetry-request');
    },
    readClientData() {
      const transport = socket.io.engine?.transport;
      const intervals = networkStats.stateArrivalIntervalsMs;
      const intervalMean = intervals.length ? intervals.reduce((sum, value) => sum + value, 0) / intervals.length : null;
      const intervalJitter = intervalMean === null ? null : Math.sqrt(intervals.reduce((sum, value) => sum + (value - intervalMean) ** 2, 0) / intervals.length);
      const now = performance.now();
      const sessionStats = session?.getDiagnostics() as {
        vehicle?: { speedMps: number; speedKph: number; grounded: boolean; airborneSeconds: number; headingRadians: number };
        simulation?: { tickRateHz: number; stepsLastFrame: number; physicsMsLastFrame: number; frameDeltaMs: number };
        renderer?: { pixelRatio: number; drawCalls: number; triangles: number; geometries: number; textures: number; trackTriangles: number };
        remotePlayers?: { id: string; snapshotAgeMs: number | null; interarrivalJitterMs: number | null; bufferUnderruns: number; extrapolating: boolean }[];
      } | null;
      const elapsedSeconds = Math.max(0.001, (now - networkStats.startedAt) / 1000);
      return {
        mode: currentMode,
        room: activeRoom ? { phase: activeRoom.phase, players: activeRoom.players.length, track: activeRoom.settings.trackName } : null,
        performance: performanceStats.diagnostics,
        socket: { connected: socket.connected, transport: transport?.name ?? null },
        traffic: {
          stateSentHz: networkStats.stateMessagesSent / elapsedSeconds,
          stateReceivedHz: networkStats.stateMessagesReceived / elapsedSeconds,
          approximateBytesSentPerSecond: networkStats.approximateJsonBytesSent / elapsedSeconds,
          approximateBytesReceivedPerSecond: networkStats.approximateJsonBytesReceived / elapsedSeconds,
          stateArrivalJitterMs: intervalJitter,
          lastStateAgeMs: networkStats.lastStateReceivedAt === null ? null : now - networkStats.lastStateReceivedAt,
        },
        vehicle: sessionStats?.vehicle ?? null,
        simulation: sessionStats?.simulation ?? null,
        renderer: sessionStats?.renderer ?? null,
        remotePlayers: sessionStats?.remotePlayers ?? [],
      };
    },
  });

  homeScreen = createHomeScreen(homeRoot, {
    onTimeTrial() {
      homeScreen.showTimeTrialSetup();
      timeTrialSetup.show();
      setMode('time-trial-setup');
      void refreshTimeTrialTracks();
    },
    onMultiplayer() { enterMultiplayerMenu(); },
    onBackToLanding() {
      if (socket.connected) socket.disconnect();
      homeScreen.showLanding();
      setMode('home');
    },
    onCreateLobby(payload) {
      saveMultiplayerPreferences({ playerName: payload.playerName, lobbyId: null });
      socket.emit('multiplayer:create-lobby', { ...payload, handling: copyTuningParameters(tuningPanel.parameters) });
      homeScreen.setStatus(`Creating ${payload.lobbyName}...`);
    },
    onJoinLobby(payload) {
      saveMultiplayerPreferences({ playerName: payload.playerName, lobbyId: payload.lobbyId });
      socket.emit('multiplayer:join-lobby', payload);
      homeScreen.setStatus('Joining lobby...');
    },
  }, fallbackTrackId.replace(/^preset:/, ''));

  timeTrialSetup = createTimeTrialSetup(homeRoot, {
    onBack() {
      timeTrialSetup.hide();
      homeScreen.showLanding();
      setMode('home');
    },
    onStart(track, color) { enterTimeTrial(track, color); },
  }, timeTrialColor);

  lobbyScreen = createLobbyScreen(lobbyRoot, {
    onStartLobby(payload) {
      socket.emit('multiplayer:start-lobby', payload);
      lobbyScreen.setStatus('Starting race...');
    },
    onLeaveLobby() {
      socket.emit('multiplayer:leave-lobby');
      enterHomeScreen('Leaving lobby...');
    },
    onColor(color) { socket.emit('multiplayer:set-color', { color }); },
    onUpdateSettings(payload) {
      socket.emit('multiplayer:update-settings', payload);
      lobbyScreen.setStatus('Updating lobby settings...');
    },
  });

  homeScreen.setPlayerName(preferences.playerName);

  socket.on('multiplayer:bootstrap', (payload) => {
    networkStats.bootstrapEventsReceived++;
    bootstrap = payload;
    localPlayerId = payload.playerId;
    homeScreen.setPlayerName(preferences.playerName);
    homeScreen.setTrackOptions(payload.trackOptions);
    homeScreen.setLobbies(payload.lobbies);
    lobbyScreen.setTrackOptions(payload.trackOptions);
    if (payload.activeLobbyId && payload.activeLobbyPhase) {
      homeScreen.setStatus('Reconnecting to your room...');
    } else {
      homeScreen.setStatus('Connected. Choose a lobby or create one.');
    }
    // A newly created room can arrive before this async bootstrap response.
    // Keep that room and refresh its host controls now that our socket ID is known.
    if (activeRoom) {
      if (currentMode === 'lobby') lobbyScreen.setRoom(activeRoom, localPlayerId);
      else if (currentMode === 'race') session?.syncRemotePlayers(activeRoom.players, localPlayerId);
      return;
    }
    const lobbyId = payload.activeLobbyId ?? preferences.lobbyId;
    if (lobbyId) {
      socket.emit('multiplayer:join-lobby', { lobbyId, playerName: preferences.playerName });
    }
  });

  socket.on('multiplayer:lobbies', ({ lobbies }) => {
    networkStats.lobbyListEventsReceived++;
    bootstrap = bootstrap ? { ...bootstrap, lobbies } : bootstrap;
    homeScreen.setLobbies(lobbies);
  });

  socket.on('multiplayer:tracks', ({ trackOptions }) => {
    networkStats.trackListEventsReceived++;
    if (bootstrap) bootstrap = { ...bootstrap, trackOptions };
    homeScreen.setTrackOptions(trackOptions);
    lobbyScreen.setTrackOptions(trackOptions);
  });

  socket.on('multiplayer:chat', message => chat.receive(message));
  socket.on('multiplayer:room', ({ lobby }) => {
    networkStats.roomEventsReceived++;
    if (bootstrap) bootstrap = { ...bootstrap, activeLobbyId: lobby?.id ?? null, activeLobbyPhase: lobby?.phase ?? null };
    syncRoom(lobby);
  });

  socket.on('multiplayer:player-state', ({ playerId, state }) => {
    const receivedAt = performance.now();
    networkStats.stateMessagesReceived++;
    networkStats.approximateJsonBytesReceived += new TextEncoder().encode(JSON.stringify({ playerId, state })).byteLength;
    if (networkStats.lastStateReceivedAt !== null) {
      networkStats.stateArrivalIntervalsMs.push(receivedAt - networkStats.lastStateReceivedAt);
      if (networkStats.stateArrivalIntervalsMs.length > 60) networkStats.stateArrivalIntervalsMs.shift();
    }
    networkStats.lastStateReceivedAt = receivedAt;
    if (playerId === localPlayerId || !session) return;
    session.updateRemotePlayer(playerId, state);
  });

  socket.on('multiplayer:error', ({ message }) => {
    networkStats.errorsReceived++;
    homeScreen.setStatus(message);
    lobbyScreen.setStatus(message);
    saveMultiplayerPreferences({ playerName: homeScreen.getPlayerName(), lobbyId: null });
  });

  socket.on('disconnect', () => {
    chat.setRoom(null);
    networkStats.disconnects++;
    homeScreen.setStatus('Disconnected. Reconnecting...');
    lobbyScreen.setStatus('Disconnected. Reconnecting...');
    raceRoomStatusElement.textContent = 'Disconnected. Reconnecting...';
  });

  socket.on('connect', () => { networkStats.connects++; });
  socket.on('recording:probe', reply => {
    const stats = performanceStats.diagnostics;
    const sessionStats = session?.getDiagnostics() as { remotePlayers: RecordingClientReport['remotePlayers'] } | undefined;
    reply({
      visible: !document.hidden, racing: currentMode === 'race', fps: stats.fps,
      frameMs: stats.averageFrameIntervalMs, httpPingMs: stats.httpPingMs,
      remotePlayers: sessionStats?.remotePlayers ?? [],
    });
  });
  socket.on('debug:telemetry', (snapshot) => developerConsole.setServerData(snapshot));

  raceLeaveButtonElement.addEventListener('click', () => {
    if (activeRoom && socket.connected) {
      socket.emit('multiplayer:leave-lobby');
      enterHomeScreen('Leaving game...');
    } else {
      enterHomeScreen('Choose another mode.');
    }
  });

  function resetTiming(): void {
    lastFrameTime = null;
  }

  function frame(): void {
    const time = performance.now();
    animationFrame = requestAnimationFrame(frame);
    if (document.hidden) return;

    const elapsed = lastFrameTime === null ? 0 : (time - lastFrameTime) / 1000;
    lastFrameTime = time;
    if (elapsed > PAUSE_THRESHOLD) lastFrameTime = time;

    if (currentMode === 'race' && session) {
      if (input.consumeCameraToggle()) session.toggleCamera();
      session.step(elapsed, input.sample());
      tuningPanel.update(session.state);
      if (activeRoom) {
        const speed = String(Math.round(Math.hypot(session.state.speed, session.state.lateralSpeed) * 3.6));
        if (multiplayerSpeed.value !== speed) multiplayerSpeed.value = speed;
      }
      if (activeRoom && socket.connected && time - lastStateSentAt >= multiplayerStateInterval) {
        const payload = { state: session.state };
        socket.emit('multiplayer:update-state', payload);
        networkStats.stateMessagesSent++;
        networkStats.approximateJsonBytesSent += new TextEncoder().encode(JSON.stringify(payload)).byteLength;
        lastStateSentAt = time;
      }
      refreshSessionFromRoom();
      performanceStats.rendered(performance.now());
    }
  }

  document.addEventListener('visibilitychange', resetTiming);
  window.addEventListener('blur', resetTiming);
  setMode('home');
  if (new URLSearchParams(location.search).get('mode') === 'time-trial') {
    homeScreen.showTimeTrialSetup(); timeTrialSetup.show(); setMode('time-trial-setup'); void refreshTimeTrialTracks();
  }
  animationFrame = requestAnimationFrame(frame);

  return {
    get state(): VehicleState { return (session ?? ensureSession(activeRoom)).state; },
    get view(): ReturnType<typeof createScene> { return (session ?? ensureSession(activeRoom)).view; },
    get car(): ReturnType<typeof createCarVisual> { return (session ?? ensureSession(activeRoom)).car; },
    tuning: tuningPanel.parameters,
    get layout(): TrackLayout { return (session ?? ensureSession(activeRoom)).layout; },
    get trackName(): string { return (session ?? ensureSession(activeRoom)).trackName; },
    get lapTimer(): ReturnType<typeof createLapTimer> { return (session ?? ensureSession(activeRoom)).lapTimer; },
    get bootstrap(): MultiplayerBootstrap | null { return bootstrap; },
    dispose(): void {
      cancelAnimationFrame(animationFrame);
      document.removeEventListener('visibilitychange', resetTiming);
      window.removeEventListener('blur', resetTiming);
      input.dispose();
      chat.dispose();
      performanceStats.dispose();
      developerConsole.dispose();
      timeTrialSetup.dispose();
      menuBackdrop.dispose();
      socket.disconnect();
      disposeSession();
      tuningPanel.dispose();
      homeScreen.dispose();
      lobbyScreen.dispose();
    },
  };
}
