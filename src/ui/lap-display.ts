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
    update(timer: Readonly<LapTimerState>, waitingForRespawn = false, verifiedBest?: number | null): void {
      text(current, formatLapTime(timer.elapsed));
      text(best, formatLapTime(verifiedBest === undefined ? timer.best : verifiedBest));
      text(last, formatLapTime(timer.last));
      delta.hidden = timer.last === null;
      const roundedDelta = timer.delta === null ? null : Math.round(timer.delta * 100);
      delta.classList.toggle('is-faster', roundedDelta !== null && roundedDelta < 0);
      delta.classList.toggle('is-slower', roundedDelta !== null && roundedDelta > 0);
      text(delta, roundedDelta === null ? verifiedBest === undefined ? 'First lap' : 'First lap this session'
        : `${roundedDelta < 0 ? '−' : roundedDelta > 0 ? '+' : '±'}${(Math.abs(roundedDelta) / 100).toFixed(2)} s vs ${verifiedBest === undefined ? 'best' : 'session best'}`);
      text(status, waitingForRespawn ? 'Respawning…' : !hasFinishLine ? 'Place a finish line to time laps'
        : timer.running ? `Lap ${timer.completedLaps + 1}${timer.checkpointCount ? ` | Checkpoints ${timer.checkpointsVisited.length}/${timer.checkpointCount}` : ""}${timer.missedCheckpoints ? " | Cross remaining checkpoints, then finish" : ""}` : 'Cross the line to start');
    },
  };
}
