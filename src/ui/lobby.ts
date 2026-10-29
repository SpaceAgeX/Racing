import type { LobbySnapshot, TrackOption, UpdateLobbySettingsPayload, StartLobbyPayload, RoundOptions } from '../multiplayer/protocol.ts';
import { maxLobbyPlayers, playerColorPalette } from '../multiplayer/protocol.ts';

import { createMinimap } from './minimap.ts';
import { carColorNames } from './car-colors.ts';

export function createLobbyScreen(root: HTMLElement, callbacks: {
  onStartLobby(payload: StartLobbyPayload): void;
  onLeaveLobby(): void;
  onUpdateSettings(payload: UpdateLobbySettingsPayload): void;
  onColor(color: string): void;
  onConfigureRound(options: RoundOptions): void;
  onEnterTrack(): void;
  onCancelRound(): void;
  onClosePanel(): void;
  onSetupVisibility(open: boolean): void;
}) {
  root.innerHTML = `
    <section class="time-trial-setup lobby-setup">
      <div class="time-trial-setup-shell">
        <header class="time-trial-setup-header">
          <button id="lobby-leave" class="back-button" type="button" aria-label="Leave lobby">&#8592; Back</button>
          <div><span class="menu-eyebrow">MULTIPLAYER</span><h1 id="lobby-room-name">Lobby</h1><p id="lobby-room-meta"></p></div>
          <button id="lobby-close-panel" class="back-button" type="button" aria-label="Close lobby settings">&times;</button>
        </header>
        <div class="time-trial-setup-grid">
          <section class="track-preview-card">
            <span class="setup-label">TRACK PREVIEW</span><h2 id="lobby-track-name"></h2>
            <canvas class="track-preview-canvas" id="lobby-preview" aria-label="Lobby track preview"></canvas>
            <label class="track-select-label" for="lobby-track-select">Select map</label>
            <select id="lobby-track-select" aria-describedby="lobby-track-permission"></select>
            <p id="lobby-track-permission" class="setup-status"></p>
          </section>
          <section class="trial-leaderboard-card">
            <h2>Players <span id="lobby-player-count"></span></h2>
            <div id="lobby-player-list" class="lobby-player-slots"></div>
          </section>
          <aside class="trial-options-card">
            <span class="setup-label">YOUR CAR</span><h2>Choose a color</h2>
            <div class="trial-color-swatches" id="lobby-colors" aria-label="Car color"></div>
            <div class="trial-selected-color"><span id="lobby-color-dot"></span><output id="lobby-color-name"></output></div>
            <p class="lobby-color-hint">Marked colors are taken.</p>
          </aside>
        </div>
        <footer class="lobby-setup-footer">
          <div id="lobby-status" class="lobby-status" role="status"></div>
          <button id="lobby-enter-track" class="trial-start-button" type="button">Open track for everyone</button>
          <button id="lobby-start" class="trial-start-button" type="button">Set up race <span class="lobby-space-hint">(hold Space)</span></button>
        </footer>
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
  const trackSelect = root.querySelector<HTMLSelectElement>('#lobby-track-select')!;
  const playerList = root.querySelector<HTMLElement>('#lobby-player-list')!;
  const startButton = root.querySelector<HTMLButtonElement>('#lobby-start')!;
  const enterTrackButton = root.querySelector<HTMLButtonElement>('#lobby-enter-track')!;
  const preview = root.querySelector<HTMLCanvasElement>('#lobby-preview')!;
  const colors = root.querySelector<HTMLElement>('#lobby-colors')!;
  let trackOptions: TrackOption[] = [];
  let currentRoom: LobbySnapshot | null = null;
  let localPlayerId = '';
  let onTrack = false;
  let minimap: ReturnType<typeof createMinimap> | null = null;
  let previewKey = '';
  const raceSetup = root.querySelector<HTMLElement>('#lobby-race-setup')!;
  document.body.append(raceSetup);
  raceSetup.tabIndex = -1;
  const lapsInput = raceSetup.querySelector<HTMLInputElement>('#lobby-round-laps')!;
  const fallSelect = raceSetup.querySelector<HTMLSelectElement>('#lobby-round-fall')!;
  const qualifyingInput = raceSetup.querySelector<HTMLInputElement>('#lobby-round-qualifying')!;
  let spaceDown = false;
  let cancelRequested = false;
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
    if (!onTrack || !currentRoom || currentRoom.hostId !== localPlayerId || currentRoom.phase !== 'lobby') return;
    raceSetup.hidden = false;
    raceSetup.focus();
    callbacks.onSetupVisibility(true);
  }
  function startRace(): void {
    if (!currentRoom || currentRoom.hostId !== localPlayerId || currentRoom.phase !== 'lobby') return;
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
  startButton.addEventListener('click', openRaceSetup);
  enterTrackButton.addEventListener('click', callbacks.onEnterTrack);
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
    if (currentRoom && !options.some(track => track.id === currentRoom!.settings.trackId)) {
      options.push({ id: currentRoom.settings.trackId, name: currentRoom.settings.trackName, layout: currentRoom.settings.layout });
    }
    trackSelect.replaceChildren(...options.map(track => {
      const option = document.createElement('option');
      option.value = track.id;
      option.textContent = track.name;
      return option;
    }));
    trackSelect.value = currentRoom?.settings.trackId ?? options[0]?.id ?? '';
  }

  function renderPlayers(room: LobbySnapshot): void {
    playerList.replaceChildren();
    root.querySelector('#lobby-player-count')!.textContent = `${room.players.length} / ${maxLobbyPlayers}`;
    for (let index = 0; index < maxLobbyPlayers; index++) {
      const player = room.players[index];
      const row = document.createElement('div');
      row.className = player ? 'player-entry' : 'player-slot-empty';
      const rank = document.createElement('span');
      rank.className = 'player-rank';
      rank.textContent = String(index + 1);
      row.append(rank);
      if (player) {
        const name = document.createElement('strong');
        name.textContent = player.name + (player.isHost ? ' (host)' : '') + (player.id === localPlayerId ? ' (you)' : '');
        const dot = document.createElement('span');
        dot.className = 'player-dot';
        dot.style.background = player.color;
        dot.title = carColorNames.get(player.color) ?? player.color;
        row.append(name, dot);
      }
      playerList.append(row);
    }
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
  trackSelect.addEventListener('change', () => {
    if (currentRoom?.hostId === localPlayerId && currentRoom.phase === 'lobby') {
      callbacks.onUpdateSettings({ trackId: trackSelect.value });
    }
  });

  return {
    setOnTrack(value: boolean): void {
      onTrack = value;
      enterTrackButton.hidden = value || !currentRoom || currentRoom.hostId !== localPlayerId || currentRoom.trackOpen;
      startButton.hidden = !value || !currentRoom || currentRoom.hostId !== localPlayerId || currentRoom.phase !== 'lobby';
      root.querySelector<HTMLButtonElement>('#lobby-close-panel')!.hidden = !value;
    },
    setRoom(room: LobbySnapshot | null, playerId: string): void {
      currentRoom = room;
      localPlayerId = playerId;
      if (!room || room.phase === 'lobby') cancelRequested = false;
      if (!room) {
        closeRaceSetup();
        minimap?.dispose();
        minimap = null;
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
      roomMeta.textContent = `${isHost ? 'You are the host' : `Hosted by ${room.hostName}`} · Default handling`;
      status.textContent = isHost
        ? onTrack ? 'Free drive is open. Hold Space on the track to set up a formal race.'
          : 'Choose the track, then open it for everyone.'
        : `${onTrack ? 'Free drive is open' : 'Choose a color and wait for the host to open the track'} · host's next race: ${room.nextRoundOptions.laps} laps · ${room.nextRoundOptions.fallMode}
          · ${room.nextRoundOptions.qualifying ? 'Qualifying on' : 'No qualifying'}`;
      renderPlayers(room);
      renderTrackOptions();
      root.querySelector('#lobby-track-name')!.textContent = room.settings.trackName;
      const key = JSON.stringify(room.settings.layout);
      if (key !== previewKey) {
        minimap?.dispose();
        minimap = createMinimap(preview, room.settings.layout);
        minimap.update([]);
        previewKey = key;
      }
      trackSelect.disabled = !isHost || room.phase !== 'lobby';
      root.querySelector('#lobby-track-permission')!.textContent = isHost
        ? 'Choose the track for everyone.' : 'Only the host can change the track.';
      enterTrackButton.hidden = onTrack || !isHost || room.trackOpen || room.phase !== 'lobby';
      startButton.hidden = !onTrack || !isHost || room.phase !== 'lobby';
    },
    setTrackOptions(options: TrackOption[]): void { trackOptions = options; renderTrackOptions(); },
    setStatus(message: string): void { status.textContent = message; },
    openRaceSetup,
    dispose(): void {
      window.removeEventListener('keydown', onSpaceDown);
      window.removeEventListener('keyup', onSpaceUp);
      window.removeEventListener('blur', cancelHold);
      minimap?.dispose(); raceSetup.remove(); root.replaceChildren();
    },
  };
}
