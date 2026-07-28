/**
 * Auth routes: signup / login / logout / me.
 *
 * Tokens are returned in the JSON body and the client stores them. (Cookie-
 * based storage would be friendlier for browsers but complicates CORS; the
 * web client in `/web` reads the token from localStorage.)
 */
import { Hono } from 'hono';
import type { Env, AuthUser } from './env';
import { hashPassword, verifyPassword, signJwt, verifyJwt, newId } from './crypto';
import { ACCESS_TOKEN_TTL } from './env';

export const auth = new Hono<{ Bindings: Env; Variables: { user: AuthUser } }>();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_PASSWORD = 256;

function badEmail(email: unknown): boolean {
  return typeof email !== 'string' || !EMAIL_RE.test(email) || email.length > 320;
}

auth.post('/signup', async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== 'object') return jsonError(c, 400, 'bad_body', 'Expected JSON body');
  const { email, password } = body as { email?: unknown; password?: unknown };

  if (badEmail(email)) return jsonError(c, 400, 'bad_email', 'A valid email is required');
  if (typeof password !== 'string' || password.length < 8) {
    return jsonError(c, 400, 'bad_password', 'Password must be at least 8 characters');
  }
  if (password.length > MAX_PASSWORD) {
    return jsonError(c, 400, 'bad_password', `Password must be at most ${MAX_PASSWORD} characters`);
  }

  const normalizedEmail = (email as string).trim();
  const existing = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?')
    .bind(normalizedEmail)
    .first<{ id: string }>();
  if (existing) return jsonError(c, 409, 'email_taken', 'Email already registered');

  const id = newId();
  const hash = await hashPassword(password);
  try {
    await c.env.DB.prepare('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)')
      .bind(id, normalizedEmail, hash)
      .run();
  } catch (e) {
    if (String(e).includes('UNIQUE')) {
      return jsonError(c, 409, 'email_taken', 'Email already registered');
    }
    throw e;
  }

  const token = await signJwt({ sub: id, email: normalizedEmail }, c.env.JWT_SECRET, ACCESS_TOKEN_TTL(c.env));
  return c.json({ userId: id, token }, 201);
});

auth.post('/login', async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== 'object') return jsonError(c, 400, 'bad_body', 'Expected JSON body');
  const { email, password } = body as { email?: unknown; password?: unknown };
  if (typeof email !== 'string' || typeof password !== 'string') {
    return jsonError(c, 400, 'bad_credentials', 'Email and password are required');
  }

  const user = await c.env.DB.prepare('SELECT id, email, password_hash FROM users WHERE email = ?')
    .bind(email.trim())
    .first<{ id: string; email: string; password_hash: string }>();
  if (!user) return jsonError(c, 401, 'bad_credentials', 'Invalid email or password');

  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) return jsonError(c, 401, 'bad_credentials', 'Invalid email or password');

  const token = await signJwt({ sub: user.id, email: user.email }, c.env.JWT_SECRET, ACCESS_TOKEN_TTL(c.env));
  return c.json({ userId: user.id, token });
});

auth.post('/logout', (c) => {
  // Stateless JWT: server keeps no session table for v1, so logout is a
  // client-side concern (drop the token). The endpoint exists for API
  // symmetry and future token-revocation work.
  return c.body(null, 204);
});

auth.get('/me', async (c) => {
  const user = c.get('user');
  return c.json({ userId: user.userId, email: user.email });
});

// Shared helpers ----------------------------------------------------------
export function jsonError(c: { json: (body: unknown, status: number) => Response }, status: number, code: string, message: string): Response {
  return c.json({ error: { code, message } }, status);
}

export async function authenticateBearer(
  authHeader: string | null | undefined,
  secret: string,
): Promise<AuthUser | null> {
  if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) return null;
  const token = authHeader.slice(7).trim();
  const claims = await verifyJwt(token, secret);
  if (!claims) return null;
  return { userId: claims.sub, email: claims.email };
}
