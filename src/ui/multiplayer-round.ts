import type { RoundResults, RoundSnapshot } from '../multiplayer/protocol.ts';
import { formatLapTime } from './lap-display.ts';

function resultTime(seconds: number | null): string {
  return seconds === null ? 'DNF' : formatLapTime(seconds);
}

export function createMultiplayerRoundUi(viewport: HTMLElement) {
  const banner = document.createElement('div');
  banner.className = 'round-banner';
  banner.hidden = true;
  const bannerTitle = document.createElement('strong');
  const bannerSubtitle = document.createElement('span');
  banner.append(bannerTitle, bannerSubtitle);
  viewport.append(banner);
  const overlay = document.createElement('section');
  overlay.className = 'round-results-overlay';
  overlay.hidden = true;
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Race results');
  overlay.innerHTML = `<div class="round-results-card">
    <header><h2>Race results</h2><button id="round-results-close" type="button" aria-label="Close results">&times;</button></header>
    <div class="round-results-content"><table><thead><tr><th>Place</th><th>Driver</th><th>Time</th><th>Laps</th><th>Falls</th></tr></thead>
      <tbody id="round-results-rows"></tbody></table></div>
  </div>`;
  document.body.append(overlay);
  let previousFocus: HTMLElement | null = null;
  const close = () => {
    overlay.hidden = true;
    previousFocus?.focus({ preventScroll: true });
    previousFocus = null;
  };
  overlay.querySelector('#round-results-close')!.addEventListener('click', close);
  overlay.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });
  let round: RoundSnapshot | null = null;
  let localPlayerId = '';
  let localCountdownEnd: number | null = null;
  let countdownKey = '';

  function setRound(next: RoundSnapshot | null, playerId: string): void {
    round = next;
    localPlayerId = playerId;
    banner.classList.toggle('round-banner-racing', next !== null && next.stage !== 'countdown');
    if (!next) { banner.hidden = true; return; }
    banner.hidden = false;
    const key = `${next.id}:${next.countdownEndsAtMs}`;
    if (next.stage === 'countdown' && key !== countdownKey && next.countdownEndsAtMs !== null) {
      localCountdownEnd = performance.now() + Math.max(0, next.countdownEndsAtMs - next.serverNowMs - 40);
      countdownKey = key;
    }
    update();
  }

  function update(): void {
    if (!round) return;
    if (round.stage === 'countdown' && localCountdownEnd !== null && performance.now() >= localCountdownEnd) {
      banner.hidden = true;
      return;
    }
    banner.hidden = false;
    const local = round.players.find(player => player.id === localPlayerId);
    let title: string;
    let subtitle: string;
    if (round.stage === 'loading') {
      title = 'Preparing race';
      subtitle = 'Waiting for all drivers to load';
    } else if (round.stage === 'countdown') {
      const remaining = Math.max(1, Math.ceil(((localCountdownEnd ?? performance.now()) - performance.now()) / 1000));
      title = String(remaining);
      subtitle = round.countdownTarget === 'qualifying' ? 'Qualifying begins'
        : `Race begins · ${round.options.laps} laps`;
    } else if (round.stage === 'qualifying') {
      title = 'Qualifying lap';
      subtitle = local?.status === 'qualified' ? `Qualified in ${formatLapTime(local.qualifyingSeconds)}`
        : local?.status === 'qualifying-fall' ? 'Fell off · waiting for other drivers'
          : 'Complete one lap to set your grid position';
    } else {
      title = local?.status === 'eliminated' ? 'Eliminated' : local?.status === 'finished'
        ? 'Finished' : `Race ${round.options.laps} Laps`;
      subtitle = local?.status === 'racing'
        ? `Lap ${Math.min(round.options.laps, (local.laps ?? 0) + 1)} of ${round.options.laps}`
        : local?.status === 'finished' ? 'Waiting for the other drivers'
          : local?.status === 'eliminated' ? 'Spectating the race' : '';
    }
    if (bannerTitle.textContent !== title) bannerTitle.textContent = title;
    if (bannerSubtitle.textContent !== subtitle) bannerSubtitle.textContent = subtitle;
  }

  function showResults(results: RoundResults): void {
    round = null;
    banner.hidden = true;
    previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    overlay.hidden = false;
    overlay.querySelector<HTMLButtonElement>('#round-results-close')!.focus({ preventScroll: true });
    const rows = overlay.querySelector<HTMLElement>('#round-results-rows')!;
    rows.replaceChildren();
    for (const [index, player] of results.players.entries()) {
      const row = document.createElement('tr');
      row.className = `round-results-player${player.id === localPlayerId ? ' round-results-you' : ''}`;
      for (const text of [String(player.place), resultTime(player.finishSeconds),
        String(player.laps), String(player.falls)]) {
        const cell = document.createElement('td');
        cell.textContent = text;
        row.append(cell);
      }
      const nameCell = document.createElement('td');
      nameCell.style.setProperty('--player-color', player.color);
      const nameButton = document.createElement('button');
      nameButton.type = 'button';
      nameButton.className = 'round-results-player-name';
      nameButton.textContent = player.name;
      nameButton.setAttribute('aria-label', `Show ${player.name}'s lap splits`);
      nameButton.setAttribute('aria-expanded', 'false');
      nameCell.append(nameButton);
      row.insertBefore(nameCell, row.children[1]!);

      const splitsRow = document.createElement('tr');
      splitsRow.className = 'round-results-splits';
      splitsRow.id = `round-results-splits-${index}`;
      nameButton.setAttribute('aria-controls', splitsRow.id);
      const splitsCell = document.createElement('td');
      splitsCell.colSpan = 5;
      const splits = document.createElement('div');
      splits.className = 'round-results-split-list';
      if (player.lapTimes.length) {
        player.lapTimes.forEach((seconds, index) => {
          const split = document.createElement('span');
          split.textContent = `Lap ${index + 1}: ${formatLapTime(seconds)}`;
          splits.append(split);
        });
      } else {
        splits.textContent = 'No completed laps';
      }
      splitsCell.append(splits);
      splitsRow.append(splitsCell);
      nameButton.addEventListener('click', () => {
        const expanded = row.classList.toggle('is-expanded');
        nameButton.setAttribute('aria-expanded', String(expanded));
      });
      rows.append(row, splitsRow);
    }
  }

  return { setRound, update, showResults, hideResults: close,
    dispose(): void { banner.remove(); overlay.remove(); } };
}
