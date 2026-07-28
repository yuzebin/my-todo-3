# Deploying my-todo-3 to Cloudflare

This guide deploys the MVP using:

- **Cloudflare Workers** — API ([`/api`](./api))
- **Cloudflare D1** — SQLite database
- **Cloudflare Pages** — React frontend ([`/web`](./web))

> There are two ways to deploy: **A)** one-click via GitHub Actions (recommended — pushes to `main` deploy automatically), or **B)** manually from your laptop with `wrangler`.

---

## 0. Prerequisites

- A Cloudflare account (free tier is fine).
- Node.js 20+ and `npm`.
- `wrangler` installed locally for manual deploys: `npm i -g wrangler` (or use `npx wrangler` as below).
- For GitHub Actions deploys: a GitHub repo with this code pushed.

## 1. Log in to Cloudflare

```bash
npx wrangler login
```

This opens a browser to authorize wrangler. (For CI, see §A below — you'll use an API token instead.)

---

## 2. Create the D1 database

```bash
cd api
npx wrangler d1 create my-todo-3
```

The command prints a `database_id` and **rewrites** [`api/wrangler.toml`](./api/wrangler.toml) automatically — the `REPLACE_WITH_D1_DATABASE_ID` placeholder gets replaced with the real id. Commit that change.

## 3. Apply migrations

```bash
cd api
# Local (for `wrangler dev`)
npx wrangler d1 migrations apply my-todo-3 --local
# Remote (the production database you just created)
npx wrangler d1 migrations apply my-todo-3 --remote
```

## 4. Set the JWT secret

The `JWT_SECRET` in `wrangler.toml` is a placeholder for local dev only. **Replace it with a real secret** before going live:

```bash
cd api
# Generate a strong secret and upload it (stored encrypted, never in the repo):
openssl rand -base64 32 | npx wrangler secret put JWT_SECRET
```

Optionally restrict CORS to your Pages domain:

```bash
echo "https://my-todo-3.<your-subdomain>.pages.dev" | npx wrangler secret put ALLOWED_ORIGIN
```

(If you skip this, the API accepts requests from any origin — fine for a personal MVP, not for production.)

## 5. Deploy the API (Worker)

```bash
cd api
npx wrangler deploy
```

Note the URL it prints, e.g. `https://my-todo-3-api.<your-subdomain>.workers.dev`. Smoke-test it:

```bash
curl https://my-todo-3-api.<your-subdomain>.workers.dev/healthz
# {"status":"ok","time":"..."}
```

## 6. Build and deploy the frontend (Pages)

```bash
cd web
# Build with the API URL baked in (use the URL from step 5).
VITE_API_URL="https://my-todo-3-api.<your-subdomain>.workers.dev" npx vite build

# Create the Pages project on first deploy (only once):
npx wrangler pages project create my-todo-3 --production-branch=main

# Deploy:
npx wrangler pages deploy dist --project-name=my-todo-3
```

Wrangler prints the Pages URL, e.g. `https://my-todo-3.<your-subdomain>.pages.dev`. Open it and sign up.

---

## A. One-click deploys via GitHub Actions (recommended)

The workflow in [`.github/workflows/deploy.yml`](./.github/workflows/deploy.yml) deploys both the API and web on every push to `main`.

### One-time setup

1. **Create a Cloudflare API token** at
   <https://dash.cloudflare.com/profile/api-tokens> → "Create token" →
   "Edit Cloudflare Workers" template. Add these permissions:
   - Account / Workers Scripts / **Edit**
   - Account / D1 / **Edit**
   - Account / Cloudflare Pages / **Edit**

2. **Add repository secrets** (GitHub → Settings → Secrets and variables → Actions → New repository secret):
   - `CLOUDFLARE_API_TOKEN` — the token from step 1
   - `CLOUDFLARE_ACCOUNT_ID` — your account id (shown in the Cloudflare dashboard URL or `wrangler whoami`)
   - `JWT_SECRET` — `openssl rand -base64 32`

3. **Add repository variables** (same page → "Variables" tab, not Secrets):
   - `VITE_API_URL` — your deployed Worker URL, e.g.
     `https://my-todo-3-api.<your-subdomain>.workers.dev`
   - `ALLOWED_ORIGIN` *(optional)* — your Pages URL, e.g.
     `https://my-todo-3.<your-subdomain>.pages.dev`

4. **Commit the real `database_id`** that step 2 above wrote into
   [`api/wrangler.toml`](./api/wrangler.toml). The CI workflow uses that id to
   apply remote migrations.

5. Push to `main`. The workflow will:
   - typecheck,
   - apply D1 migrations remotely,
   - deploy the Worker,
   - set `JWT_SECRET` (and `ALLOWED_ORIGIN` if defined),
   - build the frontend with `VITE_API_URL`,
   - deploy to Pages.

---

## Local development

Two terminals:

```bash
# Terminal 1 — API on http://127.0.0.1:8787
cd api
npm install
npm run migrate:local   # one-time
npm run dev

# Terminal 2 — Web on http://localhost:5173 (proxies /api → :8787)
cd web
npm install
npm run dev
```

Open <http://localhost:5173>. The dev proxy in [`web/vite.config.ts`](./web/vite.config.ts) forwards `/api/*` to the Worker, so no CORS setup is needed locally.

### Smoke test the API

With `wrangler dev` running on `:8787`:

```bash
bash api/scripts/smoke.sh
```

35 assertions covering signup/login, todo CRUD, schedule buckets, and per-user isolation. All must pass.

---

## Operations

| Task | Command |
|---|---|
| Run a one-off SQL query on remote D1 | `npx wrangler d1 execute my-todo-3 --remote --command "SELECT count(*) FROM todos"` |
| Tail Worker logs (live) | `npx wrangler tail` |
| Rotate JWT secret | `openssl rand -base64 32 \| npx wrangler secret put JWT_SECRET` (existing tokens become invalid immediately) |
| Roll back a Worker deploy | `npx wrangler rollback` (Workers keeps recent versions) |

---

## Cost notes (free tier)

- Workers: 100k requests/day free.
- D1: 5M rows read / 100k rows written per day free.
- Pages: 500 builds/month, unlimited requests free.

A personal multi-user todo app will live comfortably inside these limits.
