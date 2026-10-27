import type { LobbySnapshot, RaceSnapshot, RoundSnapshot } from '../multiplayer/protocol.ts';
import type { RacePlayer } from '../simulation/race.ts';
import { formatLapTime } from './lap-display.ts';

/** All multiplayer lap standings come from server snapshots. */
export function createRaceLeaderboard(root: HTMLElement) {
  const title = root.querySelector<HTMLElement>('h2')!;
  const body = root.querySelector<HTMLTableSectionElement>('tbody')!;
  let roomId: string | null = null;
  let openDrive = false;
  let round: RoundSnapshot | null = null;
  let freeDrivePlayers: RacePlayer[] = [];
  let playerDetails = new Map<string, { name: string; color: string }>();
  let localPlayerId = '';
  let lastRendered = '';

  function render(): void {
    root.hidden = !round && !openDrive;
    if (root.hidden) { body.replaceChildren(); lastRendered = ''; return; }
    title.textContent = round?.stage === 'qualifying' ? 'Qualifying'
      : round?.stage === 'countdown' ? 'Starting grid'
        : round ? `Race · ${round.options.laps} laps` : 'Free drive · fastest laps';
    const currentRound = round;
    const rows = currentRound ? currentRound.players.map((player, index) => ({
      id: player.id, name: player.name, color: player.color,
      rank: currentRound.stage === 'countdown' ? player.gridPosition : index + 1,
      last: currentRound.stage === 'qualifying'
        ? player.qualifyingSeconds !== null ? formatLapTime(player.qualifyingSeconds)
          : player.qualifyingSurvivalSeconds !== null ? `Fell ${formatLapTime(player.qualifyingSurvivalSeconds)}` : '—'
        : formatLapTime(player.lastSeconds),
      best: formatLapTime(player.bestSeconds),
      laps: player.status === 'eliminated' ? 'OUT'
        : player.status === 'finished' ? 'FIN' : String(player.laps),
    })) : freeDrivePlayers
      .filter(player => playerDetails.has(player.id))
      .sort((a, b) => (a.lapTimer.best ?? Infinity) - (b.lapTimer.best ?? Infinity)
        || playerDetails.get(a.id)!.name.localeCompare(playerDetails.get(b.id)!.name))
      .map((player, index) => ({
        id: player.id, name: playerDetails.get(player.id)!.name,
        color: playerDetails.get(player.id)!.color, rank: index + 1,
        last: formatLapTime(player.lapTimer.last),
        best: formatLapTime(player.lapTimer.best),
        laps: String(player.lapTimer.completedLaps),
      }));
    const signature = JSON.stringify([title.textContent, rows, localPlayerId]);
    if (signature === lastRendered) return;
    lastRendered = signature;
    body.replaceChildren(...rows.map(player => {
      const row = document.createElement('tr');
      if (player.id === localPlayerId) row.className = 'race-leaderboard-you';
      const rank = document.createElement('td');
      rank.textContent = String(player.rank);
      const name = document.createElement('th');
      name.scope = 'row';
      name.textContent = player.name;
      name.style.setProperty('--player-color', player.color);
      const last = document.createElement('td');
      last.textContent = player.last;
      const best = document.createElement('td');
      best.textContent = player.best;
      const laps = document.createElement('td');
      laps.textContent = player.laps;
      row.append(rank, name, last, best, laps);
      return row;
    }));
  }

  return {
    setRoom(room: LobbySnapshot | null, playerId: string): void {
      const newOpenDrive = room?.phase === 'lobby' && room.trackOpen;
      if (room?.id !== roomId || newOpenDrive !== openDrive) freeDrivePlayers = [];
      roomId = room?.id ?? null;
      localPlayerId = playerId;
      openDrive = newOpenDrive;
      playerDetails = new Map(room?.players.map(player => [player.id,
        { name: player.name, color: player.color }]) ?? []);
      round = room?.round ?? null;
      render();
    },
    updateSnapshot(snapshot: RaceSnapshot): void {
      if (snapshot.roomId !== roomId) return;
      if (snapshot.round) round = snapshot.round;
      else if (openDrive) freeDrivePlayers = snapshot.players;
      render();
    },
  };
}
