import { Router, json } from 'express';
import type { ErrorRequestHandler } from 'express';
import { TrackValidationError } from './track-store.ts';
import type { TrackStore } from './track-store.ts';

export function createTracksApi(store: TrackStore) {
  const router = Router();
  router.use((_request, response, next) => {
    response.set('Cache-Control', 'no-store');
    next();
  });
  router.use(json({ limit: '64kb' }));
  router.get('/', async (_request, response) => { response.json(await store.list()); });
  router.get('/:id', async (request, response) => {
    const record = await store.get(request.params.id);
    if (!record) { response.status(404).json({ error: 'This track no longer exists. Refresh the library.' }); return; }
    response.json(record);
  });
  router.post('/', async (request, response) => {
    const body = request.body as { name?: unknown; layout?: unknown } | undefined;
    const record = await store.save(body?.name, body?.layout);
    response.json(record);
  });
  router.delete('/:id', async (request, response) => {
    if (!await store.delete(request.params.id)) {
      response.status(404).json({ error: 'This track no longer exists. Refresh the library.' }); return;
    }
    response.sendStatus(204);
  });
  router.use((_request, response) => { response.status(404).json({ error: 'Track endpoint not found.' }); });
  const handleError: ErrorRequestHandler = (error, _request, response, _next) => {
    if (error instanceof TrackValidationError) { response.status(400).json({ error: error.message }); return; }
    if (error.type === 'entity.too.large') { response.status(413).json({ error: 'The track request is too large.' }); return; }
    if (error.type === 'entity.parse.failed') { response.status(400).json({ error: 'Send valid JSON track data.' }); return; }
    console.error('Track API:', error);
    response.status(500).json({ error: 'Could not access the server track library. Your drawing has not been discarded.' });
  };
  router.use(handleError);
  return router;
}
