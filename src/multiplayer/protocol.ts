import type { HandlingParameters, VehicleState } from '../simulation/types.ts';
import type { TrackLayout } from '../track/layout.ts';
import { trackPresets } from '../track/presets.ts';

export interface TrackOption {
  id: string;
  name: string;
  layout: TrackLayout;
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

export interface PlayerStatePayload {
  state: VehicleState;
}

export interface ClientToServerEvents {
  'multiplayer:create-lobby': (payload: CreateLobbyPayload) => void;
  'multiplayer:join-lobby': (payload: JoinLobbyPayload) => void;
  'multiplayer:leave-lobby': () => void;
  'multiplayer:update-settings': (payload: UpdateLobbySettingsPayload) => void;
  'multiplayer:start-lobby': (payload: StartLobbyPayload) => void;
  'multiplayer:update-state': (payload: PlayerStatePayload) => void;
}

export interface ServerToClientEvents {
  'multiplayer:tracks': (payload: { trackOptions: TrackOption[] }) => void;
  'multiplayer:bootstrap': (payload: MultiplayerBootstrap) => void;
  'multiplayer:lobbies': (payload: { lobbies: LobbySummary[] }) => void;
  'multiplayer:room': (payload: { lobby: LobbySnapshot | null }) => void;
  'multiplayer:player-state': (payload: { playerId: string; state: VehicleState }) => void;
  'multiplayer:error': (payload: { message: string }) => void;
}
