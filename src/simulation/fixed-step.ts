export const FIXED_TIMESTEP = 1 / 120;
export const MAX_FRAME_DELTA = 0.1;
export const PAUSE_THRESHOLD = 0.25;

/** Pure time accumulator, independent of browser and renderer. */
export class FixedStepClock {
  private accumulator = 0;

  get pendingSeconds(): number { return this.accumulator; }

  reset(): void {
    this.accumulator = 0;
  }

  /** Returns the remaining fraction of a step for rendering interpolation. */
  advance(frameDelta: number, step: (timestep: number) => void): number {
    if (!Number.isFinite(frameDelta) || frameDelta > PAUSE_THRESHOLD) {
      // Ignore a suspended tab/debugger pause instead of catching up seconds of travel.
      this.reset();
      return 0;
    }

    this.accumulator += Math.max(0, Math.min(frameDelta, MAX_FRAME_DELTA));
    while (this.accumulator + 1e-10 >= FIXED_TIMESTEP) {
      step(FIXED_TIMESTEP);
      this.accumulator = Math.max(0, this.accumulator - FIXED_TIMESTEP);
    }
    return this.accumulator / FIXED_TIMESTEP;
  }
}
