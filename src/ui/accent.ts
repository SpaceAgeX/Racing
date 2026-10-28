import { carColorNames } from './car-colors.ts';

const storageKey = 'beggars-grand-prix-accent';
const preferenceKey = 'beggars-grand-prix-accent-preference';
const previousKey = 'auth-scene-last-car-color';
const availableColors = [...carColorNames.keys()].filter(color => !['Pearl', 'Charcoal'].includes(carColorNames.get(color)!));
export type AccentPreference = 'random' | string;
export const accentChoices = availableColors.map(color => ({ color, name: carColorNames.get(color)! }));
const listeners = new Set<(color: string) => void>();
let activeColor: string | null = null;

function luminance(hex: string): number {
  const channels = [1, 3, 5].map(offset => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
}

function contrast(a: string, b: string): number {
  const first = luminance(a);
  const second = luminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

function applyColor(color: string): void {
  const root = document.documentElement;
  root.toggleAttribute('data-auth-dark-accent', contrast(color, '#111417') < 4.5);
  root.style.setProperty('--auth-accent', color);
  root.style.setProperty('--auth-button-text', contrast(color, '#111417') >= contrast(color, '#f5f7f8') ? '#111417' : '#f5f7f8');
}

/** One palette color per browser session, shared by login, signup, and the menu. */
export function getActiveAccentColor(): string {
  if (!activeColor) {
    const preference = getAccentPreference();
    let stored: string | null = null;
    let previous: string | null = null;
    try {
      stored = sessionStorage.getItem(storageKey);
      previous = sessionStorage.getItem(previousKey);
    } catch { /* Continue without storage. */ }
    if (preference !== 'random') activeColor = preference;
    else if (stored && availableColors.includes(stored)) activeColor = stored;
    else {
      const choices = availableColors.filter(color => color !== previous);
      activeColor = choices[Math.floor(Math.random() * choices.length)]!;
      try {
        sessionStorage.setItem(storageKey, activeColor);
        sessionStorage.setItem(previousKey, activeColor);
      } catch { /* Continue without storage. */ }
    }
  }
  applyColor(activeColor);
  return activeColor;
}

export function getAccentPreference(): AccentPreference {
  try {
    const value = localStorage.getItem(preferenceKey);
    if (value && availableColors.includes(value)) return value;
  } catch { /* Browser storage may be unavailable. */ }
  return 'random';
}

export function setAccentPreference(preference: AccentPreference): void {
  if (preference !== 'random' && !availableColors.includes(preference)) return;
  try { localStorage.setItem(preferenceKey, preference); } catch { /* Current page still responds. */ }
  // Random mode keeps the current session color until the next browser session.
  if (preference !== 'random') setActiveAccentColor(preference);
}

export function setActiveAccentColor(color: string): void {
  if (!availableColors.includes(color)) return;
  activeColor = color;
  try { sessionStorage.setItem(storageKey, color); } catch { /* Continue without storage. */ }
  applyColor(color);
  for (const listener of listeners) listener(color);
}

export function onActiveAccentColorChange(listener: (color: string) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
