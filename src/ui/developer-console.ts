export interface DeveloperConsoleOptions {
  readClientData(): unknown;
  requestServerTelemetry(): void;
}

const shortcut = '[';

function compactServerSnapshot(value: unknown): unknown {
  if (typeof value !== 'object' || value === null) return null;
  const snapshot = value as Record<string, unknown>;
  const server = snapshot.server as Record<string, unknown> | undefined;
  const connection = snapshot.connection as Record<string, unknown> | undefined;
  const memory = server?.memoryBytes as Record<string, number> | undefined;
  const eventLoop = server?.eventLoopDelayMs as Record<string, number | null> | undefined;
  const mib = (bytes: number | undefined): number | null => typeof bytes === 'number' ? Math.round(bytes / 1048576 * 10) / 10 : null;
  return {
    capturedAt: snapshot.capturedAt,
    process: server ? {
      nodeVersion: server.nodeVersion,
      uptimeSeconds: server.uptimeSeconds,
      cpuPercent: server.cpuPercent,
      memoryMiB: { rss: mib(memory?.rss), heapUsed: mib(memory?.heapUsed), heapTotal: mib(memory?.heapTotal) },
      eventLoopDelayMs: eventLoop,
      authoritativeSimulation: server.authoritativeSimulation,
      simulationTickRateHz: server.simulationTickRateHz,
      simulationTickMs: server.simulationTickMs,
    } : null,
    load: server ? {
      connectedSockets: server.connectedSockets,
      lobbies: server.lobbyCount,
      players: server.playerCount,
      inputsReceivedTotal: server.stateMessagesReceivedTotal,
      snapshotsSentTotal: server.stateMessagesRelayedTotal,
    } : null,
    thisConnection: connection ? {
      transport: connection.transport,
      readyState: connection.readyState,
      inputReceivedHz: connection.receivedStateHz,
      snapshotSentHz: connection.relayedStateHz,
      approximateJsonBytesInPerSecond: connection.approximateJsonBytesInPerSecond,
      approximateJsonBytesOutPerSecond: connection.approximateJsonBytesOutPerSecond,
    } : null,
  };
}

export function createDeveloperConsole(options: DeveloperConsoleOptions) {
  const root = document.createElement('section');
  root.id = 'developer-console';
  root.hidden = true;
  root.setAttribute('aria-label', 'Developer diagnostics console');
  root.innerHTML = `
    <div class="developer-console-window">
      <header class="developer-console-header">
        <div><strong>Performance & Server</strong><span>Toggle: ${shortcut}</span></div>
        <div class="developer-console-actions">
          <output id="developer-console-status">Closed</output>
          <button id="developer-console-copy" type="button">Copy JSON</button>
          <button id="developer-console-close" type="button">Close</button>
        </div>
      </header>
      <pre id="developer-console-data" tabindex="0"></pre>
    </div>`;
  document.body.append(root);

  const data = root.querySelector<HTMLElement>('#developer-console-data')!;
  const status = root.querySelector<HTMLOutputElement>('#developer-console-status')!;
  const closeButton = root.querySelector<HTMLButtonElement>('#developer-console-close')!;
  const copyButton = root.querySelector<HTMLButtonElement>('#developer-console-copy')!;
  let opened = false;
  let interval = 0;
  let lastServerRequest = Number.NEGATIVE_INFINITY;
  let serverData: unknown = null;
  let lastReport = '';

  function render(): void {
    if (!opened) return;
    try {
      const report = {
        capturedAt: new Date().toISOString(),
        client: options.readClientData(),
        server: serverData,
      };
      lastReport = JSON.stringify(report, null, 2);
      data.textContent = lastReport;
      const now = performance.now();
      if (now - lastServerRequest >= 1000) {
        options.requestServerTelemetry();
        lastServerRequest = now;
      }
      status.value = 'Client updates 4 Hz | server updates 1 Hz';
    } catch (error) {
      status.value = `Diagnostics error: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  function setOpen(value: boolean): void {
    if (opened === value) return;
    opened = value;
    root.hidden = !opened;
    if (opened) {
      lastServerRequest = Number.NEGATIVE_INFINITY;
      render();
      interval = window.setInterval(render, 250);
      data.focus();
    } else {
      window.clearInterval(interval);
      interval = 0;
    }
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.code === 'BracketLeft' && !event.repeat) {
      event.preventDefault();
      event.stopImmediatePropagation();
      setOpen(!opened);
    } else if (opened && event.code === 'Escape') {
      event.preventDefault();
      setOpen(false);
    }
  }

  async function copyReport(): Promise<void> {
    try {
      await navigator.clipboard.writeText(lastReport);
      status.value = 'Copied diagnostics JSON';
    } catch {
      status.value = 'Clipboard unavailable; select and copy the JSON below';
      data.focus();
    }
  }

  document.addEventListener('keydown', onKeyDown, true);
  closeButton.addEventListener('click', () => setOpen(false));
  copyButton.addEventListener('click', () => { void copyReport(); });

  return {
    setServerData(value: unknown): void {
      serverData = compactServerSnapshot(value);
    },
    get isOpen(): boolean { return opened; },
    dispose(): void {
      setOpen(false);
      document.removeEventListener('keydown', onKeyDown, true);
      root.remove();
    },
  };
}
