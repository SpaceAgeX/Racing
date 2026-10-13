import { startPrototype } from './prototype.ts';
import { startAdmissionHeartbeat } from './admission.ts';
startAdmissionHeartbeat();

const canvas = document.querySelector<HTMLCanvasElement>('#game');
if (!canvas) throw new Error('Driving canvas is missing.');

export const prototype = startPrototype(canvas);
