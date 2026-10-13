import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer, type IncomingMessage } from 'node:http';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAdmission } from '../server/admission.ts';
import { createGameRecorder, sanitizeReport } from '../server/game-recorder.ts';
import { writePlan, planIsActive } from '../server/recording-control.ts';
import { analyzeRecording } from '../server/recording-analysis.ts';

test('admission enforces a global 15-session cap atomically, protects APIs and sockets, and releases expired places', async () => {
  let now = 1000;
  const gate = createAdmission(15, 1000, () => now);
  const app = express();
  app.use(gate.middleware);
  app.use((_request,response) => response.send('ok'));
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0,'127.0.0.1',resolve));
  const port = (server.address() as {port:number}).port;
  const base = 'http://127.0.0.1:' + port;
  try {
    const results = await Promise.all(Array.from({length:20}, () => fetch(base + '/')));
    assert.equal(results.filter(r => r.status === 200).length,15);
    assert.equal(results.filter(r => r.status === 503).length,5);
    assert.equal(gate.count,15);
    const cookie = results.find(r => r.status === 200)!.headers.get('set-cookie')!.split(';')[0]!;
    assert.equal((await fetch(base+'/api/tracks')).status,401);
    assert.equal((await fetch(base+'/',{headers:{cookie}})).status,200);
    assert.equal(gate.count,15);
    let disconnected = false;
    const request = {headers:{cookie}} as IncomingMessage;
    assert.equal(gate.authorized(request),true);
    assert.equal(gate.socket(request,'one',()=>{disconnected=true;}),null);
    assert.match(gate.socket(request,'two',()=>{})!,/another tab/);
    assert.ok(gate.socket({headers:{}} as IncomingMessage,'fake',()=>{}));
    now += 1001;
    assert.equal(gate.count,0);
    assert.equal(disconnected,true);
    assert.equal((await fetch(base+'/api/tracks',{headers:{cookie}})).status,401);
    assert.equal((await fetch(base+'/')).status,200);
  } finally { gate.close(); await new Promise<void>(resolve=>server.close(()=>resolve())); }
});

test('recording window is half-open and client telemetry is sanitized', () => {
  const plan = {version:1 as const,id:'test',enabled:true,startAt:new Date(1000).toISOString(),stopAt:new Date(2000).toISOString()};
  assert.equal(planIsActive(plan,999),false);
  assert.equal(planIsActive(plan,1000),true);
  assert.equal(planIsActive(plan,2000),false);
  assert.equal(sanitizeReport({visible:true,racing:true,fps:Infinity}),null);
  const data = sanitizeReport({visible:true,racing:true,fps:60,frameMs:16,httpPingMs:-1,remotePlayers:Array(30).fill({id:'x',snapshotAgeMs:5,interarrivalJitterMs:1,bufferUnderruns:2})});
  assert.equal(data?.remotePlayers.length,10);
  assert.equal(data?.httpPingMs,null);
});

test('recorder starts from a persisted schedule, records samples and stops automatically; analysis reads its output', async () => {
  const directory = await mkdtemp(join(tmpdir(),'racing-recorder-'));
  const start = Date.now();
  await writePlan({version:1,id:'run-test',enabled:true,startAt:new Date(start).toISOString(),stopAt:new Date(start+2400).toISOString()},directory);
  const recorder = createGameRecorder(()=>({clients:[],rooms:[],roomForPlayer:()=>null}),directory);
  try {
    await new Promise(resolve=>setTimeout(resolve,3400));
    const folder = join(directory,'run-test');
    const files = await readdir(folder);
    const lines = (await readFile(join(folder,files[0]!),'utf8')).trim().split('\n').map(line=>JSON.parse(line));
    assert.ok(lines.some(row=>row.type==='sample'));
    assert.ok(lines.some(row=>row.type==='end'));
    const report = await analyzeRecording(folder);
    assert.ok(report.samples >= 1);
    assert.equal(report.cleanStops,1);
    assert.ok(report.metrics.cpuPercent);
    assert.equal(JSON.parse(await readFile(join(directory,'status.json'),'utf8')).recording,false);
  } finally { await recorder.close(); await rm(directory,{recursive:true,force:true}); }
});
