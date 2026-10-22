/** Limits actual draws while keeping a steady cadence on high-refresh displays. */
export function createFrameLimiter(maxFramesPerSecond: number) {
  const intervalMs = 1000 / maxFramesPerSecond;
  const recentDraws: number[] = [];
  let nextDrawAt = 0;

  return {
    shouldDraw(now: number): boolean {
      // Allow a little timestamp jitter so 120 Hz displays can draw every other frame.
      if (now + 0.5 < nextDrawAt) return false;

      while (recentDraws.length && recentDraws[0]! <= now - 1000) recentDraws.shift();
      if (recentDraws.length >= maxFramesPerSecond) return false;

      recentDraws.push(now);
      nextDrawAt += intervalMs;
      if (nextDrawAt < now) nextDrawAt = now + intervalMs;
      return true;
    },
    reset(): void {
      recentDraws.length = 0;
      nextDrawAt = 0;
    },
  };
}
