/**
 * To-do CRUD routes. Every handler enforces per-owner scoping at the SQL
 * layer: `owner_id = ?` is bound to the authenticated user id on every
 * statement. There is no code path that can read or mutate another user's
 * rows.
 */
import { Hono } from 'hono';
import type { Env, AuthUser } from './env';
import { newId } from './crypto';
import { jsonError } from './auth';

export const todos = new Hono<{ Bindings: Env; Variables: { user: AuthUser } }>();

const MAX_TITLE = 256;
const MAX_NOTES = 4000;

interface TodoRow {
  id: string;
  owner_id: string;
  title: string;
  notes: string | null;
  due_at: string | null;
  priority: number;
  status: string;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

interface TodoResource {
  id: string;
  title: string;
  notes: string | null;
  dueAt: string | null;
  priority: number;
  status: 'pending' | 'completed';
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

function toResource(r: TodoRow): TodoResource {
  return {
    id: r.id,
    title: r.title,
    notes: r.notes,
    dueAt: r.due_at,
    priority: r.priority,
    status: r.status as 'pending' | 'completed',
    completedAt: r.completed_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function user(c: { get: (k: 'user') => AuthUser }): AuthUser {
  return c.get('user');
}

// CREATE ------------------------------------------------------------------
todos.post('/', async (c) => {
  const u = user(c);
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== 'object') return jsonError(c, 400, 'bad_body', 'Expected JSON body');

  const { title, notes, dueAt, priority } = body as {
    title?: unknown; notes?: unknown; dueAt?: unknown; priority?: unknown;
  };
  if (typeof title !== 'string' || title.trim().length === 0) {
    return jsonError(c, 400, 'bad_title', 'title is required');
  }
  if (title.length > MAX_TITLE) return jsonError(c, 400, 'bad_title', `title must be ≤ ${MAX_TITLE} chars`);
  if (notes != null && (typeof notes !== 'string' || notes.length > MAX_NOTES)) {
    return jsonError(c, 400, 'bad_notes', `notes must be a string ≤ ${MAX_NOTES} chars`);
  }
  if (dueAt != null && (typeof dueAt !== 'string' || Number.isNaN(Date.parse(dueAt)))) {
    return jsonError(c, 400, 'bad_dueAt', 'dueAt must be an ISO-8601 timestamp');
  }
  let priorityVal = 1;
  if (priority != null) {
    const n = typeof priority === 'number' ? priority : Number.parseInt(String(priority), 10);
    if (!Number.isInteger(n) || n < 0 || n > 2) {
      return jsonError(c, 400, 'bad_priority', 'priority must be 0, 1, or 2');
    }
    priorityVal = n;
  }

  const id = newId();
  await c.env.DB.prepare(
    `INSERT INTO todos (id, owner_id, title, notes, due_at, priority)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, u.userId, title.trim(), notes ?? null, dueAt ?? null, priorityVal)
    .run();

  const row = await loadTodo(c.env.DB, id, u.userId);
  if (!row) return jsonError(c, 500, 'internal', 'Created todo not found');
  return c.json(toResource(row), 201);
});

// LIST --------------------------------------------------------------------
todos.get('/', async (c) => {
  const u = user(c);
  const status = c.req.query('status');
  const bucket = c.req.query('bucket');

  let sql = 'SELECT * FROM todos WHERE owner_id = ? AND deleted_at IS NULL';
  const args: (string | number)[] = [u.userId];

  if (status === 'pending' || status === 'completed') {
    sql += ' AND status = ?';
    args.push(status);
  }

  const nowIso = new Date().toISOString();
  // Buckets are computed in SQL on the timestamptz-as-text representation.
  // SQLite's `datetime()` compares ISO-8601 strings lexicographically, which
  // works for UTC 'YYYY-MM-DDTHH:MM:SS.sssZ'. We store/compare UTC values
  // consistently. "Today" is approximated as the UTC calendar day — fine for v1.
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const todayEnd = new Date(todayStart);
  todayEnd.setUTCDate(todayEnd.getUTCDate() + 1);

  switch (bucket) {
    case 'today':
      sql += ' AND due_at IS NOT NULL AND due_at < ? AND status = ?';
      args.push(todayEnd.toISOString(), 'pending');
      break;
    case 'upcoming':
      sql += ' AND due_at IS NOT NULL AND due_at >= ? AND status = ?';
      args.push(todayEnd.toISOString(), 'pending');
      break;
    case 'overdue':
      sql += ' AND due_at IS NOT NULL AND due_at < ? AND status = ?';
      args.push(todayStart.toISOString(), 'pending');
      break;
    case 'unscheduled':
      sql += ' AND due_at IS NULL';
      break;
    case undefined:
      break;
    default:
      return jsonError(c, 400, 'bad_bucket', "bucket must be one of today|upcoming|overdue|unscheduled");
  }

  // Suppress unused-warning while keeping the variable available for future logging.
  void nowIso;

  sql += ' ORDER BY (due_at IS NULL), due_at ASC, created_at ASC LIMIT 500';

  const result = await c.env.DB.prepare(sql).bind(...args).all<TodoRow>();
  return c.json(result.results.map(toResource));
});

// READ ONE ----------------------------------------------------------------
todos.get('/:id', async (c) => {
  const u = user(c);
  const row = await loadTodo(c.env.DB, c.req.param('id'), u.userId);
  if (!row) return jsonError(c, 404, 'not_found', 'Todo not found');
  return c.json(toResource(row));
});

// PATCH -------------------------------------------------------------------
todos.patch('/:id', async (c) => {
  const u = user(c);
  const id = c.req.param('id');
  const existing = await loadTodo(c.env.DB, id, u.userId);
  if (!existing) return jsonError(c, 404, 'not_found', 'Todo not found');

  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== 'object') return jsonError(c, 400, 'bad_body', 'Expected JSON body');

  const sets: string[] = [];
  const args: (string | number | null)[] = [];

  const { title, notes, dueAt, priority } = body as {
    title?: unknown; notes?: unknown; dueAt?: unknown; priority?: unknown;
  };

  if (title !== undefined) {
    if (typeof title !== 'string' || title.trim().length === 0) return jsonError(c, 400, 'bad_title', 'title cannot be empty');
    if (title.length > MAX_TITLE) return jsonError(c, 400, 'bad_title', `title must be ≤ ${MAX_TITLE} chars`);
    sets.push('title = ?'); args.push(title.trim());
  }
  if (notes !== undefined) {
    if (notes !== null && (typeof notes !== 'string' || notes.length > MAX_NOTES)) {
      return jsonError(c, 400, 'bad_notes', `notes must be a string ≤ ${MAX_NOTES} chars or null`);
    }
    sets.push('notes = ?'); args.push(notes);
  }
  if (dueAt !== undefined) {
    if (dueAt !== null && (typeof dueAt !== 'string' || Number.isNaN(Date.parse(dueAt)))) {
      return jsonError(c, 400, 'bad_dueAt', 'dueAt must be an ISO-8601 timestamp or null');
    }
    sets.push('due_at = ?'); args.push(dueAt);
  }
  if (priority !== undefined) {
    const n = typeof priority === 'number' ? priority : Number.parseInt(String(priority), 10);
    if (!Number.isInteger(n) || n < 0 || n > 2) return jsonError(c, 400, 'bad_priority', 'priority must be 0, 1, or 2');
    sets.push('priority = ?'); args.push(n);
  }

  if (sets.length === 0) return c.json(toResource(existing));

  sets.push("updated_at = datetime('now')");
  args.push(id, u.userId);

  await c.env.DB.prepare(
    `UPDATE todos SET ${sets.join(', ')} WHERE id = ? AND owner_id = ? AND deleted_at IS NULL`,
  ).bind(...args).run();

  const row = await loadTodo(c.env.DB, id, u.userId);
  if (!row) return jsonError(c, 404, 'not_found', 'Todo not found');
  return c.json(toResource(row));
});

// COMPLETE / REOPEN -------------------------------------------------------
todos.post('/:id/complete', async (c) => setStatus(c, 'completed'));
todos.post('/:id/reopen', async (c) => setStatus(c, 'pending'));

async function setStatus(c: { req: { param: (k: string) => string }; env: Env; get: (k: 'user') => AuthUser; json: (b: unknown, s?: number) => Response }, target: 'pending' | 'completed'): Promise<Response> {
  const u = c.get('user');
  const id = c.req.param('id');
  const existing = await loadTodo(c.env.DB, id, u.userId);
  if (!existing) return jsonError(c, 404, 'not_found', 'Todo not found');

  const completedAt = target === 'completed' ? new Date().toISOString() : null;
  await c.env.DB.prepare(
    `UPDATE todos SET status = ?, completed_at = ?, updated_at = datetime('now')
     WHERE id = ? AND owner_id = ? AND deleted_at IS NULL`,
  ).bind(target, completedAt, id, u.userId).run();

  const row = await loadTodo(c.env.DB, id, u.userId);
  if (!row) return jsonError(c, 404, 'not_found', 'Todo not found');
  return c.json(toResource(row));
}

// DELETE (soft) -----------------------------------------------------------
todos.delete('/:id', async (c) => {
  const u = user(c);
  const id = c.req.param('id');
  const result = await c.env.DB.prepare(
    `UPDATE todos SET deleted_at = ?, updated_at = datetime('now')
     WHERE id = ? AND owner_id = ? AND deleted_at IS NULL`,
  ).bind(new Date().toISOString(), id, u.userId).run();

  if (result.meta.changes === 0) return jsonError(c, 404, 'not_found', 'Todo not found');
  return c.body(null, 204);
});

// helper ------------------------------------------------------------------
async function loadTodo(db: D1Database, id: string, ownerId: string): Promise<TodoRow | null> {
  return db.prepare(
    'SELECT * FROM todos WHERE id = ? AND owner_id = ? AND deleted_at IS NULL',
  ).bind(id, ownerId).first<TodoRow>();
}
