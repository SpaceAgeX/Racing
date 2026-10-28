import { carColorNames } from './car-colors.ts';
import { preferredCarColor } from './car-color-preference.ts';
import { countryFlag } from './countries.ts';
import { trackThumbnail } from './track-thumbnail.ts';
import { createCarShowroom } from '../rendering/car-showroom.ts';
import type { TrackOption } from '../multiplayer/protocol.ts';
import { playerColorPalette } from '../multiplayer/protocol.ts';
import { accountFetch } from '../auth/session.ts';

export interface TimeTrialTrackOption extends TrackOption {}

function formatLap(ms: number): string {
  return `${Math.floor(ms / 60000)}:${((ms % 60000) / 1000).toFixed(2).padStart(5, '0')}`;
}
function formatPopularity(ms: number): string {
  if (!ms) return 'No completed laps yet';
  if (ms < 60000) return '<1m on track';
  const minutes = Math.floor(ms / 60000);
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m on track` : `${minutes}m on track`;
}
export function createTimeTrialSetup(root: HTMLElement, callbacks: {
  onBack(): void; onStart(track: TimeTrialTrackOption, color: string): void;
}, username = '') {
  const section = document.createElement('section');
  section.className = 'time-trial-setup trial-browser is-car-stage';
  section.hidden = true;
  section.innerHTML = `<div class="trial-browser-shell">
    <header class="trial-browser-header"><button class="back-button" data-back type="button">← Back</button>
      <div><span class="menu-eyebrow">SOLO RACE</span><h1>Time Trial</h1></div></header>
    <div class="trial-browser-layout">
      <div class="trial-browser-side">
        <section class="trial-selected-info"><span class="setup-label">SELECTED TRACK</span>
          <button class="trial-track-preview-button" data-open-tracks type="button" aria-label="Choose track" title="Choose track">
            <canvas class="trial-selected-thumbnail" data-selected-thumbnail width="256" height="256" aria-hidden="true"></canvas>
          </button>
          <h2 data-track-name>Choose a track</h2><p data-track-popularity></p></section>
        <section class="trial-board-panel"><span class="setup-label">FASTEST DRIVERS</span><h2>Leaderboard</h2>
          <div class="trial-board-head" aria-hidden="true"><span>#</span><span>Driver</span><span>Best lap</span></div>
          <ol class="trial-board-rows" data-leaderboard aria-label="Track leaderboard"></ol>
          <p class="trial-board-status" data-leaderboard-status role="status"></p></section>
        <section class="trial-car-panel"><span class="setup-label">YOUR CAR</span>
          <canvas class="trial-car-canvas" data-car aria-label="Three-dimensional preview of your car"></canvas>
          <div class="trial-color-controls"><h2>Choose a color</h2>
            <div class="trial-compact-swatches" data-colors role="group" aria-label="Car colors"></div>
            <output class="trial-color-name" data-color-name></output></div></section>
        <div class="trial-actions">
          <p class="trial-browser-status" data-status role="status"></p>
          <button class="trial-start-button" data-start type="button" disabled>Start Time Trial <span aria-hidden="true">→</span></button>
        </div>
      </div>
    </div></div>
    <dialog class="trial-track-dialog" data-track-dialog aria-label="Choose a track">
      <div class="trial-dialog-shell">
        <header class="trial-dialog-header"><button class="back-button" data-close-tracks type="button">← Back</button>
          <div><span class="menu-eyebrow">SOLO RACE</span><h2>Choose your track</h2></div></header>
        <div class="trial-dialog-layout">
          <section class="trial-browser-main" aria-label="Track browser">
            <div class="trial-browser-controls"><label><span class="sr-only">Search tracks</span><input data-search type="search" placeholder="Search tracks" autocomplete="off"></label>
              <label>Sort <select data-sort aria-label="Sort tracks"><option value="popular">Popular</option><option value="newest">Newest</option>
                <option value="played">Most Played</option><option value="name">Name</option></select></label></div>
            <div class="trial-track-scroll" data-track-scroll><div class="trial-track-grid" data-tracks role="group" aria-label="Available tracks"></div></div>
          </section>
          <aside class="trial-dialog-side"><span class="setup-label">SELECTED TRACK</span><h3 data-dialog-track-name>Choose a track</h3>
            <p data-dialog-track-popularity></p><div data-dialog-board-slot></div>
            <button class="trial-start-button" data-use-track type="button" disabled>Use this track <span aria-hidden="true">→</span></button></aside>
        </div>
      </div>
    </dialog>`;
  root.append(section);
  const search = section.querySelector<HTMLInputElement>('[data-search]')!;
  const sort = section.querySelector<HTMLSelectElement>('[data-sort]')!;
  const grid = section.querySelector<HTMLElement>('[data-tracks]')!;
  const scroll = section.querySelector<HTMLElement>('[data-track-scroll]')!;
  const backButton = section.querySelector<HTMLButtonElement>('[data-back]')!;
  const trackDialog = section.querySelector<HTMLDialogElement>('[data-track-dialog]')!;
  const browserSide = section.querySelector<HTMLElement>('.trial-browser-side')!;
  const board = section.querySelector<HTMLElement>('.trial-board-panel')!;
  const dialogBoardSlot = section.querySelector<HTMLElement>('[data-dialog-board-slot]')!;
  const previewButton = section.querySelector<HTMLButtonElement>('[data-open-tracks]')!;
  const dialogTrackName = section.querySelector<HTMLElement>('[data-dialog-track-name]')!;
  const dialogTrackPopularity = section.querySelector<HTMLElement>('[data-dialog-track-popularity]')!;
  const useTrackButton = section.querySelector<HTMLButtonElement>('[data-use-track]')!;
  const selectedThumbnail = section.querySelector<HTMLCanvasElement>('[data-selected-thumbnail]')!;
  const trackName = section.querySelector<HTMLElement>('[data-track-name]')!;
  const trackPopularity = section.querySelector<HTMLElement>('[data-track-popularity]')!;
  const status = section.querySelector<HTMLElement>('[data-status]')!;
  const leaderboard = section.querySelector<HTMLOListElement>('[data-leaderboard]')!;
  const leaderboardStatus = section.querySelector<HTMLElement>('[data-leaderboard-status]')!;
  const swatches = section.querySelector<HTMLElement>('[data-colors]')!;
  const colorName = section.querySelector<HTMLOutputElement>('[data-color-name]')!;
  const startButton = section.querySelector<HTMLButtonElement>('[data-start]')!;
  const canvas = section.querySelector<HTMLCanvasElement>('[data-car]')!;
  let showroom: ReturnType<typeof createCarShowroom> | null = null;
  let tracks: TimeTrialTrackOption[] = [];
  let selectedId: string | null = null;
  let selectedColor: string = playerColorPalette[0];
  let leaderboardRequest = 0;
  let renderGeneration = 0;
  let userSelected = false;
  let savedScrollTop = 0;
  let preparing = false;
  const selectedTrack = () => tracks.find(track => track.id === selectedId) ?? null;
  const lastTrackKey = `racing-last-solo-track-v1:${username.toLocaleLowerCase()}`;
  let lastTrackInMemory: string | null = null;
  function lastRacedId(): string | null {
    try { return localStorage.getItem(lastTrackKey) ?? lastTrackInMemory; } catch { return lastTrackInMemory; }
  }

  function orderedTracks(): TimeTrialTrackOption[] {
    return [...tracks].sort((a, b) => {
      if (sort.value === 'name') return a.name.localeCompare(b.name);
      if (sort.value === 'newest') return (b.createdAt ?? b.updatedAt ?? 0) - (a.createdAt ?? a.updatedAt ?? 0) || a.name.localeCompare(b.name);
      const field = sort.value === 'played' ? 'completedLaps' : 'popularityMs';
      return (b[field] ?? 0) - (a[field] ?? 0) || a.name.localeCompare(b.name);
    });
  }

  function renderCards(): void {
    grid.replaceChildren();
    const matching = orderedTracks().filter(track => track.name.toLocaleLowerCase().includes(search.value.trim().toLocaleLowerCase()));
    if (!matching.length) {
      const empty = document.createElement('p'); empty.className = 'trial-track-empty';
      empty.textContent = tracks.length ? 'No tracks match your search.' : 'No tracks available yet.';
      grid.append(empty); return;
    }
    const generation = ++renderGeneration;
    const previews: { track: TimeTrialTrackOption; image: HTMLCanvasElement }[] = [];
    for (const track of matching) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'trial-track-card';
      button.dataset.trackId = track.id;
      button.setAttribute('aria-pressed', String(track.id === selectedId));
      const image = document.createElement('canvas'); image.width = image.height = 256;
      image.className = 'trial-track-thumbnail'; image.setAttribute('aria-hidden', 'true');
      const details = document.createElement('span'); details.className = 'trial-track-details';
      const title = document.createElement('strong'); title.textContent = track.name;
      const meta = document.createElement('small'); meta.textContent = track.visibility === 'personal'
        ? 'Personal · unranked' : formatPopularity(track.popularityMs ?? 0);
      details.append(title, meta); button.append(image, details);
      button.addEventListener('click', () => { userSelected = true; selectTrack(track.id); }); grid.append(button);
      previews.push({ track, image });
    }
    function drawNext(): void {
      if (generation !== renderGeneration) return;
      const next = previews.shift();
      if (!next) return;
      next.image.getContext('2d')?.drawImage(trackThumbnail(next.track.layout), 0, 0);
      if (previews.length) requestAnimationFrame(drawNext);
    }
    requestAnimationFrame(drawNext);
  }

  function renderLeaderboard(track: TimeTrialTrackOption | null): void {
    const requestId = ++leaderboardRequest;
    leaderboard.replaceChildren();
    if (!track) { leaderboardStatus.textContent = 'Select a track to see lap records.'; return; }
    if (track.visibility !== 'ranked') { leaderboardStatus.textContent = track.visibility === 'personal' ? 'Personal track · unranked.' : 'Local track · unranked.'; return; }
    leaderboardStatus.textContent = 'Loading records…';
    void accountFetch(`/api/leaderboard/${encodeURIComponent(track.id)}`, { cache: 'no-store' })
      .then(async response => {
        if (!response.ok) throw new Error('Leaderboard unavailable.');
        return response.json() as Promise<{ name: string; countryCode?: string | null; durationMs: number }[]>;
      }).then(entries => {
        if (requestId !== leaderboardRequest) return;
        leaderboardStatus.textContent = entries.length ? '' : 'No lap times recorded yet.';
        entries.forEach((entry, index) => {
          const row = document.createElement('li');
          if (entry.name.toLowerCase() === username.toLowerCase()) row.className = 'is-you';
          const place = document.createElement('span'); place.textContent = String(index + 1);
          const driver = document.createElement('span'); driver.className = 'trial-board-driver';
          const flag = countryFlag(entry.countryCode);
          if (flag) { const icon = document.createElement('span'); icon.textContent = flag; icon.setAttribute('aria-label', entry.countryCode!); driver.append(icon); }
          const name = document.createElement('span'); name.textContent = entry.name; driver.append(name);
          const time = document.createElement('strong'); time.textContent = formatLap(entry.durationMs);
          row.append(place, driver, time); leaderboard.append(row);
        });
      }).catch(() => { if (requestId === leaderboardRequest) leaderboardStatus.textContent = 'Leaderboard unavailable.'; });
  }

  function selectTrack(id: string): void {
    selectedId = id;
    const track = selectedTrack();
    trackName.textContent = track?.name ?? 'Choose a track';
    trackPopularity.textContent = track ? track.visibility === 'personal' ? 'Personal track · unranked'
      : `${formatPopularity(track.popularityMs ?? 0)} · ${track.completedLaps ?? 0} completed laps` : '';
    dialogTrackName.textContent = trackName.textContent;
    dialogTrackPopularity.textContent = trackPopularity.textContent;
    selectedThumbnail.getContext('2d')?.clearRect(0, 0, 256, 256);
    if (track) selectedThumbnail.getContext('2d')?.drawImage(trackThumbnail(track.layout), 0, 0);
    useTrackButton.disabled = !track;
    startButton.disabled = !track || preparing;
    for (const card of grid.querySelectorAll<HTMLButtonElement>('.trial-track-card'))
      card.setAttribute('aria-pressed', String(card.dataset.trackId === id));
    renderLeaderboard(track);
  }

  function renderColors(): void {
    swatches.replaceChildren();
    for (const color of playerColorPalette) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'trial-compact-swatch';
      button.style.setProperty('--swatch-color', color);
      button.setAttribute('aria-label', carColorNames.get(color) ?? color);
      button.setAttribute('aria-pressed', String(selectedColor === color));
      button.addEventListener('click', () => setColor(color)); swatches.append(button);
    }
    const random = document.createElement('button'); random.type = 'button';
    random.className = 'trial-compact-swatch trial-shuffle'; random.setAttribute('aria-label', 'Randomize car color'); random.title = 'Randomize';
    random.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m18 14 4 4-4 4"/><path d="m18 2 4 4-4 4"/><path d="M2 18h2.5c2.5 0 4.4-1.4 5.5-3l4-6c1.1-1.6 3-3 5.5-3H22"/><path d="M2 6h2.5c2.5 0 4.4 1.4 5.5 3"/><path d="M14 15c1.1 1.6 3 3 5.5 3H22"/></svg>';
    random.addEventListener('click', () => {
      const alternatives = playerColorPalette.filter(color => color !== selectedColor);
      setColor(alternatives[Math.floor(Math.random() * alternatives.length)]!);
    });
    swatches.append(random);
    colorName.value = carColorNames.get(selectedColor) ?? selectedColor;
  }
  function setColor(color: string): void { selectedColor = color; renderColors(); showroom?.setColor(color); }
  function openTracks(): void {
    if (trackDialog.open) return;
    dialogBoardSlot.append(board);
    trackDialog.showModal();
    requestAnimationFrame(() => { scroll.scrollTop = savedScrollTop; });
  }
  function closeTracks(): void { if (trackDialog.open) trackDialog.close(); }
  function restoreBoard(): void {
    savedScrollTop = scroll.scrollTop;
    browserSide.append(board);
    previewButton.focus({ preventScroll: true });
  }
  search.addEventListener('input', renderCards);
  sort.addEventListener('change', renderCards);
  backButton.addEventListener('click', callbacks.onBack);
  previewButton.addEventListener('click', openTracks);
  section.querySelector<HTMLButtonElement>('[data-close-tracks]')!.addEventListener('click', closeTracks);
  useTrackButton.addEventListener('click', closeTracks);
  trackDialog.addEventListener('close', restoreBoard);
  trackDialog.addEventListener('click', event => { if (event.target === trackDialog) closeTracks(); });
  function onEscape(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || section.hidden || event.defaultPrevented) return;
    if (trackDialog.open) return; // Native dialog Escape closes the picker.
    const target = event.target;
    if (target instanceof HTMLElement && (target.matches('input, select, textarea') || target.isContentEditable)) return;
    if (document.querySelector('dialog[open], [role="dialog"]:not([hidden])')) return;
    event.preventDefault(); callbacks.onBack();
  }
  document.addEventListener('keydown', onEscape);
  startButton.addEventListener('click', () => {
    const track = selectedTrack(); if (!track || preparing || trackDialog.open) return;
    preparing = true; startButton.disabled = true;
    status.textContent = 'Preparing time trial…';
    callbacks.onStart(track, selectedColor);
  });

  return {
    rememberLastRaced(id: string): void {
      lastTrackInMemory = id;
      try { localStorage.setItem(lastTrackKey, id); } catch { /* Selection stays in memory for this session. */ }
    },
    show(): void {
      section.hidden = false; closeTracks(); selectedColor = preferredCarColor(); renderColors();
      userSelected = false; status.textContent = ''; preparing = false; savedScrollTop = 0;
      showroom?.dispose(); showroom = createCarShowroom(canvas, selectedColor);
      search.value = ''; sort.value = 'popular';
      const lastId = lastRacedId();
      selectedId = lastId && tracks.some(track => track.id === lastId) ? lastId : orderedTracks()[0]?.id ?? null;
      renderCards(); selectTrack(selectedId ?? '');
    },
    hide(): void { closeTracks(); section.hidden = true; showroom?.dispose(); showroom = null; renderGeneration++; leaderboardRequest++; },
    setTracks(options: TimeTrialTrackOption[], preferredId?: string): void {
      const previousId = userSelected ? selectedId : preferredId ?? lastRacedId();
      tracks = options;
      selectedId = previousId && tracks.some(track => track.id === previousId) ? previousId : orderedTracks()[0]?.id ?? null;
      renderCards(); selectTrack(selectedId ?? '');
    },
    setStatus(message: string): void {
      status.textContent = message; preparing = message.startsWith('Preparing');
      startButton.disabled = !selectedTrack() || preparing;
    },
    get selection(): { track: TimeTrialTrackOption | null; color: string } { return { track: selectedTrack(), color: selectedColor }; },
    dispose(): void { showroom?.dispose(); renderGeneration++; leaderboardRequest++; document.removeEventListener('keydown', onEscape); section.remove(); },
  };
}
