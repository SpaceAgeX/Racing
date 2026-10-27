import type { LobbySnapshot, RaceSnapshot } from '../multiplayer/protocol.ts';
import { formatLapTime } from './lap-display.ts';

/** The room's live results come from server-owned lap timers in race snapshots. */
export function createRaceLeaderboard(root: HTMLElement) {
  const body = root.querySelector<HTMLTableSectionElement>('tbody')!;
  let room: LobbySnapshot | null = null;
  let localPlayerId = '';
  let lastRendered = '';
  const results = new Map<string, { laps: number; best: number | null }>();

  function render(): void {
    if (!room) return;
    const rows = room.players.map((player, index) => ({
      ...player,
      index,
      result: results.get(player.id) ?? { laps: 0, best: null },
    })).sort((a, b) => b.result.laps - a.result.laps
      || (a.result.best ?? Infinity) - (b.result.best ?? Infinity) || a.index - b.index);
    const signature = JSON.stringify(rows.map(player => [player.id, player.name, player.color,
      player.result.laps, player.result.best, player.id === localPlayerId]));
    if (signature === lastRendered) return;
    lastRendered = signature;
    body.replaceChildren(...rows.map((player, index) => {
      const row = document.createElement('tr');
      if (player.id === localPlayerId) row.className = 'race-leaderboard-you';
      const rank = document.createElement('td');
      rank.textContent = String(index + 1);
      const name = document.createElement('th');
      name.scope = 'row';
      name.textContent = player.name;
      name.style.setProperty('--player-color', player.color);
      const best = document.createElement('td');
      best.textContent = formatLapTime(player.result.best);
      const laps = document.createElement('td');
      laps.textContent = String(player.result.laps);
      row.append(rank, name, best, laps);
      return row;
    }));
  }

  return {
    setRoom(nextRoom: LobbySnapshot | null, playerId: string): void {
      if (nextRoom?.id !== room?.id) results.clear();
      room = nextRoom;
      localPlayerId = playerId;
      root.hidden = !room;
      if (!room) { body.replaceChildren(); lastRendered = ''; }
      else render();
    },
    updateSnapshot(snapshot: RaceSnapshot): void {
      if (!room || snapshot.roomId !== room.id) return;
      for (const player of snapshot.players) {
        results.set(player.id, { laps: player.lapTimer.completedLaps, best: player.lapTimer.best });
      }
      render();
    },
  };
}
