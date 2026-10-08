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
    update(timer: Readonly<LapTimerState>): void {
      text(current, formatLapTime(timer.elapsed));
      text(best, formatLapTime(timer.best));
      text(last, formatLapTime(timer.last));
      delta.hidden = timer.last === null;
      const roundedDelta = timer.delta === null ? 0 : Math.round(timer.delta * 100);
      delta.classList.toggle('is-faster', timer.delta !== null && roundedDelta < 0);
      delta.classList.toggle('is-slower', timer.delta !== null && roundedDelta > 0);
      text(delta, timer.delta === null ? 'First lap' : `${roundedDelta < 0 ? '−' : roundedDelta > 0 ? '+' : '±'}${(Math.abs(roundedDelta) / 100).toFixed(2)} s vs best`);
      text(status, !hasFinishLine ? 'Add a start/finish tile to time laps'
        : timer.running ? `Lap ${timer.completedLaps + 1}` : 'Cross the line to start');
    },
  };
}
