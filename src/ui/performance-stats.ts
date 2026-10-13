const FPS_WINDOW_MS = 1000;
const PING_INTERVAL_MS = 1000;

export function createPerformanceStats(element: HTMLElement) {
  let active = false;
  let fpsWindowStartedAt = 0;
  let framesInWindow = 0;
  let pingTimer = 0;
  let requestInFlight = false;
  let latestPingMs: number | null = null;
  let latestFps = 0;
  let latestFrameMs: number | null = null;
  let pingFailures = 0;

  const fpsOutput = element.querySelector<HTMLOutputElement>('[data-fps]');
  const pingOutput = element.querySelector<HTMLOutputElement>('[data-ping]');
  if (!fpsOutput || !pingOutput) throw new Error('Performance stats outputs are missing.');

  async function measurePing(): Promise<void> {
    if (!active || requestInFlight) return;
    requestInFlight = true;
    const startedAt = performance.now();
    try {
      const response = await fetch(`/api/ping?time=${Date.now()}`, {
        cache: 'no-store',
        signal: AbortSignal.timeout(1500),
      });
      if (!response.ok) throw new Error('Ping failed');
      await response.json();
      latestPingMs = performance.now() - startedAt;
      if (active) pingOutput!.value = `${Math.round(latestPingMs)} ms`;
    } catch {
      latestPingMs = null;
      pingFailures++;
      if (active) pingOutput!.value = '—';
    } finally {
      requestInFlight = false;
    }
  }

  function stop(): void {
    active = false;
    window.clearInterval(pingTimer);
    pingTimer = 0;
  }

  return {
    setActive(value: boolean): void {
      if (active === value) return;
      stop();
      if (!value) return;
      active = true;
      fpsWindowStartedAt = performance.now();
      framesInWindow = 0;
      latestFps = 0;
      latestFrameMs = null;
      fpsOutput.value = '0';
      pingOutput.value = 'Checking…';
      void measurePing();
      pingTimer = window.setInterval(() => { void measurePing(); }, PING_INTERVAL_MS);
    },
    rendered(time: number): void {
      if (!active) return;
      framesInWindow++;
      const elapsed = time - fpsWindowStartedAt;
      if (elapsed < FPS_WINDOW_MS) return;

      // Publish the completed interval's exact frame count while the next window begins.
      latestFps = framesInWindow;
      latestFrameMs = framesInWindow > 0 ? elapsed / framesInWindow : null;
      fpsOutput.value = String(framesInWindow);
      framesInWindow = 0;
      fpsWindowStartedAt = time;
    },
    get diagnostics() {
      return { fps: latestFps, averageFrameIntervalMs: latestFrameMs, httpPingMs: latestPingMs, pingFailures,
        fpsWindowMs: FPS_WINDOW_MS, pingIntervalMs: PING_INTERVAL_MS, framesInCurrentWindow: framesInWindow };
    },
    dispose(): void { stop(); },
  };
}
