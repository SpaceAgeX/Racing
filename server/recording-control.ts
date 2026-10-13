import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

export const recordingDirectory = resolve(process.env.RACING_RECORDINGS_DIR ?? fileURLToPath(new URL('../data/recordings', import.meta.url)));
export interface RecordingPlan {
  version: 1;
  id: string;
  startAt: string;
  stopAt: string;
  enabled: boolean;
}
export function validPlan(value: unknown): value is RecordingPlan {
  if (!value || typeof value !== 'object') return false;
  const plan = value as RecordingPlan;
  return plan.version === 1 && typeof plan.enabled === 'boolean'
    && typeof plan.id === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(plan.id)
    && typeof plan.startAt === 'string' && typeof plan.stopAt === 'string'
    && Number.isFinite(Date.parse(plan.startAt)) && Date.parse(plan.stopAt) > Date.parse(plan.startAt);
}
export function planIsActive(plan: RecordingPlan | null, now: number): boolean {
  return Boolean(plan?.enabled && now >= Date.parse(plan.startAt) && now < Date.parse(plan.stopAt));
}
export async function readPlan(directory = recordingDirectory): Promise<RecordingPlan | null> {
  try {
    const value: unknown = JSON.parse(await readFile(join(directory, 'schedule.json'), 'utf8'));
    if (!validPlan(value)) throw new Error('Invalid recording schedule.');
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}
export async function writePlan(plan: RecordingPlan, directory = recordingDirectory): Promise<void> {
  if (!validPlan(plan)) throw new Error('Invalid recording schedule.');
  await mkdir(directory, { recursive: true });
  const temporary = join(directory, 'schedule-' + randomUUID() + '.tmp');
  await writeFile(temporary, JSON.stringify(plan, null, 2) + '\n');
  await rename(temporary, join(directory, 'schedule.json'));
}
