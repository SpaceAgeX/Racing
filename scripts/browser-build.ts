import type { BuildOptions } from 'esbuild';
import { fileURLToPath } from 'node:url';

export const browserBuildOptions: BuildOptions = {
  entryPoints: {
    main: fileURLToPath(new URL('../src/main.ts', import.meta.url)),
    'map-builder': fileURLToPath(new URL('../src/map-builder.ts', import.meta.url)),
  },
  outdir: fileURLToPath(new URL('../dist/', import.meta.url)),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  logLevel: 'info',
};
