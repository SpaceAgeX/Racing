export function moveTowards(current: number, target: number, amount: number): number {
  const difference = target - current;
  return Math.abs(difference) <= amount
    ? target
    : current + Math.sign(difference) * amount;
}

/** Shortest signed angular difference, also suitable for normalizing a heading. */
export function wrapAngle(angle: number): number {
  const tau = 2 * Math.PI;
  return ((angle + Math.PI) % tau + tau) % tau - Math.PI;
}
