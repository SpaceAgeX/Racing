import type { LobbySnapshot, RaceSnapshot, RoundSnapshot } from '../multiplayer/protocol.ts';
import { formatLapTime } from './lap-display.ts';

/** The displayed order and lap data are supplied by the authoritative round. */
export function createRaceLeaderboard(root: HTMLElement) {
  const title = root.querySelector<HTMLElement>('h2')!;
  const body = root.querySelector<HTMLTableSectionElement>('tbody')!;
  let roomId: string | null = null;
  let round: RoundSnapshot | null = null;
  let localPlayerId = '';
  let lastRendered = '';

  function render(): void {
    root.hidden = !round;
    if (!round) { body.replaceChildren(); lastRendered = ''; return; }
    title.textContent = round.stage === 'qualifying' ? 'Qualifying' : round.stage === 'countdown'
      ? 'Starting grid' : `Race · ${round.options.laps} laps`;
    const signature = JSON.stringify([round.stage, round.players, localPlayerId]);
    if (signature === lastRendered) return;
    lastRendered = signature;
    body.replaceChildren(...round.players.map((player, index) => {
      const row = document.createElement('tr');
      if (player.id === localPlayerId) row.className = 'race-leaderboard-you';
      const rank = document.createElement('td');
      rank.textContent = String(round!.stage === 'countdown' ? player.gridPosition : index + 1);
      const name = document.createElement('th');
      name.scope = 'row';
      name.textContent = player.name;
      name.style.setProperty('--player-color', player.color);
      const last = document.createElement('td');
      last.textContent = round!.stage === 'qualifying'
        ? player.qualifyingSeconds !== null ? formatLapTime(player.qualifyingSeconds)
          : player.qualifyingSurvivalSeconds !== null ? `Fell ${formatLapTime(player.qualifyingSurvivalSeconds)}` : '—'
        : formatLapTime(player.lastSeconds);
      const best = document.createElement('td');
      best.textContent = formatLapTime(player.bestSeconds);
      const laps = document.createElement('td');
      laps.textContent = player.status === 'eliminated' ? 'OUT'
        : player.status === 'finished' ? 'FIN' : String(player.laps);
      row.append(rank, name, last, best, laps);
      return row;
    }));
  }

  return {
    setRoom(room: LobbySnapshot | null, playerId: string): void {
      roomId = room?.id ?? null;
      localPlayerId = playerId;
      round = room?.round ?? null;
      render();
    },
    updateSnapshot(snapshot: RaceSnapshot): void {
      if (snapshot.roomId !== roomId || !snapshot.round) return;
      round = snapshot.round;
      render();
    },
  };
}
