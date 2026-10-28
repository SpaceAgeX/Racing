export type UnitPreference = 'metric' | 'imperial';

const storageKey = 'beggars-grand-prix-units';
const kilometersToMiles = 0.621371;
const listeners = new Set<(units: UnitPreference) => void>();
let current: UnitPreference | null = null;

export function getUnitPreference(): UnitPreference {
  if (current) return current;
  try { current = localStorage.getItem(storageKey) === 'imperial' ? 'imperial' : 'metric'; }
  catch { current = 'metric'; }
  return current;
}

export function setUnitPreference(units: UnitPreference): void {
  if (units !== 'metric' && units !== 'imperial') return;
  current = units;
  try { localStorage.setItem(storageKey, units); } catch { /* Current page still responds. */ }
  for (const listener of listeners) listener(units);
}

export function onUnitPreferenceChange(listener: (units: UnitPreference) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function speedUnit(): 'km/h' | 'mph' { return getUnitPreference() === 'imperial' ? 'mph' : 'km/h'; }

export function speedValueFromMetersPerSecond(metersPerSecond: number): number {
  const kilometersPerHour = metersPerSecond * 3.6;
  return getUnitPreference() === 'imperial' ? kilometersPerHour * kilometersToMiles : kilometersPerHour;
}

export function formatSpeedFromMetersPerSecond(metersPerSecond: number, decimals = 1): string {
  return `${speedValueFromMetersPerSecond(metersPerSecond).toFixed(decimals)} ${speedUnit()}`;
}

export function formatDistanceFromMeters(meters: number, decimals = 1): string {
  const kilometers = meters / 1000;
  return getUnitPreference() === 'imperial'
    ? `${(kilometers * kilometersToMiles).toFixed(decimals)} miles`
    : `${kilometers.toFixed(decimals)} km`;
}
