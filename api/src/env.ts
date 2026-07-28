/**
 * Worker bindings and shared types.
 *
 * Kept centralized so handlers depend only on `Env`, never on the raw
 * Cloudflare `ExecutionContext` shape.
 */
export interface Env {
  /** D1 database binding (see wrangler.toml [[d1_databases]]). */
  DB: D1Database;

  /** HS256 signing secret. Set as a real secret in production. */
  JWT_SECRET: string;

  /** Access-token lifetime in seconds. */
  JWT_TTL_SECONDS: string;

  /** Optional comma-separated list of allowed CORS origins. Defaults to `*`. */
  ALLOWED_ORIGIN?: string;
}

export const ACCESS_TOKEN_TTL = (env: Env): number => {
  const n = Number.parseInt(env.JWT_TTL_SECONDS, 10);
  return Number.isFinite(n) && n > 0 ? n : 60 * 60 * 24 * 7; // default 7d
};

/** Authenticated principal, attached to Hono context by `requireAuth`. */
export interface AuthUser {
  userId: string;
  email: string;
}
