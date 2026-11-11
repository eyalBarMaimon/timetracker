# TimeTracker

Freelance time tracker with Dropbox sync. Tracks hours per project and client, generates invoices, and exports reports.

## Live App

**https://eyalbarmaimon.github.io/timetracker/** — works on phone and desktop.

---

## Quick Start

Open **https://eyalbarmaimon.github.io/timetracker/** in any browser — phone or desktop. No install needed.
On a phone, use the browser menu → *Add to Home Screen* to open it like an app.

### Running tests

```bash
node --test tests/
```

---

## Dropbox Setup (one-time)

1. Go to https://www.dropbox.com/developers/apps
2. **Create app** → Scoped access → App folder → Name it `TimeTracker`
3. Under **OAuth 2 → Redirect URIs**, add:
   - `https://eyalbarmaimon.github.io/timetracker/` (with trailing slash)
4. Copy the **App Key** (short ~15-char code — not the secret)
5. In the app → **Settings** → paste the App Key → **Connect Dropbox**
6. Authorize once — data syncs to `/ClaudeCode/timetracker_data.json` in your Dropbox

---

## Multi-Device Sync

Use the app on a phone and several computers at the same time — every device syncs through the same Dropbox file.

- **Merge, not overwrite** — each sync downloads the Dropbox file and merges it item by item (clients, projects, entries, expenses, invoices, favorites) with this device's changes. Edits made on different devices at the same time are all kept.
- **Conflict-safe upload** — uploads are tied to the file revision; if another device wrote in between, the app re-downloads and merges again.
- **Offline** — changes stay on the device and are merged in on the next successful sync.
- **When it syncs** — on every save, on tab focus, every 60 seconds, and via *Settings → ⟳ Sync Now*.
- If two devices edit the *same* item at the same moment, the device that syncs last wins for that item.

> The timer is never interrupted by a sync pull.

---

## Deploy (GitHub Pages)

Push changes to `main` branch — GitHub Pages deploys automatically within ~1 minute.

```bash
git add app.js index.html style.css
git commit -m "v1.x.x: description"
git push origin main
```

Remember to bump `APP_VERSION` in `app.js` (line 14) with every push.

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

All data stored in `/ClaudeCode/timetracker_data.json` in your Dropbox, and cached in `localStorage` as fallback.

- **Clients** hold the hourly rate and currency (not projects)
- **Projects** belong to one client
- **Entries** and **Expenses** belong to a project
- **Invoices** group entries/expenses per client

---

## Accent Color

Orange/amber `#f97316`.
