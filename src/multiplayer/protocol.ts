import type { HandlingParameters, VehicleState } from '../simulation/types.ts';
import type { RaceInput, RacePlayer } from '../simulation/race.ts';
import type { SplineTrack as TrackLayout } from '../track/spline-records.ts';
import { splinePresets as trackPresets } from '../track/spline-presets.ts';

export interface TrackOption {
  id: string;
  name: string;
  layout: TrackLayout;
  visibility?: 'ranked' | 'personal';
}

export const trackOptions: TrackOption[] = trackPresets.map((preset) => ({
  id: preset.id,
  name: preset.name,
  layout: preset.create(),
}));

export function getTrackOption(trackId: string | null | undefined): TrackOption {
  return trackOptions.find((option) => option.id === trackId) ?? trackOptions[0]!;
}

export interface LobbySettings {
  trackId: string;
  trackName: string;
  layout: TrackLayout;
  handling: HandlingParameters;
}

export type LobbyPhase = 'lobby' | 'race';
export const maxLobbyPlayers = 10;

export const playerColorPalette = [
  '#6bc5ff', '#ee7136', '#8ce5ad', '#f5d76e', '#c38fff',
  '#ff8ab0', '#ef5350', '#20c4b7', '#e8edf2', '#536175',
  '#305bd6', '#a4d941', '#db40a0', '#b87942', '#252a34',
] as const;

export interface LobbyPlayerSnapshot {
  id: string;
  name: string;
  isHost: boolean;
  color: string;
  state: VehicleState | null;
}

export interface LobbySnapshot {
  id: string;
  name: string;
  hostId: string;
  hostName: string;
  phase: LobbyPhase;
  ranked: boolean;
  settings: LobbySettings;
  players: LobbyPlayerSnapshot[];
}

export interface LobbySummary {
  id: string;
  name: string;
  hostName: string;
  settings: Pick<LobbySettings, 'trackId' | 'trackName'>;
  playerCount: number;
}

export interface MultiplayerBootstrap {
  playerId: string;
  playerName: string;
  activeLobbyId: string | null;
  activeLobbyPhase: LobbyPhase | null;
  trackOptions: TrackOption[];
  lobbies: LobbySummary[];
}

export interface CreateLobbyPayload {
  lobbyName: string;
  playerName: string;
  trackId: string;
  handling?: HandlingParameters;
}

export interface JoinLobbyPayload {
  lobbyId: string;
  playerName: string;
}

export interface UpdateLobbySettingsPayload {
  trackId?: string;
  handling?: HandlingParameters;
}

export interface StartLobbyPayload {
  start: true;
}

export interface RaceSnapshot {
  roomId: string;
  tick: number;
  serverTimeMs: number;
  players: RacePlayer[];
}

export interface TimeTrialStart {
  requestId: number;
  trackId: string;
  name: string;
  layout: TrackLayout;
  handling: HandlingParameters;
}

export interface TimeTrialReady {
  requestId: number;
  track: TrackOption;
  handling: HandlingParameters;
  ranked: boolean;
}

export interface ServerDiagnosticsSnapshot {
  capturedAt: number;
  server: {
    pid: number;
    nodeVersion: string;
    platform: string;
    uptimeSeconds: number;
    cpuPercent: number | null;
    memoryBytes: { rss: number; heapTotal: number; heapUsed: number; external: number; arrayBuffers: number };
    eventLoopDelayMs: { mean: number | null; p95: number | null; max: number | null };
    authoritativeSimulation: boolean;
    simulationTickRateHz: number;
    simulationTickMs: { latest: number; average: number; max: number; overrunsTotal: number };
    connectedSockets: number;
    lobbyCount: number;
    playerCount: number;
    stateMessagesReceivedTotal: number;
    stateMessagesRelayedTotal: number;
    approximateJsonBytesReceivedTotal: number;
    approximateJsonBytesRelayedTotal: number;
  };
  connection: {
    id: string;
    transport: string;
    readyState: string;
    lobbyId: string | null;
    receivedStateMessages: number;
    relayedStateMessages: number;
    approximateJsonBytesReceived: number;
    approximateJsonBytesSent: number;
    sampleDurationSeconds: number;
    receivedStateHz: number;
    relayedStateHz: number;
    approximateJsonBytesInPerSecond: number;
    approximateJsonBytesOutPerSecond: number;
  };
  lobbies: { id: string; name: string; phase: LobbyPhase; players: number }[];
}

export interface ChatMessage { roomId: string; playerId: string; name: string; text: string; }

export interface ClientToServerEvents {
  'multiplayer:chat': (text: string) => void;
  'multiplayer:create-lobby': (payload: CreateLobbyPayload) => void;
  'multiplayer:join-lobby': (payload: JoinLobbyPayload) => void;
  'multiplayer:leave-lobby': () => void;
  'multiplayer:update-settings': (payload: UpdateLobbySettingsPayload) => void;
  'multiplayer:set-color': (payload: { color: string }) => void;
  'multiplayer:start-lobby': (payload: StartLobbyPayload) => void;
  'multiplayer:input': (payload: RaceInput) => void;
  'multiplayer:clock': (reply: (serverTimeMs: number) => void) => void;
  'time-trial:start': (payload: TimeTrialStart) => void;
  'time-trial:input': (payload: RaceInput) => void;
  'time-trial:handling': (handling: HandlingParameters) => void;
  'time-trial:leave': () => void;
  'debug:telemetry-request': () => void;
}

export interface ServerToClientEvents {
  'multiplayer:chat': (message: ChatMessage) => void;
  'recording:probe': (reply: (report: RecordingClientReport) => void) => void;
  'multiplayer:tracks': (payload: { trackOptions: TrackOption[] }) => void;
  'multiplayer:bootstrap': (payload: MultiplayerBootstrap) => void;
  'multiplayer:lobbies': (payload: { lobbies: LobbySummary[] }) => void;
  'multiplayer:room': (payload: { lobby: LobbySnapshot | null }) => void;
  'multiplayer:snapshot': (payload: RaceSnapshot) => void;
  'time-trial:ready': (payload: TimeTrialReady) => void;
  'time-trial:snapshot': (payload: RaceSnapshot) => void;
  'time-trial:error': (payload: { requestId: number; message: string }) => void;
  'multiplayer:error': (payload: { message: string }) => void;
  'debug:telemetry': (payload: ServerDiagnosticsSnapshot) => void;
}

export interface RecordingClientReport {
  visible: boolean;
  racing: boolean;
  fps: number;
  frameMs: number | null;
  httpPingMs: number | null;
  remotePlayers: { id: string; snapshotAgeMs: number | null; interarrivalJitterMs: number | null; bufferUnderruns: number; extrapolating: boolean }[];
}
