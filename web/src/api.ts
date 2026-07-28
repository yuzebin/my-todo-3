/**
 * Minimal API client. Talks to the Worker via either:
 *   - the dev proxy at /api/* (see vite.config.ts), or
 *   - VITE_API_URL when set (production build).
 */
export interface Todo {
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

const API_BASE =
  (import.meta as unknown as { env?: { VITE_API_URL?: string } }).env?.VITE_API_URL ?? '/api';

const TOKEN_KEY = 'mt3_token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(t: string | null): void {
  if (t) localStorage.setItem(TOKEN_KEY, t);
  else localStorage.removeItem(TOKEN_KEY);
}

class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

async function request<T>(
  path: string,
  opts: {
    method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
    body?: unknown;
    auth?: boolean;
  } = {},
): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.auth !== false) {
    const t = getToken();
    if (t) headers.Authorization = `Bearer ${t}`;
  }
  const res = await fetch(`${API_BASE}${path}`, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      throw new ApiError(res.status, 'bad_response', `Non-JSON response: ${text.slice(0, 200)}`);
    }
  }
  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string } } | null)?.error;
    throw new ApiError(res.status, err?.code ?? 'error', err?.message ?? `HTTP ${res.status}`);
  }
  return data as T;
}

export const api = {
  signup: (email: string, password: string) =>
    request<{ userId: string; token: string }>('/auth/signup', {
      method: 'POST',
      auth: false,
      body: { email, password },
    }),
  login: (email: string, password: string) =>
    request<{ userId: string; token: string }>('/auth/login', {
      method: 'POST',
      auth: false,
      body: { email, password },
    }),
  me: () => request<{ userId: string; email: string }>('/auth/me'),
  logout: () => request<void>('/auth/logout', { method: 'POST' }),
  listTodos: (params: { status?: 'pending' | 'completed'; bucket?: 'today' | 'upcoming' | 'overdue' | 'unscheduled' } = {}) => {
    const qs = new URLSearchParams();
    if (params.status) qs.set('status', params.status);
    if (params.bucket) qs.set('bucket', params.bucket);
    const q = qs.toString();
    return request<Todo[]>(`/todos${q ? `?${q}` : ''}`);
  },
  createTodo: (body: { title: string; notes?: string; dueAt?: string; priority?: number }) =>
    request<Todo>('/todos', { method: 'POST', body }),
  patchTodo: (id: string, body: Partial<{ title: string; notes: string | null; dueAt: string | null; priority: number }>) =>
    request<Todo>(`/todos/${id}`, { method: 'PATCH', body }),
  completeTodo: (id: string) => request<Todo>(`/todos/${id}/complete`, { method: 'POST' }),
  reopenTodo: (id: string) => request<Todo>(`/todos/${id}/reopen`, { method: 'POST' }),
  deleteTodo: (id: string) => request<void>(`/todos/${id}`, { method: 'DELETE' }),
};

export { ApiError };
