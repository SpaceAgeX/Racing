import type { Vector3Data } from './collision.ts';

export interface FinishLine {
  center: Vector3Data;
  width: number;
  direction?: { x: number; z: number };
  crossSlope?: number;
}

export interface LapTimerState {
  running: boolean;
  elapsed: number;
  best: number | null;
  last: number | null;
  /** Completed lap minus the best that existed before it finished. */
  delta: number | null;
  completedLaps: number;
  checkpointsVisited: number[];
  checkpointCount: number;
  missedCheckpoints: boolean;
}

export function createLapTimer(): LapTimerState {
  return { running: false, elapsed: 0, best: null, last: null, delta: null, completedLaps: 0, checkpointsVisited: [], checkpointCount: 0, missedCheckpoints: false };
}

/** Reset an attempt after respawning, retaining this session's completed results. */
export function resetCurrentLap(timer: LapTimerState): void {
  timer.checkpointsVisited = [];
  timer.missedCheckpoints = false;
  timer.running = false;
  timer.elapsed = 0;
}

/** Finite line crossing in either direction, using the car origin's swept movement. */
function crossingFraction(from: Readonly<Vector3Data>, to: Readonly<Vector3Data>, line: Readonly<FinishLine>): number | null {
  const direction = line.direction ?? { x: 0, z: 1 };
  const before = (from.x-line.center.x)*direction.x + (from.z-line.center.z)*direction.z;
  const after = (to.x-line.center.x)*direction.x + (to.z-line.center.z)*direction.z;
  if (!((before > 0 && after <= 0) || (before < 0 && after >= 0))) return null;
  const fraction = before / (before - after);
  const x = from.x + (to.x - from.x) * fraction;
  const y = from.y + (to.y - from.y) * fraction;
  const across = (x-line.center.x)*direction.z - (from.z+(to.z-from.z)*fraction-line.center.z)*direction.x;
  if (Math.abs(across) > line.width / 2 || Math.abs(y-line.center.y-across*(line.crossSlope ?? 0)) > 0.5) return null;
  return fraction;
}

/** Swept finite gates, processed in crossing order within a fixed step. Checkpoints are unordered per lap. */
export function stepLapTimer(timer: LapTimerState, from: Readonly<Vector3Data>, to: Readonly<Vector3Data>, timestep: number,
  line: Readonly<FinishLine> | null, checkpoints: readonly (FinishLine & {id:number})[] = []): void {
  if (!Number.isFinite(timestep) || timestep <= 0) return;
  timer.checkpointCount = checkpoints.length;
  const events: { fraction:number; id:number|null }[]=[];
  for(const cp of checkpoints){const fraction=crossingFraction(from,to,cp);if(fraction!==null)events.push({fraction,id:cp.id});}
  const finish=line?crossingFraction(from,to,line):null;
  if(finish!==null)events.push({fraction:finish,id:null});
  events.sort((a,b)=>a.fraction-b.fraction || (a.id===null?1:-1));
  let previous=0;
  for(const event of events){
    if(timer.running)timer.elapsed+=(event.fraction-previous)*timestep;
    previous=event.fraction;
    if(event.id!==null){
      if(timer.running&&!timer.checkpointsVisited.includes(event.id))timer.checkpointsVisited.push(event.id);
      continue;
    }
    if(!timer.running){timer.running=true;timer.elapsed=0;timer.checkpointsVisited=[];timer.missedCheckpoints=false;}
    else if(checkpoints.every(cp=>timer.checkpointsVisited.includes(cp.id))){
      timer.last=timer.elapsed;timer.delta=timer.best===null?null:timer.last-timer.best;
      timer.best=timer.best===null?timer.last:Math.min(timer.best,timer.last);timer.completedLaps++;
      timer.elapsed=0;timer.checkpointsVisited=[];timer.missedCheckpoints=false;
    }else { timer.missedCheckpoints=true; } // Incomplete crossing does not reset elapsed time or award a lap.
  }
  if(timer.running)timer.elapsed+=(1-previous)*timestep;
}
