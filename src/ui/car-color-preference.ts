import { getAccentPreference } from './accent.ts';
import { playerColorPalette } from '../multiplayer/protocol.ts';

/** A reusable car-color choice for solo setups and future lobby assignment. */
export function preferredCarColor(available: readonly string[] = playerColorPalette): string {
  if (!available.length) throw new Error('No car colors are available.');
  const preference = getAccentPreference();
  return preference !== 'random' && available.includes(preference)
    ? preference : available[Math.floor(Math.random() * available.length)]!;
}
