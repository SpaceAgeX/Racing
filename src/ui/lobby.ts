import type { LobbySnapshot, TrackOption, UpdateLobbySettingsPayload, StartLobbyPayload } from '../multiplayer/protocol.ts';
import { maxLobbyPlayers, playerColorPalette } from '../multiplayer/protocol.ts';

import { createMinimap } from './minimap.ts';
import { createLobbyHandlingEditor } from './tuning.ts';
import { carColorNames } from './car-colors.ts';

export function createLobbyScreen(root: HTMLElement, callbacks: {
  onStartLobby(payload: StartLobbyPayload): void;
  onLeaveLobby(): void;
  onUpdateSettings(payload: UpdateLobbySettingsPayload): void;
  onColor(color: string): void;
}) {
  root.innerHTML = `
    <section class="time-trial-setup lobby-setup">
      <div class="time-trial-setup-shell">
        <header class="time-trial-setup-header">
          <button id="lobby-leave" class="back-button" type="button" aria-label="Leave lobby">&#8592; Back</button>
          <div><span class="menu-eyebrow">MULTIPLAYER</span><h1 id="lobby-room-name">Lobby</h1><p id="lobby-room-meta"></p></div>
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
        <section id="lobby-shared-settings" class="lobby-shared-settings" hidden>
          <h2>Advanced race settings</h2>
          <button id="lobby-tuning-toggle" type="button" aria-controls="lobby-handling-editor" aria-expanded="false">Edit handling</button>
          <div id="lobby-handling-editor" hidden></div>
        </section>
        <footer class="lobby-setup-footer">
          <div id="lobby-status" class="lobby-status" role="status"></div>
          <button id="lobby-start" class="trial-start-button" type="button">Start race</button>
        </footer>
      </div>
    </section>`;
  const roomName = root.querySelector<HTMLElement>('#lobby-room-name')!;
  const roomMeta = root.querySelector<HTMLElement>('#lobby-room-meta')!;
  const status = root.querySelector<HTMLElement>('#lobby-status')!;
  const trackSelect = root.querySelector<HTMLSelectElement>('#lobby-track-select')!;
  const playerList = root.querySelector<HTMLElement>('#lobby-player-list')!;
  const startButton = root.querySelector<HTMLButtonElement>('#lobby-start')!;
  const preview = root.querySelector<HTMLCanvasElement>('#lobby-preview')!;
  const colors = root.querySelector<HTMLElement>('#lobby-colors')!;
  const settingsSection = root.querySelector<HTMLElement>('#lobby-shared-settings')!;
  const tuningToggle = root.querySelector<HTMLButtonElement>('#lobby-tuning-toggle')!;
  const editorElement = root.querySelector<HTMLElement>('#lobby-handling-editor')!;
  const handlingEditor = createLobbyHandlingEditor(editorElement, handling => {
    callbacks.onUpdateSettings({ handling });
  });
  tuningToggle.addEventListener('click', () => {
    editorElement.hidden = !editorElement.hidden;
    tuningToggle.setAttribute('aria-expanded', String(!editorElement.hidden));
    tuningToggle.textContent = editorElement.hidden ? 'Edit handling' : 'Hide handling';
  });
  let trackOptions: TrackOption[] = [];
  let currentRoom: LobbySnapshot | null = null;
  let localPlayerId = '';
  let minimap: ReturnType<typeof createMinimap> | null = null;
  let previewKey = '';

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

  startButton.addEventListener('click', () => callbacks.onStartLobby({ start: true }));
  root.querySelector('#lobby-leave')!.addEventListener('click', callbacks.onLeaveLobby);
  trackSelect.addEventListener('change', () => {
    if (currentRoom?.hostId === localPlayerId && currentRoom.phase === 'lobby') {
      callbacks.onUpdateSettings({ trackId: trackSelect.value });
    }
  });

  return {
    setRoom(room: LobbySnapshot | null, playerId: string): void {
      currentRoom = room;
      localPlayerId = playerId;
      if (!room) {
        minimap?.dispose();
        minimap = null;
        previewKey = '';
        return;
      }
      const isHost = room.hostId === playerId;
      roomName.textContent = room.name;
      roomMeta.textContent = `${isHost ? 'You are the host' : `Hosted by ${room.hostName}`} · ${room.ranked ? 'Ranked laps' : 'Unranked · custom handling'}`;
      status.textContent = isHost ? 'Choose your settings, then start the race.' : 'Waiting for the host to start the race.';
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
      settingsSection.hidden = !isHost || room.phase !== 'lobby';
      if (settingsSection.hidden) {
        editorElement.hidden = true;
        tuningToggle.setAttribute('aria-expanded', 'false');
      }
      root.querySelector('#lobby-track-permission')!.textContent = isHost
        ? 'Choose the track for everyone.' : 'Only the host can change the track.';
      startButton.hidden = !isHost || room.phase !== 'lobby';
      handlingEditor.setRoomHandling(room.settings.handling, isHost && room.phase === 'lobby');
    },
    setTrackOptions(options: TrackOption[]): void { trackOptions = options; renderTrackOptions(); },
    setStatus(message: string): void { status.textContent = message; },
    dispose(): void { minimap?.dispose(); handlingEditor.dispose(); root.replaceChildren(); },
  };
}
