import express from 'express';
import { access } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';
import type { BuildContext } from 'esbuild';
import { createTrackStore } from './track-store.ts';
import { createTracksApi } from './tracks-api.ts';

const publicDirectory = fileURLToPath(new URL('../public', import.meta.url));
const bundleDirectory = fileURLToPath(new URL('../dist', import.meta.url));
const development = process.argv.includes('--dev');
let bundler: BuildContext | undefined;

if (development) {
  const [{ context }, { browserBuildOptions }] = await Promise.all([
    import('esbuild'),
    import('../scripts/browser-build.ts'),
  ]);
  bundler = await context({ ...browserBuildOptions, sourcemap: true });
  await bundler.rebuild();
  await bundler.watch();
} else {
  await access(new URL('../dist/main.js', import.meta.url)).catch(() => {
    throw new Error('Browser bundle is missing. Run npm run build before npm start.');
  });
}

const app = express();
app.disable('x-powered-by');
const trackFile = process.env.TRACKS_FILE ?? fileURLToPath(new URL('../data/tracks.json', import.meta.url));
const trackStore = await createTrackStore(trackFile);
app.use('/api/tracks', createTracksApi(trackStore));
app.get('/favicon.ico', (_request, response) => response.sendStatus(204));
app.use('/assets', express.static(bundleDirectory));
app.use(express.static(publicDirectory));

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '0.0.0.0';
const server = app.listen(port, host, () => {
  console.log(`Driving prototype: http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`);
  if (host === '0.0.0.0') {
    for (const addresses of Object.values(networkInterfaces())) {
      for (const address of addresses ?? []) {
        if (address.family === 'IPv4' && !address.internal) {
          console.log(`Network: http://${address.address}:${port}`);
        }
      }
    }
  }
  if (development) console.log('Watching TypeScript files. Refresh the browser after edits.');
});

async function shutdown(): Promise<void> {
  await new Promise<void>((closed, reject) => server.close((error) => error ? reject(error) : closed()));
  await trackStore.flush();
  await bundler?.dispose();
  process.exit(0);
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
server.on('error', async (error) => {
  console.error(error.message);
  await bundler?.dispose();
  process.exit(1);
});
