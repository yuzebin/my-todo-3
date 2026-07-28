# my-todo-3

My-todo-3 is a multi-user to-do schedule management tool that allows users to log in and manage their own to-do schedules.

## Status

Working MVP deployed on Cloudflare:

- **API** — Cloudflare Workers (Hono + TypeScript), see [`/api`](./api)
- **Database** — Cloudflare D1 (SQLite)
- **Web** — Cloudflare Pages (React + Vite), see [`/web`](./web)

Features: email/password signup & login (JWT), to-do CRUD, completion toggle, soft delete, schedule buckets (today / upcoming / overdue / no date), and strict per-user data isolation enforced at the SQL layer.

## Documentation

- [`DESIGN.md`](./DESIGN.md) — scope, architecture, data model, API spec, security.
- [`DEPLOY.md`](./DEPLOY.md) — how to deploy to Cloudflare (manual or via GitHub Actions).

## Quick start (local)

```bash
# Terminal 1 — API on :8787
cd api && npm install && npm run migrate:local && npm run dev

# Terminal 2 — Web on :5173 (proxies /api → :8787)
cd web && npm install && npm run dev
```

Open <http://localhost:5173>.

## Smoke test

```bash
# with `npm run dev` running in api/
bash api/scripts/smoke.sh
```
