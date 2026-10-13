import { randomUUID } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { readPlan, writePlan, recordingDirectory } from '../server/recording-control.ts';
import { analyzeRecording } from '../server/recording-analysis.ts';

const [command, ...args] = process.argv.slice(2);
const option = (name: string) => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
function date(value: string | undefined): Date {
  if (!value || !/(Z|[+-]\d\d:\d\d)$/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new Error('Use a full timestamp with timezone, for example 2026-10-14T08:00:00-04:00.');
  }
  return new Date(value);
}
try {
  if (command === 'schedule' || command === 'start') {
    let start: Date, stop: Date;
    if (args.includes('--tomorrow')) {
      start = new Date(); start.setDate(start.getDate() + 1); start.setHours(0,0,0,0);
      stop = new Date(start); stop.setDate(stop.getDate() + 1);
    } else {
      start = command === 'start' ? new Date() : date(option('--start'));
      stop = option('--stop') ? date(option('--stop')) : new Date(start);
      if (!option('--stop') && command === 'start') { stop.setDate(stop.getDate()+1); stop.setHours(0,0,0,0); }
    }
    if (stop <= start || stop.getTime() <= Date.now()) throw new Error('Stop must be later than start and in the future.');
    const id = 'run-' + start.toISOString().slice(0,10) + '-' + randomUUID().slice(0,8);
    await writePlan({ version: 1, id, startAt: start.toISOString(), stopAt: stop.toISOString(), enabled: true });
    console.log('Recording scheduled. The game server must remain running.');
    console.log('Start:',start.toString(),'\nStop: ',stop.toString(),'\nTimezone:',Intl.DateTimeFormat().resolvedOptions().timeZone);
    console.log('Directory:',join(recordingDirectory,id));
  } else if (command === 'stop') {
    const plan = await readPlan();
    if (plan) await writePlan({ ...plan, enabled: false });
    console.log('Stop requested; the game server will stop recording within its next sampling interval.');
  } else if (command === 'status') {
    console.log('Schedule:',JSON.stringify(await readPlan(),null,2));
    const status = JSON.parse(await readFile(join(recordingDirectory,'status.json'),'utf8').catch(() => '{}'));
    console.log('Recorder:',JSON.stringify(status,null,2));
    if (!status.at || Date.now() - Date.parse(status.at) > 30000) console.log('Recorder heartbeat is missing or stale. Check that the server is running with the same recording directory.');
  } else if (command === 'analyze') {
    let input = args[0];
    if (!input || input === 'latest') {
      const runs = (await readdir(recordingDirectory, { withFileTypes: true })).filter(entry => entry.isDirectory() && entry.name.startsWith('run-'));
      if (!runs.length) throw new Error('No recordings found.');
      const plan = await readPlan();
      input = join(recordingDirectory, plan && runs.some(entry => entry.name === plan.id) ? plan.id : runs.map(entry => entry.name).sort().at(-1)!);
    }
    const report = await analyzeRecording(resolve(input));
    const output = option('--output') ?? resolve(recordingDirectory,'analysis.json');
    await writeFile(output,JSON.stringify(report,null,2)+'\n');
    console.log('Recorded:',report.recordedSeconds.toFixed(1),'seconds; samples:',report.samples,'; distinct connections:',report.distinctConnections);
    console.log('Metric                         Average         p95         Max');
    for (const [name,metric] of Object.entries(report.metrics)) {
      const number = (value: number | null) => value === null ? 'n/a' : value.toFixed(2);
      console.log(name.padEnd(30),number(metric.average).padStart(10),number(metric.p95).padStart(11),number(metric.max).padStart(11));
    }
    console.log('Disconnects:',report.disconnects,'Probe timeouts:',report.probeTimeouts,'\nReport:',output);
    for (const note of report.notes) console.log('-',note);
  } else {
    console.log('npm run recorder -- schedule --tomorrow\nnpm run recorder -- schedule --start <ISO timestamp with timezone> --stop <ISO timestamp with timezone>\nnpm run recorder -- start [--stop <ISO timestamp with timezone>]\nnpm run recorder -- status\nnpm run recorder -- stop\nnpm run recorder -- analyze [latest|directory] [--output report.json]');
    if (command) process.exitCode = 1;
  }
} catch (error) { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }
