import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { join } from 'node:path';

/** Bounded logarithmic histogram: p95 is the bucket upper bound (~2% resolution). */
export class Metric {
  count = 0; total = 0; min = Infinity; max = -Infinity;
  buckets = new Map<number, number>();
  add(value: unknown): void {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return;
    this.count++; this.total += value; this.min = Math.min(this.min, value); this.max = Math.max(this.max, value);
    const bucket = Math.ceil(Math.log1p(value) / Math.log(1.02));
    this.buckets.set(bucket, (this.buckets.get(bucket) ?? 0) + 1);
  }
  summary() {
    let rank = Math.ceil(this.count * .95), p95: number | null = null;
    for (const [bucket, count] of [...this.buckets].sort((a,b) => a[0] - b[0])) {
      rank -= count;
      if (rank <= 0) { p95 = Math.min(this.max, Math.expm1(bucket * Math.log(1.02))); break; }
    }
    return { samples: this.count, average: this.count ? this.total / this.count : null, min: this.count ? this.min : null, max: this.count ? this.max : null, p95 };
  }
}
export async function analyzeRecording(path: string) {
  const files = (await stat(path)).isDirectory()
    ? (await readdir(path)).filter(name => name.endsWith('.jsonl')).sort().map(name => join(path, name)) : [path];
  const metrics = new Map<string, Metric>();
  function add(name: string, value: unknown) {
    let metric = metrics.get(name);
    if (!metric) { metric = new Metric(); metrics.set(name, metric); }
    metric.add(value);
  }
  let samples = 0, invalidLines = 0, starts = 0, ends = 0, seconds = 0, inBytes = 0, outBytes = 0, disconnects = 0, timeouts = 0;
  let first: string | null = null, last: string | null = null;
  const lastReports = new Map<string, number>();
  const participants = new Set<string>();
  const underruns = new Map<string, number>();
  let newBufferUnderruns = 0;
  const http: Record<string, {requests: number; errors: number; contentBytes: number; unknownLengths: number}> = {};
  const worstWindows: { at: string; eventLoopMaxMs: number }[] = [];
  for (const file of files) {
    const lines = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
    for await (const line of lines) {
      let row;
      try { row = JSON.parse(line); } catch { invalidLines++; continue; }
      if (row.type === 'start') { starts++; continue; }
      if (row.type === 'end') { ends++; continue; }
      if (row.type !== 'sample') continue;
      samples++; first ??= row.at; last = row.at;
      seconds += row.intervalSeconds;
      inBytes += row.server.inBytes; outBytes += row.server.outBytes;
      for (const [group, raw] of Object.entries(row.http ?? {})) {
        const source = raw as {requests:number;errors:number;contentBytes:number;unknownLengths:number};
        const target = http[group] ??= { requests: 0, errors: 0, contentBytes: 0, unknownLengths: 0 };
        target.requests += source.requests; target.errors += source.errors;
        target.contentBytes += source.contentBytes; target.unknownLengths += source.unknownLengths;
      }
      add('admittedBrowserSessions', row.server.admittedSessions);
      disconnects += (row.events ?? []).filter((event: {type:string}) => event.type === 'disconnect').length;
      for (const key of ['cpuPercent','rssBytes','heapUsedBytes','eventLoopMeanMs','eventLoopP95Ms','eventLoopMaxMs','connectedClients','players','inBytesPerSecond','outBytesPerSecond']) add(key,row.server[key]);
      worstWindows.push({ at: row.at, eventLoopMaxMs: row.server.eventLoopMaxMs ?? 0 });
      worstWindows.sort((a,b) => b.eventLoopMaxMs - a.eventLoopMaxMs);
      worstWindows.length = Math.min(worstWindows.length,10);
      for (const client of row.clients ?? []) {
        participants.add(client.id);
        add('receivedStateHz', client.receivedHz);
        add('sentStateHz', client.sentHz);
        add('serverArrivalJitterMs',client.arrivalJitterMs);
        add('serverArrivalGapMaxMs',client.arrivalGapMaxMs);
        timeouts += client.probeTimeouts;
        const reportAt = client.reportAt ?? null;
        // Do not count stale RTT reports as new network measurements.
        if (reportAt !== null && client.reportAgeMs < 5000 && reportAt !== lastReports.get(client.id)) {
          lastReports.set(client.id, reportAt);
          add('socketRttMs',client.rttMs);
          if (client.client?.visible && client.client?.racing) {
            add('foregroundRaceFps',client.client.fps);
            add('foregroundFrameMs',client.client.frameMs);
            for (const remote of client.client.remotePlayers ?? []) {
              const key = client.id + '/' + remote.id;
              const previous = underruns.get(key);
              if (previous !== undefined) newBufferUnderruns += Math.max(0, remote.bufferUnderruns - previous);
              underruns.set(key, remote.bufferUnderruns);
              add('remoteSnapshotAgeMs',remote.snapshotAgeMs);
              add('remoteArrivalJitterMs',remote.interarrivalJitterMs);
              add('extrapolatingFraction',remote.extrapolating ? 1 : 0);
            }
          }
        }
      }
    }
  }
  return {
    first, last, samples, recordedSeconds: seconds, processStarts: starts, cleanStops: ends, invalidLines,
    distinctConnections: participants.size, disconnects, probeTimeouts: timeouts,
    newBufferUnderruns, http,
    approximatePayloadBytes: { received: inBytes, sent: outBytes },
    metrics: Object.fromEntries([...metrics].map(([name, metric]) => [name, metric.summary()])),
    worstServerStalls: worstWindows,
    notes: ['p95 values use logarithmic histogram buckets (~2% resolution).',
      'Traffic counts position-update JSON payloads, not total wire bandwidth.',
      'HTTP ping, snapshots, and extrapolation are client-reported. Hidden-tab FPS is excluded.',
      'Socket RTT includes browser scheduling. Timeouts are not direct evidence of packet loss.',
      'This server relays positions; it does not run authoritative physics.'],
  };
}
