import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError, getToken, setToken, type Todo } from './api';

type Bucket = 'today' | 'upcoming' | 'overdue' | 'unscheduled' | 'all';

const BUCKETS: { key: Bucket; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'unscheduled', label: 'No date' },
  { key: 'all', label: 'All' },
];

export function App() {
  const [authed, setAuthed] = useState<boolean>(() => !!getToken());
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    if (!authed) return;
    api.me().then((u) => setEmail(u.email)).catch(() => {
      setToken(null);
      setAuthed(false);
    });
  }, [authed]);

  if (!authed) {
    return <AuthScreen onAuthed={() => setAuthed(true)} />;
  }

  return (
    <TodosScreen
      email={email}
      onLogout={() => {
        void api.logout().catch(() => {});
        setToken(null);
        setAuthed(false);
        setEmail(null);
      }}
    />
  );
}

// -------------------- Auth --------------------
function AuthScreen({ onAuthed }: { onAuthed: () => void }) {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = mode === 'login'
        ? await api.login(email.trim(), password)
        : await api.signup(email.trim(), password);
      setToken(res.token);
      onAuthed();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Network error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-form card">
      <h1>my-todo-3</h1>
      <div className="sub">{mode === 'login' ? 'Log in to your tasks' : 'Create an account'}</div>
      {error && <div className="error">{error}</div>}
      <form onSubmit={submit}>
        <label className="field">
          <span>Email</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
        </label>
        <label className="field">
          <span>Password (min 8 chars)</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required minLength={8} />
        </label>
        <button type="submit" disabled={busy} style={{ width: '100%' }}>
          {busy ? '…' : mode === 'login' ? 'Log in' : 'Sign up'}
        </button>
      </form>
      <div className="switch">
        {mode === 'login' ? "Don't have an account? " : 'Already have an account? '}
        <a href="#" onClick={(e) => { e.preventDefault(); setError(null); setMode(mode === 'login' ? 'signup' : 'login'); }}>
          {mode === 'login' ? 'Sign up' : 'Log in'}
        </a>
      </div>
    </div>
  );
}

// -------------------- Todos --------------------
function TodosScreen({ email, onLogout }: { email: string | null; onLogout: () => void }) {
  const [bucket, setBucket] = useState<Bucket>('today');
  const [todos, setTodos] = useState<Todo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = bucket === 'all' ? {} : { bucket };
      setTodos(await api.listTodos(params));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [bucket]);

  useEffect(() => { void refresh(); }, [refresh]);

  return (
    <div className="shell">
      <header className="topbar">
        <h1>my-todo-3</h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span className="who">{email ?? ''}</span>
          <button className="secondary" onClick={onLogout}>Log out</button>
        </div>
      </header>

      <CreateTodo onCreated={() => void refresh()} />

      <div className="tabs">
        {BUCKETS.map((b) => (
          <button key={b.key} className={bucket === b.key ? 'active' : ''} onClick={() => setBucket(b.key)}>
            {b.label}
          </button>
        ))}
      </div>

      {error && <div className="card" style={{ color: 'var(--danger)' }}>{error}</div>}

      <div className="card">
        {loading && todos.length === 0 ? (
          <div className="empty">Loading…</div>
        ) : todos.length === 0 ? (
          <div className="empty">Nothing here. Add a to-do above.</div>
        ) : (
          todos.map((t) => (
            <TodoRow key={t.id} todo={t} onChanged={() => void refresh()} />
          ))
        )}
      </div>
    </div>
  );
}

function CreateTodo({ onCreated }: { onCreated: () => void }) {
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [priority, setPriority] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.createTodo({
        title: title.trim(),
        notes: notes.trim() || undefined,
        dueAt: dueAt ? new Date(dueAt).toISOString() : undefined,
        priority,
      });
      setTitle('');
      setNotes('');
      setDueAt('');
      setPriority(1);
      onCreated();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to create');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card" onSubmit={submit}>
      <label className="field">
        <span>New to-do</span>
        <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What needs doing?" maxLength={256} />
      </label>
      <label className="field">
        <span>Notes (optional)</span>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={4000} />
      </label>
      <div className="form-row">
        <label className="field due">
          <span>Due (optional)</span>
          <input type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
        </label>
        <label className="field priority">
          <span>Priority</span>
          <select value={priority} onChange={(e) => setPriority(Number(e.target.value))}>
            <option value={0}>Low</option>
            <option value={1}>Normal</option>
            <option value={2}>High</option>
          </select>
        </label>
        <button type="submit" disabled={busy || !title.trim()}>{busy ? '…' : 'Add'}</button>
      </div>
      {error && <div style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</div>}
    </form>
  );
}

function TodoRow({ todo, onChanged }: { todo: Todo; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(todo.title);
  const [notes, setNotes] = useState(todo.notes ?? '');
  const [dueAt, setDueAt] = useState(toLocalInput(todo.dueAt));
  const [busy, setBusy] = useState(false);

  const dueInfo = useMemo(() => formatDue(todo.dueAt, todo.status), [todo.dueAt, todo.status]);

  async function toggleComplete() {
    setBusy(true);
    try {
      await (todo.status === 'completed' ? api.reopenTodo(todo.id) : api.completeTodo(todo.id));
      onChanged();
    } finally { setBusy(false); }
  }

  async function remove() {
    if (!confirm('Delete this to-do?')) return;
    setBusy(true);
    try { await api.deleteTodo(todo.id); onChanged(); } finally { setBusy(false); }
  }

  async function save() {
    setBusy(true);
    try {
      await api.patchTodo(todo.id, {
        title: title.trim(),
        notes: notes.trim() || null,
        dueAt: dueAt ? new Date(dueAt).toISOString() : null,
      });
      setEditing(false);
      onChanged();
    } finally { setBusy(false); }
  }

  if (editing) {
    return (
      <div className="todo">
        <div className="body">
          <label className="field">
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={256} />
          </label>
          <label className="field">
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={4000} />
          </label>
          <label className="field" style={{ maxWidth: 240 }}>
            <input type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
          </label>
        </div>
        <div className="actions">
          <button onClick={save} disabled={busy}>Save</button>
          <button className="secondary" onClick={() => setEditing(false)} disabled={busy}>Cancel</button>
        </div>
      </div>
    );
  }

  return (
    <div className={`todo ${todo.status === 'completed' ? 'completed' : ''}`}>
      <input
        className="check"
        type="checkbox"
        checked={todo.status === 'completed'}
        onChange={toggleComplete}
        disabled={busy}
        aria-label={`Mark ${todo.title} ${todo.status === 'completed' ? 'pending' : 'completed'}`}
      />
      <div className="body">
        <div className="title">{todo.title}</div>
        {todo.notes && <div className="meta">{todo.notes}</div>}
        <div className="meta">
          <PriorityBadge priority={todo.priority} />
          {dueInfo && <span className={`due ${dueInfo.overdue ? 'overdue' : ''}`}>{dueInfo.label}</span>}
        </div>
      </div>
      <div className="actions">
        <button className="secondary" onClick={() => setEditing(true)} disabled={busy}>Edit</button>
        <button className="danger" onClick={remove} disabled={busy}>Delete</button>
      </div>
    </div>
  );
}

function PriorityBadge({ priority }: { priority: number }) {
  if (priority === 2) return <span style={{ color: 'var(--danger)' }}>● high</span>;
  if (priority === 0) return <span style={{ color: 'var(--muted)' }}>● low</span>;
  return <span style={{ color: 'var(--muted)' }}>● normal</span>;
}

// ---------- date helpers ----------
function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatDue(iso: string | null, status: Todo['status']): { label: string; overdue: boolean } | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  const overdue = status === 'pending' && d.getTime() < now.getTime();
  const sameDay = d.toDateString() === now.toDateString();
  const label = sameDay
    ? `Today ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
    : d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  return { label: overdue ? `Overdue · ${label}` : label, overdue };
}
