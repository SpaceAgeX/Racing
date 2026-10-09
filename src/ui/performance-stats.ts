export function createPerformanceStats(element: HTMLElement) {
  let active = false;
  let renderedFrames: number[] = [];
  let lastFpsUpdate = 0;
  let pingTimer = 0;
  let requestInFlight = false;

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
      if (active) element.querySelector<HTMLOutputElement>('[data-ping]')!.value = `${Math.round(performance.now() - startedAt)} ms`;
    } catch {
      if (active) element.querySelector<HTMLOutputElement>('[data-ping]')!.value = '—';
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
      renderedFrames = [];
      lastFpsUpdate = 0;
      element.querySelector<HTMLOutputElement>('[data-fps]')!.value = '—';
      element.querySelector<HTMLOutputElement>('[data-ping]')!.value = '…';
      void measurePing();
      pingTimer = window.setInterval(() => { void measurePing(); }, 2000);
    },
    rendered(time: number): void {
      if (!active) return;
      renderedFrames.push(time);
      const windowStart = time - 1000;
      while (renderedFrames.length > 1 && renderedFrames[1]! < windowStart) renderedFrames.shift();
      if (time - lastFpsUpdate < 250 || renderedFrames.length < 2) return;
      lastFpsUpdate = time;
      const elapsed = renderedFrames.at(-1)! - renderedFrames[0]!;
      const fps = (renderedFrames.length - 1) * 1000 / elapsed;
      element.querySelector<HTMLOutputElement>('[data-fps]')!.value = `${fps.toFixed(1)} fps · ${(1000 / fps).toFixed(1)} ms`;
    },
    dispose(): void { stop(); },
  };
}
