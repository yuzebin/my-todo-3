# my-todo-3 — Design Document

> Source of truth: [`README.md`](./README.md) — *"My-todo-3 is a multi-user to-do schedule management tool that allows users to log in and manage their own to-do schedules."*

This document specifies the design for my-todo-3. It is intended to align contributors on scope, architecture, data model, and APIs before implementation begins.

---

## 1. Overview

my-todo-3 is a multi-user, web-based to-do and schedule management tool. Each registered user authenticates against the system and is given a private workspace in which they can create, organize, track, and complete to-do items and time-bound schedule entries. Users never see or mutate another user's data.

The product is intentionally focused: it is **not** a team-collaboration or project-management suite. There is no sharing, assignment-to-others, or shared calendar in scope for v1.

## 2. Goals & Non-Goals

### Goals
- Let a user create an account and securely log in.
- Let a user manage a private collection of to-do items (create, read, update, delete, complete).
- Let a user attach time-bound schedule metadata (due date / scheduled time) to to-dos.
- Let a user view their to-dos grouped/sorted by schedule (today, upcoming, overdue, unscheduled).
- Enforce strict per-user data isolation.

### Non-Goals (v1)
- Real-time collaboration or shared lists between users.
- Notifications (email/push) — deferred to a later milestone.
- Recurring tasks (e.g. "every Monday").
- Calendar sync (Google/Outlook) or CalDAV.
- Mobile-native apps; v1 ships a responsive web client only.

## 3. Personas

- **Individual user**: the only actor in v1. Owns all data they create.

## 4. Functional Requirements

### 4.1 Authentication & Account
- **Sign up** with email + password.
- **Log in**; receive a session token used for subsequent API calls.
- **Log out**; invalidate the session.
- Passwords must never be stored in plaintext (see §7).
- A user can have only their own session; no impersonation.

### 4.2 To-do Management
- Create a to-do with: title (required), notes (optional), due date/time (optional), priority (optional), status (default `pending`).
- List to-dos with filtering by status and date bucket.
- Update any mutable field of a to-do.
- Delete a to-do (soft-delete recommended to support undo).
- Mark a to-do as `completed` / revert to `pending`.

### 4.3 Schedule Views
- **Today**: to-dos due today or overdue and not completed.
- **Upcoming**: to-dos with a due date in the future.
- **Overdue**: to-dos past their due date and not completed.
- **Unscheduled**: to-dos with no due date.

### 4.4 Data Isolation
- Every to-do read/write MUST be scoped to the authenticated user. The API must reject any request attempting to address a resource owned by another user with `404` (not `403`, to avoid leaking existence).

## 5. Non-Functional Requirements

| Concern | Target |
|---|---|
| Availability | Best-effort single-region for v1; no formal SLO. |
| Latency | p95 < 300 ms for list/create/update under typical load. |
| Scale | Designed for up to ~10k users and ~100 to-dos/user (≈1M rows) — not a hard limit. |
| Security | TLS in transit; passwords hashed (bcrypt/argon2); per-row authorization on every query. |
| Privacy | No cross-user data exposure; no analytics on to-do content. |
| Accessibility | Web client targets WCAG 2.1 AA for core flows. |

## 6. System Architecture

```
┌───────────────┐     HTTPS     ┌─────────────────┐     ┌──────────────┐
│  Web Client   │ ────────────► │  API Server     │ ──► │  Database    │
│  (SPA/SSR)    │ ◄──────────── │  (stateless)    │ ◄── │  (Postgres)  │
└───────────────┘   JSON+JWT    └─────────────────┘     └──────────────┘
                                       │
                                       └── (future) ──► Notification worker
```

- **Web Client**: a single-page or server-rendered web app. Responsible only for rendering and form validation; enforces no security (all authorization is server-side).
- **API Server**: stateless service exposing a REST/JSON API. Authn via JWT (or opaque session token stored in an httpOnly cookie). All endpoints that touch to-dos require a valid authenticated user.
- **Database**: a relational store (Postgres). The relational model gives us strong constraints (FKs, uniqueness) and a clear authorization boundary (every `todo` row carries `owner_id`).

### Components
- `auth/`: signup, login, logout, password hashing, token issuance/verification.
- `todos/`: CRUD + completion + list/filtering for to-dos.
- `middleware/`: authentication, request logging, error handling.

## 7. Security Design

- **Password storage**: hash with bcrypt (cost ≥ 12) or argon2id. Never log or return password hashes.
- **Sessions**: short-lived access token (e.g. 15 min) + refresh token (e.g. 7 days, rotated on use). For v1 a single opaque session token in an httpOnly, Secure, SameSite=Lax cookie is acceptable.
- **Authorization**: every to-do query includes `WHERE owner_id = $authenticated_user_id`. Object IDs are not guessable (use UUIDv4).
- **Transport**: TLS only; HSTS enabled.
- **Input validation**: server-side validation of all inputs; titles/notes length-capped.
- **Rate limiting**: on login and signup endpoints to mitigate brute force.

## 8. Data Model

### `users`
| column | type | notes |
|---|---|---|
| `id` | uuid (pk) | UUIDv4 |
| `email` | citext / text | unique, not null |
| `password_hash` | text | not null |
| `created_at` | timestamptz | not null, default now() |

### `todos`
| column | type | notes |
|---|---|---|
| `id` | uuid (pk) | UUIDv4 |
| `owner_id` | uuid (fk → users.id) | not null; indexed |
| `title` | text | not null, length ≤ 256 |
| `notes` | text | nullable, length ≤ 4000 |
| `due_at` | timestamptz | nullable |
| `priority` | smallint | 0..2 (low/normal/high), default 1 |
| `status` | text | `pending` \| `completed`, default `pending` |
| `completed_at` | timestamptz | nullable; set when status → completed |
| `deleted_at` | timestamptz | nullable; soft delete |
| `created_at` | timestamptz | not null, default now() |
| `updated_at` | timestamptz | not null, default now() |

Indexes:
- `todos(owner_id)` — list queries are always per-owner.
- `todos(owner_id, due_at)` — schedule-bucket queries.
- `todos(owner_id, status)` — status filters.

## 9. API Design (REST)

All endpoints except `POST /auth/signup` and `POST /auth/login` require authentication. Errors use a consistent shape: `{ "error": { "code": "...", "message": "..." } }`.

### Auth
| Method | Path | Description |
|---|---|---|
| POST | `/auth/signup` | Create account. Body: `{ email, password }` → `201 { userId }` |
| POST | `/auth/login` | Authenticate. Body: `{ email, password }` → `200 { token }` (or sets cookie) |
| POST | `/auth/logout` | Invalidate session. → `204` |

### Todos
| Method | Path | Description |
|---|---|---|
| POST | `/todos` | Create. Body: `{ title, notes?, dueAt?, priority? }` → `201 Todo` |
| GET | `/todos` | List. Query: `?status=&bucket=today\|upcoming\|overdue\|unscheduled` → `200 Todo[]` |
| GET | `/todos/{id}` | Read one. → `200 Todo` / `404` |
| PATCH | `/todos/{id}` | Partial update. Body: any subset of mutable fields. → `200 Todo` |
| POST | `/todos/{id}/complete` | Mark completed. → `200 Todo` |
| POST | `/todos/{id}/reopen` | Revert to pending. → `200 Todo` |
| DELETE | `/todos/{id}` | Soft delete. → `204` |

### `Todo` resource shape
```json
{
  "id": "uuid",
  "title": "string",
  "notes": "string | null",
  "dueAt": "ISO-8601 | null",
  "priority": 1,
  "status": "pending",
  "completedAt": "ISO-8601 | null",
  "createdAt": "ISO-8601",
  "updatedAt": "ISO-8601"
}
```

## 10. Technology Stack (proposed)

- **Backend**: Node.js (TypeScript) with a lightweight HTTP framework (e.g. Fastify or Express). Chosen for fast iteration and shared language with the client.
- **Database**: PostgreSQL 15+. Migration tool: any standard (e.g. node-pg-migrate).
- **Auth**: JWT (HS256 for v1; rotate the signing key) OR opaque session tokens in a `sessions` table. Pick one and document the choice before implementation.
- **Web client**: React + TypeScript, responsive, minimal dependencies.
- **Deployment**: containerized API + Postgres; v1 single instance is acceptable.
- **Observability (minimal)**: structured request logs + a `/healthz` endpoint.

> These are recommendations; the implementer may substitute equivalents (e.g. Go/Python for the API) as long as the security and data-isolation requirements in §5 and §7 are met.

## 11. Open Questions

1. Confirm session strategy: JWT vs. opaque cookie session. (See §10.)
2. Is email verification required at signup? Assumed **no** for v1.
3. Is a "forgot password" flow needed in v1? Assumed **no**; add later with email.
4. Soft delete (`deleted_at`) vs. hard delete — confirm preference.

## 12. Milestones (illustrative)

1. **M1 — Auth skeleton**: signup/login/logout, password hashing, session token, `/healthz`.
2. **M2 — Todo CRUD**: create/list/get/patch/delete + per-owner authorization enforced end-to-end.
3. **M3 — Schedule views**: today/upcoming/overdue/unscheduled buckets.
4. **M4 — Web client**: usable responsive UI covering M1–M3 flows.
5. **M5 — Hardening**: rate limiting, input validation, error normalization, basic observability.
