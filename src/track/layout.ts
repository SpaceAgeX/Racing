import { createDefaultTrack } from './presets.ts';

export type TrackTile = 0 | 1 | 2;
export type TrackLayout = readonly (readonly TrackTile[])[];

/** Every occupied cell is a square this many meters wide and long. */
export const trackTileSize = 12;
/** Shared by tile rendering and full-volume collision boxes. */
export const trackTileThickness = 0.5;
export const trackArchDimensions = Object.freeze({ height: 3.8, postWidth: 0.4, depth: 0.6, beamHeight: 0.5, postInset: 0.3 });

/**
 * Edit this array to build the track: 0 = empty, 1 = track, 2 = start/finish.
 * Columns go left to right (+X); rows go top to bottom (+Z).
 * The car starts facing toward earlier rows (-Z).
 */
export const trackLayout: TrackLayout = createDefaultTrack();
