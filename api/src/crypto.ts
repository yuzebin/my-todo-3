/**
 * Crypto helpers using the Web Crypto API available in the Workers runtime.
 *
 * - Passwords are hashed with PBKDF2-SHA256 (210_000 iterations).
 * - JWTs are signed/verified with HS256.
 *
 * No external dependencies — keeps the Worker bundle small and avoids
 * native modules that aren't available in the Workers sandbox.
 */

const PBKDF2_ITERATIONS = 210_000;
const PBKDF2_KEY_LEN = 32; // 256-bit
const SALT_LEN = 16;

const enc = new TextEncoder();
const dec = new TextDecoder();

// ---------- base64url helpers (URL-safe, no padding) ----------
function bytesToBase64url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = '';
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  const b64 = btoa(bin);
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlToBytes(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
  const bin = atob(b64 + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ---------- password hashing ----------
function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  crypto.getRandomValues(out);
  return out;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LEN);
  const key = await deriveKey(password, salt);
  const raw = await exportRaw(key);
  const saltB64 = bytesToBase64url(salt);
  const hashB64 = bytesToBase64url(raw);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${saltB64}$${hashB64}`;
}

async function exportRaw(key: CryptoKey): Promise<ArrayBuffer> {
  const exported = await crypto.subtle.exportKey('raw', key);
  // PBKDF2-derived HMAC keys export as ArrayBuffer. Narrow for type safety.
  if (exported instanceof ArrayBuffer) return exported;
  throw new Error('unexpected non-ArrayBuffer key export');
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const iter = Number.parseInt(parts[1], 10);
  if (!Number.isFinite(iter) || iter <= 0) return false;
  const salt = base64urlToBytes(parts[2]);
  const expected = parts[3];

  const key = await deriveKey(password, salt, iter);
  const raw = await exportRaw(key);
  const actual = bytesToBase64url(new Uint8Array(raw));

  // constant-time-ish comparison
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

async function deriveKey(
  password: string,
  salt: Uint8Array,
  iterations = PBKDF2_ITERATIONS,
): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits', 'deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    baseKey,
    { name: 'HMAC', hash: 'SHA-256', length: PBKDF2_KEY_LEN * 8 },
    true,
    ['sign'],
  );
}

// ---------- JWT (HS256) ----------
export interface JwtClaims {
  sub: string; // user id
  email: string;
  iat: number; // issued at (seconds)
  exp: number; // expiry (seconds)
}

export async function signJwt(claims: Omit<JwtClaims, 'iat' | 'exp'>, secret: string, ttlSeconds: number): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const full: JwtClaims = { ...claims, iat: now, exp: now + ttlSeconds };
  const header = { alg: 'HS256', typ: 'JWT' };
  const h = bytesToBase64url(enc.encode(JSON.stringify(header)));
  const p = bytesToBase64url(enc.encode(JSON.stringify(full)));
  const signingInput = `${h}.${p}`;

  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(signingInput)));
  return `${signingInput}.${bytesToBase64url(sig)}`;
}

export async function verifyJwt(token: string, secret: string): Promise<JwtClaims | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [h, p, s] = parts;
  const signingInput = `${h}.${p}`;

  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const ok = await crypto.subtle.verify('HMAC', key, base64urlToBytes(s), enc.encode(signingInput));
  if (!ok) return null;

  let claims: JwtClaims;
  try {
    claims = JSON.parse(dec.decode(base64urlToBytes(p))) as JwtClaims;
  } catch {
    return null;
  }
  const now = Math.floor(Date.now() / 1000);
  if (typeof claims.exp !== 'number' || claims.exp <= now) return null;
  return claims;
}

// ---------- misc ----------
export function newId(): string {
  return crypto.randomUUID();
}
