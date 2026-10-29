import { accountFetch } from '../auth/session.ts';
import type { TrackOption } from '../multiplayer/protocol.ts';
import { countryFlagImageUrl } from './countries.ts';
import { trackThumbnail } from './track-thumbnail.ts';

function formatLap(ms: number): string {
  return `${Math.floor(ms / 60000)}:${((ms % 60000) / 1000).toFixed(3).padStart(6, '0')}`;
}

/** The same track-card browser, search, ranking panel, and dialog styling as Time Trial. */
export function createLobbyTrackPicker(root: HTMLElement, onSelect: (id: string) => void) {
  const dialog = document.createElement('dialog');
  dialog.className = 'trial-track-dialog lobby-track-dialog';
  dialog.setAttribute('aria-label', 'Choose a track');
  dialog.innerHTML = `<div class="trial-dialog-shell">
    <header class="trial-dialog-header"><button class="back-button" data-close type="button">← Back</button>
      <div><span class="menu-eyebrow">MULTIPLAYER</span><h2>Choose your track</h2></div></header>
    <div class="trial-dialog-layout"><section class="trial-browser-main" aria-label="Track browser">
      <div class="trial-browser-controls"><label><span class="sr-only">Search tracks</span><input data-search type="search" placeholder="Search tracks" autocomplete="off"></label>
      <label>Sort <select data-sort aria-label="Sort tracks"><option value="popular">Popular</option><option value="newest">Newest</option><option value="played">Most Played</option><option value="name">Name</option></select></label></div>
      <div class="trial-track-scroll"><div class="trial-track-grid" data-tracks role="group" aria-label="Available tracks"></div></div></section>
      <aside class="trial-dialog-side"><span class="setup-label">SELECTED TRACK</span><h3 data-name>Choose a track</h3><p data-meta></p>
      <div class="trial-board-panel"><span class="setup-label">FASTEST DRIVERS</span><h2>Leaderboard</h2>
        <div class="trial-board-head" aria-hidden="true"><span>#</span><span>Driver</span><span>Best lap</span></div>
        <ol class="trial-board-rows" data-board></ol><p class="trial-board-status" data-board-status role="status"></p></div>
      <button class="trial-start-button" data-use type="button">Use this track <span aria-hidden="true">→</span></button></aside></div></div>`;
  root.append(dialog);
  const search = dialog.querySelector<HTMLInputElement>('[data-search]')!;
  const sort = dialog.querySelector<HTMLSelectElement>('[data-sort]')!;
  const grid = dialog.querySelector<HTMLElement>('[data-tracks]')!;
  const name = dialog.querySelector<HTMLElement>('[data-name]')!;
  const meta = dialog.querySelector<HTMLElement>('[data-meta]')!;
  const board = dialog.querySelector<HTMLOListElement>('[data-board]')!;
  const boardStatus = dialog.querySelector<HTMLElement>('[data-board-status]')!;
  const use = dialog.querySelector<HTMLButtonElement>('[data-use]')!;
  let tracks: TrackOption[] = [];
  let selectedId = '';
  let requestId = 0;
  let renderId = 0;

  function select(id: string): void {
    selectedId = id;
    const track = tracks.find(item => item.id === id);
    name.textContent = track?.name ?? 'Choose a track';
    meta.textContent = track ? `${track.completedLaps ?? 0} completed laps` : '';
    use.disabled = !track;
    for (const card of grid.querySelectorAll<HTMLElement>('.trial-track-card'))
      card.setAttribute('aria-pressed', String(card.dataset.trackId === id));
    const generation = ++requestId;
    board.replaceChildren();
    boardStatus.textContent = track ? 'Loading records…' : 'Select a track to see lap records.';
    if (!track) return;
    void accountFetch(`/api/leaderboard/${encodeURIComponent(track.id)}`, { cache: 'no-store' })
      .then(async response => {
        if (!response.ok) throw new Error('Leaderboard unavailable.');
        return response.json() as Promise<{ name: string; countryCode?: string | null; durationMs: number }[]>;
      }).then(entries => {
        if (generation !== requestId) return;
        boardStatus.textContent = entries.length ? '' : 'No lap times recorded yet.';
        for (let index = 0; index < 10; index++) {
          const entry = entries[index];
          const row = document.createElement('li'); if (!entry) row.className = 'is-empty';
          const place = document.createElement('span'); place.textContent = String(index + 1);
          const driver = document.createElement('span'); driver.className = 'trial-board-driver';
          const flagUrl = entry ? countryFlagImageUrl(entry.countryCode ?? 'US') : '';
          if (flagUrl) { const icon = document.createElement('img'); icon.className = 'trial-board-flag'; icon.src = flagUrl;
            icon.alt = `${entry!.countryCode ?? 'US'} flag`; icon.width = 20; icon.height = 15; driver.append(icon); }
          const label = document.createElement('span'); label.textContent = entry?.name ?? 'No time yet'; driver.append(label);
          const time = document.createElement('strong'); time.textContent = entry ? formatLap(entry.durationMs) : '—';
          row.append(place, driver, time); board.append(row);
        }
      }).catch(() => { if (generation === requestId) boardStatus.textContent = 'Leaderboard unavailable.'; });
  }
  function render(): void {
    const query = search.value.trim().toLocaleLowerCase();
    const ordered = [...tracks].filter(track => track.name.toLocaleLowerCase().includes(query)).sort((a, b) => {
      if (sort.value === 'name') return a.name.localeCompare(b.name);
      if (sort.value === 'newest') return (b.createdAt ?? b.updatedAt ?? 0) - (a.createdAt ?? a.updatedAt ?? 0);
      const field = sort.value === 'played' ? 'completedLaps' : 'popularityMs';
      return (b[field] ?? 0) - (a[field] ?? 0) || a.name.localeCompare(b.name);
    });
    grid.replaceChildren();
    const pending: { track: TrackOption; canvas: HTMLCanvasElement }[] = [];
    for (const track of ordered) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'trial-track-card';
      button.dataset.trackId = track.id; button.setAttribute('aria-pressed', String(track.id === selectedId));
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
      canvas.className = 'trial-track-thumbnail'; canvas.setAttribute('aria-hidden', 'true');
      const details = document.createElement('span'); details.className = 'trial-track-details';
      const title = document.createElement('strong'); title.textContent = track.name;
      const stats = document.createElement('small'); stats.textContent = `${track.completedLaps ?? 0} completed laps`;
      details.append(title, stats); button.append(canvas, details);
      button.addEventListener('click', () => select(track.id)); grid.append(button); pending.push({ track, canvas });
    }
    if (!ordered.length) { const empty = document.createElement('p'); empty.className = 'trial-track-empty';
      empty.textContent = tracks.length ? 'No tracks match your search.' : 'No tracks available yet.'; grid.append(empty); }
    const generation = ++renderId;
    function drawNext(): void {
      if (generation !== renderId) return;
      const item = pending.shift(); if (!item) return;
      item.canvas.getContext('2d')?.drawImage(trackThumbnail(item.track.layout), 0, 0);
      if (pending.length) requestAnimationFrame(drawNext);
    }
    requestAnimationFrame(drawNext);
  }
  search.addEventListener('input', render);
  sort.addEventListener('change', render);
  dialog.querySelector('[data-close]')!.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
  use.addEventListener('click', () => { if (selectedId) { onSelect(selectedId); dialog.close(); } });
  return {
    setTracks(value: TrackOption[]): void { tracks = value; render(); select(selectedId || value[0]?.id || ''); },
    open(currentId: string): void { search.value = ''; sort.value = 'popular'; render(); select(currentId);
      if (!dialog.open) dialog.showModal(); },
    close(): void { if (dialog.open) dialog.close(); },
    dispose(): void { renderId++; requestId++; dialog.remove(); },
  };
}
