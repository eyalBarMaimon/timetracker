/* ===== TimeTracker SPA ===== */
'use strict';

// ── Default data structure ──────────────────────────────────────────────────
const DEFAULT_DATA = {
  clients: [], projects: [], entries: [], expenses: [], invoices: [],
  runningEntry: null, favorites: [],
  settings: {
    baseCurrency: 'ILS', displayCurrency: 'ILS', fxMarkup: 4,
    weekStartDay: 'sunday', dropboxConnected: false, dropboxAppKey: ''
  }
};

const APP_VERSION = '1.0.7';
const CURRENCIES = ['ILS','USD','EUR','GBP','JPY','CHF','CAD','AUD','SEK','NOK','DKK','PLN','CZK','HUF','RON'];
const CURRENCY_SYMBOLS = { ILS:'₪', USD:'$', EUR:'€', GBP:'£', JPY:'¥', CHF:'Fr', CAD:'CA$', AUD:'A$', SEK:'kr', NOK:'kr', DKK:'kr', PLN:'zł', CZK:'Kč', HUF:'Ft', RON:'lei' };
const CATEGORY_ICONS = { travel:'✈', software:'💻', hardware:'🖥', hosting:'☁', food:'🍔', accommodation:'🏨', phone:'📱', other:'📦' };

// ── State ───────────────────────────────────────────────────────────────────
let data = JSON.parse(JSON.stringify(DEFAULT_DATA));
let timerInterval = null;
let currentTab = 'timer';
let reportRange = { preset: 'month', start: null, end: null };
let reportFilters = { client: '', project: '' };
let dailyChart = null;
let donutChart = null;
let dropboxClient = null;
let syncPending = false;
let pendingEntryEdit = null;   // id being edited (null = new)
let pendingExpenseEdit = null;
let pendingClientEdit = null;
let pendingProjectEdit = null;
let pendingInvoiceId = null;
let invoiceFilter = 'all';

// ── Utilities ────────────────────────────────────────────────────────────────
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function fmt2(n) { return String(Math.floor(n)).padStart(2, '0'); }
function fmtDuration(seconds) {
  if (!seconds || seconds < 0) return '0:00:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${h}:${fmt2(m)}:${fmt2(s)}`;
}
function durationSec(start, end) {
  return Math.max(0, (new Date(end) - new Date(start)) / 1000);
}
function isoNow() { const n = new Date(); return new Date(n - n.getTimezoneOffset() * 60000).toISOString().slice(0, 19); }
function isoDate(dt) { return dt ? dt.slice(0, 10) : ''; }
function toDatetimeLocal(iso) { return iso ? iso.slice(0, 16) : ''; }
function fromDatetimeLocal(val) { return val ? val + ':00' : ''; }

function fmtDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

function parseDMY(str) {
  // accepts DD/MM/YYYY → YYYY-MM-DD, or pass-through YYYY-MM-DD
  if (!str) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  const parts = str.split('/');
  if (parts.length === 3) {
    const [dd, mm, yyyy] = parts;
    if (dd && mm && yyyy && yyyy.length === 4) return `${yyyy}-${mm.padStart(2,'0')}-${dd.padStart(2,'0')}`;
  }
  return '';
}
function currSym(c) { return CURRENCY_SYMBOLS[c] || c; }

function fmtMoney(amount, currency) {
  if (!amount && amount !== 0) return '—';
  return `${currSym(currency)} ${Math.round(amount).toLocaleString('en-US')}`;
}

function getProject(id) { return data.projects.find(p => p.id === id); }
function getClient(id) { return data.clients.find(c => c.id === id); }
function getProjectColor(projectId) { const p = getProject(projectId); return (p && p.color) ? p.color : '#888'; }

// Rate and currency are stored on the client, not the project
function getClientRate(projectId) {
  const proj   = getProject(projectId);
  const client = proj ? getClient(proj.clientId) : null;
  return {
    rate:     (client && client.hourlyRate) || 0,
    currency: (client && client.currency)  || data.settings.baseCurrency
  };
}

function totalEntrySec(entries) { return entries.reduce((s,e) => s + durationSec(e.start, e.end), 0); }

// ── FX Rates ─────────────────────────────────────────────────────────────────
async function fetchFxRates(base, date) {
  const d = date || new Date().toISOString().slice(0, 10);
  const cacheKey = `fx_rate_${base}_${d}`;
  const cached = JSON.parse(localStorage.getItem(cacheKey) || 'null');
  if (cached && (Date.now() - cached.fetchedAt < 60 * 60 * 1000)) return cached.rates;

  try {
    const url = `https://api.frankfurter.dev/v1/${d === new Date().toISOString().slice(0,10) ? 'latest' : d}?base=${base}`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error('FX fetch failed');
    const json = await resp.json();
    const rates = json.rates || {};
    localStorage.setItem(cacheKey, JSON.stringify({ rates, fetchedAt: Date.now() }));
    localStorage.setItem('fx_last_fetch', new Date().toLocaleString());
    const el = document.getElementById('last-rate-fetch');
    if (el) el.textContent = localStorage.getItem('fx_last_fetch') || '—';
    return rates;
  } catch { return null; }
}

async function buildFxSnapshot(base, date) {
  const rates = await fetchFxRates(base, date);
  const markup = data.settings.fxMarkup || 4;
  const displayCurrency = data.settings.displayCurrency || 'USD';
  const midpoint = rates ? (rates[displayCurrency] || 1) : 1;
  const effectiveRate = midpoint * (1 + markup / 100);
  return {
    date, base,
    midpointRate: midpoint, markupPct: markup, effectiveRate,
    rates: rates || {}
  };
}

function convertAmount(amount, fxSnap, displayCurrency) {
  if (!fxSnap || !fxSnap.rates) return null;
  const base = fxSnap.base;
  if (base === displayCurrency) return amount;
  const rate = fxSnap.effectiveRate || (fxSnap.rates[displayCurrency] || 1);
  return amount * rate;
}

// ── Persistence ───────────────────────────────────────────────────────────────
function saveLocal() {
  localStorage.setItem('timetracker_data', JSON.stringify(data));
}

function loadLocal() {
  const raw = localStorage.getItem('timetracker_data');
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      data = Object.assign(JSON.parse(JSON.stringify(DEFAULT_DATA)), parsed);
      // ensure required fields
      if (!data.settings) data.settings = DEFAULT_DATA.settings;
      if (!data.expenses) data.expenses = [];
      if (!data.invoices) data.invoices = [];
      if (!data.favorites) data.favorites = [];
    } catch { data = JSON.parse(JSON.stringify(DEFAULT_DATA)); }
  }
}

async function save() {
  saveLocal();
  await dropboxSync('write');
}

// ── Dropbox Sync ─────────────────────────────────────────────────────────────
function setSyncStatus(state, msg) {
  const el = document.getElementById('sync-status');
  if (!el) return;
  el.className = 'sync-status';
  if (state === 'ok') { el.className += ' sync-ok'; el.textContent = '✓ Synced'; }
  else if (state === 'loading') { el.className += ' sync-loading'; el.textContent = '⟳ Syncing…'; }
  else { el.className += ' sync-error'; el.textContent = '✗ ' + (msg || 'Offline'); }
}

function makeDropboxClient(key, accessToken, refreshToken, expiresAt) {
  const authOpts = { clientId: key, accessToken };
  if (refreshToken) authOpts.refreshToken = refreshToken;
  if (expiresAt)    authOpts.accessTokenExpiresAt = new Date(expiresAt);
  const auth = new Dropbox.DropboxAuth(authOpts);
  return new Dropbox.Dropbox({ auth });
}

function initDropbox() {
  const key = data.settings.dropboxAppKey;
  if (!key) return;
  const token = localStorage.getItem('dropbox_token');
  if (token) {
    try {
      const refresh   = localStorage.getItem('dropbox_refresh_token') || undefined;
      const expiresAt = localStorage.getItem('dropbox_token_expires_at') || undefined;
      dropboxClient = makeDropboxClient(key, token, refresh, expiresAt);
      updateDropboxUI(true);
    } catch { dropboxClient = null; }
  }
}

function dropboxOAuth() {
  // Read directly from the input so a click right after typing works (no race with 'change' event)
  const keyInput = document.getElementById('dropbox-app-key');
  const key = (keyInput ? keyInput.value.trim() : '') || data.settings.dropboxAppKey || '';
  if (!key) { alert('Please enter your Dropbox App Key first.'); return; }
  // Dropbox App Keys are ~15 alphanumeric chars. Anything much longer is the wrong value.
  if (key.length > 50) {
    alert('That doesn\'t look like a Dropbox App Key — it\'s too long.\n\nThe App Key is a short code (~15 characters) found at:\ndropbox.com/developers/apps → your app → "App key"\n\nDo NOT paste the App Secret or any other credentials.');
    return;
  }
  // Save the validated key
  data.settings.dropboxAppKey = key;
  saveLocal();

  const redirectUri = location.origin + location.pathname;
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = verifier; // plain PKCE (no SHA-256 needed for App folder apps)
  localStorage.setItem('dropbox_verifier', verifier);
  const params = new URLSearchParams({
    client_id: key, response_type: 'code',
    redirect_uri: redirectUri, token_access_type: 'offline',
    code_challenge: challenge, code_challenge_method: 'plain'
  });
  window.location.href = `https://www.dropbox.com/oauth2/authorize?${params}`;
}

function base64url(arr) {
  return btoa(String.fromCharCode(...arr)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
}

async function handleDropboxCallback() {
  const params = new URLSearchParams(location.search);
  const code = params.get('code');
  if (!code) return;
  history.replaceState({}, '', location.pathname);

  const key = data.settings.dropboxAppKey;
  const verifier = localStorage.getItem('dropbox_verifier');
  const redirectUri = location.origin + location.pathname;

  try {
    const resp = await fetch('https://api.dropboxapi.com/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code, grant_type: 'authorization_code', client_id: key,
        redirect_uri: redirectUri, code_verifier: verifier
      })
    });
    const json = await resp.json();
    if (json.access_token) {
      const expiresAt = new Date(Date.now() + (json.expires_in || 14400) * 1000).toISOString();
      localStorage.setItem('dropbox_token', json.access_token);
      if (json.refresh_token) localStorage.setItem('dropbox_refresh_token', json.refresh_token);
      localStorage.setItem('dropbox_token_expires_at', expiresAt);
      dropboxClient = makeDropboxClient(key, json.access_token, json.refresh_token, expiresAt);
      data.settings.dropboxConnected = true;
      saveLocal();
      updateDropboxUI(true);
      await dropboxSync('read');
    } else {
      setSyncStatus('error', 'Auth failed');
    }
  } catch { setSyncStatus('error', 'Auth failed'); }
}

async function dropboxSync(mode) {
  if (!dropboxClient) return;
  setSyncStatus('loading');
  try {
    if (mode === 'read') {
      const resp = await dropboxClient.filesDownload({ path: '/ClaudeCode/timetracker_data.json' });
      const text = await resp.result.fileBlob.text();
      const remote = JSON.parse(text);
      data = Object.assign(JSON.parse(JSON.stringify(DEFAULT_DATA)), remote);
      saveLocal();
      renderAll();
      renderSettings();
    } else {
      const content = JSON.stringify(data, null, 2);
      await dropboxClient.filesUpload({
        path: '/ClaudeCode/timetracker_data.json',
        contents: content,
        mode: { '.tag': 'overwrite' }
      });
    }
    setSyncStatus('ok');
  } catch (e) {
    if (e && e.status === 409) {
      // File not found — create it
      try {
        const content = JSON.stringify(data, null, 2);
        await dropboxClient.filesUpload({ path: '/ClaudeCode/timetracker_data.json', contents: content, mode: { '.tag': 'add' } });
        setSyncStatus('ok');
      } catch { setSyncStatus('error'); }
    } else if (e && (e.status === 401 || e.status === 400)) {
      // Token expired and could not be refreshed — force reconnect
      localStorage.removeItem('dropbox_token');
      localStorage.removeItem('dropbox_refresh_token');
      localStorage.removeItem('dropbox_token_expires_at');
      dropboxClient = null;
      data.settings.dropboxConnected = false;
      saveLocal();
      updateDropboxUI(false);
      setSyncStatus('error', 'Session expired — reconnect Dropbox in Settings');
    } else {
      setSyncStatus('error');
      syncPending = true;
    }
  }
}

function updateDropboxUI(connected) {
  const connectBtn = document.getElementById('dropbox-connect-btn');
  const disconnectBtn = document.getElementById('dropbox-disconnect-btn');
  const syncNowBtn = document.getElementById('dropbox-sync-now-btn');
  const statusEl = document.getElementById('dropbox-status');
  if (connected) {
    connectBtn.classList.add('hidden');
    disconnectBtn.classList.remove('hidden');
    if (syncNowBtn) syncNowBtn.classList.remove('hidden');
    if (statusEl) statusEl.textContent = '✓ Connected';
  } else {
    connectBtn.classList.remove('hidden');
    disconnectBtn.classList.add('hidden');
    if (syncNowBtn) syncNowBtn.classList.add('hidden');
    if (statusEl) statusEl.textContent = '';
  }
}

// ── Navigation ───────────────────────────────────────────────────────────────
function updateFabVisibility() {
  document.getElementById('fab-expense').classList.toggle('hidden', currentTab !== 'entries');
}

function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.tab-panel').forEach(el => el.classList.remove('active'));
  document.getElementById('tab-' + tab)?.classList.add('active');
  document.querySelectorAll('.nav-btn[data-tab]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  updateFabVisibility();

  if (tab === 'reports') renderReports();
  if (tab === 'invoices') renderInvoices();
  if (tab === 'entries') renderEntries();
  if (tab === 'timer') renderTimerEntries();
  if (tab === 'settings') renderSettings();
}

// ── Timer ─────────────────────────────────────────────────────────────────────
let timerProjectId = null;
let timerBillable = true;

function startTimer() {
  const note = document.getElementById('timer-note').value.trim();
  const entry = {
    id: uid(), projectId: timerProjectId, start: isoNow(), end: null,
    note, billable: timerBillable, tags: [], invoiceId: null, paymentStatus: 'uninvoiced'
  };
  data.runningEntry = entry;
  localStorage.setItem('running_start', entry.start);
  saveLocal();
  showRunningBar();
  startTick();
}

function stopTimer() {
  if (!data.runningEntry) return;
  const entry = Object.assign({}, data.runningEntry, { end: isoNow() });
  buildFxSnapshot(data.settings.baseCurrency, isoDate(entry.start)).then(snap => {
    entry.fxSnapshot = snap;
    data.entries.unshift(entry);
    data.runningEntry = null;
    localStorage.removeItem('running_start');
    clearInterval(timerInterval);
    timerInterval = null;
    document.getElementById('running-bar').classList.add('hidden');
    document.getElementById('start-bar').classList.remove('hidden');
    document.getElementById('timer-note').value = '';
    setTimerProject(null);
    renderTimerEntries();
    save();
  });
}

function startTick() {
  clearInterval(timerInterval);
  timerInterval = setInterval(updateRunningDisplay, 1000);
  updateRunningDisplay();
}

function updateRunningDisplay() {
  const entry = data.runningEntry;
  if (!entry) return;
  const sec = (Date.now() - new Date(entry.start)) / 1000;
  document.getElementById('running-display').textContent = fmtDuration(sec);
}

function showRunningBar() {
  const bar = document.getElementById('running-bar');
  const startBarEl = document.getElementById('start-bar');
  bar.classList.remove('hidden');
  startBarEl.classList.add('hidden');
  const entry = data.runningEntry;
  const noteEl = document.getElementById('running-note-display');
  const projEl = document.getElementById('running-project-display');
  noteEl.textContent = (entry && entry.note) ? entry.note : 'No description';
  const proj = entry ? getProject(entry.projectId) : null;
  projEl.textContent = proj ? proj.name : '—';
}

function setTimerProject(projectId) {
  timerProjectId = projectId;
  const btn = document.getElementById('timer-project-btn');
  if (projectId) {
    const p = getProject(projectId);
    const color = getProjectColor(projectId);
    btn.innerHTML = `<span style="color:${color}">●</span> ${p ? p.name : 'Project'} ✕`;
    btn.classList.add('active');
  } else {
    btn.innerHTML = '📁 Select project';
    btn.classList.remove('active');
  }
}

function replayEntry(entry) {
  document.getElementById('timer-note').value = entry.note || '';
  timerBillable = entry.billable !== false;
  setTimerProject(entry.projectId);
  updateBillableBtn();
  switchTab('timer');
}

function updateBillableBtn() {
  const btn = document.getElementById('timer-billable-btn');
  if (timerBillable) {
    btn.classList.add('billable-on');
    btn.classList.remove('billable-off');
  } else {
    btn.classList.remove('billable-on');
    btn.classList.add('billable-off');
  }
}

// ── Render Timer Tab ──────────────────────────────────────────────────────────
function renderTimerEntries() {
  renderFavorites();
  const container = document.getElementById('timer-entries-list');
  const allItems = [...data.entries, ...data.expenses].sort((a, b) => {
    const da = a.start || a.date;
    const db = b.start || b.date;
    return db < da ? -1 : db > da ? 1 : 0;
  });
  container.innerHTML = renderGroupedItems(allItems, true);
  bindEntryRowEvents(container);
}

function renderGroupedItems(items, showReplay) {
  if (!items.length) return '<div class="empty-state"><div class="empty-icon">⏱</div>No entries yet. Start the timer!</div>';
  const groups = {};
  items.forEach(item => {
    const d = item.start ? isoDate(item.start) : item.date;
    if (!groups[d]) groups[d] = [];
    groups[d].push(item);
  });
  const dates = Object.keys(groups).sort((a,b) => b.localeCompare(a));
  return dates.map(date => {
    const dayItems = groups[date];
    const timeEntries = dayItems.filter(i => i.start && i.end);
    const totalSec = totalEntrySec(timeEntries);
    return `<div class="date-group">
      <div class="date-group-header">
        <span>${fmtDate(date)}</span>
        <span>${fmtDuration(totalSec)}</span>
      </div>
      ${dayItems.map(item => renderItemRow(item, showReplay)).join('')}
    </div>`;
  }).join('');
}

function renderItemRow(item, showReplay) {
  const isExpense = !item.start;
  if (isExpense) return renderExpenseRow(item);
  const color = getProjectColor(item.projectId);
  const proj = getProject(item.projectId);
  const sec = durationSec(item.start, item.end);
  const payDot = `<span class="pay-dot pay-${item.paymentStatus || 'uninvoiced'}"></span>`;
  const billableIcon = item.billable ? '<span class="billable-icon">$</span>' : '';
  return `<div class="entry-row" data-id="${item.id}" data-type="entry">
    <span class="project-dot" style="background:${color}"></span>
    <div class="entry-middle">
      <div class="entry-note${!item.note ? ' empty' : ''}">${item.note || '+ Add description'}</div>
      <div class="entry-project">${proj ? proj.name : '—'} ${payDot}</div>
    </div>
    <div class="entry-right">
      ${billableIcon}
      <span class="entry-duration">${fmtDuration(sec)}</span>
    </div>
    ${showReplay ? `<button class="replay-btn" data-replay="${item.id}" title="Restart">▶</button>` : ''}
  </div>`;
}

function renderExpenseRow(exp) {
  const color = getProjectColor(exp.projectId);
  const proj = getProject(exp.projectId);
  const icon = CATEGORY_ICONS[exp.category] || '📦';
  const payDot = `<span class="pay-dot pay-${exp.paymentStatus || 'uninvoiced'}"></span>`;
  return `<div class="entry-row expense-row" data-id="${exp.id}" data-type="expense">
    <span class="project-dot" style="background:${color}"></span>
    <div class="entry-middle">
      <div class="entry-note">${icon} ${exp.description || 'Expense'}</div>
      <div class="entry-project">${proj ? proj.name : '—'} ${payDot}</div>
    </div>
    <div class="entry-right">
      <span class="entry-duration">${fmtMoney(exp.amount, exp.currency)}</span>
      ${exp.billable ? '<span class="billable-icon">$</span>' : ''}
    </div>
  </div>`;
}

function bindEntryRowEvents(container) {
  container.querySelectorAll('.entry-row[data-type="entry"]').forEach(row => {
    row.addEventListener('click', e => {
      if (e.target.closest('.replay-btn')) return;
      openEntryModal(row.dataset.id);
    });
  });
  container.querySelectorAll('.entry-row[data-type="expense"]').forEach(row => {
    row.addEventListener('click', () => openExpenseModal(row.dataset.id));
  });
  container.querySelectorAll('.replay-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const entry = data.entries.find(x => x.id === btn.dataset.replay);
      if (entry) replayEntry(entry);
    });
  });
}

// ── Entries Tab ───────────────────────────────────────────────────────────────
function renderEntries() {
  const search = document.getElementById('entries-search').value.toLowerCase();
  const clientFilter = document.getElementById('entries-filter-client').value;
  const projFilter = document.getElementById('entries-filter-project').value;

  let entries = data.entries.filter(e => {
    if (clientFilter) {
      const p = getProject(e.projectId);
      if (!p || p.clientId !== clientFilter) return false;
    }
    if (projFilter && e.projectId !== projFilter) return false;
    if (search) {
      const note = (e.note || '').toLowerCase();
      const pName = (getProject(e.projectId)?.name || '').toLowerCase();
      if (!note.includes(search) && !pName.includes(search)) return false;
    }
    return true;
  });
  let expenses = data.expenses.filter(exp => {
    if (clientFilter) {
      const p = getProject(exp.projectId);
      if (!p || p.clientId !== clientFilter) return false;
    }
    if (projFilter && exp.projectId !== projFilter) return false;
    if (search) {
      const desc = (exp.description || '').toLowerCase();
      if (!desc.includes(search)) return false;
    }
    return true;
  });

  const allItems = [...entries, ...expenses].sort((a,b) => {
    const da = a.start || (a.date + 'T00:00:00');
    const db = b.start || (b.date + 'T00:00:00');
    return db < da ? -1 : db > da ? 1 : 0;
  });

  populateFilterDropdowns();

  const container = document.getElementById('entries-list');
  container.innerHTML = renderGroupedItems(allItems, false);
  bindEntryRowEvents(container);
}

function populateFilterDropdowns() {
  ['entries-filter-client', 'report-client-filter', 'invoice-client'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const cur = el.value;
    const isInvoice = id === 'invoice-client';
    el.innerHTML = isInvoice
      ? data.clients.map(c => `<option value="${c.id}">${c.name}</option>`).join('')
      : `<option value="">All Clients</option>` + data.clients.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
    el.value = cur;
  });
  ['entries-filter-project', 'report-project-filter'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const cur = el.value;
    el.innerHTML = `<option value="">All Projects</option>` + data.projects.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
    el.value = cur;
  });
}

// ── Entry Modal ───────────────────────────────────────────────────────────────
function openEntryModal(id) {
  pendingEntryEdit = id || null;
  const entry = id ? data.entries.find(e => e.id === id) : null;

  document.getElementById('entry-modal-title').textContent = entry ? 'Edit Entry' : 'Add Entry';
  document.getElementById('entry-note').value = entry ? (entry.note || '') : '';
  document.getElementById('entry-billable').checked = entry ? (entry.billable !== false) : true;
  document.getElementById('entry-tags').value = entry && entry.tags ? entry.tags.join(', ') : '';
  document.getElementById('entry-delete-btn').classList.toggle('hidden', !entry);

  // Populate project select
  const projSel = document.getElementById('entry-project');
  projSel.innerHTML = `<option value="">— No project —</option>` +
    data.projects.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
  projSel.value = entry ? (entry.projectId || '') : (timerProjectId || '');

  if (entry) {
    document.getElementById('entry-start').value = toDatetimeLocal(entry.start);
    document.getElementById('entry-end').value = toDatetimeLocal(entry.end);
    document.getElementById('entry-date').value = isoDate(entry.start);
    const sec = durationSec(entry.start, entry.end);
    document.getElementById('entry-duration-display').textContent = fmtDuration(sec);

    if (entry.fxSnapshot) {
      const snap = entry.fxSnapshot;
      const disp = data.settings.displayCurrency;
      document.getElementById('entry-fx-info').classList.remove('hidden');
      document.getElementById('entry-fx-info').textContent =
        `FX: ${snap.base}→${disp} @ ${snap.midpointRate?.toFixed(4)} midpoint + ${snap.markupPct}% = ${snap.effectiveRate?.toFixed(4)} (${snap.date})`;
    } else {
      document.getElementById('entry-fx-info').classList.add('hidden');
    }
  } else {
    const now = toDatetimeLocal(isoNow());
    document.getElementById('entry-start').value = now;
    document.getElementById('entry-end').value = now;
    document.getElementById('entry-date').value = new Date().toISOString().slice(0,10);
    document.getElementById('entry-duration-display').textContent = '0:00:00';
    document.getElementById('entry-fx-info').classList.add('hidden');
  }

  showModal('modal-entry');
}

function updateEntryDuration() {
  const s = document.getElementById('entry-start').value;
  const e = document.getElementById('entry-end').value;
  if (s && e) {
    const sec = durationSec(fromDatetimeLocal(s), fromDatetimeLocal(e));
    document.getElementById('entry-duration-display').textContent = fmtDuration(sec);
  }
}

async function saveEntry() {
  const start = fromDatetimeLocal(document.getElementById('entry-start').value);
  const end = fromDatetimeLocal(document.getElementById('entry-end').value);
  const note = document.getElementById('entry-note').value.trim();
  const projectId = document.getElementById('entry-project').value || null;
  const billable = document.getElementById('entry-billable').checked;
  const tags = document.getElementById('entry-tags').value.split(',').map(t => t.trim()).filter(Boolean);
  const dateStr = isoDate(start);

  let fxSnap = null;
  try { fxSnap = await buildFxSnapshot(data.settings.baseCurrency, dateStr); } catch {}

  if (pendingEntryEdit) {
    const idx = data.entries.findIndex(e => e.id === pendingEntryEdit);
    if (idx !== -1) {
      data.entries[idx] = Object.assign(data.entries[idx], { start, end, note, projectId, billable, tags, fxSnapshot: fxSnap });
    }
  } else {
    data.entries.unshift({
      id: uid(), projectId, start, end, note, billable, tags,
      invoiceId: null, paymentStatus: 'uninvoiced', fxSnapshot: fxSnap
    });
  }
  closeModal('modal-entry');
  renderAll();
  save();
}

function deleteEntry(id) {
  if (!confirm('Delete this entry?')) return;
  data.entries = data.entries.filter(e => e.id !== id);
  closeModal('modal-entry');
  renderAll();
  save();
}

// ── Expense Modal ─────────────────────────────────────────────────────────────
function openExpenseModal(id) {
  pendingExpenseEdit = id || null;
  const exp = id ? data.expenses.find(e => e.id === id) : null;

  document.getElementById('expense-modal-title').textContent = exp ? 'Edit Expense' : 'Add Expense';
  document.getElementById('expense-date').value = exp ? exp.date : new Date().toISOString().slice(0,10);
  document.getElementById('expense-desc').value = exp ? (exp.description || '') : '';
  document.getElementById('expense-amount').value = exp ? exp.amount : '';
  document.getElementById('expense-billable').checked = exp ? (exp.billable !== false) : true;
  document.getElementById('expense-delete-btn').classList.toggle('hidden', !exp);

  const projSel = document.getElementById('expense-project');
  projSel.innerHTML = `<option value="">— No project —</option>` +
    data.projects.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
  projSel.value = exp ? (exp.projectId || '') : (timerProjectId || '');

  const catSel = document.getElementById('expense-category');
  catSel.value = exp ? (exp.category || 'other') : 'other';

  const currSel = document.getElementById('expense-currency');
  currSel.innerHTML = CURRENCIES.map(c => `<option value="${c}">${c}</option>`).join('');
  currSel.value = exp ? (exp.currency || data.settings.baseCurrency) : data.settings.baseCurrency;

  const preview = document.getElementById('expense-receipt-preview');
  if (exp && exp.receipt) {
    preview.classList.remove('hidden');
    preview.innerHTML = `<img src="${exp.receipt}" alt="Receipt">`;
  } else {
    preview.classList.add('hidden');
    preview.innerHTML = '';
  }

  showModal('modal-expense');
}

async function saveExpense() {
  const date = document.getElementById('expense-date').value;
  const projectId = document.getElementById('expense-project').value || null;
  const category = document.getElementById('expense-category').value;
  const description = document.getElementById('expense-desc').value.trim();
  const amount = parseFloat(document.getElementById('expense-amount').value) || 0;
  const currency = document.getElementById('expense-currency').value;
  const billable = document.getElementById('expense-billable').checked;

  let receipt = pendingExpenseEdit ? (data.expenses.find(e => e.id === pendingExpenseEdit)?.receipt || '') : '';
  const fileInput = document.getElementById('expense-receipt');
  if (fileInput.files && fileInput.files[0]) {
    receipt = await fileToBase64(fileInput.files[0]);
  }

  let fxSnap = null;
  try { fxSnap = await buildFxSnapshot(currency, date); } catch {}

  if (pendingExpenseEdit) {
    const idx = data.expenses.findIndex(e => e.id === pendingExpenseEdit);
    if (idx !== -1) {
      data.expenses[idx] = Object.assign(data.expenses[idx], { date, projectId, category, description, amount, currency, billable, receipt, fxSnapshot: fxSnap });
    }
  } else {
    data.expenses.push({
      id: uid(), projectId, date, category, description, amount, currency, billable, receipt,
      invoiceId: null, paymentStatus: 'uninvoiced', fxSnapshot: fxSnap
    });
  }
  closeModal('modal-expense');
  renderAll();
  save();
}

function deleteExpense(id) {
  if (!confirm('Delete this expense?')) return;
  data.expenses = data.expenses.filter(e => e.id !== id);
  closeModal('modal-expense');
  renderAll();
  save();
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ── Client Modal ──────────────────────────────────────────────────────────────
function openClientModal(id) {
  pendingClientEdit = id || null;
  const client = id ? getClient(id) : null;
  document.getElementById('client-name').value  = client ? client.name  : '';
  document.getElementById('client-rate').value  = client ? (client.hourlyRate || 0) : 0;
  document.getElementById('client-color').value = client ? client.color : '#4f8ef7';

  const currSel = document.getElementById('client-currency');
  currSel.innerHTML = CURRENCIES.map(c => `<option value="${c}">${c}</option>`).join('');
  currSel.value = client ? (client.currency || data.settings.baseCurrency) : data.settings.baseCurrency;

  document.getElementById('client-delete-btn').classList.toggle('hidden', !client);
  showModal('modal-client');
}

function saveClient() {
  const name       = document.getElementById('client-name').value.trim();
  const hourlyRate = parseFloat(document.getElementById('client-rate').value) || 0;
  const currency   = document.getElementById('client-currency').value;
  const color      = document.getElementById('client-color').value;
  if (!name) { alert('Client name is required.'); return; }
  if (pendingClientEdit) {
    const idx = data.clients.findIndex(c => c.id === pendingClientEdit);
    if (idx !== -1) data.clients[idx] = Object.assign(data.clients[idx], { name, hourlyRate, currency, color });
  } else {
    data.clients.push({ id: uid(), name, hourlyRate, currency, color });
  }
  closeModal('modal-client');
  renderSettings();
  save();
}

function deleteClient(id) {
  if (!confirm('Delete this client? All projects will be unlinked.')) return;
  data.clients = data.clients.filter(c => c.id !== id);
  data.projects.forEach(p => { if (p.clientId === id) p.clientId = null; });
  closeModal('modal-client');
  renderSettings();
  save();
}

// ── Project Modal ─────────────────────────────────────────────────────────────
function openProjectModal(id) {
  pendingProjectEdit = id || null;
  const proj = id ? getProject(id) : null;
  document.getElementById('project-name').value = proj ? proj.name : '';
  document.getElementById('project-color').value = proj ? (proj.color || '#4f8ef7') : '#4f8ef7';

  const clientSel = document.getElementById('project-client');
  clientSel.innerHTML = `<option value="">— No client —</option>` +
    data.clients.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  clientSel.value = proj ? (proj.clientId || '') : '';

  document.getElementById('project-delete-btn').classList.toggle('hidden', !proj);
  showModal('modal-project');
}

function saveProject() {
  const name     = document.getElementById('project-name').value.trim();
  const clientId = document.getElementById('project-client').value || null;
  const color    = document.getElementById('project-color').value;
  if (!name) { alert('Project name is required.'); return; }
  if (pendingProjectEdit) {
    const idx = data.projects.findIndex(p => p.id === pendingProjectEdit);
    if (idx !== -1) data.projects[idx] = Object.assign(data.projects[idx], { name, clientId, color });
  } else {
    data.projects.push({ id: uid(), name, clientId, color });
  }
  closeModal('modal-project');
  renderSettings();
  save();
}

function deleteProject(id) {
  if (!confirm('Delete this project?')) return;
  data.projects = data.projects.filter(p => p.id !== id);
  closeModal('modal-project');
  renderSettings();
  save();
}

// ── Project Picker ────────────────────────────────────────────────────────────
function openProjectPicker(callback) {
  const list = document.getElementById('project-picker-list');
  const search = document.getElementById('project-search');
  search.value = '';

  function render(q) {
    const clients = data.clients;
    const filtered = data.projects.filter(p => !q || p.name.toLowerCase().includes(q));
    if (!filtered.length) { list.innerHTML = '<div class="empty-state">No projects found</div>'; return; }

    const byClient = {};
    filtered.forEach(p => {
      const cid = p.clientId || '__none__';
      if (!byClient[cid]) byClient[cid] = [];
      byClient[cid].push(p);
    });

    list.innerHTML = Object.entries(byClient).map(([cid, projs]) => {
      const client = cid === '__none__' ? null : getClient(cid);
      return `<div class="picker-section">${client ? client.name : 'No client'}</div>` +
        projs.map(p => `<div class="picker-item" data-proj="${p.id}">
          <span class="project-dot" style="background:${p.color || '#888'}"></span>
          ${p.name}
        </div>`).join('');
    }).join('');

    list.querySelectorAll('.picker-item').forEach(item => {
      item.addEventListener('click', () => {
        callback(item.dataset.proj);
        closeModal('modal-project-picker');
      });
    });
  }

  render('');
  search.addEventListener('input', e => render(e.target.value.toLowerCase()));
  showModal('modal-project-picker');
}

// ── Reports ───────────────────────────────────────────────────────────────────
function getReportRange() {
  const today = new Date();
  const todayStr = today.toISOString().slice(0,10);
  if (reportRange.preset === 'today') return { start: todayStr, end: todayStr };
  if (reportRange.preset === 'week') {
    const day = today.getDay();
    const startDay = data.settings.weekStartDay === 'monday' ? 1 : 0;
    const diff = (day - startDay + 7) % 7;
    const start = new Date(today); start.setDate(today.getDate() - diff);
    return { start: start.toISOString().slice(0,10), end: todayStr };
  }
  if (reportRange.preset === 'month') {
    return { start: todayStr.slice(0,7) + '-01', end: todayStr };
  }
  if (reportRange.preset === 'last-month') {
    const lm = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const le = new Date(today.getFullYear(), today.getMonth(), 0);
    return { start: lm.toISOString().slice(0,10), end: le.toISOString().slice(0,10) };
  }
  return { start: reportRange.start || todayStr.slice(0,7) + '-01', end: reportRange.end || todayStr };
}

function getFilteredEntries() {
  const { start, end } = getReportRange();
  const cf = reportFilters.client;
  const pf = reportFilters.project;
  return data.entries.filter(e => {
    const d = isoDate(e.start);
    if (d < start || d > end) return false;
    if (pf && e.projectId !== pf) return false;
    if (cf) { const p = getProject(e.projectId); if (!p || p.clientId !== cf) return false; }
    return true;
  });
}

function getFilteredExpenses() {
  const { start, end } = getReportRange();
  const cf = reportFilters.client;
  const pf = reportFilters.project;
  return data.expenses.filter(exp => {
    if (exp.date < start || exp.date > end) return false;
    if (pf && exp.projectId !== pf) return false;
    if (cf) { const p = getProject(exp.projectId); if (!p || p.clientId !== cf) return false; }
    return true;
  });
}

function renderReports() {
  populateFilterDropdowns();
  const entries = getFilteredEntries();
  const expenses = getFilteredExpenses();
  const { start, end } = getReportRange();

  // KPIs
  const totalSec = totalEntrySec(entries);
  const billableSec = totalEntrySec(entries.filter(e => e.billable));
  document.getElementById('kpi-total').textContent = fmtDuration(totalSec);
  document.getElementById('kpi-billable').textContent = fmtDuration(billableSec);

  // Total amount
  const disp = data.settings.displayCurrency;
  let totalAmount = 0;
  entries.forEach(e => {
    const { rate } = getClientRate(e.projectId);
    if (rate) {
      const hrs = durationSec(e.start, e.end) / 3600;
      const native = hrs * rate;
      totalAmount += convertAmount(native, e.fxSnapshot, disp) || native;
    }
  });
  document.getElementById('kpi-amount').textContent = `${currSym(disp)} ${totalAmount.toLocaleString('en-US', {maximumFractionDigits:0})}`;

  renderDailyChart(entries, start, end);
  renderProjectTable(entries, expenses, disp);
  renderDescTable(entries, disp);
}

function renderDailyChart(entries, start, end) {
  const startD = new Date(start + 'T00:00:00');
  const endD   = new Date(end   + 'T00:00:00');

  // Build ordered day list using local dates to avoid UTC-offset drift
  const dayKeys   = [];
  const dayLabels = [];
  for (let d = new Date(startD); d <= endD; d.setDate(d.getDate() + 1)) {
    const ds = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    dayKeys.push(ds);
    dayLabels.push(`${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}`);
  }

  // One dataset per project that appears in the filtered entries
  const projectIds = [...new Set(entries.map(e => e.projectId).filter(Boolean))];
  const datasets = projectIds.map(pid => {
    const proj = getProject(pid);
    return {
      label: proj?.name || 'Unknown',
      backgroundColor: proj?.color || '#888',
      borderRadius: 4,
      skipNull: true,
      data: dayKeys.map(ds => {
        const sec = totalEntrySec(entries.filter(e => isoDate(e.start) === ds && e.projectId === pid));
        return sec ? sec / 3600 : null;
      })
    };
  });

  // Entries with no project
  const noProjSecs = dayKeys.map(ds =>
    totalEntrySec(entries.filter(e => isoDate(e.start) === ds && !e.projectId)));
  if (noProjSecs.some(Boolean)) {
    datasets.push({ label: 'No project', backgroundColor: '#4a3d5a', borderRadius: 4, skipNull: true,
      data: noProjSecs.map(s => s ? s / 3600 : null) });
  }

  const ctx = document.getElementById('daily-chart').getContext('2d');
  if (dailyChart) dailyChart.destroy();
  dailyChart = new Chart(ctx, {
    type: 'bar',
    data: { labels: dayLabels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: '#a090b0', font: { size: 11 } } },
        tooltip: {
          callbacks: {
            label: c => c.parsed.y ? `${c.dataset.label}: ${fmtDuration(c.parsed.y * 3600)}` : null
          }
        }
      },
      scales: {
        x: { stacked: true, ticks: { color: '#6a5a7a', maxRotation: 45, font: { size: 10 } }, grid: { color: '#2d2440' } },
        y: { stacked: true, ticks: { color: '#6a5a7a', callback: v => v > 0 ? `${v.toFixed(1)}h` : '' }, grid: { color: '#2d2440' } }
      }
    }
  });
}

function renderProjectTable(entries, expenses, disp) {
  const totalSec = totalEntrySec(entries);
  const byProject = {};
  entries.forEach(e => {
    if (!byProject[e.projectId]) byProject[e.projectId] = { entries: [], expenses: [] };
    byProject[e.projectId].entries.push(e);
  });
  expenses.forEach(exp => {
    if (!byProject[exp.projectId]) byProject[exp.projectId] = { entries: [], expenses: [] };
    byProject[exp.projectId].expenses.push(exp);
  });

  const rows = Object.entries(byProject).map(([pid, group]) => {
    const proj   = getProject(pid);
    const client = proj ? getClient(proj.clientId) : null;
    const sec      = totalEntrySec(group.entries);
    const hrs      = sec / 3600;
    const { rate, currency } = getClientRate(pid);
    const nativeTime = hrs * rate;
    const nativeExp  = group.expenses.filter(e => e.billable).reduce((s, e) => {
      if (e.currency === currency) return s + e.amount;
      return s + (convertAmount(e.amount, e.fxSnapshot, currency) || e.amount);
    }, 0);
    const nativeTotal = nativeTime + nativeExp;
    const pct = totalSec > 0 ? (sec / totalSec * 100) : 0;
    return { pid, proj, client, sec, pct, nativeTime, nativeExp, nativeTotal, currency };
  }).sort((a, b) => {
    const ca = a.client?.name || '';
    const cb = b.client?.name || '';
    return ca !== cb ? ca.localeCompare(cb) : b.sec - a.sec;
  });

  // Donut chart
  const donutCtx = document.getElementById('donut-chart').getContext('2d');
  if (donutChart) donutChart.destroy();
  donutChart = new Chart(donutCtx, {
    type: 'doughnut',
    data: {
      labels: rows.map(r => r.proj ? r.proj.name : 'Unknown'),
      datasets: [{ data: rows.map(r => r.sec / 3600), backgroundColor: rows.map(r => r.proj?.color || '#888'), borderWidth: 0 }]
    },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '65%',
      plugins: {
        legend: { display: true, position: 'bottom', labels: { color: '#a090b0', font: { size: 11 }, boxWidth: 12, padding: 10 } },
        tooltip: { callbacks: { label: c => `${c.label}: ${fmtDuration(c.parsed * 3600)}` } }
      }
    }
  });

  // Table grouped by client
  const tbody = document.getElementById('project-table-body');
  let html = '';
  let lastClientId = '__sentinel__';
  rows.forEach(r => {
    const cid = r.client?.id || '__none__';
    if (cid !== lastClientId) {
      lastClientId = cid;
      const clientSec = rows.filter(x => (x.client?.id || '__none__') === cid)
                            .reduce((s, x) => s + x.sec, 0);
      html += `<tr class="client-group-row">
        <td colspan="6">
          <span class="project-dot" style="background:${r.client?.color || '#888'}"></span>
          <strong>${r.client?.name || 'No client'}</strong>
          <span class="client-group-total">${fmtDuration(clientSec)}</span>
        </td>
      </tr>`;
    }
    html += `<tr>
      <td class="proj-indent"><span class="project-dot" style="background:${r.proj?.color||'#888'}"></span> ${r.proj?.name || 'Unknown'}</td>
      <td class="mono">${fmtDuration(r.sec)}</td>
      <td class="mono">${r.nativeTime > 0 ? fmtMoney(r.nativeTime, r.currency) : '—'}</td>
      <td class="mono">${r.nativeExp  > 0 ? fmtMoney(r.nativeExp,  r.currency) : '—'}</td>
      <td class="mono">${r.nativeTotal > 0 ? fmtMoney(r.nativeTotal, r.currency) : '—'}</td>
      <td>
        <div class="progress-bar-wrap"><div class="progress-bar-fill" style="width:${r.pct}%;background:${r.proj?.color||'var(--accent)'}"></div></div>
        ${r.pct.toFixed(1)}%
      </td>
    </tr>`;
  });
  tbody.innerHTML = html;
}

function renderDescTable(entries, disp) {
  const total = totalEntrySec(entries);
  const groups = {};
  entries.forEach(e => {
    const key = e.note || '__none__';
    if (!groups[key]) groups[key] = { sec: 0, amount: 0 };
    const sec2 = durationSec(e.start, e.end);
    groups[key].sec += sec2;
    const { rate } = getClientRate(e.projectId);
    if (rate) groups[key].amount += (sec2 / 3600) * rate;
  });

  const tbody = document.getElementById('desc-table-body');
  tbody.innerHTML = Object.entries(groups).sort((a,b) => b[1].sec - a[1].sec).map(([key, g]) => `<tr>
    <td>${key === '__none__' ? '<span style="color:var(--text3)">Without description</span>' : key}</td>
    <td class="mono">${fmtDuration(g.sec)}</td>
    <td class="mono">${g.amount > 0 ? fmtMoney(g.amount, data.settings.baseCurrency) : '—'}</td>
    <td>${total > 0 ? (g.sec / total * 100).toFixed(1) + '%' : '0%'}</td>
  </tr>`).join('');
}

// ── Export ────────────────────────────────────────────────────────────────────
function exportCSV() {
  const entries = getFilteredEntries();
  const disp = data.settings.displayCurrency;
  const rows = [['Date','Project','Client','Description','Start','End','Duration','Billable','Native Amount','Native Currency','Display Amount','Display Currency','FX Rate','Payment Status']];
  entries.forEach(e => {
    const p = getProject(e.projectId);
    const c = p ? getClient(p.clientId) : null;
    const { rate: clientRate, currency: clientCur } = getClientRate(e.projectId);
    const sec = durationSec(e.start, e.end);
    const hrs = sec / 3600;
    const native = clientRate ? hrs * clientRate : 0;
    const dispAmt = convertAmount(native, e.fxSnapshot, disp) || native;
    const fxRate = e.fxSnapshot?.effectiveRate || '';
    rows.push([
      isoDate(e.start), p?.name || '', c?.name || '',
      e.note || '', e.start, e.end, fmtDuration(sec),
      e.billable ? 'Yes' : 'No',
      native.toFixed(2), clientCur,
      dispAmt.toFixed(2), disp, fxRate,
      e.paymentStatus || 'uninvoiced'
    ]);
  });
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  downloadFile(csv, 'timetracker_export.csv', 'text/csv');
}

async function exportPDF() {
  const section = document.getElementById('reports-chart-section');
  if (!section) return;
  try {
    const { jsPDF } = window.jspdf;
    const canvas = await html2canvas(document.getElementById('tab-reports'), { backgroundColor: '#1a1014', scale: 1.5 });
    const pdf = new jsPDF('p', 'pt', 'a4');
    const w = pdf.internal.pageSize.getWidth();
    const h = (canvas.height / canvas.width) * w;
    pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, w, h);
    pdf.save('timetracker_report.pdf');
  } catch (e) { alert('PDF export failed: ' + e.message); }
}

function downloadFile(content, filename, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ── Invoices ──────────────────────────────────────────────────────────────────
function renderInvoices() {
  const overdue = data.invoices.filter(inv => {
    if (inv.status !== 'sent') return false;
    const days = (Date.now() - new Date(inv.sentAt)) / (1000 * 60 * 60 * 24);
    return days > 30;
  }).length;

  ['invoice-badge-sidebar', 'invoice-badge-bottom', 'invoice-badge-title'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    if (overdue > 0) { el.textContent = overdue; el.classList.remove('hidden'); }
    else el.classList.add('hidden');
  });

  const list = document.getElementById('invoices-list');
  let invoices = data.invoices;
  if (invoiceFilter !== 'all') invoices = invoices.filter(inv => inv.status === invoiceFilter);
  invoices = invoices.sort((a,b) => (b.sentAt || b.id) < (a.sentAt || a.id) ? -1 : 1);

  if (!invoices.length) {
    list.innerHTML = '<div class="empty-state"><div class="empty-icon">🧾</div>No invoices yet.</div>';
    return;
  }

  list.innerHTML = invoices.map(inv => {
    const client = getClient(inv.clientId);
    const overdue = inv.status === 'sent' && (Date.now() - new Date(inv.sentAt)) / 86400000 > 30;
    const ago = inv.sentAt ? daysSince(inv.sentAt) : '';
    return `<div class="invoice-row ${inv.status === 'paid' ? 'paid' : ''} ${overdue ? 'overdue' : ''}" data-inv="${inv.id}">
      <span class="invoice-number">${inv.number}</span>
      <span class="invoice-client">${client ? client.name : '—'}</span>
      <span class="invoice-amount">${fmtMoney(inv.totalNative, inv.currency)}</span>
      <span class="invoice-status status-${inv.status}">
        ${inv.status === 'paid' ? '✓' : inv.status === 'sent' ? '●' : '○'} ${inv.status.toUpperCase()}
      </span>
      <span class="invoice-meta">${ago}</span>
    </div>`;
  }).join('');

  list.querySelectorAll('.invoice-row').forEach(row => {
    row.addEventListener('click', () => openInvoiceDetail(row.dataset.inv));
  });
}

function daysSince(iso) {
  if (!iso) return '';
  const d = Math.floor((Date.now() - new Date(iso)) / 86400000);
  if (d === 0) return 'today';
  if (d === 1) return '1 day ago';
  return `${d} days ago`;
}

function openInvoiceDetail(id) {
  pendingInvoiceId = id;
  const inv = data.invoices.find(i => i.id === id);
  if (!inv) return;

  const client = getClient(inv.clientId);
  document.getElementById('invoice-detail-number').textContent = inv.number;

  const markPaidBtn = document.getElementById('invoice-mark-paid-btn');
  markPaidBtn.classList.toggle('hidden', inv.status === 'paid');

  const body = document.getElementById('invoice-detail-body');
  const timeEntries = inv.entryIds.map(eid => data.entries.find(e => e.id === eid)).filter(Boolean);
  const expItems = (inv.expenseIds || []).map(eid => data.expenses.find(e => e.id === eid)).filter(Boolean);

  let html = `<div class="invoice-detail-section">
    <h4>Client</h4>
    <div>${client ? client.name : '—'}</div>
    <div style="color:var(--text3);font-size:12px">${inv.number} · ${inv.status.toUpperCase()} · ${inv.sentAt ? new Date(inv.sentAt).toLocaleDateString() : '—'}</div>
  </div>`;

  if (timeEntries.length) {
    html += `<div class="invoice-detail-section"><h4>Time Entries</h4>`;
    timeEntries.forEach(e => {
      const { rate, currency: cur } = getClientRate(e.projectId);
      const sec = durationSec(e.start, e.end);
      const amt = (sec / 3600) * rate;
      html += `<div class="invoice-line">
        <span>${isoDate(e.start)} · ${e.note || 'No description'} · ${fmtDuration(sec)}</span>
        <span>${amt > 0 ? fmtMoney(amt, cur) : '—'}</span>
      </div>`;
    });
    html += '</div>';
  }

  if (expItems.length) {
    html += `<div class="invoice-detail-section"><h4>Expenses</h4>`;
    expItems.forEach(exp => {
      html += `<div class="invoice-line">
        <span>${exp.date} · ${CATEGORY_ICONS[exp.category] || ''} ${exp.description || 'Expense'}</span>
        <span>${fmtMoney(exp.amount, exp.currency)}</span>
      </div>`;
    });
    html += '</div>';
  }

  html += `<div class="invoice-total-line">
    <span>Total</span>
    <span>${fmtMoney(inv.totalNative, inv.currency)}</span>
  </div>`;
  if (inv.note) html += `<div style="color:var(--text3);font-size:13px;margin-top:8px">${inv.note}</div>`;
  const markup = data.settings.fxMarkup || 4;
  html += `<div class="invoice-footnote">Exchange rate: ECB midpoint + ${markup}% conversion buffer</div>`;

  body.innerHTML = html;
  showModal('modal-invoice-detail');
}

function markInvoicePaid() {
  const inv = data.invoices.find(i => i.id === pendingInvoiceId);
  if (!inv) return;
  inv.status = 'paid';
  inv.paidAt = isoNow();
  inv.entryIds.forEach(eid => {
    const e = data.entries.find(x => x.id === eid);
    if (e) e.paymentStatus = 'paid';
  });
  (inv.expenseIds || []).forEach(eid => {
    const e = data.expenses.find(x => x.id === eid);
    if (e) e.paymentStatus = 'paid';
  });
  closeModal('modal-invoice-detail');
  renderInvoices();
  save();
}

function deleteInvoice(id) {
  const inv = data.invoices.find(i => i.id === id);
  if (!inv) return;
  if (!confirm('Delete this invoice? Entries will be returned to uninvoiced.')) return;
  inv.entryIds.forEach(eid => {
    const e = data.entries.find(x => x.id === eid);
    if (e) { e.paymentStatus = 'uninvoiced'; e.invoiceId = null; }
  });
  (inv.expenseIds || []).forEach(eid => {
    const e = data.expenses.find(x => x.id === eid);
    if (e) { e.paymentStatus = 'uninvoiced'; e.invoiceId = null; }
  });
  data.invoices = data.invoices.filter(i => i.id !== id);
  closeModal('modal-invoice-detail');
  renderInvoices();
  save();
}

function openNewInvoiceModal() {
  populateFilterDropdowns();
  const clientSel = document.getElementById('invoice-client');
  if (data.clients.length === 0) { alert('Add a client first.'); return; }
  clientSel.value = data.clients[0].id;
  renderInvoiceItems();
  showModal('modal-invoice');
}

function renderInvoiceItems() {
  const clientId = document.getElementById('invoice-client').value;
  const selectAll = document.getElementById('invoice-select-all').checked;

  const uninvEntries = data.entries.filter(e => e.paymentStatus === 'uninvoiced' && e.billable);
  const uninvExpenses = data.expenses.filter(exp => exp.paymentStatus === 'uninvoiced' && exp.billable);

  const clientEntries = uninvEntries.filter(e => {
    const p = getProject(e.projectId);
    return p && p.clientId === clientId;
  });
  const clientExpenses = uninvExpenses.filter(exp => {
    const p = getProject(exp.projectId);
    return p && p.clientId === clientId;
  });

  const list = document.getElementById('invoice-items-list');
  if (!clientEntries.length && !clientExpenses.length) {
    list.innerHTML = '<div class="empty-state" style="padding:16px">No uninvoiced billable items for this client.</div>';
    document.getElementById('invoice-preview-total').innerHTML = '';
    return;
  }

  list.innerHTML = [
    ...clientEntries.map(e => {
      const { rate, currency: cur } = getClientRate(e.projectId);
      const sec = durationSec(e.start, e.end);
      const amt = rate ? (sec / 3600) * rate : null;
      return `<div class="invoice-item-row">
        <input type="checkbox" class="inv-item-check" data-type="entry" data-id="${e.id}" ${selectAll ? 'checked' : ''}>
        <span class="invoice-item-desc">${isoDate(e.start)} · ${e.note || 'No description'} · ${fmtDuration(sec)}</span>
        <span class="invoice-item-amount">${amt !== null ? fmtMoney(amt, cur) : '—'}</span>
      </div>`;
    }),
    ...clientExpenses.map(exp => {
      const p = getProject(exp.projectId);
      return `<div class="invoice-item-row">
        <input type="checkbox" class="inv-item-check" data-type="expense" data-id="${exp.id}" ${selectAll ? 'checked' : ''}>
        <span class="invoice-item-desc">${exp.date} · ${CATEGORY_ICONS[exp.category]||''} ${exp.description || 'Expense'}</span>
        <span class="invoice-item-amount">${fmtMoney(exp.amount, exp.currency)}</span>
      </div>`;
    })
  ].join('');

  list.querySelectorAll('.inv-item-check').forEach(cb => cb.addEventListener('change', updateInvoiceTotal));
  updateInvoiceTotal();
}

function updateInvoiceTotal() {
  const checks = document.querySelectorAll('.inv-item-check:checked');
  let total = 0;
  const currency = data.settings.baseCurrency;
  checks.forEach(cb => {
    if (cb.dataset.type === 'entry') {
      const e = data.entries.find(x => x.id === cb.dataset.id);
      if (e) {
        const { rate } = getClientRate(e.projectId);
        if (rate) total += (durationSec(e.start, e.end) / 3600) * rate;
      }
    } else {
      const exp = data.expenses.find(x => x.id === cb.dataset.id);
      if (exp) total += exp.amount;
    }
  });
  document.getElementById('invoice-preview-total').innerHTML =
    `<div style="display:flex;justify-content:space-between;align-items:center">
      <span>${checks.length} item(s) selected</span>
      <strong>${fmtMoney(total, currency)}</strong>
    </div>`;
}

function createInvoice() {
  const clientId = document.getElementById('invoice-client').value;
  const note = document.getElementById('invoice-note').value.trim();
  const checks = Array.from(document.querySelectorAll('.inv-item-check:checked'));
  const entryIds = checks.filter(c => c.dataset.type === 'entry').map(c => c.dataset.id);
  const expenseIds = checks.filter(c => c.dataset.type === 'expense').map(c => c.dataset.id);

  if (!entryIds.length && !expenseIds.length) { alert('Select at least one item.'); return; }

  const currency = data.settings.baseCurrency;
  let total = 0;
  entryIds.forEach(eid => {
    const e = data.entries.find(x => x.id === eid);
    if (e) {
      const { rate } = getClientRate(e.projectId);
      if (rate) total += (durationSec(e.start, e.end) / 3600) * rate;
    }
  });
  expenseIds.forEach(eid => {
    const exp = data.expenses.find(x => x.id === eid);
    if (exp) total += exp.amount;
  });

  const year = new Date().getFullYear();
  const count = data.invoices.filter(i => i.number.startsWith(`INV-${year}-`)).length + 1;
  const number = `INV-${year}-${String(count).padStart(3,'0')}`;
  const now = isoNow();
  const inv = { id: uid(), clientId, number, status: 'sent', sentAt: now, paidAt: null, entryIds, expenseIds, totalNative: total, currency, note };
  data.invoices.push(inv);

  entryIds.forEach(eid => {
    const e = data.entries.find(x => x.id === eid);
    if (e) { e.paymentStatus = 'sent'; e.invoiceId = inv.id; }
  });
  expenseIds.forEach(eid => {
    const exp = data.expenses.find(x => x.id === eid);
    if (exp) { exp.paymentStatus = 'sent'; exp.invoiceId = inv.id; }
  });

  closeModal('modal-invoice');
  renderInvoices();
  renderAll();
  save();
}

// ── Settings ──────────────────────────────────────────────────────────────────
function renderSettings() {
  const s = data.settings;
  const keyInput = document.getElementById('dropbox-app-key');
  if (keyInput) keyInput.value = s.dropboxAppKey || '';
  document.getElementById('redirect-uri-display').textContent = location.origin;
  updateDropboxUI(s.dropboxConnected && !!localStorage.getItem('dropbox_token'));

  const baseSel = document.getElementById('base-currency');
  const dispSel = document.getElementById('display-currency');
  if (baseSel) {
    baseSel.innerHTML = CURRENCIES.map(c => `<option value="${c}">${c}</option>`).join('');
    baseSel.value = s.baseCurrency || 'ILS';
  }
  if (dispSel) {
    dispSel.innerHTML = CURRENCIES.map(c => `<option value="${c}">${c}</option>`).join('');
    dispSel.value = s.displayCurrency || 'ILS';
  }

  const markup = document.getElementById('fx-markup');
  if (markup) { markup.value = s.fxMarkup ?? 4; document.getElementById('fx-markup-val').textContent = (s.fxMarkup ?? 4) + '%'; }

  const weekSel = document.getElementById('week-start');
  if (weekSel) weekSel.value = s.weekStartDay || 'sunday';

  const lastFetch = localStorage.getItem('fx_last_fetch');
  const lfEl = document.getElementById('last-rate-fetch');
  if (lfEl) lfEl.textContent = lastFetch || '—';

  renderClientsList();
  renderProjectsList();
}

function renderClientsList() {
  const list = document.getElementById('clients-list');
  if (!data.clients.length) { list.innerHTML = '<div style="color:var(--text3);font-size:13px">No clients yet.</div>'; return; }
  list.innerHTML = data.clients.map(c => {
    const projCount = data.projects.filter(p => p.clientId === c.id).length;
    const rateStr = c.hourlyRate ? `${currSym(c.currency || data.settings.baseCurrency)}${c.hourlyRate}/hr` : (c.currency || data.settings.baseCurrency);
    return `<div class="crud-item" data-client="${c.id}">
      <span class="crud-color" style="background:${c.color}"></span>
      <span class="crud-name">${c.name}</span>
      <span class="crud-meta">${projCount} project${projCount !== 1 ? 's' : ''} · ${rateStr}</span>
    </div>`;
  }).join('');
  list.querySelectorAll('.crud-item').forEach(item => {
    item.addEventListener('click', () => openClientModal(item.dataset.client));
  });
}

function renderProjectsList() {
  const list = document.getElementById('projects-list');
  if (!data.projects.length) { list.innerHTML = '<div style="color:var(--text3);font-size:13px">No projects yet.</div>'; return; }
  list.innerHTML = data.projects.map(p => {
    const client = p.clientId ? getClient(p.clientId) : null;
    const { rate, currency } = getClientRate(p.id);
    const rateStr = rate ? `${currSym(currency)}${rate}/hr` : currency;
    return `<div class="crud-item" data-project="${p.id}">
      <span class="crud-color" style="background:${p.color || '#888'}"></span>
      <span class="crud-name">${p.name}</span>
      <span class="crud-meta">${client ? client.name + ' · ' : ''}${rateStr}</span>
    </div>`;
  }).join('');
  list.querySelectorAll('.crud-item').forEach(item => {
    item.addEventListener('click', () => openProjectModal(item.dataset.project));
  });
}

// ── Favorites ─────────────────────────────────────────────────────────────────
function renderFavorites() {
  const bar = document.getElementById('favorites-bar');
  const favItems = data.favorites.map(fav => {
    const p = getProject(fav.projectId);
    const color = getProjectColor(fav.projectId);
    return `<button class="fav-chip" data-fav="${fav.id}" style="border-color:${color}20">
      <span style="color:${color}">●</span> ${p ? p.name : 'Unknown'}${fav.note ? ' · ' + fav.note : ''}
      <span class="fav-remove" data-fav-remove="${fav.id}" title="Remove">✕</span>
    </button>`;
  }).join('');
  bar.innerHTML = `<button id="add-fav-btn" class="fav-chip fav-add">+ Favorite</button>` + favItems;

  document.getElementById('add-fav-btn').addEventListener('click', () => {
    if (!timerProjectId) { alert('Select a project first, then add to favorites.'); return; }
    const note = document.getElementById('timer-note').value.trim();
    data.favorites.push({ id: uid(), projectId: timerProjectId, note });
    renderFavorites();
    save();
  });

  bar.querySelectorAll('.fav-chip[data-fav]').forEach(btn => {
    btn.addEventListener('click', e => {
      if (e.target.closest('.fav-remove')) return;
      const fav = data.favorites.find(f => f.id === btn.dataset.fav);
      if (fav) { replayEntry({ projectId: fav.projectId, note: fav.note, billable: true }); }
    });
  });

  bar.querySelectorAll('.fav-remove').forEach(x => {
    x.addEventListener('click', e => {
      e.stopPropagation();
      data.favorites = data.favorites.filter(f => f.id !== x.dataset.favRemove);
      renderFavorites();
      save();
    });
  });
}

// ── Toggl CSV Import ──────────────────────────────────────────────────────────
function handleCSVImport(file) {
  const reader = new FileReader();
  reader.onload = e => {
    const text = e.target.result;
    const lines = text.split('\n').filter(l => l.trim());
    if (lines.length < 2) { alert('CSV appears empty.'); return; }
    const headers = parseCSVRow(lines[0]);
    const rows = lines.slice(1).map(l => {
      const vals = parseCSVRow(l);
      const obj = {};
      headers.forEach((h, i) => obj[h.trim()] = (vals[i] || '').trim());
      return obj;
    }).filter(r => r['Start date']);

    const newClients = {}, newProjects = {};
    let skipped = 0;
    const toImport = [];

    rows.forEach(r => {
      const startISO = r['Start date'] + 'T' + (r['Start time'] || '00:00:00');
      const endISO = r['End date'] + 'T' + (r['End time'] || '00:00:00');
      const isDuplicate = data.entries.some(e => e.start === startISO && e.end === endISO);
      if (isDuplicate) { skipped++; return; }

      const clientName = r['Client'] || '';
      const projectName = r['Project'] || '';
      let clientId = data.clients.find(c => c.name === clientName)?.id;
      if (!clientId && clientName) {
        if (!newClients[clientName]) {
          newClients[clientName] = { id: uid(), name: clientName, color: randColor() };
        }
        clientId = newClients[clientName].id;
      }
      const projKey = `${clientId}__${projectName}`;
      let projectId = data.projects.find(p => p.name === projectName && p.clientId === clientId)?.id;
      if (!projectId && projectName) {
        if (!newProjects[projKey]) {
          newProjects[projKey] = { id: uid(), clientId: clientId || null, name: projectName, hourlyRate: 0, currency: data.settings.baseCurrency, color: randColor() };
        }
        projectId = newProjects[projKey].id;
      }

      toImport.push({
        id: uid(), projectId: projectId || null, start: startISO, end: endISO,
        note: r['Description'] || '',
        billable: (r['Billable'] || '').toLowerCase() === 'yes',
        tags: r['Tags'] ? r['Tags'].split(',').map(t => t.trim()).filter(Boolean) : [],
        invoiceId: null, paymentStatus: 'uninvoiced'
      });
    });

    // Show preview modal
    const summary = document.getElementById('import-summary');
    summary.innerHTML = `<strong>${toImport.length}</strong> entries to import · <strong>${Object.keys(newClients).length}</strong> new clients · <strong>${Object.keys(newProjects).length}</strong> new projects · <strong>${skipped}</strong> duplicates skipped`;

    const previewList = document.getElementById('import-preview-list');
    previewList.innerHTML = toImport.slice(0, 20).map(e =>
      `<div class="import-preview-row">${isoDate(e.start)} · ${e.note || 'No description'} · ${fmtDuration(durationSec(e.start, e.end))}</div>`
    ).join('') + (toImport.length > 20 ? `<div class="import-preview-row">… and ${toImport.length - 20} more</div>` : '');

    // Store pending import
    window._pendingImport = { newClients: Object.values(newClients), newProjects: Object.values(newProjects), entries: toImport };
    showModal('modal-import');
  };
  reader.readAsText(file);
}

function confirmImport() {
  const imp = window._pendingImport;
  if (!imp) return;
  data.clients.push(...imp.newClients);
  data.projects.push(...imp.newProjects);
  data.entries.push(...imp.entries);
  data.entries.sort((a,b) => b.start < a.start ? -1 : 1);
  window._pendingImport = null;
  closeModal('modal-import');
  renderAll();
  save();
  alert(`Imported ${imp.entries.length} entries successfully.`);
}

function parseCSVRow(row) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < row.length; i++) {
    const ch = row[i];
    if (ch === '"') {
      if (inQuotes && row[i+1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current); current = '';
    } else { current += ch; }
  }
  result.push(current);
  return result;
}

function randColor() {
  const colors = ['#e05050','#3dd68c','#4f8ef7','#f5a623','#d946a8','#7c3aed','#06b6d4','#84cc16'];
  return colors[Math.floor(Math.random() * colors.length)];
}

// ── Modal helpers ─────────────────────────────────────────────────────────────
function showModal(id) {
  document.getElementById(id)?.classList.remove('hidden');
}
function closeModal(id) {
  document.getElementById(id)?.classList.add('hidden');
}

// ── Render All ────────────────────────────────────────────────────────────────
function renderAll() {
  renderTimerEntries();
  renderEntries();
  populateFilterDropdowns();
  if (currentTab === 'reports') renderReports();
  if (currentTab === 'invoices') renderInvoices();
  updateInvoiceBadges();
  updateFabVisibility();
}

function updateInvoiceBadges() {
  const overdue = data.invoices.filter(inv => {
    if (inv.status !== 'sent') return false;
    return (Date.now() - new Date(inv.sentAt)) / 86400000 > 30;
  }).length;
  ['invoice-badge-sidebar','invoice-badge-bottom','invoice-badge-title'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    if (overdue > 0) { el.textContent = overdue; el.classList.remove('hidden'); }
    else el.classList.add('hidden');
  });
}

function exitApp() {
  window.close();
  // Fallback: window.close() is blocked when page wasn't opened by script
  setTimeout(() => {
    if (!document.hidden) alert('Close this tab to exit the app.');
  }, 300);
}

// ── Event Listeners ───────────────────────────────────────────────────────────
function bindEvents() {
  // Exit buttons
  document.getElementById('exit-btn').addEventListener('click', exitApp);
  document.getElementById('exit-btn-mobile').addEventListener('click', exitApp);

  // Tab navigation
  document.querySelectorAll('.nav-btn[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // Start/stop timer
  document.getElementById('start-stop-btn').addEventListener('click', () => {
    if (data.runningEntry) stopTimer();
    else startTimer();
  });
  document.getElementById('stop-btn').addEventListener('click', stopTimer);

  // Project picker for timer
  document.getElementById('timer-project-btn').addEventListener('click', () => {
    openProjectPicker(projectId => {
      setTimerProject(projectId);
    });
  });

  // Billable toggle
  document.getElementById('timer-billable-btn').addEventListener('click', () => {
    timerBillable = !timerBillable;
    updateBillableBtn();
  });

  // Add entry
  document.getElementById('add-entry-btn').addEventListener('click', () => openEntryModal(null));

  // Entry modal save/delete
  document.getElementById('entry-save-btn').addEventListener('click', saveEntry);
  document.getElementById('entry-delete-btn').addEventListener('click', () => deleteEntry(pendingEntryEdit));
  document.getElementById('entry-start').addEventListener('change', updateEntryDuration);
  document.getElementById('entry-end').addEventListener('change', updateEntryDuration);

  // Expense modal save/delete
  document.getElementById('expense-save-btn').addEventListener('click', saveExpense);
  document.getElementById('expense-delete-btn').addEventListener('click', () => deleteExpense(pendingExpenseEdit));

  // FAB expense
  document.getElementById('fab-expense').addEventListener('click', () => openExpenseModal(null));

  // Client modal
  document.getElementById('add-client-btn').addEventListener('click', () => openClientModal(null));
  document.getElementById('client-save-btn').addEventListener('click', saveClient);
  document.getElementById('client-delete-btn').addEventListener('click', () => deleteClient(pendingClientEdit));

  // Project modal
  document.getElementById('add-project-btn').addEventListener('click', () => openProjectModal(null));
  document.getElementById('project-save-btn').addEventListener('click', saveProject);
  document.getElementById('project-delete-btn').addEventListener('click', () => deleteProject(pendingProjectEdit));

  // Modal cancel buttons
  document.querySelectorAll('.modal-cancel[data-close]').forEach(btn => {
    btn.addEventListener('click', () => closeModal(btn.dataset.close));
  });
  document.querySelectorAll('.modal-backdrop').forEach(bd => {
    bd.addEventListener('click', e => {
      const modal = e.target.closest('.modal');
      if (modal) closeModal(modal.id);
    });
  });

  // Reports date presets
  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      reportRange.preset = btn.dataset.preset;
      document.getElementById('custom-range').classList.toggle('hidden', btn.dataset.preset !== 'custom');
      renderReports();
    });
  });
  function autoSlashDate(e) {
    let v = e.target.value.replace(/[^\d]/g, '');
    if (v.length > 2) v = v.slice(0,2) + '/' + v.slice(2);
    if (v.length > 5) v = v.slice(0,5) + '/' + v.slice(5);
    if (v.length > 10) v = v.slice(0,10);
    e.target.value = v;
    const iso = parseDMY(v);
    return iso;
  }
  document.getElementById('range-start').addEventListener('input', e => {
    const iso = autoSlashDate(e);
    if (iso) { reportRange.start = iso; renderReports(); }
  });
  document.getElementById('range-end').addEventListener('input', e => {
    const iso = autoSlashDate(e);
    if (iso) { reportRange.end = iso; renderReports(); }
  });
  document.getElementById('report-client-filter').addEventListener('change', e => {
    reportFilters.client = e.target.value; renderReports();
  });
  document.getElementById('report-project-filter').addEventListener('change', e => {
    reportFilters.project = e.target.value; renderReports();
  });

  // Exports
  document.getElementById('export-csv-btn').addEventListener('click', exportCSV);
  document.getElementById('export-pdf-btn').addEventListener('click', exportPDF);

  // Invoice
  document.getElementById('new-invoice-btn').addEventListener('click', openNewInvoiceModal);
  document.getElementById('invoice-client').addEventListener('change', renderInvoiceItems);
  document.getElementById('invoice-select-all').addEventListener('change', renderInvoiceItems);
  document.getElementById('invoice-create-btn').addEventListener('click', createInvoice);
  document.getElementById('invoice-mark-paid-btn').addEventListener('click', markInvoicePaid);
  document.getElementById('invoice-delete-btn-detail').addEventListener('click', () => deleteInvoice(pendingInvoiceId));

  // Invoice filters
  document.querySelectorAll('.inv-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.inv-filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      invoiceFilter = btn.dataset.filter;
      renderInvoices();
    });
  });

  // Entries filters
  document.getElementById('entries-search').addEventListener('input', renderEntries);
  document.getElementById('entries-filter-client').addEventListener('change', renderEntries);
  document.getElementById('entries-filter-project').addEventListener('change', renderEntries);

  // Settings
  document.getElementById('dropbox-app-key').addEventListener('change', e => {
    data.settings.dropboxAppKey = e.target.value.trim();
    saveLocal();
  });
  document.getElementById('dropbox-connect-btn').addEventListener('click', dropboxOAuth);
  document.getElementById('dropbox-sync-now-btn').addEventListener('click', () => dropboxSync('read'));
  document.getElementById('dropbox-disconnect-btn').addEventListener('click', () => {
    if (!confirm('Disconnect Dropbox?')) return;
    localStorage.removeItem('dropbox_token');
    dropboxClient = null;
    data.settings.dropboxConnected = false;
    saveLocal();
    updateDropboxUI(false);
  });
  document.getElementById('base-currency').addEventListener('change', e => {
    data.settings.baseCurrency = e.target.value; save();
  });
  document.getElementById('display-currency').addEventListener('change', e => {
    data.settings.displayCurrency = e.target.value; save();
    fetchFxRates(data.settings.baseCurrency);
  });
  document.getElementById('fx-markup').addEventListener('input', e => {
    const val = parseFloat(e.target.value);
    data.settings.fxMarkup = val;
    document.getElementById('fx-markup-val').textContent = val + '%';
    save();
  });
  document.getElementById('week-start').addEventListener('change', e => {
    data.settings.weekStartDay = e.target.value; save();
  });

  // Import data file
  document.getElementById('load-data-file-btn').addEventListener('click', () => {
    if (!confirm('This will replace all current data with the selected JSON file. Continue?')) return;
    loadDataFile();
  });
  document.getElementById('load-data-file-input').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const sample = JSON.parse(ev.target.result);
        applyDataFile(sample);
      } catch {
        document.getElementById('load-data-status').textContent = '✗ Invalid JSON file';
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  });
  document.getElementById('import-toggl-btn').addEventListener('click', () => {
    document.getElementById('toggl-csv-input').click();
  });
  document.getElementById('toggl-csv-input').addEventListener('change', e => {
    if (e.target.files[0]) handleCSVImport(e.target.files[0]);
  });
  document.getElementById('import-confirm-btn').addEventListener('click', confirmImport);

  // Warn on close if timer running
  window.addEventListener('beforeunload', e => {
    if (data.runningEntry) { e.preventDefault(); e.returnValue = 'Timer is still running!'; }
  });

  // Reconnect sync on network restore
  window.addEventListener('online', () => {
    if (syncPending) { syncPending = false; dropboxSync('write'); }
  });

  // Pull latest data from Dropbox when tab becomes visible again
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && dropboxClient && !data.runningEntry) {
      dropboxSync('read');
    }
  });

  // Auto-pull from Dropbox every 60 seconds (keeps devices in sync)
  setInterval(() => {
    if (!document.hidden && dropboxClient && !data.runningEntry) {
      dropboxSync('read');
    }
  }, 60_000);
}

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  loadLocal();
  bindEvents();
  initDropbox();
  await handleDropboxCallback();

  // Pull fresh data from Dropbox on every page load (keeps devices in sync)
  if (dropboxClient && !data.runningEntry) {
    await dropboxSync('read');
  }

  // Restore running timer
  if (data.runningEntry) {
    showRunningBar();
    startTick();
  }

  renderAll();
  renderSettings();
  populateFilterDropdowns();
  document.querySelectorAll('.app-version-label').forEach(el => el.textContent = 'v' + APP_VERSION);

  // Fetch FX rates on load
  if (data.settings.baseCurrency) {
    fetchFxRates(data.settings.baseCurrency).catch(() => {});
  }

  // Load sample data if completely empty
  if (!data.entries.length && !data.clients.length) {
    loadSampleData();
  }
}

function loadSampleData() {
  if (localStorage.getItem('timetracker_data_loaded')) return;
  fetch('/timetracker-data.json')
    .then(r => { if (!r.ok) throw new Error(); return r.json(); })
    .then(sample => applyDataFile(sample))
    .catch(() => {});
}

function loadDataFile() {
  document.getElementById('load-data-file-input').click();
}

function applyDataFile(sample) {
  if (sample.clients)   data.clients   = sample.clients;
  if (sample.projects)  data.projects  = sample.projects;
  if (sample.entries)   data.entries   = sample.entries;
  if (sample.expenses)  data.expenses  = sample.expenses;
  if (sample.invoices)  data.invoices  = sample.invoices;
  if (sample.favorites) data.favorites = sample.favorites;
  if (sample.settings)  data.settings  = Object.assign(data.settings, sample.settings);
  localStorage.setItem('timetracker_data_loaded', '1');
  saveLocal();
  renderAll();
  renderSettings();
  const statusEl = document.getElementById('load-data-status');
  if (statusEl) statusEl.textContent = `✓ Loaded ${data.entries.length} entries`;
}

init();
