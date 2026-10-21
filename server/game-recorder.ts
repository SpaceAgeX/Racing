import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { loadavg } from 'node:os';
import type { Socket } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents, RecordingClientReport } from '../src/multiplayer/protocol.ts';
import { planIsActive, readPlan, recordingDirectory, type RecordingPlan } from './recording-control.ts';

type Client = Socket<ClientToServerEvents, ServerToClientEvents>;
interface Context {
  admittedSessions?: number;
  clients: Client[];
  rooms: { id: string; phase: string; players: number; trackId: string }[];
  roomForPlayer(id: string): string | null;
}
interface Traffic {
  received: number; sent: number; inBytes: number; outBytes: number;
  lastArrival: number | null; gaps: number; gapSum: number; gapSquares: number; gapMax: number;
}
function newTraffic(): Traffic {
  return { received: 0, sent: 0, inBytes: 0, outBytes: 0, lastArrival: null, gaps: 0, gapSum: 0, gapSquares: 0, gapMax: 0 };
}
function metric(value: unknown, max = 1e9): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max ? value : null;
}
/** Accept only bounded numeric telemetry, never arbitrary client objects. */
export function sanitizeReport(value: unknown): RecordingClientReport | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as Partial<RecordingClientReport>;
  if (typeof data.visible !== 'boolean' || typeof data.racing !== 'boolean' || metric(data.fps, 10000) === null) return null;
  return {
    visible: data.visible, racing: data.racing, fps: data.fps!,
    frameMs: metric(data.frameMs), httpPingMs: metric(data.httpPingMs),
    remotePlayers: (Array.isArray(data.remotePlayers) ? data.remotePlayers.slice(0, 10) : []).flatMap(remote => {
      if (!remote || typeof remote.id !== 'string' || remote.id.length > 100) return [];
      return [{ id: remote.id, snapshotAgeMs: metric(remote.snapshotAgeMs), interarrivalJitterMs: metric(remote.interarrivalJitterMs),
        bufferUnderruns: metric(remote.bufferUnderruns) ?? 0, extrapolating: remote.extrapolating === true }];
    }),
  };
}

export function createGameRecorder(getContext: () => Context, directory = recordingDirectory) {
  let active: RecordingPlan | null = null;
  let file = '';
  let previousCpu = process.cpuUsage();
  let previousAt = performance.now();
  let busy: Promise<void> | null = null;
  let closed = false;
  let lastError = '';
  let idleTicks = 0;
  const histogram = monitorEventLoopDelay({ resolution: 10 });
  const traffic = new Map<string, Traffic>();
  const reports = new Map<string, { at: number; rttMs: number; data: RecordingClientReport | null }>();
  const pending = new Set<string>();
  const timeouts = new Map<string, number>();
  let events: { at: string; type: string; id: string; reason?: string }[] = [];
  let http: Record<string, { requests: number; errors: number; contentBytes: number; unknownLengths: number; totalMs: number }> = {};

  function entry(id: string): Traffic {
    let record = traffic.get(id);
    if (!record) { record = newTraffic(); traffic.set(id, record); }
    return record;
  }
  async function write(value: unknown): Promise<void> {
    if (!active) return;
    const folder = join(directory, active.id);
    const target = join(folder, new Date().toISOString().slice(0, 13).replaceAll(':', '-') + '.jsonl');
    if (file !== target) {
      await mkdir(folder, { recursive: true });
      file = target;
      await appendFile(file, JSON.stringify({
        type: 'metadata', version: 1, at: new Date().toISOString(), runId: active.id,
        pid: process.pid, node: process.version, platform: process.platform + '/' + process.arch,
        schedule: active, authoritativeSimulation: true,
        trafficUnits: 'Approximate JSON input and snapshot payload bytes; excludes HTTP, TLS, Socket.IO framing and recording probes.',
        cpuUnits: 'Percent of one CPU core; can exceed 100.',
        rttUnits: 'Server-to-browser Socket.IO acknowledgement round trip including browser scheduling.',
      }) + '\n');
    }
    await appendFile(file, JSON.stringify(value) + '\n');
  }
  async function stop(reason: string): Promise<void> {
    if (!active) return;
    try { await write({ type: 'end', at: new Date().toISOString(), reason, events }); }
    finally { active = null; file = ''; histogram.disable(); traffic.clear(); reports.clear(); pending.clear(); timeouts.clear(); events = []; http = {}; }
  }
  async function status(error?: string): Promise<void> {
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'status.json'), JSON.stringify({
      at: new Date().toISOString(), pid: process.pid, recording: Boolean(active), runId: active?.id ?? null, file: file || null, error: error ?? null,
    }, null, 2) + '\n');
  }
  async function tick(): Promise<void> {
    const plan = await readPlan(directory);
    if (!planIsActive(plan, Date.now())) {
      await stop('Stopped or scheduled end reached');
      if (++idleTicks % 10 === 1) await status();
      return;
    }
    if (active?.id !== plan!.id) {
      await stop('Replaced by another recording');
      active = plan;
      histogram.reset(); histogram.enable();
      previousCpu = process.cpuUsage(); previousAt = performance.now();
      await write({ type: 'start', at: new Date().toISOString() });
      await status();
      return;
    }
    const now = performance.now();
    const seconds = Math.max(.001, (now - previousAt) / 1000);
    const cpu = process.cpuUsage();
    const cpuPercent = (cpu.user - previousCpu.user + cpu.system - previousCpu.system) / (seconds * 10000);
    previousAt = now; previousCpu = cpu;
    const context = getContext();
    const clients = context.clients.map(socket => {
      const t = entry(socket.id);
      const report = reports.get(socket.id);
      const mean = t.gaps ? t.gapSum / t.gaps : null;
      const result = {
        id: socket.id, roomId: context.roomForPlayer(socket.id), transport: socket.conn.transport.name,
        receivedHz: t.received / seconds, sentHz: t.sent / seconds, inBytes: t.inBytes, outBytes: t.outBytes,
        arrivalGapMeanMs: mean, arrivalGapMaxMs: t.gaps ? t.gapMax : null,
        arrivalJitterMs: mean === null ? null : Math.sqrt(Math.max(0, t.gapSquares / t.gaps - mean * mean)),
        reportAgeMs: report ? Date.now() - report.at : null,
        reportAt: report?.at ?? null,
        rttMs: report?.rttMs ?? null, probeTimeouts: timeouts.get(socket.id) ?? 0,
        client: report && Date.now() - report.at < 5000 ? report.data : null,
      };
      traffic.set(socket.id, { ...newTraffic(), lastArrival: t.lastArrival });
      timeouts.set(socket.id, 0);
      if (!pending.has(socket.id)) {
        pending.add(socket.id);
        const run = active;
        const sentAt = performance.now();
        socket.timeout(1500).emit('recording:probe', (error: Error | null, response: RecordingClientReport) => {
          if (active !== run || !socket.connected) return;
          pending.delete(socket.id);
          if (error) { timeouts.set(socket.id, (timeouts.get(socket.id) ?? 0) + 1); return; }
          reports.set(socket.id, { at: Date.now(), rttMs: performance.now() - sentAt, data: sanitizeReport(response) });
        });
      }
      return result;
    });
    const disconnectedTraffic = [...traffic].filter(([id]) => !context.clients.some(client => client.id === id));
    const inBytes = clients.reduce((n, client) => n + client.inBytes, 0) + disconnectedTraffic.reduce((n, [, t]) => n + t.inBytes, 0);
    const outBytes = clients.reduce((n, client) => n + client.outBytes, 0) + disconnectedTraffic.reduce((n, [, t]) => n + t.outBytes, 0);
    for (const [id] of disconnectedTraffic) { traffic.delete(id); reports.delete(id); pending.delete(id); timeouts.delete(id); }
    const toMs = (value: number) => Number.isFinite(value) ? value / 1e6 : null;
    const snapshot = {
      type: 'sample', at: new Date().toISOString(), intervalSeconds: seconds,
      server: {
        cpuPercent, rssBytes: process.memoryUsage().rss, heapUsedBytes: process.memoryUsage().heapUsed,
        eventLoopMeanMs: toMs(histogram.mean), eventLoopP95Ms: toMs(histogram.percentile(95)), eventLoopMaxMs: toMs(histogram.max),
        hostLoadAverage: loadavg(), connectedClients: context.clients.length, players: context.rooms.reduce((n, room) => n + room.players, 0),
        admittedSessions: context.admittedSessions ?? null,
        inBytes, outBytes, inBytesPerSecond: inBytes / seconds, outBytesPerSecond: outBytes / seconds,
      },
      rooms: context.rooms, clients, events, http,
    };
    events = []; http = {}; histogram.reset();
    await write(snapshot);
    await status();
  }
  function run(): void {
    if (busy || closed) return;
    busy = tick().catch(async error => {
      const message = String(error);
      if (lastError !== message) console.error('Game recorder:', message);
      lastError = message;
      await stop('Recorder error').catch(() => { active = null; histogram.disable(); });
      await status(message).catch(() => undefined);
    }).finally(() => { busy = null; });
  }
  const timer = setInterval(run, 1000);
  timer.unref();
  run();
  return {
    http(group: string, status: number, bytes: number | null, ms: number): void {
      if (!active) return;
      const row = http[group] ??= { requests: 0, errors: 0, contentBytes: 0, unknownLengths: 0, totalMs: 0 };
      row.requests++; row.errors += status >= 400 ? 1 : 0; row.contentBytes += bytes ?? 0;
      row.unknownLengths += bytes === null ? 1 : 0; row.totalMs += ms;
    },
    received(id: string, bytes: number): void {
      if (!active) return;
      const t = entry(id);
      const now = performance.now();
      if (t.lastArrival !== null) {
        const gap = now - t.lastArrival;
        t.gaps++; t.gapSum += gap; t.gapSquares += gap * gap; t.gapMax = Math.max(t.gapMax, gap);
      }
      t.lastArrival = now; t.received++; t.inBytes += bytes;
    },
    sent(id: string, bytes: number): void { if (active) { const t = entry(id); t.sent++; t.outBytes += bytes; } },
    connection(id: string, connected: boolean, reason?: string): void {
      if (active && events.length < 1000) events.push({ at: new Date().toISOString(), type: connected ? 'connect' : 'disconnect', id, reason });
    },
    async close(): Promise<void> {
      closed = true; clearInterval(timer); await busy; await stop('Server shutdown'); await status().catch(() => undefined);
    },
  };
}
