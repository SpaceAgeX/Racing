import { randomUUID } from 'node:crypto';
import type { RacePlayer, RaceStepResult } from '../src/simulation/race.ts';
import { RACE_TIMESTEP, createRaceSimulation } from '../src/simulation/race.ts';
import type { RoundOptions, RoundPlayerSnapshot, RoundResults, RoundSnapshot, RoundStage } from '../src/multiplayer/protocol.ts';

type Simulation = ReturnType<typeof createRaceSimulation>;
interface Participant extends RoundPlayerSnapshot {
  lapTimes: number[];
  samples: { seconds: number; distanceMeters: number; speedMps: number; laps: number }[];
  survivedSeconds: number;
}
export interface RoundUpdate {
  changed: boolean;
  resets: RacePlayer[];
  results: RoundResults | null;
}
const emptyUpdate = (): RoundUpdate => ({ changed: false, resets: [], results: null });
const countdownMs = 3000;
const qualifyingLimitSeconds = 240;
const raceLimitSeconds = 1200;

export function validRoundOptions(value: unknown): value is RoundOptions {
  if (!value || typeof value !== 'object') return false;
  const options = value as Partial<RoundOptions>;
  return Number.isInteger(options.laps) && options.laps! >= 1 && options.laps! <= 20
    && (options.fallMode === 'respawn' || options.fallMode === 'elimination')
    && typeof options.qualifying === 'boolean';
}

export function createMultiplayerRound(
  race: Simulation,
  players: readonly { id: string; name: string; color: string }[],
  trackName: string,
  options: RoundOptions,
) {
  const id = randomUUID();
  const participants = new Map<string, Participant>(players.map((player, index) => [player.id, {
    ...player, status: 'waiting', gridPosition: index + 1, laps: 0,
    bestSeconds: null, lastSeconds: null, qualifyingSeconds: null,
    qualifyingSurvivalSeconds: null, finishSeconds: null, falls: 0,
    distanceMeters: 0, survivedSeconds: 0, lapTimes: [], samples: [],
  }]));
  const ready = new Set<string>();
  let stage: RoundStage = 'loading';
  let countdownTarget: 'qualifying' | 'race' | null = null;
  let countdownEndsAtMs: number | null = null;
  let elapsedSeconds = 0;
  let nextSampleAt = 2;
  for (const player of players) race.setFrozen(player.id, true);
  race.setRespawnEnabled(false);

  function rankedQualifying(): Participant[] {
    return [...participants.values()].sort((a, b) => {
      const aFinished = a.qualifyingSeconds !== null;
      const bFinished = b.qualifyingSeconds !== null;
      if (aFinished !== bFinished) return aFinished ? -1 : 1;
      if (aFinished) return a.qualifyingSeconds! - b.qualifyingSeconds!;
      const aActive = a.status === 'racing';
      const bActive = b.status === 'racing';
      if (aActive !== bActive) return aActive ? -1 : 1;
      return (b.qualifyingSurvivalSeconds ?? 0) - (a.qualifyingSurvivalSeconds ?? 0)
        || a.gridPosition - b.gridPosition;
    });
  }

  function rankedRace(): Participant[] {
    return [...participants.values()].sort((a, b) => {
      const aFinished = a.finishSeconds !== null;
      const bFinished = b.finishSeconds !== null;
      if (aFinished !== bFinished) return aFinished ? -1 : 1;
      if (aFinished) return a.finishSeconds! - b.finishSeconds!;
      const aActive = a.status === 'racing';
      const bActive = b.status === 'racing';
      if (aActive !== bActive) return aActive ? -1 : 1;
      if (aActive) return b.laps - a.laps || b.distanceMeters - a.distanceMeters;
      if (options.fallMode === 'elimination') return b.laps - a.laps
        || b.survivedSeconds - a.survivedSeconds || a.gridPosition - b.gridPosition;
      return b.laps - a.laps || b.distanceMeters - a.distanceMeters || a.gridPosition - b.gridPosition;
    });
  }

  function snapshot(now: number): RoundSnapshot {
    const order = stage === 'race' ? rankedRace() : stage === 'qualifying' ? rankedQualifying()
      : [...participants.values()].sort((a, b) => a.gridPosition - b.gridPosition);
    return { id, stage, options, countdownTarget, countdownEndsAtMs, serverNowMs: now,
      elapsedSeconds, players: order.map(({ lapTimes: _laps, samples: _samples, survivedSeconds: _survival, ...player }) => ({ ...player })) };
  }

  function beginCountdown(target: 'qualifying' | 'race', now: number): RoundUpdate {
    stage = 'countdown';
    countdownTarget = target;
    countdownEndsAtMs = now + countdownMs;
    elapsedSeconds = 0;
    nextSampleAt = 2;
    const resets: RacePlayer[] = [];
    if (target === 'race' && options.qualifying) {
      rankedQualifying().forEach((player, index) => { player.gridPosition = index + 1; });
    }
    for (const player of participants.values()) {
      if (player.status === 'disconnected') continue;
      player.status = 'waiting';
      const reset = race.resetPlayer(player.id, target === 'qualifying'
        ? [...participants.keys()].indexOf(player.id) : player.gridPosition - 1, true);
      if (reset) resets.push(reset);
      if (target === 'race') {
        player.laps = 0;
        player.bestSeconds = null;
        player.lastSeconds = null;
        player.finishSeconds = null;
        player.distanceMeters = 0;
        player.survivedSeconds = 0;
        player.lapTimes = [];
        player.samples = [];
      }
    }
    return { changed: true, resets, results: null };
  }

  function advance(now: number): RoundUpdate {
    if (stage !== 'countdown' || countdownEndsAtMs === null || now < countdownEndsAtMs) return emptyUpdate();
    stage = countdownTarget!;
    countdownTarget = null;
    countdownEndsAtMs = null;
    elapsedSeconds = 0;
    race.setRespawnEnabled(stage === 'race' && options.fallMode === 'respawn');
    for (const player of participants.values()) {
      if (player.status === 'disconnected') continue;
      player.status = 'racing';
      race.setFrozen(player.id, false);
    }
    return { changed: true, resets: [], results: null };
  }

  function allSettled(): boolean {
    return [...participants.values()].every(player => player.status !== 'racing' && player.status !== 'waiting');
  }

  function complete(): RoundResults {
    return { id, trackName, options, durationSeconds: elapsedSeconds,
      players: rankedRace().map((player, index) => {
        const { survivedSeconds: _survivedSeconds, lapTimes, samples, ...summary } = player;
        return { ...summary, place: index + 1, lapTimes: [...lapTimes], samples: [...samples,
          { seconds: Math.round(elapsedSeconds * 10) / 10,
            distanceMeters: Math.round(player.distanceMeters), speedMps: 0, laps: player.laps }] };
      }) };
  }

  function step(result: RaceStepResult, now: number): RoundUpdate {
    if (stage !== 'qualifying' && stage !== 'race') return emptyUpdate();
    elapsedSeconds += RACE_TIMESTEP;
    let changed = false;
    for (const activity of result.activity) {
      const player = participants.get(activity.playerId);
      if (!player || player.status !== 'racing') continue;
      player.distanceMeters += activity.distanceMeters;
      player.survivedSeconds = elapsedSeconds;
    }
    for (const lap of result.laps) {
      const player = participants.get(lap.playerId);
      if (!player || player.status !== 'racing') continue;
      if (stage === 'qualifying') {
        player.qualifyingSeconds = lap.durationSeconds;
        player.status = 'qualified';
        changed = true;
        race.setFrozen(player.id, true);
      } else {
        player.laps++;
        player.lapTimes.push(lap.durationSeconds);
        player.lastSeconds = lap.durationSeconds;
        player.bestSeconds = player.bestSeconds === null ? lap.durationSeconds
          : Math.min(player.bestSeconds, lap.durationSeconds);
        if (player.laps >= options.laps) {
          player.finishSeconds = elapsedSeconds;
          player.status = 'finished';
          changed = true;
          race.setFrozen(player.id, true);
        }
      }
    }
    const resets: RacePlayer[] = [];
    if (stage === 'qualifying' || options.fallMode === 'elimination') {
      for (const fall of result.falls) {
        const player = participants.get(fall.playerId);
        if (!player || player.status !== 'racing') continue;
        player.falls++;
        if (stage === 'qualifying') {
          player.qualifyingSurvivalSeconds = elapsedSeconds;
          player.status = 'qualifying-fall';
          changed = true;
          const reset = race.resetPlayer(player.id, player.gridPosition - 1, true);
          if (reset) resets.push(reset);
        } else {
          player.status = 'eliminated';
          changed = true;
          race.setFrozen(player.id, true);
        }
      }
    } else {
      for (const transition of result.transitions) {
        if (transition.kind !== 'respawn') continue;
        const player = participants.get(transition.player.id);
        if (player?.status === 'racing') player.falls++;
      }
    }
    if (elapsedSeconds >= nextSampleAt) {
      nextSampleAt += 2;
      const states = race.snapshot().players;
      for (const state of states) {
        const player = participants.get(state.id);
        if (!player) continue;
        player.samples.push({ seconds: Math.round(elapsedSeconds * 10) / 10,
          distanceMeters: Math.round(player.distanceMeters),
          speedMps: Math.hypot(state.state.speed, state.state.lateralSpeed), laps: player.laps });
      }
    }
    if (stage === 'qualifying' && (allSettled() || elapsedSeconds >= qualifyingLimitSeconds)) {
      for (const player of participants.values()) {
        if (player.status !== 'racing') continue;
        player.status = 'qualifying-timeout';
        player.qualifyingSurvivalSeconds = elapsedSeconds;
        race.setFrozen(player.id, true);
      }
      const next = beginCountdown('race', now);
      return next;
    }
    if (stage === 'race' && (allSettled() || elapsedSeconds >= raceLimitSeconds)) {
      for (const player of participants.values()) {
        if (player.status === 'racing') {
          player.status = 'timed-out';
          race.setFrozen(player.id, true);
        }
      }
      return { changed: true, resets, results: complete() };
    }
    return { changed, resets, results: null };
  }

  return {
    id,
    get stage() { return stage; },
    snapshot,
    advance,
    step,
    ready(playerId: string, now: number): RoundUpdate {
      if (stage !== 'loading' || !participants.has(playerId)) return emptyUpdate();
      ready.add(playerId);
      if ([...participants.values()].some(player => player.status !== 'disconnected' && !ready.has(player.id))) return emptyUpdate();
      return beginCountdown(options.qualifying ? 'qualifying' : 'race', now);
    },
    disconnect(playerId: string, now: number): RoundUpdate {
      const player = participants.get(playerId);
      if (!player) return emptyUpdate();
      player.status = 'disconnected';
      if (stage === 'loading' && [...participants.values()].every(p => p.status === 'disconnected' || ready.has(p.id))) {
        return beginCountdown(options.qualifying ? 'qualifying' : 'race', now);
      }
      if (stage === 'qualifying' && allSettled()) return beginCountdown('race', now);
      if (stage === 'race' && allSettled()) return { changed: true, resets: [], results: complete() };
      return { changed: true, resets: [], results: null };
    },
  };
}
