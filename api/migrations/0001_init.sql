-- my-todo-3 initial schema
-- D1 (SQLite) version of the data model from DESIGN.md §8.

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,           -- UUIDv4
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,              -- "pbkdf2$iter$salt$hash" (base64)
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS todos (
  id           TEXT PRIMARY KEY,            -- UUIDv4
  owner_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  notes        TEXT,
  due_at       TEXT,                        -- ISO-8601 timestamptz as text
  priority     INTEGER NOT NULL DEFAULT 1 CHECK (priority IN (0, 1, 2)),
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed')),
  completed_at TEXT,
  deleted_at   TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_todos_owner        ON todos(owner_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_todos_owner_due    ON todos(owner_id, due_at)  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_todos_owner_status ON todos(owner_id, status) WHERE deleted_at IS NULL;
