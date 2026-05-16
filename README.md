# TimeTracker

Freelance time tracker with Dropbox sync. Tracks hours per project and client, generates invoices, and exports reports.

## Live App

**https://ebmtimetracker.netlify.app** — works on phone and desktop.

---

## Quick Start

### Option A — Netlify (recommended, works from anywhere)

Open **https://ebmtimetracker.netlify.app** in any browser. No install needed.

### Option B — Local server (same Wi-Fi only)

```bash
npm install
npm start
# App runs at http://localhost:3000
# Mobile on same Wi-Fi: http://<your-IP>:3000
```

---

## Dropbox Setup (one-time)

1. Go to https://www.dropbox.com/developers/apps
2. **Create app** → Scoped access → App folder → Name it `TimeTracker`
3. Under **OAuth 2 → Redirect URIs**, add:
   - `https://ebmtimetracker.netlify.app` (for Netlify)
   - `http://localhost:3000` (for local server, optional)
4. Copy the **App Key** (short ~15-char code — not the secret)
5. In the app → **Settings** → paste the App Key → **Connect Dropbox**
6. Authorize once — data syncs to `/Apps/TimeTracker/timetracker_data.json`

---

## Multi-Device Sync

Data syncs automatically between phone and desktop:

- **On tab focus** — pulls latest data from Dropbox when you switch back to the tab
- **Every 60 seconds** — background auto-pull
- **Settings → ⟳ Sync Now** — manual pull button

> The timer is never interrupted by a sync pull.

---

## Deploy to Netlify

When you make code changes locally, redeploy by dragging the `timetracker/` folder (just `index.html`, `app.js`, `style.css`) to **app.netlify.com → your site → Deploys**.

Do **not** include `node_modules/`, `server.js`, `package.json` — those are for local use only.

---

## Features

- **Timer** — start/stop with project selection; persists across reloads
- **Entries** — manual add, edit, delete time entries
- **Expenses** — track per-project expenses with receipt photos
- **Reports** — bar chart by project color, donut chart, client-grouped table; export PDF/CSV
- **Invoices** — create invoices from uninvoiced entries; track sent/paid status
- **Favorites** — quick-restart chips with ✕ remove button
- **Dropbox Sync** — OAuth PKCE; offline queue with auto-flush on reconnect; auto-sync every 60s
- **FX Rates** — Frankfurter ECB API (no key needed); historical rates stored per entry
- **Toggl Import** — Settings → Import from Toggl CSV
- **Exit button** — sidebar (desktop) and top-right corner (mobile)

---

## Data Model

All data stored in `timetracker_data.json` in your Dropbox App folder, and cached in `localStorage` as fallback.

- **Clients** hold the hourly rate and currency (not projects)
- **Projects** belong to one client
- **Entries** and **Expenses** belong to a project
- **Invoices** group entries/expenses per client

---

## Accent Color

Orange/amber `#f97316`.
