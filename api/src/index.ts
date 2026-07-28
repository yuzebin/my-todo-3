/**
 * Worker entrypoint. Mounts the auth and todos routers, wires CORS for the
 * Pages frontend, and applies authentication to every /todos route.
 *
 * Env-specific values (D1 binding, JWT secret) come from wrangler.toml and
 * `wrangler secret put`. See DEPLOY.md.
 */
import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import type { Env, AuthUser } from './env';
import { auth, authenticateBearer, jsonError } from './auth';
import { todos } from './todos';

type AppContext = { Bindings: Env; Variables: { user: AuthUser } };
const app = new Hono<AppContext>();

app.use('*', logger());

// CORS for the Pages frontend. In production set ALLOWED_ORIGIN via secret
// to your *.pages.dev domain (or custom domain) instead of `*`.
app.use('*', async (c, next) => {
  const origin = c.env.ALLOWED_ORIGIN ?? '*';
  const corsMiddleware = cors({
    origin: origin === '*' ? '*' : origin.split(',').map((s: string) => s.trim()),
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    exposeHeaders: ['Content-Length'],
    maxAge: 600,
    credentials: false,
  });
  return corsMiddleware(c, next);
});

app.get('/healthz', (c) => c.json({ status: 'ok', time: new Date().toISOString() }));

app.use('/auth/me', requireAuth);
app.use('/todos/*', requireAuth);

app.route('/auth', auth);
app.route('/todos', todos);

app.onError((err, c) => {
  console.error('unhandled error', err);
  return jsonError(c, 500, 'internal', 'Internal server error');
});

app.notFound((c) => jsonError(c, 404, 'not_found', 'Not found'));

async function requireAuth(c: Context<AppContext>, next: () => Promise<void>): Promise<Response | void> {
  const user = await authenticateBearer(c.req.header('Authorization'), c.env.JWT_SECRET);
  if (!user) {
    return jsonError(c, 401, 'unauthorized', 'Missing or invalid token');
  }
  c.set('user', user);
  await next();
}

export default app;
