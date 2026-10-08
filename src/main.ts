import { startPrototype } from './prototype.ts';

const canvas = document.querySelector<HTMLCanvasElement>('#game');
if (!canvas) throw new Error('Driving canvas is missing.');

export const prototype = startPrototype(canvas);
