import { trackLayout } from './track/layout.ts';
import type { TrackTile } from './track/layout.ts';
import { cloneTrack, emptyTrack, MAP_SIZE, paintTrack, paintTrackStroke, trackSummary } from './track/model.ts';
import { trackPresets } from './track/presets.ts';
import { clearActiveTrack, listBrowserTracks, loadActiveTrack, selectTrackForPlay } from './track/storage.ts';
import { deleteSharedTrack, getSharedTrack, listSharedTracks, saveSharedTrack } from './track/api.ts';
import type { SavedTrack } from './track/records.ts';

const canvas = document.querySelector<HTMLCanvasElement>('#map-canvas')!;
const canvasArea = canvas.parentElement!;
const context = canvas.getContext('2d')!;
const name = document.querySelector<HTMLInputElement>('#track-name')!;
const library = document.querySelector<HTMLSelectElement>('#track-library')!;
const summary = document.querySelector<HTMLOutputElement>('#map-summary')!;
const coordinates = document.querySelector<HTMLOutputElement>('#cell-position')!;
const message = document.querySelector<HTMLElement>('#builder-message')!;
const save = document.querySelector<HTMLButtonElement>('#save-track')!;
const play = document.querySelector<HTMLButtonElement>('#play-track')!;
const remove = document.querySelector<HTMLButtonElement>('#delete-track')!;
const load = document.querySelector<HTMLButtonElement>('#load-track')!;
const newTrack = document.querySelector<HTMLButtonElement>('#new-track')!;
const browserTracks = listBrowserTracks(localStorage);
let sharedTracks: SavedTrack[] = [];
let busy = false;
let libraryRequest = 0;
let librarySelectionChanged = false;
let libraryReadPending = false;
const active = loadActiveTrack(localStorage);
let layout = cloneTrack(active?.layout ?? trackLayout);
name.value = active?.name ?? 'Default circuit';
let selectedId = active?.id ?? 'preset:default';
if (browserTracks.some((record) => record.id === selectedId)) selectedId = `browser:${selectedId}`;
let tool: TrackTile = 1;
let dragging = false;
let lastCell: { row: number; column: number } | null = null;

function feedback(text: string, error = false): void {
  message.textContent = text;
  message.classList.toggle('error', error);
}

function updateSummary(): void {
  const info = trackSummary(layout);
  summary.value = `${info.tileCount} tiles · Start / finish: ${info.startCount}/1`;
  save.disabled = busy || !info.playable || !name.value.trim();
  play.disabled = busy || !info.playable;
}

function updateDeleteButton(): void {
  remove.disabled = busy || !sharedTracks.some((record) => record.id === library.value);
}

function setBusy(value: boolean): void {
  busy = value;
  if (value) libraryRequest++; // Discard library reads started before this operation.
  for (const element of [name, library, load, newTrack, ...document.querySelectorAll<HTMLButtonElement>('[data-tool]')]) element.disabled = value;
  canvas.setAttribute('aria-busy', String(value));
  updateSummary();
  updateDeleteButton();
}

function draw(): void {
  const size = canvas.width;
  const cell = size / MAP_SIZE;
  context.fillStyle = '#101a21';
  context.fillRect(0, 0, size, size);
  for (let row = 0; row < MAP_SIZE; row++) for (let column = 0; column < MAP_SIZE; column++) {
    const value = layout[row]![column];
    if (value === 0) continue;
    context.fillStyle = value === 2 ? '#ee7136' : '#84939c';
    context.fillRect(column * cell, row * cell, cell, cell);
    if (value === 2) {
      context.fillStyle = '#fff';
      context.fillRect(column * cell + cell * .2, row * cell + cell * .43, cell * .6, cell * .14);
    }
  }
  context.strokeStyle = '#ffffff10';
  context.lineWidth = 1;
  context.beginPath();
  for (let index = 0; index <= MAP_SIZE; index++) {
    const at = index * cell;
    context.moveTo(at, 0); context.lineTo(at, size);
    context.moveTo(0, at); context.lineTo(size, at);
  }
  context.stroke();
  updateSummary();
}

function resize(): void {
  const bounds = canvasArea.getBoundingClientRect();
  const size = Math.max(1, Math.floor(Math.min(bounds.width, bounds.height)));
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;
  canvas.width = Math.max(64, Math.round(size * Math.min(devicePixelRatio, 2)));
  canvas.height = canvas.width;
  draw();
}
new ResizeObserver(resize).observe(canvasArea);

function cellAt(event: PointerEvent) {
  const bounds = canvas.getBoundingClientRect();
  const column = Math.floor((event.clientX - bounds.left) / bounds.width * MAP_SIZE);
  const row = Math.floor((event.clientY - bounds.top) / bounds.height * MAP_SIZE);
  return row >= 0 && column >= 0 && row < MAP_SIZE && column < MAP_SIZE ? { row, column } : null;
}

canvas.addEventListener('pointerdown', (event) => {
  if (busy || event.button !== 0) return;
  const cell = cellAt(event);
  if (!cell) return;
  event.preventDefault();
  canvas.setPointerCapture(event.pointerId);
  dragging = true;
  lastCell = cell;
  paintTrack(layout, cell.row, cell.column, tool);
  feedback('Unsaved changes.');
  draw();
});
canvas.addEventListener('pointermove', (event) => {
  const cell = cellAt(event);
  coordinates.value = cell ? `Row ${cell.row + 1} · Column ${cell.column + 1}` : 'Click and drag to paint';
  if (busy || !dragging || !cell || tool === 2) return;
  paintTrackStroke(layout, lastCell ?? cell, cell, tool);
  lastCell = cell;
  draw();
});
for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(event, () => { dragging = false; lastCell = null; });

for (const button of document.querySelectorAll<HTMLButtonElement>('[data-tool]')) {
  button.addEventListener('click', () => {
    tool = Number(button.dataset.tool) as TrackTile;
    for (const other of document.querySelectorAll<HTMLButtonElement>('[data-tool]')) other.setAttribute('aria-pressed', String(other === button));
  });
}
name.addEventListener('input', updateSummary);

function updateLibrary(selectValue = selectedId): void {
  library.replaceChildren();
  const presets = document.createElement('optgroup'); presets.label = 'Presets';
  for (const preset of trackPresets) presets.append(new Option(preset.name, `preset:${preset.id}`));
  const saved = document.createElement('optgroup'); saved.label = 'Shared tracks';
  for (const record of sharedTracks) saved.append(new Option(record.name, record.id));
  library.append(presets, saved);
  if (browserTracks.length) {
    const old = document.createElement('optgroup'); old.label = 'Older browser tracks — save to share';
    for (const record of browserTracks) old.append(new Option(record.name, `browser:${record.id}`));
    library.append(old);
  }
  library.value = selectValue;
  if (!library.value) library.value = 'preset:default';
  updateDeleteButton();
}
library.addEventListener('change', () => { librarySelectionChanged = true; updateDeleteButton(); });

async function refreshSharedTracks(showErrors = false): Promise<void> {
  if (busy || libraryReadPending) return;
  libraryReadPending = true;
  const revision = ++libraryRequest;
  try {
    const records = await listSharedTracks();
    if (revision !== libraryRequest || busy) return;
    sharedTracks = records;
    updateLibrary(librarySelectionChanged ? library.value || selectedId : selectedId);
  } catch (error) {
    if (showErrors && revision === libraryRequest && !busy) feedback(error instanceof Error ? error.message : 'Could not load shared tracks.', true);
  }
  finally { libraryReadPending = false; }
}

load.addEventListener('click', async () => {
  if (busy) return;
  const id = library.value;
  const preset = trackPresets.find((entry) => `preset:${entry.id}` === id);
  const old = browserTracks.find((entry) => `browser:${entry.id}` === id);
  setBusy(true);
  try {
    const saved = preset || old ? old : await getSharedTrack(id);
    layout = preset ? preset.create() : cloneTrack(saved!.layout);
    name.value = preset?.name ?? saved!.name;
    selectedId = id;
    feedback(old ? `Loaded ${name.value}. Save track to share it with everyone.` : `Loaded ${name.value}.`);
    draw();
  } catch (error) { feedback(error instanceof Error ? error.message : 'Could not load this track.', true); }
  finally { setBusy(false); void refreshSharedTracks(); }
});

newTrack.addEventListener('click', () => {
  layout = emptyTrack();
  name.value = 'New track';
  selectedId = 'draft';
  feedback('Place a start/finish tile and paint your track.');
  draw();
});
save.addEventListener('click', async () => {
  if (busy) return;
  setBusy(true);
  feedback('Saving to the shared library…');
  try {
    const record = await saveSharedTrack(name.value, layout);
    sharedTracks = [...sharedTracks.filter((entry) => entry.id !== record.id), record];
    selectedId = record.id;
    name.value = record.name;
    updateLibrary();
    feedback(`Saved ${record.name}. Everyone on this server can play it.`);
  } catch (error) { feedback(error instanceof Error ? error.message : 'Could not save this track.', true); }
  finally { setBusy(false); void refreshSharedTracks(); }
});
remove.addEventListener('click', async () => {
  if (busy) return;
  const record = sharedTracks.find((entry) => entry.id === library.value);
  if (!record) return;
  setBusy(true);
  try {
    await deleteSharedTrack(record.id);
    sharedTracks = sharedTracks.filter((entry) => entry.id !== record.id);
    clearActiveTrack(localStorage, record.id);
    selectedId = 'draft';
    updateLibrary();
    feedback(`Deleted ${record.name} from the shared library. The current drawing is still available.`);
  } catch (error) { feedback(error instanceof Error ? error.message : 'Could not delete this track.', true); }
  finally { setBusy(false); void refreshSharedTracks(); }
});
play.addEventListener('click', () => {
  try {
    selectTrackForPlay(localStorage, name.value, layout, selectedId);
    location.href = '/';
  } catch (error) { feedback(error instanceof Error ? error.message : 'Could not load this track.', true); }
});

updateLibrary();
resize();
void refreshSharedTracks(true);
window.addEventListener('focus', () => { void refreshSharedTracks(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) void refreshSharedTracks(); });
// Pick up saves and deletions made by other browsers without reloading the drawing.
setInterval(() => { if (!document.hidden) void refreshSharedTracks(); }, 5000);
