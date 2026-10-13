import { carColorNames as colorNames } from './car-colors.ts';
import type { TrackLayout } from '../track/layout.ts';
import { trackTileSize } from '../track/layout.ts';
import { createMinimap } from './minimap.ts';
import type { TrackOption } from '../multiplayer/protocol.ts';
import { playerColorPalette } from '../multiplayer/protocol.ts';

export interface TimeTrialTrackOption extends TrackOption {}

export function createTimeTrialSetup(root: HTMLElement, callbacks: {
  onBack(): void;
  onStart(track: TimeTrialTrackOption, color: string): void;
}, initialColor: string = playerColorPalette[0]) {
  const section = document.createElement('section');
  section.className = 'time-trial-setup';
  section.hidden = true;
  section.innerHTML = `
    <div class="time-trial-setup-shell">
      <header class="time-trial-setup-header">
        <button class="back-button" data-back type="button">&#8592; Back</button>
        <div><span class="menu-eyebrow">TIME TRIAL</span><h1>Choose your track</h1></div>
      </header>
      <div class="time-trial-setup-grid">
        <section class="track-preview-card">
          <div class="track-preview-heading"><div><span class="setup-label">TRACK PREVIEW</span><h2 data-track-name>Choose a track</h2></div></div>
          <canvas class="track-preview-canvas" data-preview aria-label="Top-down preview of the selected track"></canvas>
          <label class="track-select-label" for="time-trial-track-select">Select map</label>
          <select id="time-trial-track-select" data-track-select></select>
          <p class="setup-status" data-status></p>
        </section>
        <section class="trial-leaderboard-card" aria-labelledby="trial-leaderboard-heading">
          <h2 id="trial-leaderboard-heading">Leaderboard</h2>
          <ol class="trial-leaderboard" aria-label="Leaderboard positions">
            <li></li><li></li><li></li><li></li><li></li><li></li><li></li><li></li><li></li><li></li>
          </ol>
        </section>
        <aside class="trial-options-card">
          <span class="setup-label">YOUR CAR</span>
          <h2>Choose a color</h2>
          <div class="trial-color-swatches" data-colors aria-label="Car color"></div>
          <div class="trial-selected-color"><span data-color-dot></span><output data-color-name></output></div>
        </aside>
      </div>
      <button class="trial-start-button" data-start type="button" disabled>Start Time Trial</button>
    </div>`;
  root.append(section);

  const select = section.querySelector<HTMLSelectElement>('[data-track-select]')!;
  const preview = section.querySelector<HTMLCanvasElement>('[data-preview]')!;
  let minimap: ReturnType<typeof createMinimap> | null = null;
  const trackName = section.querySelector<HTMLElement>('[data-track-name]')!;
  const status = section.querySelector<HTMLElement>('[data-status]')!;
  const swatches = section.querySelector<HTMLElement>('[data-colors]')!;
  const colorDot = section.querySelector<HTMLElement>('[data-color-dot]')!;
  const colorName = section.querySelector<HTMLOutputElement>('[data-color-name]')!;
  const startButton = section.querySelector<HTMLButtonElement>('[data-start]')!;
  let tracks: TimeTrialTrackOption[] = [];
  let selectedColor = initialColor;



  function selectedTrack(): TimeTrialTrackOption | null {
    return tracks.find((track) => track.id === select.value) ?? null;
  }

  function drawTrack(layout: TrackLayout | null): void {
    minimap?.dispose();
    minimap = null;
    preview.getContext('2d')?.clearRect(0, 0, preview.width, preview.height);
    if (layout) {
      minimap = createMinimap(preview, layout, trackTileSize);
      minimap.update([]);
    }
  }

  function renderSelectedTrack(): void {
    const track = selectedTrack();
    if (!track) {
      trackName.textContent = 'No track selected';
      startButton.disabled = true;
      drawTrack(null);
      return;
    }
    trackName.textContent = track.name;
    startButton.disabled = false;
    drawTrack(track.layout);
  }

  function renderColors(): void {
    swatches.replaceChildren();
    for (const color of playerColorPalette) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'trial-color-swatch';
      button.style.setProperty('--swatch-color', color);
      button.setAttribute('aria-label', colorNames.get(color) ?? color);
      button.setAttribute('aria-pressed', String(selectedColor === color));
      button.addEventListener('click', () => {
        selectedColor = color;
        renderColors();
      });
      swatches.append(button);
    }
    colorDot.style.background = selectedColor;
    colorName.value = colorNames.get(selectedColor) ?? selectedColor;
  }

  select.addEventListener('change', renderSelectedTrack);
  section.querySelector<HTMLButtonElement>('[data-back]')!.addEventListener('click', callbacks.onBack);
  startButton.addEventListener('click', () => {
    const track = selectedTrack();
    if (track) callbacks.onStart(track, selectedColor);
  });

  renderColors();

  return {
    show(): void { section.hidden = false; },
    hide(): void { section.hidden = true; },
    setTracks(options: TimeTrialTrackOption[], preferredId?: string): void {
      const previousId = preferredId ?? select.value;
      const previousLayout = selectedTrack()?.layout;
      tracks = options;
      select.replaceChildren();
      for (const track of tracks) {
        const option = document.createElement('option');
        option.value = track.id;
        option.textContent = track.name;
        select.append(option);
      }
      select.value = tracks.some((track) => track.id === previousId) ? previousId
        : tracks.find(track => JSON.stringify(track.layout) === JSON.stringify(previousLayout))?.id ?? tracks[0]?.id ?? '';
      renderSelectedTrack();
    },
    setStatus(message: string): void { status.textContent = message; },
    get selection(): { track: TimeTrialTrackOption | null; color: string } {
      return { track: selectedTrack(), color: selectedColor };
    },
    dispose(): void { minimap?.dispose(); section.remove(); },
  };
}
