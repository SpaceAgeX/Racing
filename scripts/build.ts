import { build } from 'esbuild';
import { browserBuildOptions } from './browser-build.ts';

await build({ ...browserBuildOptions, minify: true });
