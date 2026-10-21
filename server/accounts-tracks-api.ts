import { Router, json } from 'express';
import type { ErrorRequestHandler } from 'express';
import { AccountError, type Accounts } from './accounts.ts';

export function createAccountTracksApi(accounts: Accounts, onChange?: () => Promise<void>) {
  const router = Router();
  router.use((_request, response, next) => { response.setHeader('Cache-Control', 'no-store'); next(); });
  router.use(json({ limit: '256kb' }));
  router.get('/', async (_request, response) => { response.json(await accounts.listTracks(response.locals.account.id)); });
  router.get('/:id', async (request, response) => {
    const record = await accounts.getTrack(request.params.id, response.locals.account.id);
    if (!record) { response.status(404).json({ error: 'This track no longer exists.' }); return; }
    response.json(record);
  });
  router.post('/', async (request, response) => {
    const record = await accounts.saveTrack(response.locals.account.id, request.body?.name,
      request.body?.layout, request.body?.visibility);
    await onChange?.();
    response.json(record);
  });
  router.delete('/:id', async (request, response) => {
    if (!await accounts.deleteTrack(response.locals.account.id, request.params.id)) {
      response.status(404).json({ error: 'This track does not exist or does not belong to you.' }); return;
    }
    await onChange?.();
    response.sendStatus(204);
  });
  const handleError: ErrorRequestHandler = (error, _request, response, _next) => {
    if (error instanceof AccountError) { response.status(error.status).json({ error: error.message }); return; }
    if (error?.type === 'entity.too.large') { response.status(413).json({ error: 'The track is too large.' }); return; }
    if (error?.type === 'entity.parse.failed') { response.status(400).json({ error: 'Send valid JSON track data.' }); return; }
    console.error('Track API:', error);
    response.status(500).json({ error: 'Could not access the track library.' });
  };
  router.use(handleError);
  return router;
}
