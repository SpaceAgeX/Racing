import { accentChoices, getAccentPreference, setAccentPreference } from './accent.ts';
import { getUnitPreference, setUnitPreference } from './units.ts';

/** Browser-local display preferences; the race simulation keeps SI units. */
export function createMenuSettings(toggle: HTMLButtonElement, panel: HTMLElement): void {
  panel.innerHTML = `
    <h2>Settings</h2>
    <div class="settings-section">
      <h3>Accent Color</h3>
      <div class="settings-accent-grid" role="group" aria-label="Accent color">
        <button id="settings-random-accent" class="settings-accent-swatch settings-random-swatch" type="button" aria-label="Random accent color" title="Random"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m18 14 4 4-4 4"/><path d="m18 2 4 4-4 4"/><path d="M2 18h2.5c2.5 0 4.4-1.4 5.5-3l4-6c1.1-1.6 3-3 5.5-3H22"/><path d="M2 6h2.5c2.5 0 4.4 1.4 5.5 3"/><path d="M14 15c1.1 1.6 3 3 5.5 3H22"/></svg></button>
      </div>
      <p id="settings-accent-selection" class="settings-selected" role="status"></p>
    </div>
    <div class="settings-section">
      <h3>Units</h3>
      <div class="settings-unit-control" role="group" aria-label="Measurement units">
        <button type="button" data-units="metric">Metric <span>km/h</span></button>
        <button type="button" data-units="imperial">Imperial <span>mph</span></button>
      </div>
    </div>`;

  const grid = panel.querySelector<HTMLElement>('.settings-accent-grid')!;
  const random = panel.querySelector<HTMLButtonElement>('#settings-random-accent')!;
  const selection = panel.querySelector<HTMLElement>('#settings-accent-selection')!;
  const swatches: { color: string; button: HTMLButtonElement }[] = [];
  for (const { color, name } of accentChoices) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'settings-accent-swatch';
    button.style.setProperty('--swatch', color);
    button.title = name;
    button.setAttribute('aria-label', `${name} accent color`);
    button.addEventListener('click', () => { setAccentPreference(color); sync(); });
    grid.append(button);
    swatches.push({ color, button });
  }

  function sync(): void {
    const preference = getAccentPreference();
    random.setAttribute('aria-pressed', String(preference === 'random'));
    for (const { color, button } of swatches) button.setAttribute('aria-pressed', String(preference === color));
    selection.textContent = preference === 'random'
      ? 'Random' : accentChoices.find(choice => choice.color === preference)?.name ?? 'Random';
    const units = getUnitPreference();
    for (const button of panel.querySelectorAll<HTMLButtonElement>('[data-units]')) {
      button.setAttribute('aria-pressed', String(button.dataset.units === units));
    }
  }

  function setOpen(open: boolean): void {
    panel.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    if (open) sync();
  }

  random.addEventListener('click', () => { setAccentPreference('random'); sync(); });
  for (const button of panel.querySelectorAll<HTMLButtonElement>('[data-units]')) {
    button.addEventListener('click', () => {
      setUnitPreference(button.dataset.units === 'imperial' ? 'imperial' : 'metric');
      sync();
    });
  }
  toggle.addEventListener('click', () => setOpen(panel.hidden === true));
  document.addEventListener('pointerdown', event => {
    if (!(event.target instanceof Node) || panel.contains(event.target) || toggle.contains(event.target)) return;
    setOpen(false);
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || panel.hidden) return;
    event.preventDefault();
    setOpen(false);
    toggle.focus();
  });
  window.addEventListener('pagehide', () => setOpen(false));
  sync();
}
