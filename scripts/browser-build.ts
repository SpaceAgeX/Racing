import type { BuildOptions } from 'esbuild';
import { fileURLToPath } from 'node:url';

export const browserBuildOptions: BuildOptions = {
  absWorkingDir: fileURLToPath(new URL('..', import.meta.url)),
  entryPoints: { main: './src/main.ts', 'map-builder': './src/map-builder.ts' },
  outdir: 'dist',
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  logLevel: 'info',
};
