import { createLobbyScreen } from './ui/lobby.ts';
import { accessToken } from './auth/session.ts';
import { io, type Socket } from 'socket.io-client';
import { createKeyboardInput } from './input/keyboard.ts';
import { createChat } from './ui/chat.ts';
import { createCarVisual } from './rendering/car.ts';
import { createFollowCamera } from './rendering/camera.ts';
import { createScene } from './rendering/scene.ts';
import { createMenuBackdrop } from './rendering/menu-backdrop.ts';
import { FixedStepClock, FIXED_TIMESTEP, PAUSE_THRESHOLD } from './simulation/fixed-step.ts';
import { createLapTimer, resetCurrentLap, stepLapTimer } from './simulation/lap-timer.ts';
import { createMinimap } from './ui/minimap.ts';
import { createLapDisplay } from './ui/lap-display.ts';
import { formatLapTime } from './ui/lap-display.ts';
import { createRaceLeaderboard } from './ui/race-leaderboard.ts';
import { createMultiplayerRoundUi } from './ui/multiplayer-round.ts';
import { createPerformanceStats } from './ui/performance-stats.ts';
import { createDeveloperConsole } from './ui/developer-console.ts';
import { createTimeTrialSetup } from './ui/time-trial-setup.ts';
import { copyTuningParameters, createTuningPanel } from './ui/tuning.ts';
import type { TuningParameters } from './ui/tuning.ts';
import { listBrowserTracks, loadActiveTrack, selectTrackForPlay } from './track/storage.ts';
import { listSharedTracks } from './track/api.ts';
import { splinePresets } from './track/spline-presets.ts';
import { buildRoadGeometry } from './track/road-geometry.ts';
const trackLayout = splinePresets[0]!.create();

import { createRoadWorld } from './simulation/road-world.ts';
import { createVehicleState, copyVehicleState, interpolateVehicleState } from './simulation/vehicle.ts';
import { drivingParameters, physicsParameters } from './simulation/parameters.ts';
import { respawnVehicle, stepSplineVehicle } from './simulation/spline-vehicle.ts';
import { neutralControls, RACE_TIMESTEP, type RaceInput, type RacePlayer } from './simulation/race.ts';
import type { DrivingControls, VehicleState } from './simulation/types.ts';
import type { SplineTrack as TrackLayout } from './track/spline-records.ts';
import type {
  ClientToServerEvents,
  CreateLobbyPayload,
  JoinLobbyPayload,
  LobbyPlayerSnapshot,
  LobbySnapshot,
  LobbySummary,
  MultiplayerBootstrap,
  RecordingClientReport,
  ServerToClientEvents,
  TrackOption,
  RaceSnapshot,
  RaceTransition,
  RaceDeathNotice,
  RaceDeathAcknowledgement,
} from './multiplayer/protocol.ts';
import { maxLobbyPlayers, playerColorPalette, trackOptions as presetTrackOptions } from './multiplayer/protocol.ts';
import { projectRemoteVehicle } from './multiplayer/remote-motion.ts';

interface MultiplayerPreferences {
  lobbyId: string | null;
}

interface RemoteCarEntry {
  visual: ReturnType<typeof createCarVisual>;
  state: VehicleState;
  snapshots: { state: VehicleState; receivedAt: number; tick: number; serverTimeMs: number; lifeId: number }[];
  arrivalIntervalsMs: number[];
  lastSnapshotAt: number | null;
  snapshotsReceived: number;
  bufferUnderruns: number;
  extrapolating: boolean;
  color: string;
  visible: boolean;
}

interface DrivingSession {
  trackId: string;
  trackName: string;
  layout: TrackLayout;
  playerColor: string;
  tuning: TuningParameters;
  state: VehicleState;
  view: ReturnType<typeof createScene>;
  car: ReturnType<typeof createCarVisual>;
  lapTimer: ReturnType<typeof createLapTimer>;
  step(elapsed: number, controls: Readonly<DrivingControls>, frozen?: boolean, spectatePlayerId?: string | null): void;
  drainInputs(): RaceInput[];
  pollDeathNotice(now: number): RaceDeathNotice | null;
  applyDeathAck(ack: RaceDeathAcknowledgement): void;
  applySnapshot(snapshot: RaceSnapshot, localPlayerId: string): void;
  applyTransition(transition: RaceTransition): void;
  setVerifiedBest(bestSeconds: number): void;
  setClockOffset(offsetMs: number, roundTripMs: number): void;
  syncRemotePlayers(players: LobbyPlayerSnapshot[], localPlayerId: string): void;
  getDiagnostics(): unknown;
  dispose(): void;
}

interface HomeScreenController {
  setStatus(message: string): void;
  setTrackOptions(trackOptions: TrackOption[]): void;
  setLobbies(lobbies: LobbySummary[]): void;
  getSelectedTrackId(): string;
  showLanding(): void;
  showMultiplayer(): void;
  showTimeTrialSetup(): void;
  dispose(): void;
}

interface LobbyScreenController {
  setRoom(room: LobbySnapshot | null, localPlayerId: string): void;
  setOnTrack(onTrack: boolean): void;
  setTrackOptions(trackOptions: TrackOption[]): void;
  setStatus(message: string): void;
  openRaceSetup(): void;
  dispose(): void;
}

const multiplayerLobbyKey = 'racing-multiplayer-lobby-v1';

function loadMultiplayerPreferences(): MultiplayerPreferences {
  try {
    const lobbyId = sessionStorage.getItem(multiplayerLobbyKey);
    return { lobbyId: typeof lobbyId === 'string' && lobbyId.trim() ? lobbyId.trim() : null };
  } catch {
    return { lobbyId: null };
  }
}

function saveMultiplayerPreferences(preferences: MultiplayerPreferences): void {
  try {
    if (preferences.lobbyId) sessionStorage.setItem(multiplayerLobbyKey, preferences.lobbyId);
    else sessionStorage.removeItem(multiplayerLobbyKey);
  } catch {
    // Persistent browser storage is optional.
  }
}

function colorToNumber(color: string): number {
  return Number.parseInt(color.slice(1), 16);
}

function localPlayerColor(room: LobbySnapshot | null, playerId: string): string {
  return room?.players.find((player) => player.id === playerId)?.color ?? '#ee7136';
}

function setScreenVisibility(screen: HTMLElement, visible: boolean): void {
  screen.hidden = !visible;
}

function createDrivingSession(canvas: HTMLCanvasElement, layout: TrackLayout, trackName: string, trackId: string, tuning: TuningParameters, playerColor: string, spawnIndex = 0, multiplayer = false, historicalBest: number | null = null, showVerifiedBest = false): DrivingSession {
  document.querySelector('#active-track-name')!.textContent = trackName;
  const lapContainer = document.querySelector<HTMLElement>('#lap-display');
  if (!lapContainer) throw new Error('Lap display is missing.');
  const road = buildRoadGeometry(layout);
  const finishLine = road.finish;
  const lapTimer = createLapTimer();
  let verifiedBest = historicalBest;
  const lapDisplay = createLapDisplay(lapContainer, finishLine !== null);
  lapDisplay.update(lapTimer, false, showVerifiedBest ? verifiedBest : undefined);

  const state = createVehicleState();
  const spawn = road.spawns[spawnIndex] ?? road.spawns[0]!;
  respawnVehicle(state, spawn);
  const collisionWorld = createRoadWorld(road);
  const previous = createVehicleState();
  const rendered = createVehicleState();
  copyVehicleState(state, previous);
  copyVehicleState(state, rendered);

  const minimapCanvas = document.querySelector<HTMLCanvasElement>('#minimap');
  if (!minimapCanvas) throw new Error('Minimap canvas is missing.');
  const minimap = createMinimap(minimapCanvas, layout);

  const clock = new FixedStepClock(multiplayer ? RACE_TIMESTEP : FIXED_TIMESTEP);
  const view = createScene(canvas, road);
  const car = createCarVisual(colorToNumber(playerColor));
  const followCamera = createFollowCamera(view.camera, state);
  view.scene.add(car.object);
  const remoteCars = new Map<string, RemoteCarEntry>();
  let simulationTicks = 0;
  let lastFrameSteps = 0;
  let lastFramePhysicsMs = 0;
  let lastFrameElapsedMs = 0;
  let nextInputSequence = 0;
  let lastAppliedServerTick = -1;
  let lastPositionErrorMeters = 0;
  let lastConfirmedRespawnTick = -1;
  let confirmedLifeId = 0;
  let confirmedAttemptId = 0;
  let deathPending = false;
  let nextDeathNoticeId = 0;
  let activeDeathNoticeId = -1;
  let lastDeathNoticeAt = -Infinity;
  let lastAuthoritativeTimerAt = performance.now();
  let serverClockOffsetMs: number | null = null;
  let bestClockRoundTripMs = Infinity;
  const pendingInputs: RaceInput[] = [];
  const unsentInputs: RaceInput[] = [];
  const visualCorrection = { x: 0, y: 0, z: 0 };

  function updateMinimap(): void {
    const markers: { state: Readonly<VehicleState>; color: string }[] = [{ state: rendered, color: playerColor }];
    for (const remote of remoteCars.values()) {
      if (!remote.visible) continue;
      markers.push({ state: remote.state, color: remote.color });
    }
    minimap.update(markers);
  }

  function syncRemotePlayers(players: LobbyPlayerSnapshot[], localPlayerId: string): void {
    const wantedIds = new Set(players.filter((player) => player.id !== localPlayerId).map((player) => player.id));
    for (const [playerId, remote] of remoteCars) {
      if (wantedIds.has(playerId)) continue;
      view.scene.remove(remote.visual.object);
      remote.visual.dispose();
      remoteCars.delete(playerId);
    }

    for (const player of players) {
      if (player.id === localPlayerId) continue;
      const existing = remoteCars.get(player.id);
      if (!existing || existing.color !== player.color) {
        if (existing) {
          view.scene.remove(existing.visual.object);
          existing.visual.dispose();
          remoteCars.delete(player.id);
        }
        const visual = createCarVisual(colorToNumber(player.color));
        visual.object.visible = false;
        view.scene.add(visual.object);
        remoteCars.set(player.id, {
          visual, state: createVehicleState(), snapshots: [], arrivalIntervalsMs: [], lastSnapshotAt: null,
          snapshotsReceived: 0, bufferUnderruns: 0, extrapolating: false, color: player.color, visible: false,
        });
      }
      const remote = remoteCars.get(player.id)!;
      remote.color = player.color;
      if (player.state) {
        if (!remote.snapshots.length) {
          copyVehicleState(player.state, remote.state);
          remote.visual.update(remote.state);
          remote.visible = true;
          remote.visual.object.visible = true;
        }
      } else {
        remote.visual.object.visible = false;
        remote.visible = false;
      }
    }
    updateMinimap();
  }

  function updateRemotePlayer(playerId: string, snapshot: VehicleState, lifeId: number, tick: number, serverTimeMs: number): void {
    let remote = remoteCars.get(playerId);
    if (!remote) {
      const visual = createCarVisual(0x8ca0ab);
      view.scene.add(visual.object);
      remote = {
        visual, state: createVehicleState(), snapshots: [], arrivalIntervalsMs: [], lastSnapshotAt: null,
        snapshotsReceived: 0, bufferUnderruns: 0, extrapolating: false, color: '#8ca0ab', visible: true,
      };
      remoteCars.set(playerId, remote);
    }
    pushRemoteSnapshot(remote, snapshot, lifeId, tick, serverTimeMs);
  }

  function pushRemoteSnapshot(remote: RemoteCarEntry, snapshot: Readonly<VehicleState>, lifeId: number, tick: number, serverTimeMs: number): void {
    const state = createVehicleState();
    copyVehicleState(snapshot, state);
    const receivedAt = performance.now();
    const latest = remote.snapshots.at(-1);
    if (latest && tick <= latest.tick) return;
    const teleported = latest !== undefined && (latest.lifeId !== lifeId
      || Math.hypot(state.position.x - latest.state.position.x, state.position.z - latest.state.position.z) > 24);
    if (teleported) {
      remote.snapshots.length = 0;
      remote.arrivalIntervalsMs.length = 0;
      remote.lastSnapshotAt = null;
      remote.extrapolating = false;
    }
    if (remote.lastSnapshotAt !== null) {
      remote.arrivalIntervalsMs.push(receivedAt - remote.lastSnapshotAt);
      if (remote.arrivalIntervalsMs.length > 30) remote.arrivalIntervalsMs.shift();
    }
    remote.lastSnapshotAt = receivedAt;
    remote.snapshotsReceived++;
    remote.snapshots.push({ state, receivedAt, tick, serverTimeMs, lifeId });
    if (remote.snapshots.length > 12) remote.snapshots.splice(0, remote.snapshots.length - 12);
    remote.visible = true;
    remote.visual.object.visible = true;
    if (remote.snapshots.length === 1) {
      copyVehicleState(state, remote.state);
      remote.visual.update(remote.state);
    }
  }

  function renderRemotePlayers(now: number): void {
    // Local prediction draws the player's car close to the present. Render
    // other players on that same server timeline instead of 120 ms in the past.
    const renderTime = now - (serverClockOffsetMs ?? now);
    for (const remote of remoteCars.values()) {
      const snapshots = remote.snapshots;
      if (!remote.visible || snapshots.length === 0) continue;
      while (snapshots.length > 2 && snapshots[1]!.serverTimeMs <= renderTime) snapshots.shift();
      const older = snapshots[0]!;
      const newer = snapshots[1];
      const newest = snapshots.at(-1)!;
      const underrun = renderTime > newest.serverTimeMs;
      if (underrun && !remote.extrapolating) remote.bufferUnderruns++;
      remote.extrapolating = underrun;
      if (newer && renderTime <= newer.serverTimeMs) {
        const span = newer.serverTimeMs - older.serverTimeMs;
        const alpha = span > 0 ? Math.max(0, Math.min(1, (renderTime - older.serverTimeMs) / span)) : 1;
        interpolateVehicleState(older.state, newer.state, alpha, remote.state);
      } else {
        const anchor = newer && renderTime > newer.serverTimeMs ? newer : older;
        projectRemoteVehicle(anchor.state,
          Math.max(0, renderTime - anchor.serverTimeMs) * tuning.physics.physicsTime,
          tuning.driving.wheelbase, remote.state);
      }
      remote.visual.update(remote.state);
    }
  }

  function applyAuthoritativePlayer(player: RacePlayer, tick: number, kind?: RaceTransition['kind']): void {
    if (player.lifeId < confirmedLifeId || player.attemptId < confirmedAttemptId) return;
    const newLife = player.lifeId > confirmedLifeId;
    const newAttempt = player.attemptId > confirmedAttemptId;
    const transitionKind = kind ?? (newAttempt ? player.lastTransition : null);
    if (newLife) {
      pendingInputs.length = 0;
      unsentInputs.length = 0;
      deathPending = false;
      activeDeathNoticeId = -1;
      clock.reset();
    }
    confirmedLifeId = player.lifeId;
    confirmedAttemptId = player.attemptId;
    const before = { ...state.position };
    copyVehicleState(player.state, state);
    while (pendingInputs.length && pendingInputs[0]!.sequence <= player.acknowledgedInput) pendingInputs.shift();
    for (const input of pendingInputs) {
      if (input.lifeId !== player.lifeId) continue;
      stepSplineVehicle(state, input.controls, RACE_TIMESTEP * tuning.physics.physicsTime, collisionWorld, spawn,
        tuning.physics, tuning.driving, false);
    }
    Object.assign(lapTimer, player.lapTimer, { checkpointsVisited: [...player.lapTimer.checkpointsVisited] });
    lastAuthoritativeTimerAt = performance.now();
    const error = Math.hypot(before.x - state.position.x, before.y - state.position.y, before.z - state.position.z);
    lastPositionErrorMeters = error;
    if (newLife || transitionKind === 'respawn' || error >= 5) {
      visualCorrection.x = visualCorrection.y = visualCorrection.z = 0;
      copyVehicleState(state, rendered);
      followCamera.reset(rendered);
      if (newLife || transitionKind === 'respawn') lastConfirmedRespawnTick = tick;
    } else {
      visualCorrection.x += before.x - state.position.x;
      visualCorrection.y += before.y - state.position.y;
      visualCorrection.z += before.z - state.position.z;
    }
    copyVehicleState(state, previous);
    if (newAttempt || kind) {
      car.update(rendered);
      lapDisplay.update(lapTimer, false, showVerifiedBest ? verifiedBest : undefined);
      updateMinimap();
    }
  }

  function applySnapshot(snapshot: RaceSnapshot, localPlayerId: string): void {
    if (!multiplayer || snapshot.tick <= lastAppliedServerTick) return;
    lastAppliedServerTick = snapshot.tick;
    const now = performance.now();
    const measuredOffset = now - snapshot.serverTimeMs;
    if (serverClockOffsetMs === null) serverClockOffsetMs = measuredOffset;
    else if (!Number.isFinite(bestClockRoundTripMs)) serverClockOffsetMs = Math.min(serverClockOffsetMs + 0.25, measuredOffset);
    for (const player of snapshot.players) {
      if (player.id !== localPlayerId) {
        updateRemotePlayer(player.id, player.state, player.lifeId, snapshot.tick, snapshot.serverTimeMs);
      } else {
        applyAuthoritativePlayer(player, snapshot.tick);
      }
    }
  }

  function applyTransition(transition: RaceTransition): void {
    if (!multiplayer || transition.tick <= lastAppliedServerTick) return;
    lastAppliedServerTick = transition.tick;
    applyAuthoritativePlayer(transition.player, transition.tick, transition.kind);
  }

  function applyDeathAck(ack: RaceDeathAcknowledgement): void {
    if (!deathPending || ack.noticeId !== activeDeathNoticeId) return;
    if (ack.status === 'pending') return;
    if (ack.tick < lastAppliedServerTick) return;
    if (ack.tick >= lastAppliedServerTick && ack.player.lifeId >= confirmedLifeId) {
      lastAppliedServerTick = ack.tick;
      applyAuthoritativePlayer(ack.player, ack.tick, ack.status === 'respawned' ? 'respawn' : undefined);
    }
    if (ack.status === 'rejected' || ack.player.lifeId > confirmedLifeId) {
      deathPending = false;
      activeDeathNoticeId = -1;
    }
  }

  function pollDeathNotice(now: number): RaceDeathNotice | null {
    if (!deathPending || now - lastDeathNoticeAt < 500) return null;
    lastDeathNoticeAt = now;
    return { noticeId: activeDeathNoticeId, lifeId: confirmedLifeId };
  }

  function setClockOffset(offsetMs: number, roundTripMs: number): void {
    if (!multiplayer || !Number.isFinite(offsetMs) || !Number.isFinite(roundTripMs) || roundTripMs > 2000) return;
    if (roundTripMs <= bestClockRoundTripMs + 20) {
      serverClockOffsetMs = !Number.isFinite(bestClockRoundTripMs) || serverClockOffsetMs === null
        ? offsetMs : serverClockOffsetMs * 0.8 + offsetMs * 0.2;
      bestClockRoundTripMs = Math.min(bestClockRoundTripMs, roundTripMs);
    }
  }

  function step(elapsed: number, controls: Readonly<DrivingControls>, frozen = false, spectatePlayerId: string | null = null): void {
    if (multiplayer && frozen) {
      clock.reset();
      pendingInputs.length = 0;
      unsentInputs.length = 0;
      lastFrameSteps = 0;
      lastFramePhysicsMs = 0;
      lastFrameElapsedMs = elapsed * 1000;
      copyVehicleState(state, rendered);
      renderRemotePlayers(performance.now());
      car.object.visible = spectatePlayerId === null;
      car.update(rendered);
      const cameraTarget = spectatePlayerId ? remoteCars.get(spectatePlayerId)?.state ?? rendered : rendered;
      followCamera.update(cameraTarget, elapsed);
      view.followSun(cameraTarget.position);
      view.renderer.render(view.scene, view.camera);
      lapDisplay.update(lapTimer, false, showVerifiedBest ? verifiedBest : undefined);
      updateMinimap();
      return;
    }
    car.object.visible = true;
    if (elapsed > PAUSE_THRESHOLD) copyVehicleState(state, previous);
    let respawned = false;
    lastFrameSteps = 0;
    lastFramePhysicsMs = 0;
    lastFrameElapsedMs = elapsed * 1000;
    const alpha = clock.advance(elapsed, (timestep) => {
      const physicsStartedAt = performance.now();
      const simulatedTimestep = timestep * tuning.physics.physicsTime;
      copyVehicleState(state, previous);
      const effectiveControls = deathPending ? neutralControls : controls;
      if (stepSplineVehicle(state, effectiveControls, simulatedTimestep, collisionWorld, spawn,
        tuning.physics, tuning.driving, !multiplayer)) {
        if (!multiplayer) resetCurrentLap(lapTimer);
        copyVehicleState(state, previous);
        respawned = true;
      } else if (!multiplayer) {
        stepLapTimer(lapTimer, previous.position, state.position, simulatedTimestep, finishLine, road.checkpoints);
      }
      if (multiplayer) {
        if (!deathPending && !state.grounded && state.airborneTime >= tuning.physics.respawnDelay) {
          deathPending = true;
          activeDeathNoticeId = ++nextDeathNoticeId;
          lastDeathNoticeAt = -Infinity;
          pendingInputs.length = 0;
          unsentInputs.length = 0;
        }
        const input = { sequence: ++nextInputSequence, lifeId: confirmedLifeId,
          controls: { ...(deathPending ? neutralControls : effectiveControls) } };
        if (!deathPending) pendingInputs.push(input);
        unsentInputs.push(input);
        if (pendingInputs.length > 120) pendingInputs.shift();
      }
      lastFramePhysicsMs += performance.now() - physicsStartedAt;
      lastFrameSteps++;
      simulationTicks++;
    });

    interpolateVehicleState(previous, state, alpha, rendered);
    if (multiplayer) {
      const smoothing = Math.exp(-Math.max(0, elapsed) * 14);
      rendered.position.x += visualCorrection.x;
      rendered.position.y += visualCorrection.y;
      rendered.position.z += visualCorrection.z;
      visualCorrection.x *= smoothing;
      visualCorrection.y *= smoothing;
      visualCorrection.z *= smoothing;
    }
    car.update(rendered);
    renderRemotePlayers(performance.now());
    if (respawned) followCamera.reset(rendered);
    else followCamera.update(rendered, elapsed);
    view.followSun(rendered.position);
    view.renderer.render(view.scene, view.camera);
    const displayedElapsed = deathPending ? 0 : multiplayer && lapTimer.running
      ? lapTimer.elapsed + Math.min(0.1, (performance.now() - lastAuthoritativeTimerAt) / 1000)
        * tuning.physics.physicsTime
      : lapTimer.elapsed;
    lapDisplay.update({ ...lapTimer, elapsed: displayedElapsed }, deathPending,
      showVerifiedBest ? verifiedBest : undefined);
    updateMinimap();
  }

  function getDiagnostics(): unknown {
    const now = performance.now();
    const renderer = view.renderer;
    const drawStats = renderer.info.render;
    const memoryStats = renderer.info.memory;
    return {
      vehicle: { speedMps: state.speed, speedKph: Math.abs(state.speed) * 3.6, grounded: state.grounded,
        airborneSeconds: state.airborneTime, headingRadians: state.heading },
      simulation: { tickRateHz: 1 / (multiplayer ? RACE_TIMESTEP : FIXED_TIMESTEP), totalTicks: simulationTicks,
        stepsLastFrame: lastFrameSteps, physicsMsLastFrame: lastFramePhysicsMs, frameDeltaMs: lastFrameElapsedMs,
        lastServerTick: lastAppliedServerTick, unacknowledgedInputs: pendingInputs.length,
        positionErrorMeters: lastPositionErrorMeters, lastConfirmedRespawnTick,
        lifeId: confirmedLifeId, attemptId: confirmedAttemptId, deathPending,
        timerRunning: lapTimer.running, timerSeconds: lapTimer.elapsed },
      renderer: { pixelRatio: renderer.getPixelRatio(), drawCalls: drawStats.calls, triangles: drawStats.triangles,
        geometries: memoryStats.geometries, textures: memoryStats.textures, trackTriangles: view.road.triangles.length },
      remotePlayers: [...remoteCars].map(([id, remote]) => {
        const intervals = remote.arrivalIntervalsMs;
        const mean = intervals.length ? intervals.reduce((sum, value) => sum + value, 0) / intervals.length : null;
        const jitter = mean === null ? null : Math.sqrt(intervals.reduce((sum, value) => sum + (value - mean) ** 2, 0) / intervals.length);
        return { id, snapshotAgeMs: remote.lastSnapshotAt === null ? null : now - remote.lastSnapshotAt,
          interarrivalJitterMs: jitter, bufferUnderruns: remote.bufferUnderruns, extrapolating: remote.extrapolating };
      }),
    };
  }

  return {
    trackId,
    trackName,
    layout,
    playerColor,
    tuning,
    state,
    view,
    car,
    lapTimer,
    step,
    drainInputs(): RaceInput[] { return unsentInputs.splice(0); },
    pollDeathNotice,
    applyDeathAck,
    applySnapshot,
    applyTransition,
    setVerifiedBest(bestSeconds: number): void {
      if (!showVerifiedBest || !Number.isFinite(bestSeconds) || bestSeconds <= 0) return;
      verifiedBest = verifiedBest === null ? bestSeconds : Math.min(verifiedBest, bestSeconds);
      lapDisplay.update(lapTimer, deathPending, verifiedBest);
    },
    setClockOffset,
    syncRemotePlayers,
    getDiagnostics,
    dispose(): void {
      for (const remote of remoteCars.values()) {
        view.scene.remove(remote.visual.object);
        remote.visual.dispose();
      }
      remoteCars.clear();
      car.dispose();
      minimap.dispose();
      view.dispose();
    },
  };
}

function createHomeScreen(root: HTMLElement, callbacks: {
  onTimeTrial(): void;
  onMultiplayer(): void;
  onBackToLanding(): void;
  onCreateLobby(payload: CreateLobbyPayload): void;
  onJoinLobby(payload: JoinLobbyPayload): void;
}, username: string, preferredTrackId = ''): HomeScreenController {
  root.innerHTML = `
    <div class="home-profile">
      <a id="home-account-link" class="home-account-link" href="/account/" aria-label="Your account" title="Your account"><span id="home-account-avatar" aria-hidden="true">R</span><span id="home-profile-name" class="home-profile-name"></span></a>
      <button id="home-profile-toggle" class="home-profile-toggle" type="button" aria-label="Account menu" aria-expanded="false" aria-controls="home-profile-menu">⌄</button>
      <div id="home-profile-menu" class="home-profile-menu" hidden>
        <a href="/account/">Dashboard &amp; settings</a>
        <button id="home-sign-out" type="button">Sign out</button>
      </div>
    </div>
    <div class="home-shell">
      <section id="home-landing" class="home-landing">
        <h1 class="home-brand"><span>BEGGAR'S</span><span>GRAND <em>PRIX</em></span></h1>
        <nav class="home-choice-grid" aria-label="Main options">
          <button id="home-time-trial" class="home-choice" type="button"><strong>Time Trial</strong></button>
          <button id="home-multiplayer" class="home-choice" type="button"><strong>Multiplayer</strong></button>
          <a class="home-choice home-choice-link" href="/map-builder/"><strong>Track Builder</strong></a>
        </nav>
      </section>
      <section id="home-multiplayer-menu" class="home-multiplayer" hidden>
        <header class="multiplayer-entry-header">
          <button id="home-back" class="back-button" type="button">&#8592; Back</button>
          <span class="menu-eyebrow">MULTIPLAYER</span><h1>Create or join a lobby</h1>
          <p class="multiplayer-account-name">Playing as <strong id="home-username"></strong></p>
        </header>
        <div class="multiplayer-entry-tabs" aria-label="Lobby options">
          <button id="home-create-tab" type="button" aria-pressed="false">Create</button>
          <button id="home-join-tab" type="button" aria-pressed="true">Join</button>
        </div>
        <section id="home-create-panel" hidden>
          <div class="multiplayer-launch">
            <p class="multiplayer-account-name">Your room: <strong id="home-created-lobby-name"></strong></p>
            <button id="home-create-lobby" class="trial-start-button" type="button">Create lobby</button>
          </div>
        </section>
        <section id="home-join-panel"><h2>Open lobbies</h2><div id="home-lobby-list" class="lobby-list"></div></section>
        <div id="home-status" class="multiplayer-status">Connect to view open lobbies.</div>
      </section>
    </div>
  `;

  const status = root.querySelector<HTMLElement>('#home-status')!;
  root.querySelector('#home-username')!.textContent = username;
  root.querySelector('#home-created-lobby-name')!.textContent = `${username}'s Lobby`;
  const createButton = root.querySelector<HTMLButtonElement>('#home-create-lobby')!;
  const lobbyList = root.querySelector<HTMLElement>('#home-lobby-list')!;
  const homeShell = root.querySelector<HTMLElement>('.home-shell')!;
  const landing = root.querySelector<HTMLElement>('#home-landing')!;
  const multiplayerMenu = root.querySelector<HTMLElement>('#home-multiplayer-menu')!;
  root.querySelector<HTMLButtonElement>('#home-time-trial')!.addEventListener('click', callbacks.onTimeTrial);
  root.querySelector<HTMLButtonElement>('#home-multiplayer')!.addEventListener('click', callbacks.onMultiplayer);
  root.querySelector<HTMLButtonElement>('#home-back')!.addEventListener('click', () => { callbacks.onBackToLanding(); });
  const createTab = root.querySelector<HTMLButtonElement>('#home-create-tab')!;
  const joinTab = root.querySelector<HTMLButtonElement>('#home-join-tab')!;
  function showEntryTab(create: boolean): void {
    root.querySelector<HTMLElement>('#home-create-panel')!.hidden = !create;
    root.querySelector<HTMLElement>('#home-join-panel')!.hidden = create;
    createTab.setAttribute('aria-pressed', String(create));
    joinTab.setAttribute('aria-pressed', String(!create));
  }
  createTab.addEventListener('click', () => showEntryTab(true));
  joinTab.addEventListener('click', () => showEntryTab(false));
  let trackOptions: TrackOption[] = [];

  function selectedTrackId(): string {
    return trackOptions.find(track => track.id === preferredTrackId)?.id ?? trackOptions[0]?.id ?? 'default';
  }

  function renderLobbies(lobbies: LobbySummary[]): void {
    lobbyList.innerHTML = '';
    if (lobbies.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'multiplayer-empty';
      empty.textContent = 'No open lobbies right now.';
      lobbyList.append(empty);
      return;
    }
    for (const lobby of lobbies) {
      const card = document.createElement('article');
      card.className = 'multiplayer-card';
      const title = document.createElement('strong');
      title.textContent = lobby.name;
      const meta = document.createElement('small');
      meta.textContent = `${lobby.playerCount} / ${maxLobbyPlayers} players ? Host: ${lobby.hostName}`;
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = lobby.playerCount >= maxLobbyPlayers ? 'Lobby full' : 'Join lobby';
      button.disabled = lobby.playerCount >= maxLobbyPlayers;
      button.addEventListener('click', () => callbacks.onJoinLobby({ lobbyId: lobby.id }));
      card.append(title, meta, button);
      lobbyList.append(card);
    }
  }

  createButton.addEventListener('click', () => {
    callbacks.onCreateLobby({ trackId: selectedTrackId() });
  });

  return {
    setStatus(message: string): void { status.textContent = message; },
    setTrackOptions(options: TrackOption[]): void {
      trackOptions = options;
    },
    setLobbies(lobbies: LobbySummary[]): void { renderLobbies(lobbies); },
    getSelectedTrackId(): string { return selectedTrackId(); },
    showLanding(): void { homeShell.hidden = false; landing.hidden = false; multiplayerMenu.hidden = true; },
    showMultiplayer(): void { showEntryTab(false); homeShell.hidden = false; landing.hidden = true; multiplayerMenu.hidden = false; },
    showTimeTrialSetup(): void { homeShell.hidden = true; landing.hidden = true; multiplayerMenu.hidden = true; },
    dispose(): void { createButton.replaceWith(createButton.cloneNode(true)); },
  };
}

export function startPrototype(canvas: HTMLCanvasElement, username = 'Player') {
  const selectedTrack = loadActiveTrack(localStorage);
  const fallbackLayout = selectedTrack?.layout ?? trackLayout;
  const fallbackTrackName = selectedTrack?.name ?? 'Default circuit';
  const fallbackTrackId = selectedTrack?.id ?? 'local-default';
  const timeTrialColorKey = 'racing-time-trial-color-v1';
  let timeTrialColor: string = playerColorPalette[0];
  try {
    const storedColor = localStorage.getItem(timeTrialColorKey);
    if (playerColorPalette.includes(storedColor as typeof playerColorPalette[number])) timeTrialColor = storedColor as typeof timeTrialColor;
  } catch { /* Color preferences are optional. */ }
  let timeTrialTrack: TrackOption = { id: fallbackTrackId, name: fallbackTrackName, layout: fallbackLayout };

  const homeRoot = document.querySelector<HTMLElement>('#home-screen');
  const lobbyRoot = document.querySelector<HTMLElement>('#lobby-screen');
  const raceRoot = document.querySelector<HTMLElement>('#race-screen');
  const tuningPanelElement = document.querySelector<HTMLElement>('#tuning-panel');
  const tuningToggle = document.querySelector<HTMLButtonElement>('#tuning-toggle');
  const raceLeaveButton = document.querySelector<HTMLButtonElement>('#race-leave');
  const lobbyPanelToggle = document.querySelector<HTMLButtonElement>('#lobby-panel-toggle');
  const roundSetupToggle = document.querySelector<HTMLButtonElement>('#round-setup-toggle');
  const roundCancelHint = document.querySelector<HTMLElement>('#round-cancel-hint');
  const raceRoomName = document.querySelector<HTMLElement>('#race-room-name');
  const raceRoomStatus = document.querySelector<HTMLElement>('#race-room-status');
  const performanceStatsElement = document.querySelector<HTMLElement>('#performance-stats');
  const raceSpeed = document.querySelector<HTMLOutputElement>('#race-speed-value')!;
  const lapCurrent = document.querySelector<HTMLOutputElement>('#lap-current')!;
  const lapBest = document.querySelector<HTMLOutputElement>('#lap-best')!;
  const lapLast = document.querySelector<HTMLOutputElement>('#lap-last')!;
  const lapDelta = document.querySelector<HTMLOutputElement>('#lap-delta')!;
  const lapBestRow = lapBest.closest<HTMLElement>('.lap-row')!;
  const lapBestLabel = document.querySelector<HTMLElement>('#lap-best')!.previousElementSibling as HTMLElement;
  const lapLastLabel = document.querySelector<HTMLElement>('#lap-last')!.previousElementSibling as HTMLElement;
  const lapLabel = document.querySelector<HTMLElement>('#lap-display .lap-label')!;
  const lapStatus = document.querySelector<HTMLElement>('#lap-status')!;
  const raceLeaderboardElement = document.querySelector<HTMLElement>('#race-leaderboard');

  if (!homeRoot || !lobbyRoot || !raceRoot || !tuningPanelElement || !tuningToggle || !raceLeaveButton || !lobbyPanelToggle || !roundSetupToggle || !roundCancelHint || !raceRoomName || !raceRoomStatus || !performanceStatsElement || !raceLeaderboardElement) {
    throw new Error('Multiplayer UI is missing.');
  }

  const homeScreenRoot = homeRoot;
  const lobbyScreenRoot = lobbyRoot;
  const raceScreenRoot = raceRoot;
  const tuningPanelRoot = tuningPanelElement;
  const tuningToggleButton = tuningToggle;
  const raceLeaveButtonElement = raceLeaveButton;
  const raceRoomNameElement = raceRoomName;
  const raceRoomStatusElement = raceRoomStatus;
  const performanceStats = createPerformanceStats(performanceStatsElement);
  const raceLeaderboard = createRaceLeaderboard(raceLeaderboardElement);
  const raceViewport = raceScreenRoot.querySelector<HTMLElement>('.game-viewport')!;
  canvas.tabIndex = -1;
  const roundUi = createMultiplayerRoundUi(raceViewport);
  const menuBackdropCanvas = document.createElement('canvas');
  menuBackdropCanvas.className = 'menu-car-backdrop';
  menuBackdropCanvas.setAttribute('aria-hidden', 'true');
  document.body.prepend(menuBackdropCanvas);
  const menuBackdrop = createMenuBackdrop(menuBackdropCanvas);

  const tuningPanel = createTuningPanel(tuningPanelElement, tuningToggle);
  const input = createKeyboardInput(window, document);
  const preferences = loadMultiplayerPreferences();

  let homeScreen: HomeScreenController;
  let lobbyScreen: LobbyScreenController;
  let timeTrialSetup: ReturnType<typeof createTimeTrialSetup>;
  let session: DrivingSession | null = null;
  let currentMode: 'home' | 'multiplayer' | 'time-trial-setup' | 'lobby' | 'race' = 'home';
  let activeRoom: LobbySnapshot | null = null;
  let lobbyPanelOpen = false;
  let raceSetupOpen = false;
  let lastRoundReceivedAt = 0;
  let displayedRaceTime = 0;
  let displayedRaceRoundId = '';
  let soloRaceActive = false;
  let soloRequestId = 0;
  let pendingSoloRequest = 0;
  let lastSoloHandling = '';
  let timeTrialBest: number | null = null;
  let localPlayerId = '';
  let bootstrap: MultiplayerBootstrap | null = null;
  let lastReadyRoundId = '';
  let animationFrame = 0;
  let lastFrameTime: number | null = null;
  const chat = createChat(text => { if (socket.connected) socket.emit('multiplayer:chat', text); },
    open => input.setEnabled(currentMode === 'race' && !open && !lobbyPanelOpen && !raceSetupOpen));
  const networkStats = {
    startedAt: performance.now(),
    stateMessagesSent: 0, stateMessagesReceived: 0, approximateJsonBytesSent: 0, approximateJsonBytesReceived: 0,
    roomEventsReceived: 0, lobbyListEventsReceived: 0, trackListEventsReceived: 0, bootstrapEventsReceived: 0,
    errorsReceived: 0, disconnects: 0, connects: 0, lastStateReceivedAt: null as number | null,
    stateArrivalIntervalsMs: [] as number[],
  };

  function setMode(mode: 'home' | 'multiplayer' | 'time-trial-setup' | 'lobby' | 'race'): void {
    currentMode = mode;
    menuBackdrop.setActive(mode === 'home');
    setScreenVisibility(homeScreenRoot, mode === 'home' || mode === 'multiplayer' || mode === 'time-trial-setup');
    setScreenVisibility(lobbyScreenRoot, mode === 'lobby' || mode === 'race' && lobbyPanelOpen);
    lobbyScreenRoot.classList.toggle('is-overlay', mode === 'race' && lobbyPanelOpen);
    setScreenVisibility(raceScreenRoot, mode === 'race');
    const isTimeTrial = mode === 'race' && activeRoom === null;
    tuningPanelRoot.hidden = !isTimeTrial || document.body.classList.contains('tuning-collapsed');
    tuningToggleButton.hidden = !isTimeTrial;
    raceScreenRoot.classList.toggle('multiplayer-race', mode === 'race' && activeRoom !== null);
    lobbyPanelToggle!.hidden = mode !== 'race' || activeRoom?.phase !== 'lobby';
    roundSetupToggle!.hidden = mode !== 'race' || activeRoom?.phase !== 'lobby' || activeRoom.hostId !== localPlayerId;
    roundCancelHint!.hidden = mode !== 'race' || !activeRoom || activeRoom.phase === 'lobby' || activeRoom.hostId !== localPlayerId;
    chat.setRoom((mode === 'lobby' || mode === 'race') ? activeRoom?.id ?? null : null);
    input.setEnabled(mode === 'race' && !chat.isOpen && !lobbyPanelOpen && !raceSetupOpen);
    performanceStats.setActive(mode === 'race');
  }

  function disposeSession(): void {
    session?.dispose();
    session = null;
  }

  function ensureSession(room: LobbySnapshot | null): DrivingSession {
    const desiredLayout = room?.settings.layout ?? timeTrialTrack.layout;
    const desiredTrackName = room?.settings.trackName ?? timeTrialTrack.name;
    const desiredTrackId = room?.settings.trackId ?? timeTrialTrack.id;
    const desiredColor = room ? localPlayerColor(room, localPlayerId) : timeTrialColor;
    if (!session || session.trackId !== desiredTrackId || session.playerColor !== desiredColor) {
      disposeSession();
      session = createDrivingSession(canvas, desiredLayout, desiredTrackName, desiredTrackId, room?.settings.handling ?? tuningPanel.parameters, desiredColor, Math.max(0, room?.players.findIndex(p => p.id === localPlayerId) ?? 0), room !== null || soloRaceActive, room ? null : timeTrialBest, room === null && soloRaceActive);
    }
    return session;
  }

  function enterHomeScreen(message = 'Choose a lobby or create a new one.'): void {
    if (pendingSoloRequest || soloRaceActive) {
      pendingSoloRequest = 0;
      soloRaceActive = false;
      if (socket.connected) socket.emit('time-trial:leave');
    }
    disposeSession();
    lobbyPanelOpen = false;
    raceSetupOpen = false;
    lobbyScreen?.setRoom(null, localPlayerId);
    setMode('home');
    timeTrialSetup?.hide();
    homeScreen.showLanding();
    homeScreen.setStatus(message);
    homeScreen.setLobbies(bootstrap?.lobbies ?? []);
    activeRoom = null;
    raceLeaderboard.setRoom(null, localPlayerId);
    roundUi.setRound(null, localPlayerId);
    raceRoomNameElement.textContent = 'Race room';
    raceRoomStatusElement.textContent = 'Waiting for a race to start';
    saveMultiplayerPreferences({ lobbyId: null });
  }

  function enterRaceScreen(room: LobbySnapshot): void {
    const enteringFromMenu = currentMode !== 'race';
    if (room.round) lastRoundReceivedAt = performance.now();
    if (room.phase === 'loading') roundUi.hideResults();
    if (activeRoom?.id === room.id && (activeRoom.phase === 'lobby') !== (room.phase === 'lobby')) disposeSession();
    if (room.phase !== 'lobby') lobbyPanelOpen = false;
    activeRoom = room;
    setMode('race');
    raceRoomNameElement.textContent = room.name;
    raceRoomStatusElement.textContent = room.phase === 'lobby' ? 'Free drive · host can set up a race'
      : room.phase === 'qualifying' ? 'Qualifying lap'
      : room.phase === 'countdown' ? 'Starting countdown'
        : room.phase === 'loading' ? 'Waiting for drivers to load' : 'Race in progress';
    const currentSession = ensureSession(room);
    if (enteringFromMenu && room.phase === 'lobby') canvas.focus({ preventScroll: true });
    lobbyScreen.setOnTrack(true);
    lobbyScreen.setRoom(room, localPlayerId);
    raceLeaderboard.setRoom(room, localPlayerId);
    roundUi.setRound(room.round, localPlayerId);
    currentSession.syncRemotePlayers(room.players, localPlayerId);
    if (room.phase === 'loading' && room.round && room.round.id !== lastReadyRoundId && socket.connected) {
      lastReadyRoundId = room.round.id;
      socket.emit('multiplayer:ready', { roundId: room.round.id });
    }
    saveMultiplayerPreferences({ lobbyId: room.id });
  }

  function enterLobbyScreen(room: LobbySnapshot): void {
    activeRoom = room;
    lobbyPanelOpen = false;
    setMode('lobby');
    lobbyScreen.setOnTrack(false);
    lobbyScreen.setRoom(room, localPlayerId);
    raceLeaderboard.setRoom(room, localPlayerId);
    saveMultiplayerPreferences({ lobbyId: room.id });
  }

  function enterTimeTrial(track: TrackOption, color: string): void {
    tuningPanel.resetDefaults();
    const leavingRoom = activeRoom !== null;
    activeRoom = null;
    lobbyPanelOpen = false;
    raceSetupOpen = false;
    lobbyScreen.setRoom(null, localPlayerId);
    raceLeaderboard.setRoom(null, localPlayerId);
    timeTrialTrack = track;
    timeTrialBest = null;
    timeTrialColor = color;
    try {
      selectTrackForPlay(localStorage, track.name, track.layout, track.id);
      localStorage.setItem(timeTrialColorKey, color);
    } catch { /* The current session still uses this selection if storage is unavailable. */ }
    if (leavingRoom && socket.connected) socket.emit('multiplayer:leave-lobby');
    disposeSession();
    soloRaceActive = false;
    pendingSoloRequest = ++soloRequestId;
    timeTrialSetup.setStatus('Preparing time trial...');
    if (!socket.connected) socket.connect();
    else startPendingTimeTrial();
  }

  function startPendingTimeTrial(): void {
    if (!pendingSoloRequest || !socket.connected) return;
    socket.emit('time-trial:start', { requestId: pendingSoloRequest, trackId: timeTrialTrack.id,
      name: timeTrialTrack.name, layout: timeTrialTrack.layout, handling: copyTuningParameters(tuningPanel.parameters) });
  }

  function availableTimeTrialTracks(sharedTracks: Awaited<ReturnType<typeof listSharedTracks>> = []): TrackOption[] {
    const unique = new Map<string, TrackOption>();
    for (const track of presetTrackOptions) unique.set(track.id, track);
    for (const track of sharedTracks) unique.set(track.id, track);
    const knownLayouts = new Set([...unique.values()].map(track => JSON.stringify(track.layout)));
    for (const track of [...listBrowserTracks(localStorage), ...(selectedTrack ? [selectedTrack] : [])]) {
      const key = JSON.stringify(track.layout);
      if (unique.has(track.id) || knownLayouts.has(key)) continue;
      unique.set(track.id, { id: track.id, name: track.name, layout: track.layout });
      knownLayouts.add(key);
    }
    return [...unique.values()];
  }

  async function refreshTimeTrialTracks(): Promise<void> {
    const localTracks = availableTimeTrialTracks();
    const preferredId = localTracks.find(track => JSON.stringify(track.layout) === JSON.stringify(timeTrialTrack.layout))?.id ?? timeTrialTrack.id;
    timeTrialSetup.setTracks(localTracks, preferredId);
    timeTrialSetup.setStatus('Loading shared tracks…');
    try {
      const sharedTracks = await listSharedTracks();
      // Keep a user's choice if the shared-track request completes after they select a map.
      timeTrialSetup.setTracks(availableTimeTrialTracks(sharedTracks));
      timeTrialSetup.setStatus('');
    } catch {
      timeTrialSetup.setStatus('Shared tracks could not be loaded. Presets and locally saved tracks are available.');
    }
  }

  function enterMultiplayerMenu(): void {
    if (pendingSoloRequest || soloRaceActive) enterHomeScreen();
    homeScreen.showMultiplayer();
    setMode('multiplayer');
    homeScreen.setStatus(socket.connected ? 'Choose a lobby or create one.' : 'Connecting to multiplayer...');
    if (!socket.connected) socket.connect();
  }

  function syncRoom(room: LobbySnapshot | null): void {
    if (!room) {
      enterHomeScreen('You left the room. Pick another lobby or create one.');
      return;
    }

    if (room.phase === 'lobby' && !room.trackOpen && currentMode !== 'race') enterLobbyScreen(room);
    else enterRaceScreen(room);
  }

  function refreshSessionFromRoom(): void {
    if (!session || !activeRoom || currentMode !== 'race') return;
    const desiredColor = localPlayerColor(activeRoom, localPlayerId);
    const handlingChanged = JSON.stringify(session.tuning) !== JSON.stringify(activeRoom.settings.handling);
    if (session.trackId !== activeRoom.settings.trackId || session.playerColor !== desiredColor || handlingChanged) {
      session.dispose();
      session = createDrivingSession(canvas, activeRoom.settings.layout, activeRoom.settings.trackName, activeRoom.settings.trackId, activeRoom.settings.handling, desiredColor, Math.max(0, activeRoom.players.findIndex(p=>p.id===localPlayerId)), true);
    }
  }

  const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io({ autoConnect: false,
    auth: callback => { void accessToken().then(token => callback({ token })).catch(() => callback({ token: '' })); },
  });
  let lastClockSyncAt = Number.NEGATIVE_INFINITY;

  const developerConsole = createDeveloperConsole({
    requestServerTelemetry(): void {
      if (socket.connected) socket.emit('debug:telemetry-request');
    },
    readClientData() {
      const transport = socket.io.engine?.transport;
      const intervals = networkStats.stateArrivalIntervalsMs;
      const intervalMean = intervals.length ? intervals.reduce((sum, value) => sum + value, 0) / intervals.length : null;
      const intervalJitter = intervalMean === null ? null : Math.sqrt(intervals.reduce((sum, value) => sum + (value - intervalMean) ** 2, 0) / intervals.length);
      const now = performance.now();
      const sessionStats = session?.getDiagnostics() as {
        vehicle?: { speedMps: number; speedKph: number; grounded: boolean; airborneSeconds: number; headingRadians: number };
        simulation?: { tickRateHz: number; stepsLastFrame: number; physicsMsLastFrame: number; frameDeltaMs: number };
        renderer?: { pixelRatio: number; drawCalls: number; triangles: number; geometries: number; textures: number; trackTriangles: number };
        remotePlayers?: { id: string; snapshotAgeMs: number | null; interarrivalJitterMs: number | null; bufferUnderruns: number; extrapolating: boolean }[];
      } | null;
      const elapsedSeconds = Math.max(0.001, (now - networkStats.startedAt) / 1000);
      return {
        mode: currentMode,
        room: activeRoom ? { phase: activeRoom.phase, players: activeRoom.players.length, track: activeRoom.settings.trackName } : null,
        performance: performanceStats.diagnostics,
        socket: { connected: socket.connected, transport: transport?.name ?? null },
        traffic: {
          inputSentHz: networkStats.stateMessagesSent / elapsedSeconds,
          snapshotReceivedHz: networkStats.stateMessagesReceived / elapsedSeconds,
          approximateBytesSentPerSecond: networkStats.approximateJsonBytesSent / elapsedSeconds,
          approximateBytesReceivedPerSecond: networkStats.approximateJsonBytesReceived / elapsedSeconds,
          snapshotArrivalJitterMs: intervalJitter,
          lastSnapshotAgeMs: networkStats.lastStateReceivedAt === null ? null : now - networkStats.lastStateReceivedAt,
        },
        vehicle: sessionStats?.vehicle ?? null,
        simulation: sessionStats?.simulation ?? null,
        renderer: sessionStats?.renderer ?? null,
        remotePlayers: sessionStats?.remotePlayers ?? [],
      };
    },
  });

  homeScreen = createHomeScreen(homeRoot, {
    onTimeTrial() {
      homeScreen.showTimeTrialSetup();
      timeTrialSetup.show();
      setMode('time-trial-setup');
      void refreshTimeTrialTracks();
    },
    onMultiplayer() { enterMultiplayerMenu(); },
    onBackToLanding() {
      if (socket.connected) socket.disconnect();
      homeScreen.showLanding();
      setMode('home');
    },
    onCreateLobby(payload) {
      saveMultiplayerPreferences({ lobbyId: null });
      socket.emit('multiplayer:create-lobby', payload);
      homeScreen.setStatus(`Creating ${username}'s Lobby...`);
    },
    onJoinLobby(payload) {
      saveMultiplayerPreferences({ lobbyId: payload.lobbyId });
      socket.emit('multiplayer:join-lobby', payload);
      homeScreen.setStatus('Joining lobby...');
    },
  }, username, fallbackTrackId.replace(/^preset:/, ''));

  timeTrialSetup = createTimeTrialSetup(homeRoot, {
    onBack() {
      if (pendingSoloRequest) {
        pendingSoloRequest = 0;
        if (socket.connected) socket.emit('time-trial:leave');
      }
      timeTrialSetup.hide();
      homeScreen.showLanding();
      setMode('home');
    },
    onStart(track, color) { enterTimeTrial(track, color); },
  }, timeTrialColor);

  lobbyScreen = createLobbyScreen(lobbyRoot, {
    onEnterTrack() {
      if (activeRoom?.hostId === localPlayerId && !activeRoom.trackOpen) {
        lobbyScreen.setStatus('Opening the track for everyone...');
        socket.emit('multiplayer:enter-track');
      }
    },
    onCancelRound() {
      if (activeRoom?.hostId === localPlayerId && activeRoom.phase !== 'lobby') {
        socket.emit('multiplayer:cancel-round');
      }
    },
    onStartLobby(payload) {
      socket.emit('multiplayer:start-lobby', payload);
      lobbyScreen.setStatus('Starting race...');
    },
    onLeaveLobby() {
      socket.emit('multiplayer:leave-lobby');
      enterHomeScreen('Leaving lobby...');
    },
    onColor(color) { socket.emit('multiplayer:set-color', { color }); },
    onConfigureRound(options) { socket.emit('multiplayer:configure-round', options); },
    onClosePanel() {
      lobbyPanelOpen = false;
      setMode('race');
      canvas.focus({ preventScroll: true });
    },
    onSetupVisibility(open) {
      const wasOpen = raceSetupOpen;
      raceSetupOpen = open;
      input.setEnabled(currentMode === 'race' && !chat.isOpen && !lobbyPanelOpen && !open);
      if (wasOpen && !open && activeRoom?.phase === 'lobby' && !lobbyPanelOpen) canvas.focus({ preventScroll: true });
    },
    onUpdateSettings(payload) {
      socket.emit('multiplayer:update-settings', payload);
      lobbyScreen.setStatus('Updating lobby settings...');
    },
  });

  lobbyPanelToggle.addEventListener('click', () => {
    if (activeRoom?.phase !== 'lobby') return;
    lobbyPanelOpen = true;
    setMode('race');
  });
  roundSetupToggle.addEventListener('click', () => lobbyScreen.openRaceSetup());

  socket.on('multiplayer:bootstrap', (payload) => {
    networkStats.bootstrapEventsReceived++;
    bootstrap = payload;
    localPlayerId = payload.playerId;
    homeScreen.setTrackOptions(payload.trackOptions);
    homeScreen.setLobbies(payload.lobbies);
    lobbyScreen.setTrackOptions(payload.trackOptions);
    if (payload.activeLobbyId && payload.activeLobbyPhase) {
      homeScreen.setStatus('Reconnecting to your room...');
    } else {
      homeScreen.setStatus('Connected. Choose a lobby or create one.');
    }
    // A newly created room can arrive before this async bootstrap response.
    // Keep that room and refresh its host controls now that our socket ID is known.
    if (activeRoom) {
      if (currentMode === 'race') enterRaceScreen(activeRoom);
      else if (currentMode === 'lobby') enterLobbyScreen(activeRoom);
      return;
    }
    if (pendingSoloRequest || soloRaceActive || currentMode === 'time-trial-setup') return;
    const lobbyId = payload.activeLobbyId ?? preferences.lobbyId;
    if (lobbyId) {
      socket.emit('multiplayer:join-lobby', { lobbyId });
    }
  });

  socket.on('multiplayer:lobbies', ({ lobbies }) => {
    networkStats.lobbyListEventsReceived++;
    bootstrap = bootstrap ? { ...bootstrap, lobbies } : bootstrap;
    homeScreen.setLobbies(lobbies);
  });

  socket.on('multiplayer:tracks', ({ trackOptions }) => {
    networkStats.trackListEventsReceived++;
    if (bootstrap) bootstrap = { ...bootstrap, trackOptions };
    homeScreen.setTrackOptions(trackOptions);
    lobbyScreen.setTrackOptions(trackOptions);
  });

  socket.on('multiplayer:chat', message => chat.receive(message));
  socket.on('multiplayer:room', ({ lobby }) => {
    networkStats.roomEventsReceived++;
    if (!lobby && (pendingSoloRequest || soloRaceActive)) return;
    if (bootstrap) bootstrap = { ...bootstrap, activeLobbyId: lobby?.id ?? null, activeLobbyPhase: lobby?.phase ?? null };
    syncRoom(lobby);
  });

  socket.on('multiplayer:snapshot', (snapshot) => {
    if (!activeRoom || snapshot.roomId !== activeRoom.id || !session) return;
    const receivedAt = performance.now();
    networkStats.stateMessagesReceived++;
    networkStats.approximateJsonBytesReceived += new TextEncoder().encode(JSON.stringify(snapshot)).byteLength;
    if (networkStats.lastStateReceivedAt !== null) {
      networkStats.stateArrivalIntervalsMs.push(receivedAt - networkStats.lastStateReceivedAt);
      if (networkStats.stateArrivalIntervalsMs.length > 60) networkStats.stateArrivalIntervalsMs.shift();
    }
    networkStats.lastStateReceivedAt = receivedAt;
    session.applySnapshot(snapshot, localPlayerId);
    if (snapshot.round) {
      activeRoom.round = snapshot.round;
      lastRoundReceivedAt = receivedAt;
      roundUi.setRound(snapshot.round, localPlayerId);
    }
    raceLeaderboard.updateSnapshot(snapshot);
  });

  socket.on('multiplayer:results', ({ roomId, results }) => {
    if (activeRoom?.id !== roomId) return;
    roundUi.showResults(results);
  });

  function showTimeTrialRanking(ranked: boolean): void {
    if (ranked) {
      const physicsTime = tuningPanel.parameters.physics.physicsTime;
      raceRoomStatusElement.textContent = physicsTime === 1 ? 'Ranked · server-timed'
        : `Ranked · Physics Time ${physicsTime.toFixed(1)}× · server-timed`;
    } else {
      raceRoomStatusElement.textContent = timeTrialTrack.visibility === 'personal'
        ? 'Personal track · unranked' : 'Custom handling or local track · unranked';
    }
  }

  socket.on('time-trial:ready', ({ requestId, track, handling, ranked, personalBestMs }) => {
    if (requestId !== pendingSoloRequest || currentMode !== 'time-trial-setup') return;
    pendingSoloRequest = 0;
    soloRaceActive = true;
    timeTrialTrack = track;
    timeTrialBest = personalBestMs === null ? null : personalBestMs / 1000;
    Object.assign(tuningPanel.parameters.driving, handling.driving);
    Object.assign(tuningPanel.parameters.physics, handling.physics);
    lastSoloHandling = JSON.stringify(tuningPanel.parameters);
    timeTrialSetup.hide();
    setMode('race');
    raceRoomNameElement.textContent = 'Time Trial';
    showTimeTrialRanking(ranked);
    ensureSession(null);
  });

  socket.on('time-trial:ranking', ({ ranked }) => {
    if (!soloRaceActive) return;
    showTimeTrialRanking(ranked);
  });

  socket.on('time-trial:verified-best', ({ bestMs }) => {
    if (!soloRaceActive || activeRoom || !Number.isFinite(bestMs) || bestMs <= 0) return;
    timeTrialBest = timeTrialBest === null ? bestMs / 1000 : Math.min(timeTrialBest, bestMs / 1000);
    session?.setVerifiedBest(timeTrialBest);
  });

  socket.on('time-trial:error', ({ requestId, message }) => {
    if (requestId !== pendingSoloRequest) return;
    pendingSoloRequest = 0;
    timeTrialSetup.setStatus(message);
  });

  socket.on('time-trial:snapshot', snapshot => {
    if (!soloRaceActive || !session || snapshot.roomId !== `solo:${socket.id}`) return;
    const receivedAt = performance.now();
    networkStats.stateMessagesReceived++;
    networkStats.approximateJsonBytesReceived += new TextEncoder().encode(JSON.stringify(snapshot)).byteLength;
    if (networkStats.lastStateReceivedAt !== null) {
      networkStats.stateArrivalIntervalsMs.push(receivedAt - networkStats.lastStateReceivedAt);
      if (networkStats.stateArrivalIntervalsMs.length > 60) networkStats.stateArrivalIntervalsMs.shift();
    }
    networkStats.lastStateReceivedAt = receivedAt;
    session.applySnapshot(snapshot, socket.id!);
  });

  socket.on('race:transition', transition => {
    if (!session) return;
    const expectedRoomId = activeRoom?.id ?? (soloRaceActive ? `solo:${socket.id}` : null);
    const expectedPlayerId = activeRoom ? localPlayerId : socket.id;
    if (transition.roomId !== expectedRoomId || transition.player.id !== expectedPlayerId) return;
    session.applyTransition(transition);
  });

  socket.on('race:death-ack', ack => {
    if (!session || (!activeRoom && !soloRaceActive)) return;
    if (ack.roomId !== (activeRoom?.id ?? `solo:${socket.id}`)) return;
    session.applyDeathAck(ack);
  });

  socket.on('multiplayer:error', ({ message }) => {
    networkStats.errorsReceived++;
    homeScreen.setStatus(message);
    lobbyScreen.setStatus(message);
    saveMultiplayerPreferences({ lobbyId: null });
  });

  socket.on('disconnect', () => {
    if (soloRaceActive) {
      soloRaceActive = false;
      disposeSession();
      timeTrialSetup.show();
      setMode('time-trial-setup');
      timeTrialSetup.setStatus('Connection lost. Start again to begin a new timed run.');
    }
    chat.setRoom(null);
    networkStats.disconnects++;
    homeScreen.setStatus('Disconnected. Reconnecting...');
    lobbyScreen.setStatus('Disconnected. Reconnecting...');
    raceRoomStatusElement.textContent = 'Disconnected. Reconnecting...';
  });

  socket.on('connect', () => { networkStats.connects++; lastReadyRoundId = ''; startPendingTimeTrial(); });
  socket.on('recording:probe', reply => {
    const stats = performanceStats.diagnostics;
    const sessionStats = session?.getDiagnostics() as { remotePlayers: RecordingClientReport['remotePlayers'] } | undefined;
    reply({
      visible: !document.hidden, racing: currentMode === 'race', fps: stats.fps,
      frameMs: stats.averageFrameIntervalMs, httpPingMs: stats.httpPingMs,
      remotePlayers: sessionStats?.remotePlayers ?? [],
    });
  });
  socket.on('debug:telemetry', (snapshot) => developerConsole.setServerData(snapshot));

  raceLeaveButtonElement.addEventListener('click', () => {
    if (activeRoom && socket.connected) {
      socket.emit('multiplayer:leave-lobby');
      enterHomeScreen('Leaving game...');
    } else {
      enterHomeScreen('Choose another mode.');
    }
  });

  function resetTiming(): void {
    lastFrameTime = null;
  }

  function frame(): void {
    const time = performance.now();
    animationFrame = requestAnimationFrame(frame);
    if (document.hidden) return;

    const elapsed = lastFrameTime === null ? 0 : (time - lastFrameTime) / 1000;
    lastFrameTime = time;
    if (elapsed > PAUSE_THRESHOLD) lastFrameTime = time;

    if (currentMode === 'race' && session) {
      const round = activeRoom?.round;
      const localRoundPlayer = round?.players.find(player => player.id === localPlayerId);
      const frozen = Boolean(round && (round.stage === 'loading' || round.stage === 'countdown'
        || localRoundPlayer?.status !== 'racing' && !(round.stage === 'race' && localRoundPlayer?.status === 'finished')));
      const spectate = frozen && localRoundPlayer?.status === 'eliminated'
        ? round?.players.find(player => player.id !== localPlayerId && player.status === 'racing')?.id ?? null : null;
      session.step(elapsed, input.sample(), frozen, spectate);
      const qualifying = round?.stage === 'qualifying';
      lapBestRow.hidden = qualifying;
      if (activeRoom?.round?.stage === 'race') {
        const currentRound = activeRoom.round;
        if (displayedRaceRoundId !== currentRound.id) {
          displayedRaceRoundId = currentRound.id;
          displayedRaceTime = 0;
        }
        displayedRaceTime = Math.max(displayedRaceTime, currentRound.elapsedSeconds
          + Math.min(0.15, Math.max(0, (time - lastRoundReceivedAt) / 1000)));
        lapLabel.textContent = 'Race time';
        lapCurrent.value = formatLapTime(displayedRaceTime);
        lapBestLabel.textContent = 'Best split';
        lapLastLabel.textContent = 'Last split';
        lapBest.value = formatLapTime(localRoundPlayer?.bestSeconds ?? null);
        lapLast.value = formatLapTime(localRoundPlayer?.lastSeconds ?? null);
        lapDelta.hidden = true;
        lapStatus.textContent = localRoundPlayer?.status === 'finished' ? 'Finished · keep driving'
          : localRoundPlayer?.status === 'eliminated' ? 'Eliminated'
            : `Lap ${Math.min(currentRound.options.laps, (localRoundPlayer?.laps ?? 0) + 1)} of ${currentRound.options.laps}`;
      } else if (activeRoom?.phase === 'lobby') {
        lapLabel.textContent = 'Current lap';
        lapBestLabel.textContent = 'Best lap';
        lapLastLabel.textContent = 'Last lap';
        if (!session.lapTimer.running) lapStatus.textContent = 'Cross the line to start a lap';
      } else {
        lapLabel.textContent = qualifying ? 'Qualifying lap' : 'Current';
        lapBestLabel.textContent = 'Best';
        lapLastLabel.textContent = 'Last';
        if (qualifying) lapDelta.hidden = true;
      }
      roundUi.update();
      tuningPanel.update(session.state);
      const speed = String(Math.round(Math.hypot(session.state.speed, session.state.lateralSpeed) * 3.6));
      if (raceSpeed.value !== speed) raceSpeed.value = speed;
      if (soloRaceActive && socket.connected) {
        const handling = JSON.stringify(tuningPanel.parameters);
        if (handling !== lastSoloHandling) {
          lastSoloHandling = handling;
          socket.emit('time-trial:handling', copyTuningParameters(tuningPanel.parameters));
        }
      }
      for (const input of session.drainInputs()) {
        if (!socket.connected || (!activeRoom && !soloRaceActive)) continue;
        if (activeRoom) socket.emit('multiplayer:input', input);
        else socket.emit('time-trial:input', input);
        networkStats.stateMessagesSent++;
        networkStats.approximateJsonBytesSent += new TextEncoder().encode(JSON.stringify(input)).byteLength;
      }
      const deathNotice = frozen ? null : session.pollDeathNotice(time);
      if (deathNotice && socket.connected && (activeRoom || soloRaceActive)) {
        socket.emit('race:death-notice', deathNotice);
      }
      if ((activeRoom || soloRaceActive) && socket.connected && time - lastClockSyncAt >= 2000) {
        const currentSession = session;
        const sentAt = performance.now();
        lastClockSyncAt = time;
        socket.emit('multiplayer:clock', serverTimeMs => {
          if (session !== currentSession) return;
          const receivedAt = performance.now();
          currentSession.setClockOffset((sentAt + receivedAt) / 2 - serverTimeMs, receivedAt - sentAt);
        });
      }
      refreshSessionFromRoom();
      performanceStats.rendered(performance.now());
    }
  }

  document.addEventListener('visibilitychange', resetTiming);
  window.addEventListener('blur', resetTiming);
  setMode('home');
  if (new URLSearchParams(location.search).get('mode') === 'time-trial') {
    homeScreen.showTimeTrialSetup(); timeTrialSetup.show(); setMode('time-trial-setup'); void refreshTimeTrialTracks();
  }
  animationFrame = requestAnimationFrame(frame);

  return {
    get state(): VehicleState { return (session ?? ensureSession(activeRoom)).state; },
    get view(): ReturnType<typeof createScene> { return (session ?? ensureSession(activeRoom)).view; },
    get car(): ReturnType<typeof createCarVisual> { return (session ?? ensureSession(activeRoom)).car; },
    tuning: tuningPanel.parameters,
    get layout(): TrackLayout { return (session ?? ensureSession(activeRoom)).layout; },
    get trackName(): string { return (session ?? ensureSession(activeRoom)).trackName; },
    get lapTimer(): ReturnType<typeof createLapTimer> { return (session ?? ensureSession(activeRoom)).lapTimer; },
    get bootstrap(): MultiplayerBootstrap | null { return bootstrap; },
    dispose(): void {
      cancelAnimationFrame(animationFrame);
      document.removeEventListener('visibilitychange', resetTiming);
      window.removeEventListener('blur', resetTiming);
      input.dispose();
      chat.dispose();
      performanceStats.dispose();
      developerConsole.dispose();
      timeTrialSetup.dispose();
      menuBackdrop.dispose();
      socket.disconnect();
      disposeSession();
      tuningPanel.dispose();
      homeScreen.dispose();
      lobbyScreen.dispose();
    },
  };
}
