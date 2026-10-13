/** Heartbeat also covers solo races and the map builder, which have no multiplayer socket. */
export function startAdmissionHeartbeat(): void {
  let running = false;
  async function heartbeat(): Promise<void> {
    if (running) return;
    running = true;
    try {
      const response = await fetch('/api/session/heartbeat', { method: 'POST', signal: AbortSignal.timeout(5000) });
      if (response.status === 401 || response.status === 503) {
        // Reload discards any old simulation and goes through the server's admission gate.
        location.reload();
      }
    } catch { /* Retry on the next heartbeat after a temporary network interruption. */ }
    finally { running = false; }
  }
  window.setInterval(() => { void heartbeat(); }, 15_000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void heartbeat(); });
}
