import type { LobbySnapshot, TrackOption, UpdateLobbySettingsPayload, StartLobbyPayload, RoundOptions } from '../multiplayer/protocol.ts';
import { maxLobbyPlayers, playerColorPalette } from '../multiplayer/protocol.ts';

import { trackThumbnail } from './track-thumbnail.ts';
import { createLobbyGrid } from '../rendering/lobby-grid.ts';
import { createLobbyTrackPicker } from './lobby-track-picker.ts';
import { carColorNames } from './car-colors.ts';

export function createLobbyScreen(root: HTMLElement, callbacks: {
  onStartLobby(payload: StartLobbyPayload): void;
  onLeaveLobby(): void;
  onUpdateSettings(payload: UpdateLobbySettingsPayload): void;
  onColor(color: string): void;
  onConfigureRound(options: RoundOptions): void;
  onEnterTrack(prepareRace?: boolean): void;
  onCancelRound(): void;
  onClosePanel(): void;
  onSetupVisibility(open: boolean): void;
}) {
  root.innerHTML = `
    <section class="lobby-setup">
      <div class="lobby-overhaul-shell">
        <header class="lobby-overhaul-header">
          <button id="lobby-leave" class="back-button" type="button" aria-label="Leave lobby">&#8592; Back</button>
          <div class="lobby-heading"><span class="menu-eyebrow">ONLINE RACING</span><h1>LOBBY</h1><p id="lobby-room-name"></p><p id="lobby-room-meta"></p></div>
          <span id="lobby-player-count" class="lobby-driver-count"></span>
          <button id="lobby-close-panel" class="back-button" type="button" aria-label="Close lobby settings">&times;</button>
        </header>
        <div class="lobby-grid-stage"><canvas id="lobby-grid-canvas" aria-label="Starting grid showing the players' cars"></canvas><div id="lobby-grid-labels" aria-hidden="true"></div>
          <div class="lobby-track-overlay">
            <button id="lobby-track-display" class="lobby-track-display" type="button" aria-label="Change selected track">
              <canvas class="track-preview-canvas" id="lobby-preview" width="256" height="256" aria-hidden="true"></canvas>
              <strong id="lobby-track-name"></strong>
            </button>
          </div>
        </div>
        <div class="lobby-overhaul-bottom">
          <section id="lobby-chat-slot" class="lobby-chat-slot" aria-label="Lobby chat"></section>
          <aside class="lobby-controls-panel">
            <div class="lobby-colors-block"><span class="setup-label">YOUR CAR</span><h2>Choose a color</h2>
            <div class="trial-color-swatches" id="lobby-colors" aria-label="Car color"></div>
            <div class="trial-selected-color"><span id="lobby-color-dot"></span><output id="lobby-color-name"></output></div>
            <p class="lobby-color-hint">Marked colors are taken.</p></div>
            <div class="lobby-setup-footer">
              <div id="lobby-status" class="lobby-status" role="status"></div>
              <button id="lobby-enter-track" class="trial-start-button" type="button">START <span aria-hidden="true">&rarr;</span></button>
            </div>
          </aside>
        </div>
      </div>
    </section>
    <section id="lobby-race-setup" class="race-setup-overlay" hidden aria-label="Race setup">
      <div class="race-setup-card">
        <button id="lobby-race-setup-close" class="race-setup-close" type="button" aria-label="Close race setup">&times;</button>
        <span class="menu-eyebrow">HOST CONTROLS</span><h2>Set up the race</h2>
        <p>Choose the rules, then hold Space or select Start race.</p>
        <label for="lobby-round-laps">Number of laps</label>
        <input id="lobby-round-laps" type="number" min="1" max="20" step="1" value="3">
        <label for="lobby-round-fall">When a car falls off</label>
        <select id="lobby-round-fall"><option value="respawn">Respawn and keep racing</option><option value="elimination">Eliminate the player</option></select>
        <label class="race-setup-checkbox"><input id="lobby-round-qualifying" type="checkbox" checked> Qualifying lap before the race</label>
        <div class="race-setup-actions"><button id="lobby-round-confirm" class="trial-start-button" type="button">Start race</button>
          <span class="race-setup-hold">Hold Space to start<span></span></span></div>
      </div>
    </section>`;
  const roomName = root.querySelector<HTMLElement>('#lobby-room-name')!;
  const roomMeta = root.querySelector<HTMLElement>('#lobby-room-meta')!;
  const status = root.querySelector<HTMLElement>('#lobby-status')!;
  const trackDisplay = root.querySelector<HTMLButtonElement>('#lobby-track-display')!;
  const enterTrackButton = root.querySelector<HTMLButtonElement>('#lobby-enter-track')!;
  const preview = root.querySelector<HTMLCanvasElement>('#lobby-preview')!;
  const colors = root.querySelector<HTMLElement>('#lobby-colors')!;
  const grid = createLobbyGrid(root.querySelector<HTMLCanvasElement>('#lobby-grid-canvas')!, root.querySelector<HTMLElement>('#lobby-grid-labels')!);
  const trackPicker = createLobbyTrackPicker(root, trackId => {
    if (currentRoom?.hostId === localPlayerId && currentRoom.phase === 'lobby') callbacks.onUpdateSettings({ trackId });
  });
  let trackOptions: TrackOption[] = [];
  let trackOptionKey = '';
  let currentRoom: LobbySnapshot | null = null;
  let localPlayerId = '';
  let onTrack = false;
  let previewKey = '';
  const raceSetup = root.querySelector<HTMLElement>('#lobby-race-setup')!;
  document.body.append(raceSetup);
  raceSetup.tabIndex = -1;
  const lapsInput = raceSetup.querySelector<HTMLInputElement>('#lobby-round-laps')!;
  const fallSelect = raceSetup.querySelector<HTMLSelectElement>('#lobby-round-fall')!;
  const qualifyingInput = raceSetup.querySelector<HTMLInputElement>('#lobby-round-qualifying')!;
  let spaceDown = false;
  let cancelRequested = false;
  let raceStarting = false;
  let holdTimer: ReturnType<typeof setTimeout> | null = null;

  function roundOptions(): RoundOptions {
    return { laps: Math.max(1, Math.min(20, Math.round(Number(lapsInput.value) || 3))),
      fallMode: fallSelect.value === 'elimination' ? 'elimination' : 'respawn',
      qualifying: qualifyingInput.checked };
  }
  function closeRaceSetup(): void {
    raceSetup.hidden = true;
    raceSetup.classList.remove('is-holding');
    if (holdTimer !== null) clearTimeout(holdTimer);
    holdTimer = null;
    callbacks.onSetupVisibility(false);
  }
  function openRaceSetup(): void {
    if (!onTrack || !currentRoom || currentRoom.hostId !== localPlayerId || currentRoom.phase !== 'lobby' || raceStarting) return;
    raceSetup.hidden = false;
    raceSetup.focus();
    callbacks.onSetupVisibility(true);
  }
  function startRace(): void {
    if (!currentRoom || currentRoom.hostId !== localPlayerId || currentRoom.phase !== 'lobby' || raceStarting) return;
    raceStarting = true;
    const options = roundOptions();
    lapsInput.value = String(options.laps);
    callbacks.onConfigureRound(options);
    callbacks.onStartLobby({ options });
    closeRaceSetup();
    status.textContent = 'Preparing the race...';
  }
  function onSpaceDown(event: KeyboardEvent): void {
    if (event.code === 'Escape' && !raceSetup.hidden) { closeRaceSetup(); return; }
    if (event.code === 'Escape' && onTrack && !root.hidden) { callbacks.onClosePanel(); return; }
    const target = event.target instanceof HTMLElement ? event.target : null;
    const editing = target && (target.isContentEditable || target.tagName === 'TEXTAREA'
      || target.tagName === 'SELECT' || target.tagName === 'BUTTON' || target.tagName === 'INPUT');
    if (event.code !== 'Space' || !onTrack || !root.hidden || spaceDown || !currentRoom
      || currentRoom.hostId !== localPlayerId
      || editing || cancelRequested || document.querySelector('.round-results-overlay:not([hidden])')) return;
    event.preventDefault();
    spaceDown = true;
    if (currentRoom.phase === 'lobby') {
      if (raceSetup.hidden) openRaceSetup();
      raceSetup.classList.add('is-holding');
      holdTimer = setTimeout(startRace, 900);
    } else {
      holdTimer = setTimeout(() => {
        cancelRequested = true;
        callbacks.onCancelRound();
        cancelHold();
      }, 900);
    }
  }
  function onSpaceUp(event: KeyboardEvent): void {
    if (event.code !== 'Space') return;
    cancelHold();
  }
  function cancelHold(): void {
    spaceDown = false;
    if (holdTimer !== null) clearTimeout(holdTimer);
    holdTimer = null;
    raceSetup.classList.remove('is-holding');
  }
  window.addEventListener('keydown', onSpaceDown);
  window.addEventListener('keyup', onSpaceUp);
  window.addEventListener('blur', cancelHold);
  enterTrackButton.addEventListener('click', () => callbacks.onEnterTrack(false));
  raceSetup.querySelector('#lobby-race-setup-close')!.addEventListener('click', closeRaceSetup);
  raceSetup.querySelector('#lobby-round-confirm')!.addEventListener('click', startRace);
  for (const control of [lapsInput, fallSelect, qualifyingInput]) {
    control.addEventListener('change', () => {
      if (control === lapsInput) lapsInput.value = String(roundOptions().laps);
      if (currentRoom?.hostId === localPlayerId) callbacks.onConfigureRound(roundOptions());
    });
  }
  lapsInput.addEventListener('input', () => {
    if (currentRoom?.hostId === localPlayerId && lapsInput.value) callbacks.onConfigureRound(roundOptions());
  });

  const colorButtons = playerColorPalette.map(color => {
    const button = document.createElement('button');
    button.className = 'trial-color-swatch';
    button.type = 'button';
    button.style.setProperty('--swatch-color', color);
    button.setAttribute('aria-label', carColorNames.get(color) ?? color);
    button.addEventListener('click', () => callbacks.onColor(color));
    colors.append(button);
    return { color, button };
  });

  function renderTrackOptions(): void {
    const options = [...trackOptions];
    if (currentRoom && !options.some(track => track.id === currentRoom!.settings.trackId))
      options.push({ id: currentRoom.settings.trackId, name: currentRoom.settings.trackName, layout: currentRoom.settings.layout });
    const key = options.map(track => `${track.id}:${track.name}`).join('|');
    if (key !== trackOptionKey) { trackOptionKey = key; trackPicker.setTracks(options); }
  }

  function renderPlayers(room: LobbySnapshot): void {
    root.querySelector('#lobby-player-count')!.textContent = `${room.players.length} / ${maxLobbyPlayers} DRIVERS`;
    grid.setPlayers(room.players, localPlayerId);
    const localPlayer = room.players.find(player => player.id === localPlayerId);
    for (const { color, button } of colorButtons) {
      const owner = room.players.find(player => player.color === color);
      const taken = Boolean(owner && owner.id !== localPlayerId);
      button.disabled = taken || room.phase !== 'lobby' || !localPlayer;
      button.classList.toggle('color-taken', taken);
      button.setAttribute('aria-pressed', String(localPlayer?.color === color));
      button.title = `${carColorNames.get(color)}${owner ? ' - ' + owner.name : ''}`;
      button.textContent = taken ? '\u00d7' : '';
    }
    root.querySelector<HTMLElement>('#lobby-color-dot')!.style.background = localPlayer?.color ?? 'transparent';
    root.querySelector<HTMLOutputElement>('#lobby-color-name')!.value = carColorNames.get(localPlayer?.color ?? '') ?? '';
  }

  root.querySelector('#lobby-leave')!.addEventListener('click', callbacks.onLeaveLobby);
  root.querySelector('#lobby-close-panel')!.addEventListener('click', callbacks.onClosePanel);
  function openTrackPicker(): void {
    if (currentRoom?.hostId === localPlayerId && currentRoom.phase === 'lobby')
      trackPicker.open(currentRoom.settings.trackId);
  }
  trackDisplay.addEventListener('click', openTrackPicker);

  return {
    setOnTrack(value: boolean): void {
      onTrack = value;
      grid.setActive(!value && !root.hidden);
      enterTrackButton.hidden = value || !currentRoom || currentRoom.hostId !== localPlayerId || currentRoom.trackOpen;
      root.querySelector<HTMLButtonElement>('#lobby-close-panel')!.hidden = !value;
    },
    setRoom(room: LobbySnapshot | null, playerId: string): void {
      currentRoom = room;
      localPlayerId = playerId;
      if (!room || room.phase === 'lobby') cancelRequested = false;
      if (!room || room.phase !== 'lobby') raceStarting = false;
      if (!room) {
        closeRaceSetup();
        trackPicker.close();
        grid.setActive(false);
        grid.setPlayers([], '');
        previewKey = '';
        return;
      }
      const isHost = room.hostId === playerId;
      if (!isHost || room.phase !== 'lobby') closeRaceSetup();
      if (raceSetup.hidden) {
        lapsInput.value = String(room.nextRoundOptions.laps);
        fallSelect.value = room.nextRoundOptions.fallMode;
        qualifyingInput.checked = room.nextRoundOptions.qualifying;
      }
      roomName.textContent = room.name;
      roomMeta.textContent = isHost ? 'You are the host' : `Hosted by ${room.hostName}`;
      status.textContent = isHost
        ? onTrack ? 'Free drive is open. Hold Space on the track to set up a race.'
          : 'Choose the track, then start free drive.'
        : onTrack ? 'Free drive is open.' : 'Choose a color and wait for the host to start.';
      renderPlayers(room);
      renderTrackOptions();
      root.querySelector('#lobby-track-name')!.textContent = room.settings.trackName;
      const key = JSON.stringify(room.settings.layout);
      if (key !== previewKey) {
        preview.getContext('2d')?.drawImage(trackThumbnail(room.settings.layout), 0, 0);
        previewKey = key;
      }
      trackDisplay.disabled = !isHost || room.phase !== 'lobby';
      trackDisplay.setAttribute('aria-label', isHost ? 'Change selected track' : 'Selected track');
      enterTrackButton.hidden = onTrack || !isHost || room.trackOpen || room.phase !== 'lobby';
    },
    setTrackOptions(options: TrackOption[]): void { trackOptions = options; renderTrackOptions(); },
    setActive(value: boolean): void { grid.setActive(value && !onTrack); },
    setStatus(message: string): void {
      status.textContent = message;
      if (message !== 'Starting race...' && message !== 'Preparing the race...') raceStarting = false;
    },
    openRaceSetup,
    dispose(): void {
      window.removeEventListener('keydown', onSpaceDown);
      window.removeEventListener('keyup', onSpaceUp);
      window.removeEventListener('blur', cancelHold);
      grid.dispose(); trackPicker.dispose(); raceSetup.remove(); root.replaceChildren();
    },
  };
}
