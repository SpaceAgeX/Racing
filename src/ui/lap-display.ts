import type { LapTimerState } from '../simulation/lap-timer.ts';

export function formatLapTime(seconds: number | null): string {
  if (seconds === null) return '--:--.--';
  const total = Math.max(0, Math.floor((seconds + 1e-9) * 100));
  const minutes = Math.floor(total / 6000);
  const wholeSeconds = Math.floor(total / 100) % 60;
  return `${String(minutes).padStart(2, '0')}:${String(wholeSeconds).padStart(2, '0')}.${String(total % 100).padStart(2, '0')}`;
}

export function createLapDisplay(container: HTMLElement, hasFinishLine: boolean) {
  const current = container.querySelector<HTMLOutputElement>('#lap-current')!;
  const best = container.querySelector<HTMLOutputElement>('#lap-best')!;
  const last = container.querySelector<HTMLOutputElement>('#lap-last')!;
  const delta = container.querySelector<HTMLOutputElement>('#lap-delta')!;
  const status = container.querySelector<HTMLElement>('#lap-status')!;

  function text(element: HTMLElement, value: string): void {
    if (element.textContent !== value) element.textContent = value;
  }

  return {
    update(timer: Readonly<LapTimerState>, waitingForRespawn = false, historicalBest: number | null = null): void {
      text(current, formatLapTime(timer.elapsed));
      const personalBest = historicalBest === null ? timer.best : timer.best === null
        ? historicalBest : Math.min(historicalBest, timer.best);
      text(best, formatLapTime(personalBest));
      text(last, formatLapTime(timer.last));
      delta.hidden = timer.last === null;
      const previousSessionBest = timer.last === null || timer.delta === null ? null : timer.last - timer.delta;
      const previousBest = historicalBest === null ? previousSessionBest : previousSessionBest === null
        ? historicalBest : Math.min(historicalBest, previousSessionBest);
      const roundedDelta = timer.last === null || previousBest === null ? null : Math.round((timer.last - previousBest) * 100);
      delta.classList.toggle('is-faster', roundedDelta !== null && roundedDelta < 0);
      delta.classList.toggle('is-slower', roundedDelta !== null && roundedDelta > 0);
      text(delta, roundedDelta === null ? 'First lap' : `${roundedDelta < 0 ? '−' : roundedDelta > 0 ? '+' : '±'}${(Math.abs(roundedDelta) / 100).toFixed(2)} s vs best`);
      text(status, waitingForRespawn ? 'Respawning…' : !hasFinishLine ? 'Place a finish line to time laps'
        : timer.running ? `Lap ${timer.completedLaps + 1}${timer.checkpointCount ? ` | Checkpoints ${timer.checkpointsVisited.length}/${timer.checkpointCount}` : ""}${timer.missedCheckpoints ? " | Cross remaining checkpoints, then finish" : ""}` : 'Cross the line to start');
    },
  };
}
