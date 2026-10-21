import type { BuildOptions } from 'esbuild';
import { fileURLToPath } from 'node:url';

export const browserBuildOptions: BuildOptions = {
  entryPoints: {
    main: fileURLToPath(new URL('../src/main.ts', import.meta.url)),
    'map-builder': fileURLToPath(new URL('../src/map-builder.ts', import.meta.url)),
    account: fileURLToPath(new URL('../src/account.ts', import.meta.url)),
    login: fileURLToPath(new URL('../src/login.ts', import.meta.url)),
    signup: fileURLToPath(new URL('../src/signup.ts', import.meta.url)),
  },
  outdir: fileURLToPath(new URL('../dist/', import.meta.url)),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  logLevel: 'info',
};
