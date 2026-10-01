# AVA Turn Board — project guide for Claude Code

A small live PWA for a nail salon: a daily "turn board" that tracks which
technician takes each turn and what service they do. English UI, teal accent
(`--accent:#0d9488`). Runs on Cloudflare Workers + D1. Used on phones/tablets by
receptionists, so touch-friendliness and simplicity matter more than features.

## Workflow rule (owner's standing request)

For every change: **Plan → build a MOCKUP/sample and send it to the owner to
review → only DEPLOY after they approve.** Do not push changes to the live app
before the owner has seen and approved a sample of the change.

## Two repositories — keep `src/` byte-identical

The same app lives in two GitHub repos. **Every change must be applied to both,
keeping `src/` identical**, then built and pushed to both:

- **Live** — `baoshangen/ava-turn-board`, branch `main`. Cloudflare **Workers
  Builds auto-deploys on push to `main`** (~1–2 min).
- **Canonical / dev** — `baoshangen/-ava-turn-board`, branch
  `claude/ava-turn-board-deploy-dgtpeh`.

Ship checklist (do all, in order) before considering a change done:
1. Edit files under `src/` (identical in both repos).
2. `npm run build` in both repos → confirm `dist/worker.js` is identical between them.
3. Test: `node --test tests/auth.mjs tests/setup-open.mjs tests/pin.mjs` → expect `# pass 3`.
4. Commit both, push live to `main` and canonical to its branch.

## Commands

- `npm run build` — bundle `src/worker.js` → `dist/worker.js` (esbuild). See `build.mjs`.
- `npm test` — build + `node --test` (auth + setup-open; add `tests/pin.mjs` when running manually).
- `npm run dev` — `wrangler dev` (local).
- `npm run deploy` — `wrangler deploy` (needs `wrangler login`; usually unnecessary since pushing `main` auto-deploys).
- D1 migrations: `npm run migrate:local` / `npm run migrate:remote`.

## Architecture

- **`build.mjs`** bundles the Worker into a single self-contained `dist/worker.js`.
  Static assets (`index.html`, `app.js`, `merge.js`, `sortable.min.js`, `sw.js`,
  `styles.css`, `login.html`, `auth-ui.js`, `manifest.webmanifest`, icons) are
  **inlined into the bundle** via an `ASSETS` banner — no separate asset upload.
  **When adding a new static asset you must register it in `build.mjs`** and
  reference it from `index.html`.
- **`src/sw.js`** — service worker for offline use. **HTML is network-first on
  purpose**: cache-first would strand every tablet on a stale build, which cannot
  be fixed from the salon. `/api/*`, `/login` and `/auth-ui.js` are never cached.
  Served from `PUBLIC_ASSETS` (no session) so registration survives a lapsed login.
  Bump `CACHE_VERSION` when a shell asset changes shape.
- **Offline copy**: `cacheState()` in `app.js` writes the board to `localStorage`
  after every successful load/save, and `loadState()` reads it at startup, so the
  board opens with no connection behind an `.is-offline` banner. Viewing works
  offline; **editing stays locked** because the 3-way merge needs the server's
  base copy. `cachedAt` is deliberately kept out of `shared()` so it never syncs.
- **`src/worker.js`** — request router. Serves inlined assets; `/api/account`,
  `/api/pin/*`, `/api/board` (GET/PUT with `?loc=`). `valid()` ignores unknown
  keys, so new `state` fields need no server change.
- **`src/auth.js`** — accounts (scrypt via `@noble/hashes`) + session cookies +
  per-location **PIN gate** (`pinGate`/`pinRoute`). PIN hash stored in the
  `board` table at `id = 100 + loc`.
- **`src/app.js`** — the whole client, one IIFE. Rendering (`renderBoard`,
  `renderSettings`), sync (`sync`/`save`), service picker, roster, drag-reorder.
- **`src/merge.js`** — 3-way merge so multiple devices sync without clobbering.
- **D1**: one `board` table `(id, revision, data)`. Board data is JSON. Location 1 =
  `id 1`, location 2 = `id 2`; PINs at `id 101 / 102`. Secrets (D1 binding,
  `OWNER_SETUP_KEY`, env vars) live in Cloudflare, **not** in git.

## Data model (`state`, stored as JSON in `board.data`)

`{ activeDay, centerTurn, name, services:[str], staffByDay:{day:[{id,name}]},
orderByDay:{day:[id]}, entries:{"day|id|turn": value}, halfTurns:bool, roster:[{id,name}],
techColors:{ "<lowercased name>": "blue"|"gold"|"pink" } }`

- **`techColors`** — optional per-technician type colour. **Keyed by lowercased name**
  (not id) because the app matches techs by name everywhere, so a colour follows a
  person across every day and onto the board. Set via the 3 dots next to each tech in
  Settings (roster list + day list). On the board it tints ONLY that tech's name cell
  and the `＋` of their empty cells (classes `ttype-blue/gold/pink` on the `<tr>`);
  filled cells and everything else are untouched. Colours are fixed CSS classes, not
  inline styles — the strict CSP blocks inline `style` attributes. `valid()` ignores
  the field, so no server change was needed.

- 15 turns per day (`TURN_COUNT`). `entries` key = `` `${day}|${staffId}|${turn}` ``.
- Cell value uses `SPLIT = "␟"` (unit separator):
  - `"Pe"` = single service, **full turn**, green.
  - `"Pe␟"` = one half only, **half turn**, red.
  - `"Pe␟Nc"` = two halves, **full turn**, green.
- Helpers in `app.js`: `isComplete`, `isHalf`, `turnValue` (1 / 0.5 / 0), `techTurns`.
- `staffByDay[day]` = who works that day (the pool). `orderByDay[day]` = arrival
  order (array of ids) shown as board rows. `roster` = shop-wide master list; each
  day picks from it.

## UI conventions & behaviors already built

- Teal theme; English UI. `styles.css` line 1 is a big minified block; extra
  rules are appended as readable lines after it.
- Turn cells are small squares (56px). **Collapse** fills width via a `--tw` CSS
  var set in `renderBoard`; **Expand** shows all 15 squares. Full-screen (`⛶` /
  tapping the day title) only hides the top chrome.
- **Half turns**: `♥` in the service picker (outline `♡` off / solid `♥` on);
  each press fills the next empty half. Per-location on/off toggle in Settings
  (`state.halfTurns`). Board shows a `♥` before each half service.
- **Turn-count badge** replaces the dropdown arrow next to an assigned tech
  (counts today's turns: full=1, half=0.5).
- **Roster**: Settings has a collapsible `<details>` "All technicians (N)".
  Per day, "+ Add technicians to this day" **closes Settings, opens the roster
  picker on its own, then reopens Settings** (avoids the dialog covering it).
- **Drag to reorder** via **SortableJS** (`src/sortable.min.js`, vendored,
  `forceFallback` for smooth touch): grip handle `.drag-handle`; reorders board
  arrival rows (`#turn-body`, `tr[data-sort]`) and the Settings roster /
  working-this-day / services lists. See `makeSortable` in `app.js`.
- **Zebra columns**: even-numbered turn columns get class `alt` (light gray
  `#edeff2`, header `#e6e8ec`); service cells keep green/red because the color is
  on the `.pick` button, which covers the `<td>`.
- Two locations (buttons loc 1 / loc 2), PIN-gated per location, "nhập 1 lần nhớ ~400 ngày".

## Offline QA (no deploy needed)

Headless Chromium is preinstalled. Serve `src/` and stub `window.fetch`:
- exe: `/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell`
- `python3 -m http.server 8129` in a copy of `src/`, then a `playwright-core`
  script (`NODE_PATH=$(npm root -g)`) that stubs `/api/account`,
  `/api/pin/status`, `/api/board`. Assert `pageerror` list is empty.

## Notes

- Do not commit `node_modules`. Keep changes minimal and match surrounding style.
- After any board/data change, re-run the offline QA and the 3 tests before pushing.
