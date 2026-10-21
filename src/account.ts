import { accountFetch, requireAccount } from './auth/session.ts';
import { startAdmissionHeartbeat } from './admission.ts';
import { usernameError } from './auth/username.ts';

interface Dashboard {
  username: string;
  canPublishRankedTracks: boolean;
  racesStarted: number;
  lapsCompleted: number;
  rankedLaps: number;
  timePlayedSeconds: number;
  distanceMeters: number;
  tracksCreated: number;
  personalBests: { trackName: string; durationMs: number }[];
  recentLaps: { trackName: string; durationMs: number; ranked: boolean; completedAt: string }[];
}

const session = await requireAccount();
startAdmissionHeartbeat();
const response = await accountFetch('/api/account', { cache: 'no-store' });
if (!response.ok) throw new Error('Could not load account statistics.');
const data = await response.json() as Dashboard;

let name = data.username;
const accountName = document.querySelector<HTMLElement>('#account-name')!;
const accountUsername = document.querySelector<HTMLElement>('#account-username')!;
const accountAvatar = document.querySelector<HTMLElement>('#account-avatar')!;
function showUsername(value: string): void {
  name = value;
  accountName.textContent = value;
  accountUsername.textContent = value;
  accountAvatar.textContent = value[0]!.toUpperCase();
}
showUsername(name);
document.querySelector<HTMLElement>('#account-email')!.textContent = session.user.email ?? 'Google account';
document.querySelector<HTMLElement>('#builder-approval')!.textContent = data.canPublishRankedTracks
  ? 'Approved' : 'Not approved';
document.querySelector<HTMLElement>('#builder-access')!.textContent = data.canPublishRankedTracks
  ? 'Approved creator. You can publish ranked multiplayer tracks or save personal tracks.'
  : 'You can build and race personal tracks. Ranked multiplayer publishing requires approval.';
document.querySelector<HTMLButtonElement>('#sign-out')!.addEventListener('click', () => { void session.signOut(); });

const editUsername = document.querySelector<HTMLButtonElement>('#edit-username')!;
const usernameForm = document.querySelector<HTMLFormElement>('#username-form')!;
const usernameInput = document.querySelector<HTMLInputElement>('#new-username')!;
const usernameFeedback = document.querySelector<HTMLElement>('#username-feedback')!;
function closeUsernameForm(): void {
  usernameForm.hidden = true;
  editUsername.setAttribute('aria-expanded', 'false');
}
editUsername.addEventListener('click', () => {
  usernameInput.value = name;
  usernameFeedback.textContent = '';
  usernameForm.hidden = false;
  editUsername.setAttribute('aria-expanded', 'true');
  usernameInput.focus();
  usernameInput.select();
});
document.querySelector<HTMLButtonElement>('#cancel-username')!.addEventListener('click', () => {
  closeUsernameForm();
  usernameFeedback.textContent = '';
});
usernameForm.addEventListener('submit', event => {
  event.preventDefault();
  void (async () => {
    const chosen = usernameInput.value.trim();
    const invalid = usernameError(chosen);
    if (invalid) { usernameFeedback.textContent = invalid; return; }
    const save = usernameForm.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    save.disabled = true;
    usernameFeedback.textContent = 'Saving username...';
    try {
      const response = await accountFetch('/api/account/username', { method: 'PATCH',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: chosen }) });
      const result = await response.json() as { username?: string; error?: string };
      if (!response.ok || !result.username) throw new Error(result.error ?? 'Could not change your username.');
      showUsername(result.username);
      closeUsernameForm();
      usernameFeedback.textContent = 'Username updated.';
    } catch (error) {
      usernameFeedback.textContent = error instanceof Error ? error.message : 'Could not change your username.';
    } finally { save.disabled = false; }
  })();
});

function formatLap(milliseconds: number): string {
  const minutes = Math.floor(milliseconds / 60_000);
  const seconds = ((milliseconds % 60_000) / 1000).toFixed(2).padStart(5, '0');
  return `${minutes}:${seconds}`;
}
const metrics: [string, string][] = [
  ['Laps completed', String(data.lapsCompleted)],
  ['Ranked laps', String(data.rankedLaps)],
  ['Races started', String(data.racesStarted)],
  ['Time on track', `${Math.floor(data.timePlayedSeconds / 3600)}h ${Math.floor((data.timePlayedSeconds % 3600) / 60)}m`],
  ['Distance driven', `${(data.distanceMeters / 1000).toFixed(1)} km`],
  ['Tracks created', String(data.tracksCreated)],
];
const grid = document.querySelector<HTMLElement>('#account-metrics')!;
for (const [label, value] of metrics) {
  const card = document.createElement('div');
  card.className = 'account-metric';
  const title = document.createElement('span');
  title.textContent = label;
  const output = document.createElement('strong');
  output.textContent = value;
  card.append(title, output);
  grid.append(card);
}

const bests = document.querySelector<HTMLElement>('#personal-bests')!;
if (!data.personalBests.length) {
  bests.classList.add('empty-state');
  bests.textContent = 'No ranked laps yet. Set a time with default handling to see your personal bests.';
}
for (const best of data.personalBests) {
  const row = document.createElement('div');
  row.className = 'result-row';
  const track = document.createElement('strong');
  track.textContent = best.trackName;
  const time = document.createElement('span');
  time.textContent = formatLap(best.durationMs);
  row.append(track, time);
  bests.append(row);
}

const recent = document.querySelector<HTMLElement>('#recent-laps')!;
if (!data.recentLaps.length) {
  recent.classList.add('empty-state');
  recent.textContent = 'Your latest completed laps will appear here after you race.';
}
for (const lap of data.recentLaps) {
  const row = document.createElement('div');
  row.className = 'result-row';
  const track = document.createElement('strong');
  track.textContent = lap.trackName;
  const time = document.createElement('span');
  time.textContent = formatLap(lap.durationMs);
  const detail = document.createElement('small');
  detail.className = lap.ranked ? 'ranked' : 'unranked';
  detail.textContent = `${lap.ranked ? 'Ranked' : 'Unranked'} · ${new Date(lap.completedAt).toLocaleDateString()}`;
  row.append(track, time, detail);
  recent.append(row);
}
document.body.dataset.authState = 'ready';
