import { playerColorPalette } from '../multiplayer/protocol.ts';

// These deliberately exceed the chassis dimensions to include the wings and wheels.
export const browserCarFootprint = { width: 2.6, length: 5.5 } as const;
export const browserRoadWidth = 12;
export const browserLanes = [-3.2, 0, 3.2] as const;
const lateralJitter = .08;
const longitudinalClearance = browserCarFootprint.length + 1;

export interface BrowserWaveCar {
  x: number;
  lane: number;
  offset: number;
  speed: number;
  color: string;
}

const between = (random: () => number, low: number, high: number): number => low + random() * (high - low);

/** Constant lanes and per-lane speed ordering keep every generated trajectory separate. */
export function generateBrowserWave(random: () => number = Math.random): BrowserWaveCar[] {
  const count = 2 + Math.floor(random() * 4);
  const colors = [...playerColorPalette];
  for (let index = colors.length - 1; index > 0; index--) {
    const swap = Math.floor(random() * (index + 1));
    [colors[index], colors[swap]] = [colors[swap]!, colors[index]!];
  }

  const firstLane = Math.floor(random() * browserLanes.length);
  const secondLane = (firstLane + 1 + Math.floor(random() * (browserLanes.length - 1))) % browserLanes.length;
  const spread = between(random, 8, 20);
  const baseSpeed = between(random, 12, 15.5);
  const plans: BrowserWaveCar[] = [];
  for (let index = 0; index < count; index++) {
    const lane = index === 0 ? firstLane : index === 1 ? secondLane : Math.floor(random() * browserLanes.length);
    let offset = between(random, 0, spread);
    for (let tries = 0; tries < 30 && plans.some(plan => plan.lane === lane && Math.abs(plan.offset - offset) < longitudinalClearance); tries++) {
      offset = between(random, 0, spread + 7);
    }
    if (plans.some(plan => plan.lane === lane && Math.abs(plan.offset - offset) < longitudinalClearance)) {
      offset = Math.max(...plans.filter(plan => plan.lane === lane).map(plan => plan.offset))
        + longitudinalClearance + between(random, .2, 2);
    }
    plans.push({ lane, x: browserLanes[lane]! + between(random, -lateralJitter, lateralJitter),
      offset, speed: baseSpeed + between(random, 0, 3.5), color: colors[index]! });
  }

  const earliest = Math.min(...plans.map(plan => plan.offset));
  for (const plan of plans) plan.offset -= earliest;
  for (const lane of browserLanes.keys()) {
    const inLane = plans.filter(plan => plan.lane === lane).sort((a, b) => a.offset - b.offset);
    for (let index = 1; index < inLane.length; index++) {
      inLane[index]!.speed = Math.min(inLane[index]!.speed, inLane[index - 1]!.speed - .15);
    }
  }
  // Array order has no relationship to arrival order or lane.
  for (let index = plans.length - 1; index > 0; index--) {
    const swap = Math.floor(random() * (index + 1));
    [plans[index], plans[swap]] = [plans[swap]!, plans[index]!];
  }
  return plans;
}
