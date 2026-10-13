import { randomBytes } from 'node:crypto';
import type { RequestHandler } from 'express';
import type { IncomingMessage } from 'node:http';

const cookieName = 'racing_session';
export function createAdmission(limit = 15, ttlMs = 120_000, now = Date.now) {
  if (!Number.isInteger(limit) || limit < 0) throw new Error('MAX_BROWSER_SESSIONS must be a nonnegative integer.');
  const sessions = new Map<string, { expires: number; sockets: Map<string, () => void> }>();
  function token(request: Pick<IncomingMessage, 'headers'>): string | undefined {
    return request.headers.cookie?.split(';').map(part => part.trim()).find(part => part.startsWith(cookieName + '='))?.slice(cookieName.length + 1);
  }
  function sweep(): void {
    for (const [id, session] of sessions) if (session.expires <= now()) {
      sessions.delete(id);
      for (const disconnect of session.sockets.values()) disconnect();
    }
  }
  const timer = setInterval(sweep, 5000);
  timer.unref();
  const middleware: RequestHandler = (request, response, next) => {
    if (limit === 0) { next(); return; }
    sweep();
    const id = token(request);
    const session = id ? sessions.get(id) : undefined;
    const document = request.method === 'GET' && ['/', '/map-builder', '/map-builder/'].includes(request.path);
    if (session) { session.expires = now() + ttlMs; next(); return; }
    response.setHeader('Cache-Control', 'no-store');
    if (!document) { response.status(401).json({ error: 'Session expired. Reload the game to enter again.' }); return; }
    if (sessions.size >= limit) {
      response.setHeader('Retry-After', '15');
      response.status(503).type('html').send('<!doctype html><html><meta name="viewport" content="width=device-width, initial-scale=1"><title>Server full</title><body style="background:#101b21;color:white;font:20px system-ui;text-align:center;padding:15vh 20px"><h1>Server full</h1><p>All 15 places are occupied. Please try again shortly.</p><button onclick="location.reload()" style="padding:12px 24px">Try again</button></body></html>');
      return;
    }
    const created = randomBytes(32).toString('hex');
    sessions.set(created, { expires: now() + ttlMs, sockets: new Map() });
    response.cookie(cookieName, created, { httpOnly: true, sameSite: 'strict', secure: request.headers['x-forwarded-proto'] === 'https', path: '/' });
    next();
  };
  return {
    middleware,
    authorized(request: IncomingMessage): boolean { sweep(); return limit === 0 || sessions.has(token(request) ?? ''); },
    socket(request: IncomingMessage, socketId: string, disconnect: () => void): string | null {
      if (limit === 0) return null;
      sweep();
      const id = token(request);
      const session = id ? sessions.get(id) : undefined;
      if (!session) return 'Open the game page to obtain an active session.';
      if (session.sockets.size) return 'Multiplayer is already open in another tab in this browser.';
      session.sockets.set(socketId, disconnect);
      return null;
    },
    releaseSocket(request: IncomingMessage, id: string): void { sessions.get(token(request) ?? '')?.sockets.delete(id); },
    get count(): number { sweep(); return sessions.size; },
    close(): void { clearInterval(timer); },
  };
}
