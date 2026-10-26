import type { RoadGeometry } from '../track/road-geometry.ts';
import { createRoadWorld } from './road-world.ts';
import { createLapTimer, resetCurrentLap, stepLapTimer, type LapTimerState } from './lap-timer.ts';
import { respawnVehicle, stepSplineVehicle } from './spline-vehicle.ts';
import type { DrivingControls, HandlingParameters, VehicleState } from './types.ts';
import { createVehicleState } from './vehicle.ts';

export const RACE_TIMESTEP = 1 / 60;
export const RACE_SNAPSHOT_TICKS = 3;
export const neutralControls: Readonly<DrivingControls> = { throttle: 0, steering: 0, brake: false };

export interface RaceInput { sequence: number; lifeId: number; controls: DrivingControls }
type CompatibleRaceInput = Omit<RaceInput, 'lifeId'> & { lifeId?: number };
export interface RacePlayer {
  id: string;
  state: VehicleState;
  lapTimer: LapTimerState;
  acknowledgedInput: number;
  lifeId: number;
  attemptId: number;
  lastTransition: 'respawn' | 'start' | 'lap' | null;
}
export interface RaceStepResult {
  laps: { playerId: string; durationSeconds: number }[];
  activity: { playerId: string; seconds: number; distanceMeters: number }[];
  transitions: { kind: 'respawn' | 'start' | 'lap'; tick: number; player: RacePlayer }[];
}

interface InternalPlayer extends RacePlayer {
  spawnIndex: number;
  pending: RaceInput[];
  lastReceivedInput: number;
  controls: DrivingControls;
  lastInputAt: number;
}

export function validRaceInput(value: unknown): value is CompatibleRaceInput {
  if (!value || typeof value !== 'object') return false;
  const input = value as Partial<RaceInput>;
  const controls = input.controls;
  return Number.isSafeInteger(input.sequence) && input.sequence! > 0
    && (input.lifeId === undefined || (Number.isSafeInteger(input.lifeId) && input.lifeId >= 0))
    && !!controls && (controls.throttle === -1 || controls.throttle === 0 || controls.throttle === 1)
    && (controls.steering === -1 || controls.steering === 0 || controls.steering === 1)
    && typeof controls.brake === 'boolean';
}

export function createRaceSimulation(
  road: Pick<RoadGeometry, 'triangles' | 'spawns' | 'finish' | 'checkpoints'>,
  handling: Readonly<HandlingParameters>,
) {
  const world = createRoadWorld(road);
  const players = new Map<string, InternalPlayer>();
  let currentHandling: Readonly<HandlingParameters> = handling;
  let tick = 0;

  return {
    get tick() { return tick; },
    setHandling(value: Readonly<HandlingParameters>): void { currentHandling = value; },
    addPlayer(id: string, spawnIndex: number): RacePlayer {
      const state = createVehicleState();
      respawnVehicle(state, road.spawns[spawnIndex] ?? road.spawns[0]!);
      const player: InternalPlayer = { id, spawnIndex, state, lapTimer: createLapTimer(),
        lifeId: 0, attemptId: 0, lastTransition: null,
        acknowledgedInput: 0, lastReceivedInput: 0, pending: [], controls: { ...neutralControls }, lastInputAt: 0 };
      players.set(id, player);
      return player;
    },
    removePlayer(id: string): void { players.delete(id); },
    deathStatus(id: string, lifeId: number): 'pending' | 'rejected' | 'respawned' | null {
      const player = players.get(id);
      if (!player) return null;
      if (lifeId < player.lifeId) return 'respawned';
      return lifeId > player.lifeId || player.state.grounded ? 'rejected' : 'pending';
    },
    input(id: string, value: unknown, now: number): boolean {
      const player = players.get(id);
      if (!player || !validRaceInput(value) || (value.lifeId !== undefined && value.lifeId !== player.lifeId)
        || value.sequence <= player.lastReceivedInput) return false;
      // Tabs left open across a deployment may still send the previous input format.
      // Explicit life IDs retain respawn fencing; legacy inputs use the current life.
      const lifeId = value.lifeId ?? player.lifeId;
      // Do not let a stalled sender grow an unbounded queue or make the server replay stale commands.
      player.lastReceivedInput = value.sequence;
      player.pending.push({ sequence: value.sequence, lifeId, controls: { ...value.controls } });
      if (player.pending.length > 12) player.pending.splice(0, player.pending.length - 12);
      player.lastInputAt = now;
      return true;
    },
    step(now: number): RaceStepResult {
      tick++;
      const result: RaceStepResult = { laps: [], activity: [], transitions: [] };
      for (const player of players.values()) {
        const previousPosition = { ...player.state.position };
        const previousLaps = player.lapTimer.completedLaps;
        const wasRunning = player.lapTimer.running;
        const input = player.pending.shift();
        if (input) {
          player.controls = input.controls;
          player.acknowledgedInput = input.sequence;
        }
        const controls = now - player.lastInputAt > 250 ? neutralControls : player.controls;
        const spawn = road.spawns[player.spawnIndex] ?? road.spawns[0]!;
        const respawned = stepSplineVehicle(player.state, controls, RACE_TIMESTEP, world, spawn, currentHandling.physics, currentHandling.driving);
        if (respawned) {
          resetCurrentLap(player.lapTimer);
          player.lifeId++;
          // Inputs from the previous life must never accelerate the respawned car.
          player.pending.length = 0;
          player.controls = { ...neutralControls };
          player.acknowledgedInput = player.lastReceivedInput;
          player.lastInputAt = 0;
        } else {
          stepLapTimer(player.lapTimer, previousPosition, player.state.position,
            RACE_TIMESTEP, road.finish, road.checkpoints);
        }
        const distance = respawned ? 0 : Math.hypot(
          player.state.position.x - previousPosition.x,
          player.state.position.z - previousPosition.z,
        );
        result.activity.push({ playerId: player.id, seconds: RACE_TIMESTEP,
          distanceMeters: distance < 50 ? distance : 0 });
        if (player.lapTimer.completedLaps > previousLaps && player.lapTimer.last !== null) {
          result.laps.push({ playerId: player.id, durationSeconds: player.lapTimer.last });
        }
        const kind = respawned ? 'respawn'
          : player.lapTimer.completedLaps > previousLaps ? 'lap'
            : !wasRunning && player.lapTimer.running ? 'start' : null;
        if (kind) {
          player.attemptId++;
          player.lastTransition = kind;
          result.transitions.push({ kind, tick, player: {
          id: player.id, state: structuredClone(player.state), lapTimer: structuredClone(player.lapTimer),
          acknowledgedInput: player.acknowledgedInput, lifeId: player.lifeId,
          attemptId: player.attemptId, lastTransition: player.lastTransition,
        } });
        }
      }
      return result;
    },
    snapshot(): { tick: number; players: RacePlayer[] } {
      return { tick, players: [...players.values()].map(p => ({ id: p.id,
        state: structuredClone(p.state), lapTimer: structuredClone(p.lapTimer), acknowledgedInput: p.acknowledgedInput,
        lifeId: p.lifeId, attemptId: p.attemptId, lastTransition: p.lastTransition })) };
    },
  };
}
