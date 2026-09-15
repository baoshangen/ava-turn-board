# AVA Turn Board

Shared salon turn board for phones and laptops, running on **Cloudflare Workers + D1**.
Everyone in the salon logs in with one shared account and sees the same board; edits
sync live between devices. Free to host on a `*.workers.dev` link.

## Features

- Seven daily boards with up to 15 turns each
- Technician arrival ordering per day
- Service selection with visual status colors
- Compact and expanded board views
- Per-day reset controls
- One shared salon login, with optional 30-day "remember me" sessions
- Conflict-aware synchronization between devices (three-way merge, revision guard)

## How authentication works

- **Owner setup** (`/setup`): create or change the shared salon account.
  - By default (no `OWNER_SETUP_KEY` set) the **first** visit to `/setup` creates the
    account with no key; afterwards only a signed-in device can change it. This is the
    simplest path for a one-click browser deploy.
  - For stricter control, set an `OWNER_SETUP_KEY` Worker secret — then `/setup` always
    requires that key. Never commit it.
- **Shared salon account**: a username + password (min 15 chars) that everyone in the
  salon uses to log in. Passwords are hashed with scrypt; sessions are random tokens
  stored hashed in D1. Changing the password logs out every device but keeps the board.

## Deploy to Cloudflare (free `workers.dev` link)

### Prerequisites

- A free [Cloudflare account](https://dash.cloudflare.com/sign-up).
- Node 18+ and npm.
- Authenticate wrangler once: `npx wrangler login`
  (or set `CLOUDFLARE_API_TOKEN` with **Workers Scripts:Edit** and **D1:Edit** permissions).

### Option A — one command

```bash
./deploy.sh
```

This installs deps, builds, creates the D1 database, writes its id into `wrangler.toml`,
applies migrations, generates and sets `OWNER_SETUP_KEY` (printed once — **save it**),
and deploys. At the end it prints your `https://<name>.<subdomain>.workers.dev` URL.

### Option B — manual steps

```bash
npm install

# 1. Create the D1 database, then paste the printed database_id into wrangler.toml
npx wrangler d1 create ava-turn-board

# 2. Create the tables
npm run migrate:remote

# 3. Set the owner setup key (any long random string; keep it private)
npx wrangler secret put OWNER_SETUP_KEY

# 4. Build and deploy
npm run deploy
```

### First run

1. Open the printed `*.workers.dev` URL, then go to `<URL>/setup`.
2. Enter a salon username and a password (≥ 15 characters). Enter the `OWNER_SETUP_KEY`
   too if you configured one.
3. Share the URL + username + password with the salon. Log in on phone and laptop —
   turns stay in sync automatically.

## Development

```bash
npm install
npm test                          # build + run the auth/sync test suite

cp .dev.vars.example .dev.vars    # set a local OWNER_SETUP_KEY
npm run migrate:local             # create tables in the local D1
npm run dev                       # local Worker at http://localhost:8787
```

## Project layout

- `src/worker.js` — Worker entry: routing, board GET/PUT with revision conflict handling, security headers
- `src/auth.js` — setup key check, salon login, scrypt hashing, sessions, rate limiting
- `src/index.html`, `src/app.js`, `src/merge.js`, `src/styles.css` — the board UI and client sync
- `src/login.html`, `src/auth-ui.js` — login and owner setup pages
- `build.mjs` — bundles the Worker (assets inlined) into `dist/worker.js`
- `migrations/` — D1 schema applied by wrangler
- `wrangler.toml` — Worker + D1 configuration
- `tests/auth.mjs` — end-to-end auth and sync tests against the bundle

## Security notes

Never commit passwords, session tokens, the setup key, or production database contents.
`OWNER_SETUP_KEY` lives only as a Worker secret (and in local `.dev.vars`, which is
git-ignored).
