import { io, type Socket } from 'socket.io-client';
import { createKeyboardInput } from './input/keyboard.ts';
import { createCarVisual } from './rendering/car.ts';
import { createFollowCamera } from './rendering/camera.ts';
import { createScene } from './rendering/scene.ts';
import { FixedStepClock, PAUSE_THRESHOLD } from './simulation/fixed-step.ts';
import { createLapTimer, resetCurrentLap, stepLapTimer } from './simulation/lap-timer.ts';
import { createMinimap } from './ui/minimap.ts';
import { createLapDisplay } from './ui/lap-display.ts';
import { createPerformanceStats } from './ui/performance-stats.ts';
import { createTuningPanel } from './ui/tuning.ts';
import type { TuningParameters } from './ui/tuning.ts';
import { loadActiveTrack } from './track/storage.ts';
import { trackLayout, trackTileSize } from './track/layout.ts';
import { getFinishLine, getTrackSpawn } from './track/grid.ts';
import { createTrackCollisionWorld } from './track/collision.ts';
import { createVehicleState, copyVehicleState, interpolateVehicleState } from './simulation/vehicle.ts';
import { respawnVehicle, stepVehicleInWorld } from './simulation/vehicle-world.ts';
import type { DrivingControls, VehicleState } from './simulation/types.ts';
import type { TrackLayout } from './track/layout.ts';
import type {
  ClientToServerEvents,
  CreateLobbyPayload,
  JoinLobbyPayload,
  LobbyPlayerSnapshot,
  LobbySnapshot,
  LobbySummary,
  MultiplayerBootstrap,
  ServerToClientEvents,
  StartLobbyPayload,
  TrackOption,
  UpdateLobbySettingsPayload,
} from './multiplayer/protocol.ts';

interface MultiplayerPreferences {
  playerName: string;
  lobbyId: string | null;
}

interface RemoteCarEntry {
  visual: ReturnType<typeof createCarVisual>;
  state: VehicleState;
  color: string;
}

interface DrivingSession {
  trackId: string;
  trackName: string;
  layout: TrackLayout;
  state: VehicleState;
  view: ReturnType<typeof createScene>;
  car: ReturnType<typeof createCarVisual>;
  lapTimer: ReturnType<typeof createLapTimer>;
  step(elapsed: number, controls: Readonly<DrivingControls>): void;
  syncRemotePlayers(players: LobbyPlayerSnapshot[], localPlayerId: string): void;
  updateRemotePlayer(playerId: string, state: VehicleState): void;
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

function setScreenVisibility(screen: HTMLElement, visible: boolean): void {
  screen.hidden = !visible;
}

function createDrivingSession(canvas: HTMLCanvasElement, layout: TrackLayout, trackName: string, trackId: string, tuning: TuningParameters): DrivingSession {
  document.querySelector('#active-track-name')!.textContent = trackName;
  const lapContainer = document.querySelector<HTMLElement>('#lap-display');
  if (!lapContainer) throw new Error('Lap display is missing.');
  const finishLine = getFinishLine(layout, trackTileSize);
  const lapTimer = createLapTimer();
  const lapDisplay = createLapDisplay(lapContainer, finishLine !== null);
  lapDisplay.update(lapTimer);

  const state = createVehicleState();
  const spawn = getTrackSpawn(layout, trackTileSize);
  respawnVehicle(state, spawn);
  const collisionWorld = createTrackCollisionWorld(layout, trackTileSize);
  const previous = createVehicleState();
  const rendered = createVehicleState();
  copyVehicleState(state, previous);
  copyVehicleState(state, rendered);

  const minimapCanvas = document.querySelector<HTMLCanvasElement>('#minimap');
  if (!minimapCanvas) throw new Error('Minimap canvas is missing.');
  const minimap = createMinimap(minimapCanvas, layout, trackTileSize);
  minimap.update(rendered);

  const clock = new FixedStepClock();
  const view = createScene(canvas, layout, trackTileSize);
  const car = createCarVisual();
  const followCamera = createFollowCamera(view.camera, state);
  view.scene.add(car.object);
  const remoteCars = new Map<string, RemoteCarEntry>();

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
        remoteCars.set(player.id, { visual, state: createVehicleState(), color: player.color });
      }
      const remote = remoteCars.get(player.id)!;
      remote.color = player.color;
      if (player.state) {
        copyVehicleState(player.state, remote.state);
        remote.visual.object.visible = true;
        remote.visual.update(remote.state);
      } else {
        remote.visual.object.visible = false;
      }
    }
  }

  function updateRemotePlayer(playerId: string, snapshot: VehicleState): void {
    let remote = remoteCars.get(playerId);
    if (!remote) {
      const visual = createCarVisual(0x8ca0ab);
      view.scene.add(visual.object);
      remote = { visual, state: createVehicleState(), color: '#8ca0ab' };
      remoteCars.set(playerId, remote);
    }
    copyVehicleState(snapshot, remote.state);
    remote.visual.object.visible = true;
    remote.visual.update(remote.state);
  }

  function step(elapsed: number, controls: Readonly<DrivingControls>): void {
    if (elapsed > PAUSE_THRESHOLD) copyVehicleState(state, previous);
    let respawned = false;
    const alpha = clock.advance(elapsed, (timestep) => {
      copyVehicleState(state, previous);
      if (stepVehicleInWorld(state, controls, timestep, collisionWorld, spawn, tuning.physics, tuning.driving)) {
        resetCurrentLap(lapTimer);
        copyVehicleState(state, previous);
        respawned = true;
      } else {
        stepLapTimer(lapTimer, previous.position, state.position, timestep, finishLine);
      }
    });

    interpolateVehicleState(previous, state, alpha, rendered);
    car.update(rendered);
    if (respawned) followCamera.reset(rendered);
    else followCamera.update(rendered, elapsed);
    view.followSun(rendered.position);
    view.renderer.render(view.scene, view.camera);
    lapDisplay.update(lapTimer);
    minimap.update(rendered);
  }

  return {
    trackId,
    trackName,
    layout,
    state,
    view,
    car,
    lapTimer,
    step,
    syncRemotePlayers,
    updateRemotePlayer,
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
        <div class="hero-card home-title"><h1>Choose your race</h1><p>Race alone, meet friends in a room, or build a track.</p></div>
        <div class="home-choice-grid">
          <button id="home-time-trial" class="home-choice" type="button"><strong>Time Trial</strong><span>Race immediately on your selected track.</span></button>
          <button id="home-multiplayer" class="home-choice" type="button"><strong>Multiplayer Race</strong><span>Create a room or join an open lobby.</span></button>
          <a class="home-choice home-choice-link" href="/map-builder/"><strong>Map Builder</strong><span>Design and share a track.</span></a>
        </div>
      </section>
      <section id="home-multiplayer-menu" class="home-multiplayer" hidden>
        <div class="hero-card"><button id="home-back" class="back-button" type="button">← Back</button><h1>Multiplayer race</h1><p>Create a lobby for friends or join a room that is waiting for players.</p></div>
        <div class="panel-card">
          <h2>Create a lobby</h2>
          <div class="multiplayer-launch">
            <label>Player name<input id="home-player-name" type="text" maxlength="32" /></label>
            <label>Lobby name<input id="home-lobby-name" type="text" maxlength="32" /></label>
            <label>Track<select id="home-track-select"></select></label>
            <div class="multiplayer-actions">
              <button id="home-create-lobby" type="button">Create lobby</button>
            </div>
          </div>
        </div>
        <section class="lobby-list-card"><h2>Join a lobby</h2><div id="home-lobby-list" class="lobby-list"></div></section>
        <div id="home-status" class="multiplayer-status">Connect to view open lobbies.</div>
      </section>
    </div>
  `;

  const status = root.querySelector<HTMLElement>('#home-status')!;
  const playerNameInput = root.querySelector<HTMLInputElement>('#home-player-name')!;
  const lobbyNameInput = root.querySelector<HTMLInputElement>('#home-lobby-name')!;
  const trackSelect = root.querySelector<HTMLSelectElement>('#home-track-select')!;
  const createButton = root.querySelector<HTMLButtonElement>('#home-create-lobby')!;
  const lobbyList = root.querySelector<HTMLElement>('#home-lobby-list')!;
  const landing = root.querySelector<HTMLElement>('#home-landing')!;
  const multiplayerMenu = root.querySelector<HTMLElement>('#home-multiplayer-menu')!;
  root.querySelector<HTMLButtonElement>('#home-time-trial')!.addEventListener('click', callbacks.onTimeTrial);
  root.querySelector<HTMLButtonElement>('#home-multiplayer')!.addEventListener('click', callbacks.onMultiplayer);
  root.querySelector<HTMLButtonElement>('#home-back')!.addEventListener('click', () => { callbacks.onBackToLanding(); });
  let trackOptions: TrackOption[] = [];

  function selectedName(): string {
    return playerNameInput.value.trim() || 'Player';
  }

  function selectedLobbyName(): string {
    return lobbyNameInput.value.trim() || `${selectedName()}'s lobby`;
  }

  function selectedTrackId(): string {
    return trackSelect.value || trackOptions[0]?.id || 'default';
  }

  function renderTrackOptions(): void {
    const selectedId = trackSelect.value || preferredTrackId;
    trackSelect.innerHTML = '';
    for (const option of trackOptions) {
      const item = document.createElement('option');
      item.value = option.id;
      item.textContent = option.name;
      trackSelect.append(item);
    }
    trackSelect.value = trackOptions.some((option) => option.id === selectedId) ? selectedId : trackOptions[0]?.id ?? '';
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
      meta.textContent = `${lobby.settings.trackName} · ${lobby.playerCount} player${lobby.playerCount === 1 ? '' : 's'} · host ${lobby.hostName}`;
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = 'Join lobby';
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
      renderTrackOptions();
    },
    setLobbies(lobbies: LobbySummary[]): void { renderLobbies(lobbies); },
    setPlayerName(name: string): void { playerNameInput.value = name; },
    getPlayerName(): string { return selectedName(); },
    getLobbyName(): string { return selectedLobbyName(); },
    getSelectedTrackId(): string { return selectedTrackId(); },
    showLanding(): void { landing.hidden = false; multiplayerMenu.hidden = true; },
    showMultiplayer(): void { landing.hidden = true; multiplayerMenu.hidden = false; },
    dispose(): void { createButton.replaceWith(createButton.cloneNode(true)); },
  };
}

function createLobbyScreen(root: HTMLElement, callbacks: {
  onStartLobby(payload: StartLobbyPayload): void;
  onLeaveLobby(): void;
  onUpdateSettings(payload: UpdateLobbySettingsPayload): void;
}): LobbyScreenController {
  root.innerHTML = `
    <div class="lobby-shell">
      <section class="lobby-card">
        <div class="room-header">
          <strong id="lobby-room-name">Lobby</strong>
          <span id="lobby-room-meta">Waiting for players</span>
        </div>
        <p id="lobby-room-message">This lobby is not racing yet. Players can gather here, change the track if they host, and start when ready.</p>
        <div class="lobby-grid">
          <div class="lobby-details">
            <section>
              <h2>Lobby settings</h2>
              <div class="lobby-settings">
                <label>Track<select id="lobby-track-select"></select></label>
              </div>
            </section>
            <section>
              <h2>Players</h2>
              <div id="lobby-player-list" class="lobby-players"></div>
            </section>
          </div>
          <div class="panel-card">
            <h2>Actions</h2>
            <div class="multiplayer-actions">
              <button id="lobby-start" type="button">Start race</button>
              <button id="lobby-leave" type="button">Leave lobby</button>
            </div>
            <div id="lobby-status" class="lobby-status">Ready to start when the host says so.</div>
          </div>
        </div>
      </section>
    </div>
  `;

  const roomName = root.querySelector<HTMLElement>('#lobby-room-name')!;
  const roomMeta = root.querySelector<HTMLElement>('#lobby-room-meta')!;
  const roomMessage = root.querySelector<HTMLElement>('#lobby-room-message')!;
  const status = root.querySelector<HTMLElement>('#lobby-status')!;
  const trackSelect = root.querySelector<HTMLSelectElement>('#lobby-track-select')!;
  const playerList = root.querySelector<HTMLElement>('#lobby-player-list')!;
  const startButton = root.querySelector<HTMLButtonElement>('#lobby-start')!;
  const leaveButton = root.querySelector<HTMLButtonElement>('#lobby-leave')!;
  let trackOptions: TrackOption[] = [];
  let currentRoom: LobbySnapshot | null = null;
  let localPlayerId = '';

  function renderTrackOptions(selectedId: string): void {
    trackSelect.innerHTML = '';
    for (const option of trackOptions) {
      const item = document.createElement('option');
      item.value = option.id;
      item.textContent = option.name;
      trackSelect.append(item);
    }
    if (selectedId) trackSelect.value = selectedId;
  }

  function renderPlayers(room: LobbySnapshot): void {
    playerList.innerHTML = '';
    for (const player of room.players) {
      const row = document.createElement('div');
      row.className = 'player-entry';
      const name = document.createElement('strong');
      name.textContent = `${player.name}${player.isHost ? ' (host)' : ''}`;
      const marker = document.createElement('span');
      marker.className = 'player-dot';
      marker.style.background = player.color;
      row.append(name, marker);
      playerList.append(row);
    }
  }

  startButton.addEventListener('click', () => callbacks.onStartLobby({ start: true }));
  leaveButton.addEventListener('click', () => callbacks.onLeaveLobby());
  trackSelect.addEventListener('change', () => {
    if (!currentRoom || currentRoom.hostId !== localPlayerId) return;
    callbacks.onUpdateSettings({ trackId: trackSelect.value });
  });

  return {
    setRoom(room: LobbySnapshot | null, playerId: string): void {
      currentRoom = room;
      localPlayerId = playerId;
      if (!room) {
        roomName.textContent = 'Lobby';
        roomMeta.textContent = 'Waiting for players';
        roomMessage.textContent = 'No lobby is active. Go back home, create one, or join another room.';
        status.textContent = 'Not in a lobby.';
        playerList.innerHTML = '';
        startButton.hidden = true;
        trackSelect.disabled = true;
        leaveButton.hidden = true;
        return;
      }

      roomName.textContent = room.name;
      roomMeta.textContent = `${room.phase === 'race' ? 'Race in progress' : 'Waiting lobby'} · ${room.players.length} player${room.players.length === 1 ? '' : 's'}`;
      roomMessage.textContent = room.phase === 'race'
        ? 'The race is live. Drive on the loaded track and leave back to the home screen whenever you want.'
        : 'This room is still a lobby. Track and cars stay out of view until the host starts the race.';
      status.textContent = room.phase === 'race' ? 'Race started.' : 'Waiting for the host to start the race.';
      renderPlayers(room);
      renderTrackOptions(room.settings.trackId);
      const isHost = room.hostId === localPlayerId;
      startButton.hidden = !isHost || room.phase === 'race';
      trackSelect.disabled = !isHost || room.phase === 'race';
      leaveButton.hidden = false;
    },
    setTrackOptions(options: TrackOption[]): void {
      trackOptions = options;
      renderTrackOptions(currentRoom?.settings.trackId ?? options[0]?.id ?? '');
      if (currentRoom) renderPlayers(currentRoom);
    },
    setStatus(message: string): void { status.textContent = message; },
    dispose(): void { startButton.replaceWith(startButton.cloneNode(true)); },
  };
}

export function startPrototype(canvas: HTMLCanvasElement) {
  const selectedTrack = loadActiveTrack(localStorage);
  const fallbackLayout = selectedTrack?.layout ?? trackLayout;
  const fallbackTrackName = selectedTrack?.name ?? 'Default circuit';
  const fallbackTrackId = selectedTrack?.id ?? 'local-default';

  const homeRoot = document.querySelector<HTMLElement>('#home-screen');
  const lobbyRoot = document.querySelector<HTMLElement>('#lobby-screen');
  const raceRoot = document.querySelector<HTMLElement>('#race-screen');
  const tuningPanelElement = document.querySelector<HTMLElement>('#tuning-panel');
  const tuningToggle = document.querySelector<HTMLButtonElement>('#tuning-toggle');
  const raceLeaveButton = document.querySelector<HTMLButtonElement>('#race-leave');
  const raceRoomName = document.querySelector<HTMLElement>('#race-room-name');
  const raceRoomStatus = document.querySelector<HTMLElement>('#race-room-status');
  const performanceStatsElement = document.querySelector<HTMLElement>('#performance-stats');

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

  const tuningPanel = createTuningPanel(tuningPanelElement, tuningToggle);
  const input = createKeyboardInput(window, document);
  const preferences = loadMultiplayerPreferences();

  let homeScreen: HomeScreenController;
  let lobbyScreen: LobbyScreenController;
  let session: DrivingSession | null = null;
  let currentMode: 'home' | 'multiplayer' | 'lobby' | 'race' = 'home';
  let activeRoom: LobbySnapshot | null = null;
  let localPlayerId = '';
  let bootstrap: MultiplayerBootstrap | null = null;
  let animationFrame = 0;
  let lastFrameTime: number | null = null;

  function setMode(mode: 'home' | 'multiplayer' | 'lobby' | 'race'): void {
    currentMode = mode;
    setScreenVisibility(homeScreenRoot, mode === 'home' || mode === 'multiplayer');
    setScreenVisibility(lobbyScreenRoot, mode === 'lobby');
    setScreenVisibility(raceScreenRoot, mode === 'race');
    const isTimeTrial = mode === 'race' && activeRoom === null;
    tuningPanelRoot.hidden = !isTimeTrial || document.body.classList.contains('tuning-collapsed');
    tuningToggleButton.hidden = !isTimeTrial;
    raceScreenRoot.classList.toggle('multiplayer-race', mode === 'race' && activeRoom !== null);
    input.setEnabled(mode === 'race');
    performanceStats.setActive(mode === 'race');
  }

  function disposeSession(): void {
    session?.dispose();
    session = null;
  }

  function ensureSession(room: LobbySnapshot | null): DrivingSession {
    const desiredLayout = room?.settings.layout ?? fallbackLayout;
    const desiredTrackName = room?.settings.trackName ?? fallbackTrackName;
    const desiredTrackId = room?.settings.trackId ?? fallbackTrackId;
    if (!session || session.trackId !== desiredTrackId) {
      disposeSession();
      session = createDrivingSession(canvas, desiredLayout, desiredTrackName, desiredTrackId, tuningPanel.parameters);
    }
    return session;
  }

  function enterHomeScreen(message = 'Choose a lobby or create a new one.'): void {
    disposeSession();
    setMode('home');
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

  function enterTimeTrial(): void {
    activeRoom = null;
    if (socket.connected) socket.emit('multiplayer:leave-lobby');
    socket.disconnect();
    setMode('race');
    raceRoomNameElement.textContent = 'Time Trial';
    raceRoomStatusElement.textContent = 'Solo session';
    ensureSession(null);
  }

  function enterMultiplayerMenu(): void {
    homeScreen.showMultiplayer();
    setMode('multiplayer');
    homeScreen.setStatus('Connecting to multiplayer...');
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
    if (session.trackId !== activeRoom.settings.trackId) {
      session.dispose();
      session = createDrivingSession(canvas, activeRoom.settings.layout, activeRoom.settings.trackName, activeRoom.settings.trackId, tuningPanel.parameters);
    }
  }

  const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io({ autoConnect: false });

  homeScreen = createHomeScreen(homeRoot, {
    onTimeTrial() { enterTimeTrial(); },
    onMultiplayer() { enterMultiplayerMenu(); },
    onBackToLanding() {
      if (socket.connected) socket.disconnect();
      homeScreen.showLanding();
      setMode('home');
    },
    onCreateLobby(payload) {
      saveMultiplayerPreferences({ playerName: payload.playerName, lobbyId: null });
      socket.emit('multiplayer:create-lobby', payload);
      homeScreen.setStatus(`Creating ${payload.lobbyName}...`);
    },
    onJoinLobby(payload) {
      saveMultiplayerPreferences({ playerName: payload.playerName, lobbyId: payload.lobbyId });
      socket.emit('multiplayer:join-lobby', payload);
      homeScreen.setStatus('Joining lobby...');
    },
  }, fallbackTrackId.replace(/^preset:/, ''));

  lobbyScreen = createLobbyScreen(lobbyRoot, {
    onStartLobby(payload) {
      socket.emit('multiplayer:start-lobby', payload);
      lobbyScreen.setStatus('Starting race...');
    },
    onLeaveLobby() {
      socket.emit('multiplayer:leave-lobby');
      enterHomeScreen('Leaving lobby...');
    },
    onUpdateSettings(payload) {
      socket.emit('multiplayer:update-settings', payload);
      lobbyScreen.setStatus('Updating lobby settings...');
    },
  });

  homeScreen.setPlayerName(preferences.playerName);

  socket.on('multiplayer:bootstrap', (payload) => {
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
    if (preferences.lobbyId) {
      socket.emit('multiplayer:join-lobby', { lobbyId: preferences.lobbyId, playerName: preferences.playerName });
    } else {
      enterHomeScreen();
    }
  });

  socket.on('multiplayer:lobbies', ({ lobbies }) => {
    bootstrap = bootstrap ? { ...bootstrap, lobbies } : bootstrap;
    homeScreen.setLobbies(lobbies);
  });

  socket.on('multiplayer:tracks', ({ trackOptions }) => {
    if (bootstrap) bootstrap = { ...bootstrap, trackOptions };
    homeScreen.setTrackOptions(trackOptions);
    lobbyScreen.setTrackOptions(trackOptions);
  });

  socket.on('multiplayer:room', ({ lobby }) => {
    if (bootstrap) bootstrap = { ...bootstrap, activeLobbyId: lobby?.id ?? null, activeLobbyPhase: lobby?.phase ?? null };
    syncRoom(lobby);
  });

  socket.on('multiplayer:player-state', ({ playerId, state }) => {
    if (playerId === localPlayerId || !session) return;
    session.updateRemotePlayer(playerId, state);
  });

  socket.on('multiplayer:error', ({ message }) => {
    homeScreen.setStatus(message);
    lobbyScreen.setStatus(message);
    saveMultiplayerPreferences({ playerName: homeScreen.getPlayerName(), lobbyId: null });
  });

  socket.on('disconnect', () => {
    homeScreen.setStatus('Disconnected. Reconnecting...');
    lobbyScreen.setStatus('Disconnected. Reconnecting...');
    raceRoomStatusElement.textContent = 'Disconnected. Reconnecting...';
  });

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
      session.step(elapsed, input.sample());
      tuningPanel.update(session.state);
      if (activeRoom && socket.connected) {
        socket.emit('multiplayer:update-state', { state: session.state });
      }
      refreshSessionFromRoom();
      performanceStats.rendered(performance.now());
    }
  }

  document.addEventListener('visibilitychange', resetTiming);
  window.addEventListener('blur', resetTiming);
  setMode('home');
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
      performanceStats.dispose();
      socket.disconnect();
      disposeSession();
      tuningPanel.dispose();
      homeScreen.dispose();
      lobbyScreen.dispose();
    },
  };
}
