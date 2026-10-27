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
    <header><div><span class="menu-eyebrow">RACE COMPLETE</span><h2>Final results</h2>
      <p id="round-results-subtitle"></p></div><button id="round-results-close" type="button" aria-label="Close results">&times;</button></header>
    <div class="round-results-content"><table><thead><tr><th>Place</th><th>Driver</th><th>Time</th><th>Laps</th><th>Falls</th></tr></thead>
      <tbody id="round-results-rows"></tbody></table>
      <h3>Distance over time</h3><div id="round-results-chart" class="round-results-chart"></div>
      <h3>Driver details</h3><div id="round-results-details"></div></div>
    <footer><button id="round-results-done" type="button">Return to lobby</button></footer>
  </div>`;
  document.body.append(overlay);
  const close = () => { overlay.hidden = true; };
  overlay.querySelector('#round-results-close')!.addEventListener('click', close);
  overlay.querySelector('#round-results-done')!.addEventListener('click', close);
  let round: RoundSnapshot | null = null;
  let localPlayerId = '';
  let localCountdownEnd: number | null = null;
  let countdownKey = '';

  function setRound(next: RoundSnapshot | null, playerId: string): void {
    round = next;
    localPlayerId = playerId;
    banner.classList.toggle('round-banner-racing', next?.stage === 'race');
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
    overlay.hidden = false;
    overlay.querySelector('#round-results-subtitle')!.textContent =
      `${results.trackName} · ${results.options.laps} laps · ${results.options.fallMode}
        · ${results.options.qualifying ? 'qualifying' : 'no qualifying'}`;
    const rows = overlay.querySelector<HTMLElement>('#round-results-rows')!;
    rows.replaceChildren();
    for (const player of results.players) {
      const row = document.createElement('tr');
      if (player.id === localPlayerId) row.className = 'round-results-you';
      for (const text of [String(player.place), player.name, resultTime(player.finishSeconds),
        String(player.laps), String(player.falls)]) {
        const cell = document.createElement('td');
        cell.textContent = text;
        row.append(cell);
      }
      row.children[1]?.setAttribute('style', `--player-color: ${player.color}`);
      rows.append(row);
    }
    const chart = overlay.querySelector<HTMLElement>('#round-results-chart')!;
    chart.replaceChildren();
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 720 230');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Each driver’s distance traveled over race time');
    const maxTime = Math.max(1, results.durationSeconds);
    const maxDistance = Math.max(1, ...results.players.map(player => player.distanceMeters));
    for (const player of results.players) {
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
      const samples = [{ seconds: 0, distanceMeters: 0 }, ...player.samples];
      line.setAttribute('points', samples.map(sample => `${35 + sample.seconds / maxTime * 665},${205 - sample.distanceMeters / maxDistance * 180}`).join(' '));
      line.setAttribute('fill', 'none');
      line.setAttribute('stroke', player.color);
      line.setAttribute('stroke-width', player.id === localPlayerId ? '4' : '2.5');
      line.setAttribute('stroke-linejoin', 'round');
      svg.append(line);
    }
    chart.append(svg);
    const legend = document.createElement('div');
    legend.className = 'round-chart-legend';
    for (const player of results.players) {
      const item = document.createElement('span');
      item.style.setProperty('--player-color', player.color);
      item.textContent = player.name;
      legend.append(item);
    }
    chart.append(legend);
    const details = overlay.querySelector<HTMLElement>('#round-results-details')!;
    details.replaceChildren();
    for (const player of results.players) {
      const section = document.createElement('details');
      const summary = document.createElement('summary');
      summary.textContent = `${player.place}. ${player.name} · ${player.status === 'finished' ? resultTime(player.finishSeconds) : player.status}`;
      const body = document.createElement('p');
      body.textContent = `Distance ${Math.round(player.distanceMeters)} m · Falls ${player.falls}
        · Qualifying ${player.qualifyingSeconds !== null ? formatLapTime(player.qualifyingSeconds)
          : player.qualifyingSurvivalSeconds !== null ? `fell after ${formatLapTime(player.qualifyingSurvivalSeconds)}` : 'off'}
        · Laps ${player.lapTimes.length ? player.lapTimes.map((time, index) => `#${index + 1} ${formatLapTime(time)}`).join(', ') : 'none'}`;
      section.append(summary, body);
      details.append(section);
    }
  }

  return { setRound, update, showResults, hideResults: close,
    dispose(): void { banner.remove(); overlay.remove(); } };
}
