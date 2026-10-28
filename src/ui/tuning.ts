import { drivingParameters, physicsParameters } from '../simulation/parameters.ts';
import type { DrivingParameters, HandlingParameters, PhysicsParameters, VehicleState } from '../simulation/types.ts';
import { formatSpeedFromMetersPerSecond, onUnitPreferenceChange } from './units.ts';

export type TuningParameters = HandlingParameters;

export function copyTuningParameters(parameters: Readonly<TuningParameters>): TuningParameters {
  return { driving: { ...parameters.driving }, physics: { ...parameters.physics } };
}

interface SliderRange {
  label: string;
  min: number;
  max: number;
  step: number;
  unit: string;
}

type SliderDefinition = SliderRange & (
  { target: 'driving'; key: keyof DrivingParameters }
  | { target: 'physics'; key: keyof PhysicsParameters }
);

function driving(key: keyof DrivingParameters, label: string, min: number, max: number, step: number, unit: string): SliderDefinition {
  return { target: 'driving', key, label, min, max, step, unit };
}

function physics(key: keyof PhysicsParameters, label: string, min: number, max: number, step: number, unit: string): SliderDefinition {
  return { target: 'physics', key, label, min, max, step, unit };
}

const sections = [
  { title: 'Speed & braking', sliders: [
    driving('acceleration', 'Acceleration', 1, 40, 0.5, 'm/s²'),
    driving('reverseAcceleration', 'Reverse acceleration', 0.5, 25, 0.5, 'm/s²'),
    driving('braking', 'Braking', 1, 80, 0.5, 'm/s²'),
    driving('maxSpeed', 'Top speed limit', 1, 80, 0.5, 'm/s'),
    driving('maxReverseSpeed', 'Reverse speed limit', 0.5, 30, 0.5, 'm/s'),
  ] },
  { title: 'Steering', sliders: [
    driving('wheelbase', 'Wheelbase', 0.5, 6, 0.1, 'm'),
    driving('maxSteeringAngle', 'Maximum steering', 0.05, 1.2, 0.01, 'rad'),
    driving('highSpeedSteeringAngle', 'High-speed steering', 0, 1.2, 0.01, 'rad'),
    driving('steeringLimitSpeed', 'Steering limit speed', 1, 80, 1, 'm/s'),
    driving('steeringSpeed', 'Steering rate', 0.1, 8, 0.1, 'rad/s'),
    driving('steeringReturnSpeed', 'Centering rate', 0.1, 10, 0.1, 'rad/s'),
  ] },
  { title: 'Coasting & drag', sliders: [
    driving('rollingDrag', 'Rolling drag', 0, 5, 0.05, 'm/s²'),
    driving('linearDrag', 'Linear drag', 0, 1, 0.01, '1/s'),
    driving('quadraticDrag', 'Quadratic drag', 0, 0.03, 0.0005, '1/m'),
  ] },
  { title: 'Falling & ground contact', sliders: [
    physics('physicsTime', 'Physics Time', 0.1, 3, 0.1, 'x'),
    physics('gravity', 'Gravity', 0, 30, 0.01, 'm/s²'),
    physics('respawnDelay', 'Respawn delay', 0.2, 5, 0.1, 's'),
    physics('groundSnapDistance', 'Ground snap distance', 0.01, 1, 0.01, 'm'),
  ] },
  { title: 'Crashes', sliders: [
    physics('collisionRestitution', 'Collision bounce', 0, 0.8, 0.01, ''),
    physics('spinDamping', 'Spin damping', 0.1, 8, 0.1, '1/s'),
    physics('crashGrip', 'Crash tire grip', 0.1, 12, 0.1, '1/s'),
    physics('crashRecoveryTime', 'Crash recovery time', 0.1, 4, 0.1, 's'),
  ] },
];

export function createTuningPanel(panel: HTMLElement, toggle: HTMLButtonElement) {
  const parameters: TuningParameters = { driving: { ...drivingParameters }, physics: { ...physicsParameters } };
  let competitiveSettingsChanged = false;
  const cleanup: (() => void)[] = [];
  const controls: { definition: SliderDefinition; input: HTMLInputElement; output: HTMLOutputElement }[] = [];

  function getValue(definition: SliderDefinition): number {
    return definition.target === 'driving'
      ? parameters.driving[definition.key] : parameters.physics[definition.key];
  }

  function setValue(definition: SliderDefinition, value: number): void {
    const decimals = definition.step.toString().split('.')[1]?.length ?? 0;
    const clamped = Math.max(definition.min, Math.min(definition.max, value));
    const quantized = Number((Math.round(clamped / definition.step) * definition.step).toFixed(decimals));
    if (definition.target === 'driving') parameters.driving[definition.key] = quantized;
    else parameters.physics[definition.key] = quantized;
  }

  panel.innerHTML = `
    <header class="tuning-header">
      <h1>Handling</h1>
      <p>Physics Time can be changed without affecting ranking. Other tuning makes this run unranked.</p>
      <div class="tuning-telemetry"><output id="current-speed">${formatSpeedFromMetersPerSecond(0)}</output><span id="ground-status">On track</span></div>
    </header>
    <div class="tuning-fields"></div>
    <footer class="tuning-footer">
      <div><button type="button" id="reset-tuning">Reset defaults</button><button type="button" id="save-tuning">Save settings</button></div>
      <p id="tuning-message" aria-live="polite">Default handling is active.</p>
    </footer>`;
  const fields = panel.querySelector<HTMLElement>('.tuning-fields')!;
  const speed = panel.querySelector<HTMLOutputElement>('#current-speed')!;
  const status = panel.querySelector<HTMLElement>('#ground-status')!;
  const message = panel.querySelector<HTMLElement>('#tuning-message')!;

  function sync(): void {
    parameters.driving.highSpeedSteeringAngle = Math.min(parameters.driving.highSpeedSteeringAngle, parameters.driving.maxSteeringAngle);
    for (const { definition, input, output } of controls) {
      const value = getValue(definition);
      input.max = String(definition.key === 'highSpeedSteeringAngle' ? parameters.driving.maxSteeringAngle : definition.max);
      input.value = String(value);
      const decimals = definition.step.toString().split('.')[1]?.length ?? 0;
      const additional = definition.unit === 'm/s' ? ` · ${formatSpeedFromMetersPerSecond(value)}`
        : definition.unit === 'rad' ? ` · ${(value * 180 / Math.PI).toFixed(0)}°` : '';
      output.value = `${value.toFixed(decimals)} ${definition.unit}${additional}`;
    }
  }

  for (const section of sections) {
    const group = document.createElement('fieldset');
    const legend = document.createElement('legend');
    legend.textContent = section.title;
    group.append(legend);
    for (const definition of section.sliders) {
      const row = document.createElement('div');
      row.className = 'tuning-slider';
      const heading = document.createElement('div');
      heading.className = 'slider-heading';
      const label = document.createElement('label');
      const input = document.createElement('input');
      const output = document.createElement('output');
      input.type = 'range';
      input.id = `tuning-${definition.key}`;
      input.min = String(definition.min);
      input.max = String(definition.max);
      input.step = String(definition.step);
      label.htmlFor = input.id;
      label.textContent = definition.label;
      output.htmlFor.add(input.id);
      heading.append(label, output);
      row.append(heading, input);
      group.append(row);
      controls.push({ definition, input, output });
      const onInput = (): void => {
        const previous = getValue(definition);
        setValue(definition, Number(input.value));
        sync();
        if (definition.key !== 'physicsTime' && getValue(definition) !== previous) competitiveSettingsChanged = true;
        message.textContent = competitiveSettingsChanged
          ? 'Custom handling: this session is unranked.'
          : 'Physics Time can change without disqualifying this run.';
      };
      input.addEventListener('input', onInput);
      cleanup.push(() => input.removeEventListener('input', onInput));
    }
    fields.append(group);
  }
  sync();
  cleanup.push(onUnitPreferenceChange(sync));

  const reset = panel.querySelector<HTMLButtonElement>('#reset-tuning')!;
  const onReset = (): void => {
    Object.assign(parameters.driving, drivingParameters);
    Object.assign(parameters.physics, physicsParameters);
    sync();
    message.textContent = competitiveSettingsChanged ? 'Defaults restored. This run remains unranked.' : 'Defaults restored.';
  };
  reset.addEventListener('click', onReset);
  cleanup.push(() => reset.removeEventListener('click', onReset));

  const save = panel.querySelector<HTMLButtonElement>('#save-tuning')!;
  const onSave = (): void => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(parameters, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'beggars-grand-prix-handling.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    message.textContent = 'Settings saved as JSON.';
  };
  save.addEventListener('click', onSave);
  cleanup.push(() => save.removeEventListener('click', onSave));

  function setCollapsed(collapsed: boolean): void {
    panel.hidden = collapsed;
    document.body.classList.toggle('tuning-collapsed', collapsed);
    toggle.textContent = collapsed ? 'Tuning' : 'Hide';
    toggle.setAttribute('aria-expanded', String(!collapsed));
  }
  const narrow = matchMedia('(max-width: 760px)');
  const onWidthChange = (): void => { if (narrow.matches) setCollapsed(true); };
  const onToggle = (): void => setCollapsed(!panel.hidden);
  setCollapsed(true);
  toggle.addEventListener('click', onToggle);
  narrow.addEventListener('change', onWidthChange);
  cleanup.push(() => toggle.removeEventListener('click', onToggle));
  cleanup.push(() => narrow.removeEventListener('change', onWidthChange));

  return {
    parameters,
    resetDefaults(): void {
      Object.assign(parameters.driving, drivingParameters);
      Object.assign(parameters.physics, physicsParameters);
      competitiveSettingsChanged = false;
      sync();
      setCollapsed(true);
      message.textContent = 'Default handling is active.';
    },
    update(state: Readonly<VehicleState>): void {
      const text = formatSpeedFromMetersPerSecond(Math.hypot(state.speed, state.lateralSpeed));
      if (speed.value !== text) speed.value = text;
      const ground = state.grounded ? (state.crashTime > 0 ? 'Recovering from crash' : 'On track') : `${state.tipping ? 'Tipping' : 'Falling'} · ${state.airborneTime.toFixed(1)} s`;
      if (status.textContent !== ground) status.textContent = ground;
    },
    dispose(): void { for (const remove of cleanup) remove(); },
  };
}

export function createLobbyHandlingEditor(root: HTMLElement, onCommit: (parameters: TuningParameters) => void) {
  root.innerHTML = '<div class="lobby-handling-header"><p id="lobby-handling-note">Only the host can change handling. Settings apply to everyone when the race starts.</p><button id="lobby-handling-reset" type="button">Reset defaults</button></div><div class="lobby-handling-fields"></div>';
  const fields = root.querySelector<HTMLElement>('.lobby-handling-fields')!;
  const note = root.querySelector<HTMLElement>('#lobby-handling-note')!;
  const reset = root.querySelector<HTMLButtonElement>('#lobby-handling-reset')!;
  const parameters = copyTuningParameters({ driving: drivingParameters as DrivingParameters, physics: physicsParameters as PhysicsParameters });
  const controls: { definition: SliderDefinition; input: HTMLInputElement; output: HTMLOutputElement }[] = [];

  function valueOf(definition: SliderDefinition): number {
    return definition.target === 'driving' ? parameters.driving[definition.key] : parameters.physics[definition.key];
  }

  function setValue(definition: SliderDefinition, value: number): void {
    const decimals = definition.step.toString().split('.')[1]?.length ?? 0;
    const clamped = Math.max(definition.min, Math.min(definition.max, value));
    const quantized = Number((Math.round(clamped / definition.step) * definition.step).toFixed(decimals));
    if (definition.target === 'driving') parameters.driving[definition.key] = quantized;
    else parameters.physics[definition.key] = quantized;
  }

  function sync(): void {
    parameters.driving.highSpeedSteeringAngle = Math.min(parameters.driving.highSpeedSteeringAngle, parameters.driving.maxSteeringAngle);
    for (const { definition, input, output } of controls) {
      const value = valueOf(definition);
      input.max = String(definition.key === 'highSpeedSteeringAngle' ? parameters.driving.maxSteeringAngle : definition.max);
      input.value = String(value);
      const decimals = definition.step.toString().split('.')[1]?.length ?? 0;
      const additional = definition.unit === 'm/s' ? ` · ${formatSpeedFromMetersPerSecond(value)}`
        : definition.unit === 'rad' ? ` · ${(value * 180 / Math.PI).toFixed(0)}°` : '';
      output.value = `${value.toFixed(decimals)} ${definition.unit}${additional}`;
    }
  }

  for (const section of sections) {
    const group = document.createElement('fieldset');
    const legend = document.createElement('legend');
    legend.textContent = section.title;
    group.append(legend);
    for (const definition of section.sliders) {
      if (definition.key === 'physicsTime') continue;
      const row = document.createElement('div');
      row.className = 'tuning-slider';
      const heading = document.createElement('div');
      heading.className = 'slider-heading';
      const label = document.createElement('label');
      const input = document.createElement('input');
      const output = document.createElement('output');
      input.type = 'range';
      input.id = `lobby-handling-${definition.key}`;
      input.min = String(definition.min);
      input.max = String(definition.max);
      input.step = String(definition.step);
      label.htmlFor = input.id;
      label.textContent = definition.label;
      output.htmlFor.add(input.id);
      heading.append(label, output);
      row.append(heading, input);
      group.append(row);
      controls.push({ definition, input, output });
      input.addEventListener('input', () => {
        if (input.disabled) return;
        setValue(definition, Number(input.value));
        sync();
        onCommit(copyTuningParameters(parameters));
      });
    }
    fields.append(group);
  }

  function commitDefaults(): void {
    Object.assign(parameters.driving, drivingParameters);
    Object.assign(parameters.physics, physicsParameters);
    sync();
    onCommit(copyTuningParameters(parameters));
  }
  reset.addEventListener('click', commitDefaults);
  sync();
  const unsubscribeUnits = onUnitPreferenceChange(sync);

  return {
    setRoomHandling(value: Readonly<TuningParameters>, canEdit: boolean): void {
      Object.assign(parameters.driving, value.driving);
      Object.assign(parameters.physics, value.physics);
      parameters.physics.physicsTime = 1;
      for (const { input } of controls) input.disabled = !canEdit;
      reset.disabled = !canEdit;
      note.textContent = canEdit
        ? 'You are the host. Handling changes apply to everyone when the race starts.'
        : 'The host controls handling. These settings apply to everyone when the race starts.';
      sync();
    },
    dispose(): void { reset.removeEventListener('click', commitDefaults); unsubscribeUnits(); },
  };
}
