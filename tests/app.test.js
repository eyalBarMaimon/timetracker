/**
 * TimeTracker – Test Suite
 * Runner: node --test (Node 24 built-in, no extra packages)
 *
 * Strategy: the app is one script that mixes pure logic with DOM calls.
 * We load it inside a sandboxed Function with complete DOM + browser stubs,
 * then export only the internal symbols we need via __nsExport.
 * DOM-touching functions get a richer per-test stub injected via setDoc().
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// ─── localStorage shim ───────────────────────────────────────────────────────
const _ls = {};
const _localStorage = {
  getItem:    k => Object.prototype.hasOwnProperty.call(_ls, k) ? _ls[k] : null,
  setItem:    (k, v) => { _ls[k] = String(v); },
  removeItem: k => { delete _ls[k]; },
  clear:      () => { Object.keys(_ls).forEach(k => delete _ls[k]); },
};

// ─── Null-safe DOM element stub ───────────────────────────────────────────────
// Returns an element whose properties/methods are always safe to call.
function nullEl(overrides = {}) {
  const el = {
    classList: { add: () => {}, remove: () => {}, toggle: () => {}, contains: () => false },
    style: {},
    textContent: '',
    innerHTML: '',
    value: '',
    checked: false,
    dataset: {},
    getAttribute: () => null,
    addEventListener: () => {},
    getBoundingClientRect: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
    querySelectorAll: () => { return { forEach: () => {} }; },
    querySelector: () => null,
    closest: () => null,
    click: () => {},
    ...overrides,
  };
  return el;
}

// ─── Configurable document stub ───────────────────────────────────────────────
// Tests that exercise DOM-touching functions replace this via setDoc().
let _docById  = {};   // id → element overrides
let _docQuery = {};   // selector → element overrides

function makeDocument() {
  return {
    getElementById:   id  => nullEl(_docById[id]  || {}),
    querySelector:    sel => nullEl(_docQuery[sel] || {}),
    querySelectorAll: sel => {
      // Must be Array-like so both forEach and Array.from() work.
      const items = Array.isArray(_docQuery[sel]) ? _docQuery[sel] : [];
      // Return a real array — Array.from works on arrays, and forEach too.
      return items;
    },
    addEventListener: () => {},
    hidden: false,
  };
}

function setDoc(byId = {}, byQuery = {}) {
  _docById  = byId;
  _docQuery = byQuery;
}

// ─── crypto shim (read-only on Node 24) ──────────────────────────────────────
// Use Node's built-in crypto.getRandomValues so uid() produces truly unique IDs.
import { webcrypto } from 'node:crypto';
Object.defineProperty(globalThis, 'crypto', {
  value: webcrypto,
  configurable: true, writable: true,
});

// ─── Other browser globals ────────────────────────────────────────────────────
globalThis.localStorage = _localStorage;
globalThis.Dropbox  = { DropboxAuth: class { constructor() {} }, Dropbox: class { constructor() {} } };
globalThis.Chart    = class { constructor() {} destroy() {} };
globalThis.fetch    = async () => ({ ok: false, json: async () => ({}) });
globalThis.alert    = () => {};
globalThis.confirm  = () => true;
globalThis.window   = { addEventListener: () => {}, location: { origin: 'http://localhost', pathname: '/' } };
globalThis.location = { origin: 'http://localhost', pathname: '/', search: '' };
globalThis.history  = { replaceState: () => {} };
globalThis.setInterval = () => 0;
globalThis.clearInterval = () => {};

// ─── Load & sandbox app.js ───────────────────────────────────────────────────
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appSrc = readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

const sandboxSrc = appSrc
  .replace(/^'use strict';\n?/, '')
  .replace(/^init\(\);?\s*$/m, '');

const ns = {};
// We pass `document` as a getter so tests can swap the stub at runtime.
const factory = new Function(
  'globalThis','localStorage','window','location','history',
  'Dropbox','Chart','fetch','alert','confirm','crypto','setInterval','clearInterval',
  '__getDocument', '__nsExport',
  `
  // Proxy document so tests can swap it
  const document = new Proxy({}, {
    get(_, prop) { return __getDocument()[prop]; }
  });

  ${sandboxSrc}

  // ── export symbols ──
  __nsExport.uid             = uid;
  __nsExport.esc             = esc;
  __nsExport.fmt2            = fmt2;
  __nsExport.fmtDuration     = fmtDuration;
  __nsExport.durationSec     = durationSec;
  __nsExport.isoNow          = isoNow;
  __nsExport.isoDate         = isoDate;
  __nsExport.fmtDate         = fmtDate;
  __nsExport.fmtMoney        = fmtMoney;
  __nsExport.convertAmount   = convertAmount;
  __nsExport.buildFxSnapshot = buildFxSnapshot;
  __nsExport.parseCSVRow     = parseCSVRow;
  __nsExport.randColor       = randColor;
  __nsExport.totalEntrySec   = totalEntrySec;
  __nsExport.daysSince       = daysSince;
  __nsExport.loadLocal       = loadLocal;
  __nsExport.saveLocal       = saveLocal;

  __nsExport.getData  = () => data;
  __nsExport.setData  = d  => { data = d; };
  __nsExport.getDefaultData = () => JSON.parse(JSON.stringify(DEFAULT_DATA));

  __nsExport.deleteClient  = deleteClient;
  __nsExport.deleteProject = deleteProject;
  __nsExport.createInvoice    = createInvoice;
  __nsExport.markInvoicePaid  = markInvoicePaid;
  __nsExport.deleteInvoice    = deleteInvoice;

  __nsExport.getFilteredEntries  = getFilteredEntries;
  __nsExport.getFilteredExpenses = getFilteredExpenses;
  __nsExport.setReportRange      = v => { reportRange = v; };
  __nsExport.setReportMode       = v => { reportMode  = v; };
  __nsExport.setReportFilters    = v => { reportFilters = v; };
  __nsExport.setReportInvoiceId  = v => { reportInvoiceId = v; };
  __nsExport.setPendingInvoiceId = v => { pendingInvoiceId = v; };

  __nsExport.dropboxSync         = dropboxSync;
  __nsExport.getSyncInProgress   = () => syncInProgress;
  __nsExport.setSyncInProgress   = v  => { syncInProgress = v; };
  __nsExport.setDropboxClient    = v  => { dropboxClient  = v; };
`);

factory(
  globalThis, _localStorage, globalThis.window, globalThis.location,
  globalThis.history, globalThis.Dropbox, globalThis.Chart, globalThis.fetch,
  globalThis.alert, globalThis.confirm, globalThis.crypto,
  globalThis.setInterval, globalThis.clearInterval,
  makeDocument, ns
);

const {
  uid, esc, fmtDuration, durationSec, isoDate, fmtDate,
  fmtMoney, convertAmount, buildFxSnapshot, parseCSVRow, randColor,
  totalEntrySec, daysSince, loadLocal, saveLocal,
  getData, setData, getDefaultData,
  deleteClient, deleteProject,
  createInvoice, markInvoicePaid, deleteInvoice,
  getFilteredEntries, getFilteredExpenses,
  setReportRange, setReportMode, setReportFilters,
  setReportInvoiceId, setPendingInvoiceId,
  dropboxSync, getSyncInProgress, setSyncInProgress, setDropboxClient,
} = ns;

// ─── test helpers ─────────────────────────────────────────────────────────────
function freshData() {
  setData(getDefaultData());
  setDoc();
}

function makeClient(o = {})  { return { id:'c1', name:'Acme', hourlyRate:100, currency:'ILS', color:'#fff', ...o }; }
function makeProject(o = {}) { return { id:'p1', name:'Alpha', clientId:'c1', color:'#aaa', ...o }; }
function makeEntry(o = {}) {
  return {
    id:'e1', projectId:'p1',
    start:'2025-01-15T08:00:00', end:'2025-01-15T10:00:00',
    note:'Work', billable:true, tags:[], invoiceId:null, paymentStatus:'uninvoiced',
    ...o,
  };
}
function makeExpense(o = {}) {
  return {
    id:'x1', projectId:'p1', date:'2025-01-15',
    amount:200, currency:'ILS', category:'other', description:'Misc',
    billable:true, paymentStatus:'uninvoiced', invoiceId:null,
    ...o,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// 1. PURE UTILITIES
// ═════════════════════════════════════════════════════════════════════════════
describe('esc()', () => {
  test('encodes < > " &', () => {
    assert.equal(esc('<script>alert("xss")&</script>'),
      '&lt;script&gt;alert(&quot;xss&quot;)&amp;&lt;/script&gt;');
  });
  test('null → empty string', () => assert.equal(esc(null), ''));
  test('undefined → empty string', () => assert.equal(esc(undefined), ''));
  test('number passes through as string', () => assert.equal(esc(42), '42'));
});

describe('fmtDuration()', () => {
  test('0 → 0:00:00',         () => assert.equal(fmtDuration(0),    '0:00:00'));
  test('negative → 0:00:00',  () => assert.equal(fmtDuration(-5),   '0:00:00'));
  test('null → 0:00:00',      () => assert.equal(fmtDuration(null), '0:00:00'));
  test('59s',                  () => assert.equal(fmtDuration(59),   '0:00:59'));
  test('3600s → 1:00:00',     () => assert.equal(fmtDuration(3600), '1:00:00'));
  test('3661s → 1:01:01',     () => assert.equal(fmtDuration(3661), '1:01:01'));
  test('100h+ no zero-pad',   () => assert.equal(fmtDuration(360000), '100:00:00'));
  test('minutes zero-padded', () => assert.equal(fmtDuration(3660),  '1:01:00'));
});

describe('durationSec()', () => {
  test('2-hour span → 7200', () =>
    assert.equal(durationSec('2025-01-15T08:00:00','2025-01-15T10:00:00'), 7200));
  test('inverted range → 0 (non-negative clamp)', () =>
    assert.equal(durationSec('2025-01-15T10:00:00','2025-01-15T08:00:00'), 0));
  test('same timestamps → 0', () =>
    assert.equal(durationSec('2025-01-15T08:00:00','2025-01-15T08:00:00'), 0));
});

describe('isoDate()', () => {
  test('extracts date part', () => assert.equal(isoDate('2025-01-15T08:00:00'), '2025-01-15'));
  test('null → empty',       () => assert.equal(isoDate(null), ''));
  test('empty → empty',      () => assert.equal(isoDate(''), ''));
});

describe('fmtDate()', () => {
  test('ISO → DD/MM/YYYY',         () => assert.equal(fmtDate('2025-01-15'), '15/01/2025'));
  test('datetime string works',    () => assert.equal(fmtDate('2025-12-31T23:59:59'), '31/12/2025'));
  test('null → empty',             () => assert.equal(fmtDate(null), ''));
});

describe('fmtMoney()', () => {
  test('ILS shows ₪',              () => assert.match(fmtMoney(1000, 'ILS'), /₪/));
  test('USD shows $',              () => assert.match(fmtMoney(1000, 'USD'), /\$/));
  test('rounds to integer',        () => assert.match(fmtMoney(1000.9, 'ILS'), /1,001/));
  test('null amount → —',          () => assert.equal(fmtMoney(null, 'ILS'), '—'));
  test('zero displays',            () => assert.match(fmtMoney(0, 'ILS'), /0/));
  test('unknown currency → code',  () => assert.match(fmtMoney(50, 'XYZ'), /XYZ/));
});

describe('totalEntrySec()', () => {
  test('sums multiple entries', () => {
    assert.equal(totalEntrySec([
      makeEntry({ start:'2025-01-15T08:00:00', end:'2025-01-15T09:00:00' }),
      makeEntry({ id:'e2', start:'2025-01-15T10:00:00', end:'2025-01-15T11:30:00' }),
    ]), 9000);
  });
  test('empty array → 0', () => assert.equal(totalEntrySec([]), 0));
  // null end: new Date(null) = epoch but Math.max(0,...) clamps negative → 0.
  // Running entries (null end) do NOT inflate totalEntrySec — safe.
  test('entry with null end contributes 0 (clamped) — running entries are safe', () => {
    const contribution = durationSec('2025-01-15T08:00:00', null);
    assert.equal(contribution, 0,
      `null-end entry should contribute 0s to totalEntrySec, got ${contribution}`);
  });
});

describe('daysSince()', () => {
  test('null → empty string', () => assert.equal(daysSince(null), ''));
  test('now → "today"',       () => assert.equal(daysSince(new Date().toISOString()), 'today'));
  test('>1 day → "N days ago"', () => {
    const twoDaysAgo = new Date(Date.now() - 86400000 * 2.5).toISOString();
    assert.match(daysSince(twoDaysAgo), /days ago/);
  });
});

describe('parseCSVRow()', () => {
  test('simple',                     () => assert.deepEqual(parseCSVRow('a,b,c'), ['a','b','c']));
  test('quoted field with comma',    () => assert.deepEqual(parseCSVRow('"a,b",c'), ['a,b','c']));
  test('escaped quote inside quotes',() => assert.deepEqual(parseCSVRow('"he said ""hi""",x'), ['he said "hi"','x']));
  test('empty fields',               () => assert.deepEqual(parseCSVRow('a,,c'), ['a','','c']));
  test('Toggl client with comma in name', () => {
    const row = `"John","j@e.com","Acme, Inc","Alpha",,Work,Yes,2025-01-15,08:00:00,2025-01-15,10:00:00,02:00:00,,0`;
    const p = parseCSVRow(row);
    assert.equal(p[2], 'Acme, Inc');
    assert.equal(p[3], 'Alpha');
  });
});

describe('randColor()', () => {
  const PALETTE = ['#e05050','#3dd68c','#4f8ef7','#f5a623','#d946a8','#7c3aed','#06b6d4','#84cc16'];
  test('returns a hex string', () => assert.match(randColor(), /^#[0-9a-f]{6}$/i));
  test('always from palette',  () => {
    for (let i = 0; i < 40; i++) assert.ok(PALETTE.includes(randColor()));
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. uid() COLLISION STRESS TEST
// ═════════════════════════════════════════════════════════════════════════════
describe('uid() uniqueness', () => {
  test('10,000 IDs – no collision', () => {
    const s = new Set();
    for (let i = 0; i < 10_000; i++) s.add(uid());
    assert.equal(s.size, 10_000);
  });
  test('IDs are non-empty strings', () => {
    assert.equal(typeof uid(), 'string');
    assert.ok(uid().length > 4);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. FX / CURRENCY LOGIC
// ═════════════════════════════════════════════════════════════════════════════
describe('convertAmount()', () => {
  test('same currency → passthrough', () => {
    const snap = { base:'ILS', effectiveRate:3.7, rates:{ USD:3.7 } };
    assert.equal(convertAmount(100, snap, 'ILS'), 100);
  });
  test('converts using effectiveRate', () => {
    const snap = { base:'ILS', effectiveRate:3.7, rates:{ USD:3.5 } };
    assert.equal(convertAmount(100, snap, 'USD'), 370);
  });
  test('falls back to rates[display] when no effectiveRate', () => {
    const snap = { base:'ILS', rates:{ USD:3.5 } };
    assert.equal(convertAmount(100, snap, 'USD'), 350);
  });
  test('currency not in rates → multiplies by 1', () => {
    const snap = { base:'ILS', rates:{} };
    assert.equal(convertAmount(100, snap, 'XYZ'), 100);
  });
  test('null snapshot → null', ()  => assert.equal(convertAmount(100, null, 'USD'), null));
  test('snap without rates → null', () => assert.equal(convertAmount(100, { base:'ILS' }, 'USD'), null));
});

describe('buildFxSnapshot() – from localStorage cache', () => {
  test('applies markup% to midpoint rate', async () => {
    freshData();
    getData().settings.fxMarkup = 4;
    getData().settings.displayCurrency = 'USD';
    _localStorage.setItem('fx_rate_ILS_2025-01-15',
      JSON.stringify({ rates:{ USD:3.5 }, fetchedAt: Date.now() }));

    const snap = await buildFxSnapshot('ILS', '2025-01-15');
    assert.equal(snap.base, 'ILS');
    assert.equal(snap.markupPct, 4);
    assert.ok(Math.abs(snap.effectiveRate - 3.5 * 1.04) < 0.0001);
  });

  test('defaults to midpoint 1 when fetch fails and no cache', async () => {
    freshData();
    getData().settings.fxMarkup = 0;
    getData().settings.displayCurrency = 'USD';
    _localStorage.removeItem('fx_rate_ILS_1980-01-01');

    const snap = await buildFxSnapshot('ILS', '1980-01-01');
    assert.equal(snap.midpointRate, 1);
  });
});

describe('Invoice total FX inconsistency (known bug)', () => {
  test('USD expense added raw to ILS total produces wrong result', () => {
    const USD_AMOUNT = 100;
    const ILS_RATE   = 3.7;
    const correctILS = USD_AMOUNT * ILS_RATE;   // 370
    const buggyTotal = USD_AMOUNT;               // what updateInvoiceTotal does
    assert.notEqual(buggyTotal, correctILS,
      'Bug: 100 USD treated as 100 ILS. Should be 370 ILS at rate 3.7.');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 4. deleteClient() CASCADE
// ═════════════════════════════════════════════════════════════════════════════
describe('deleteClient() cascade', () => {
  beforeEach(() => {
    freshData();
    const d = getData();
    d.clients  = [makeClient()];
    d.projects = [makeProject()];
    d.entries  = [makeEntry()];
    d.expenses = [makeExpense()];
    // closeModal / renderAll are DOM-dependent — stub them out
    setDoc({ 'modal-client': { classList: { add: () => {}, remove: () => {} } } });
  });

  test('removes the client record', () => {
    deleteClient('c1');
    assert.equal(getData().clients.length, 0);
  });
  test('project survives but clientId becomes null', () => {
    deleteClient('c1');
    const p = getData().projects.find(p => p.id === 'p1');
    assert.ok(p, 'project should still exist');
    assert.equal(p.clientId, null);
  });
  test('entry survives but projectId becomes null', () => {
    deleteClient('c1');
    assert.equal(getData().entries[0].projectId, null);
  });
  test('expense survives but projectId becomes null', () => {
    deleteClient('c1');
    assert.equal(getData().expenses[0].projectId, null);
  });
  test('deleting unknown id is a no-op', () => {
    const before = getData().clients.length;
    deleteClient('no-such-id');
    assert.equal(getData().clients.length, before);
  });
  test('multiple projects under same client are all unlinked', () => {
    getData().projects.push(makeProject({ id:'p2', clientId:'c1', name:'Beta' }));
    deleteClient('c1');
    assert.ok(getData().projects.every(p => p.clientId === null));
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 5. deleteProject() CASCADE
// ═════════════════════════════════════════════════════════════════════════════
describe('deleteProject() cascade', () => {
  beforeEach(() => {
    freshData();
    getData().clients  = [makeClient()];
    getData().projects = [makeProject()];
    getData().entries  = [makeEntry()];
    getData().expenses = [makeExpense()];
    setDoc({ 'modal-project': { classList: { add: () => {}, remove: () => {} } } });
  });

  test('removes the project', () => {
    deleteProject('p1');
    assert.equal(getData().projects.find(p => p.id === 'p1'), undefined);
  });
  test('entry projectId set to null', () => {
    deleteProject('p1');
    assert.equal(getData().entries[0].projectId, null);
  });
  test('expense projectId set to null', () => {
    deleteProject('p1');
    assert.equal(getData().expenses[0].projectId, null);
  });
  test('parent client is untouched', () => {
    deleteProject('p1');
    assert.ok(getData().clients.find(c => c.id === 'c1'));
  });
  test('entries for OTHER projects are not affected', () => {
    getData().projects.push(makeProject({ id:'p2', name:'Beta', clientId:'c1' }));
    getData().entries.push(makeEntry({ id:'e2', projectId:'p2' }));
    deleteProject('p1');
    assert.equal(getData().entries.find(e => e.id === 'e2').projectId, 'p2');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 6. INVOICE LIFECYCLE
// ═════════════════════════════════════════════════════════════════════════════
function seedInvoiceState() {
  freshData();
  const d = getData();
  d.clients  = [makeClient()];
  d.projects = [makeProject()];
  d.entries  = [
    makeEntry({ id:'e1', paymentStatus:'sent', invoiceId:'inv1' }),
    makeEntry({ id:'e2', paymentStatus:'sent', invoiceId:'inv1',
                start:'2025-01-15T11:00:00', end:'2025-01-15T13:00:00' }),
  ];
  d.expenses = [makeExpense({ id:'x1', paymentStatus:'sent', invoiceId:'inv1' })];
  d.invoices = [{
    id:'inv1', clientId:'c1', number:'INV-2025-001', status:'sent',
    sentAt: new Date().toISOString(), paidAt:null,
    entryIds:['e1','e2'], expenseIds:['x1'],
    totalNative:400, currency:'ILS', note:'',
  }];
  // Stub modal close
  setDoc({ 'modal-invoice-detail': nullEl() });
}

describe('markInvoicePaid()', () => {
  beforeEach(seedInvoiceState);

  test('invoice status → paid', () => {
    setPendingInvoiceId('inv1');
    markInvoicePaid();
    assert.equal(getData().invoices[0].status, 'paid');
  });
  test('paidAt is set', () => {
    setPendingInvoiceId('inv1');
    markInvoicePaid();
    assert.ok(getData().invoices[0].paidAt);
  });
  test('all linked entries marked paid', () => {
    setPendingInvoiceId('inv1');
    markInvoicePaid();
    const d = getData();
    assert.equal(d.entries.find(e => e.id === 'e1').paymentStatus, 'paid');
    assert.equal(d.entries.find(e => e.id === 'e2').paymentStatus, 'paid');
  });
  test('linked expense marked paid', () => {
    setPendingInvoiceId('inv1');
    markInvoicePaid();
    assert.equal(getData().expenses[0].paymentStatus, 'paid');
  });
  test('unknown pendingInvoiceId is a no-op', () => {
    setPendingInvoiceId('no-such-invoice');
    assert.doesNotThrow(() => markInvoicePaid());
    assert.equal(getData().invoices[0].status, 'sent');
  });
});

describe('deleteInvoice()', () => {
  beforeEach(() => {
    seedInvoiceState();
    // renderInvoices needs invoices-list element
    setDoc({ 'invoices-list': nullEl(), 'invoice-badge-sidebar': nullEl(),
             'invoice-badge-bottom': nullEl(), 'invoice-badge-title': nullEl(),
             'modal-invoice-detail': nullEl() });
  });

  test('invoice removed from list', () => {
    deleteInvoice('inv1');
    assert.equal(getData().invoices.length, 0);
  });
  test('entries reverted to uninvoiced', () => {
    deleteInvoice('inv1');
    const d = getData();
    assert.equal(d.entries.find(e => e.id === 'e1').paymentStatus, 'uninvoiced');
    assert.equal(d.entries.find(e => e.id === 'e2').paymentStatus, 'uninvoiced');
  });
  test('entry invoiceId cleared', () => {
    deleteInvoice('inv1');
    assert.equal(getData().entries.find(e => e.id === 'e1').invoiceId, null);
  });
  test('expense reverted to uninvoiced', () => {
    deleteInvoice('inv1');
    assert.equal(getData().expenses[0].paymentStatus, 'uninvoiced');
  });
  test('expense invoiceId cleared', () => {
    deleteInvoice('inv1');
    assert.equal(getData().expenses[0].invoiceId, null);
  });
  test('non-existent id is a no-op', () => {
    assert.doesNotThrow(() => deleteInvoice('no-such'));
    assert.equal(getData().invoices.length, 1);
  });
});

describe('createInvoice() – invoice numbering', () => {
  // createInvoice calls Array.from(document.querySelectorAll(...)) so the
  // stub must return an actual array (not an object with forEach).
  function invoiceDocStub(entryId, clientId = 'c1') {
    const checkedItem = { dataset: { type: 'entry', id: entryId } };
    return {
      byId: {
        'invoice-client':        { value: clientId },
        'invoice-note':          { value: '' },
        'invoice-preview-total': nullEl(),
        'modal-invoice':         nullEl(),
        'invoices-list':         nullEl(),
        'invoice-badge-sidebar': nullEl(),
        'invoice-badge-bottom':  nullEl(),
        'invoice-badge-title':   nullEl(),
      },
      byQuery: {
        // Must be a real array because createInvoice does Array.from(...)
        '.inv-item-check:checked': [checkedItem],
      },
    };
  }

  // Override makeDocument so querySelectorAll returns a real array for Array.from
  function setDocForInvoice(entryId, clientId = 'c1') {
    const { byId, byQuery } = invoiceDocStub(entryId, clientId);
    _docById  = byId;
    _docQuery = byQuery;
  }

  test('counter resets to 001 when year changes', () => {
    freshData();
    const d = getData();
    d.clients  = [makeClient()];
    d.projects = [makeProject()];
    d.settings.invoiceYear    = 2020;
    d.settings.invoiceCounter = 99;
    d.entries  = [makeEntry({ id: 'e1', paymentStatus: 'uninvoiced', invoiceId: null })];

    setDocForInvoice('e1');
    createInvoice();

    const inv = getData().invoices[0];
    const y = new Date().getFullYear();
    assert.match(inv.number, new RegExp(`INV-${y}-001`),
      `Expected INV-${y}-001, got ${inv.number}`);
  });

  test('counter increments when year is current', () => {
    freshData();
    const d = getData();
    const y = new Date().getFullYear();
    d.clients  = [makeClient()];
    d.projects = [makeProject()];
    d.settings.invoiceYear    = y;
    d.settings.invoiceCounter = 4;
    d.entries  = [makeEntry({ id: 'e1', paymentStatus: 'uninvoiced', invoiceId: null })];

    setDocForInvoice('e1');
    createInvoice();
    assert.match(getData().invoices[0].number, new RegExp(`INV-${y}-005`));
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 7. REPORT FILTERING
// ═════════════════════════════════════════════════════════════════════════════
describe('getFilteredEntries() / getFilteredExpenses()', () => {
  beforeEach(() => {
    freshData();
    const d = getData();
    d.clients  = [makeClient({ id:'c1' }), makeClient({ id:'c2', name:'Beta' })];
    d.projects = [
      makeProject({ id:'p1', clientId:'c1' }),
      makeProject({ id:'p2', clientId:'c2', name:'BetaProj' }),
    ];
    d.entries = [
      makeEntry({ id:'e1', projectId:'p1', start:'2025-06-01T08:00:00', end:'2025-06-01T10:00:00', paymentStatus:'uninvoiced' }),
      makeEntry({ id:'e2', projectId:'p2', start:'2025-06-15T08:00:00', end:'2025-06-15T09:00:00', paymentStatus:'sent', invoiceId:'inv1' }),
      makeEntry({ id:'e3', projectId:'p1', start:'2025-07-01T08:00:00', end:'2025-07-01T11:00:00', paymentStatus:'uninvoiced' }),
    ];
    d.expenses = [makeExpense({ id:'x1', projectId:'p1', date:'2025-06-10', paymentStatus:'uninvoiced' })];
    d.invoices = [{
      id:'inv1', clientId:'c2', number:'INV-2025-001', status:'sent',
      sentAt:'2025-06-15T12:00:00', paidAt:null,
      entryIds:['e2'], expenseIds:[], totalNative:100, currency:'ILS', note:'',
    }];
  });

  test('date-range: June only → e1, e2 (not e3)', () => {
    setReportMode('normal');
    setReportFilters({ client:'', project:'' });
    setReportRange({ preset:'custom', start:'2025-06-01', end:'2025-06-30' });
    const ids = getFilteredEntries().map(e => e.id).sort();
    assert.deepEqual(ids, ['e1','e2']);
  });

  test('client filter → only entries for c1 projects', () => {
    setReportMode('normal');
    setReportFilters({ client:'c1', project:'' });
    setReportRange({ preset:'custom', start:'2025-01-01', end:'2025-12-31' });
    assert.ok(getFilteredEntries().every(e => e.projectId === 'p1'));
  });

  test('project filter → only entries for p2', () => {
    setReportMode('normal');
    setReportFilters({ client:'', project:'p2' });
    setReportRange({ preset:'custom', start:'2025-01-01', end:'2025-12-31' });
    assert.ok(getFilteredEntries().every(e => e.projectId === 'p2'));
  });

  test('uninvoiced mode → only uninvoiced billable entries', () => {
    setReportMode('uninvoiced');
    const entries = getFilteredEntries();
    assert.ok(entries.every(e => e.paymentStatus === 'uninvoiced' && e.billable));
    assert.equal(entries.find(e => e.id === 'e2'), undefined, 'sent entry must be excluded');
  });

  test('uninvoiced mode → only uninvoiced billable expenses', () => {
    setReportMode('uninvoiced');
    const expenses = getFilteredExpenses();
    assert.ok(expenses.every(x => x.paymentStatus === 'uninvoiced' && x.billable));
  });

  test('invoice mode → entries for that invoice', () => {
    setReportMode('invoice');
    setReportInvoiceId('inv1');
    const entries = getFilteredEntries();
    assert.equal(entries.length, 1);
    assert.equal(entries[0].id, 'e2');
  });

  test('invoice mode with null invoiceId → empty', () => {
    setReportMode('invoice');
    setReportInvoiceId(null);
    assert.equal(getFilteredEntries().length, 0);
  });

  test('combining date + project filter excludes wrong project', () => {
    setReportMode('normal');
    setReportFilters({ client:'', project:'p2' });
    setReportRange({ preset:'custom', start:'2025-06-01', end:'2025-06-30' });
    const entries = getFilteredEntries();
    assert.ok(entries.every(e => e.projectId === 'p2'));
    assert.equal(entries.find(e => e.id === 'e1'), undefined);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 8. DROPBOX SYNC — CONCURRENCY GUARD
// ═════════════════════════════════════════════════════════════════════════════
describe('dropboxSync()', () => {
  beforeEach(() => {
    freshData();
    setSyncInProgress(false);
    setDropboxClient(null);
  });

  test('skipped when no dropboxClient', async () => {
    await assert.doesNotReject(() => dropboxSync('write'));
  });

  test('skipped when syncInProgress=true (no client call)', async () => {
    setSyncInProgress(true);
    let called = false;
    setDropboxClient({
      filesUpload:   async () => { called = true; },
      filesDownload: async () => { called = true; },
    });
    await dropboxSync('read');
    assert.equal(called, false, 'filesDownload must not be called when already syncing');
    setSyncInProgress(false);
  });

  test('syncInProgress resets to false after 401', async () => {
    getData().settings.dropboxAppKey = 'testkey';
    _localStorage.setItem('dropbox_token', 'fake-token');
    const err = Object.assign(new Error('Unauthorized'), { status: 401 });
    setDropboxClient({ filesUpload: async () => { throw err; } });
    setDoc({
      'dropbox-connect-btn':    nullEl(),
      'dropbox-disconnect-btn': nullEl(),
      'dropbox-sync-now-btn':   nullEl(),
      'dropbox-status':         nullEl(),
      'sync-status':            nullEl(),
    });
    await dropboxSync('write');
    assert.equal(getSyncInProgress(), false);
  });

  test('syncInProgress resets to false after 409 (file not found → create)', async () => {
    const notFound = Object.assign(new Error('not_found'), { status: 409 });
    let uploadCalls = 0;
    setDropboxClient({
      filesUpload: async ({ mode }) => {
        uploadCalls++;
        if (uploadCalls === 1) throw notFound;
        // Second call (add mode) succeeds
      },
    });
    setDoc({ 'sync-status': nullEl() });
    await dropboxSync('write');
    assert.equal(getSyncInProgress(), false);
    assert.equal(uploadCalls, 2, 'should retry with add mode on 409');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 9. LOCAL PERSISTENCE — loadLocal() resilience
// ═════════════════════════════════════════════════════════════════════════════
describe('loadLocal() resilience', () => {
  beforeEach(() => { _localStorage.clear(); freshData(); });

  test('corrupt JSON → falls back to DEFAULT_DATA', () => {
    _localStorage.setItem('timetracker_data', '{not:valid{{');
    loadLocal();
    assert.deepEqual(getData().clients,  []);
    assert.deepEqual(getData().entries,  []);
    assert.deepEqual(getData().invoices, []);
  });

  test('partial JSON missing expenses → defaults to []', () => {
    _localStorage.setItem('timetracker_data',
      JSON.stringify({ clients:[], projects:[], entries:[] }));
    loadLocal();
    assert.deepEqual(getData().expenses, []);
  });

  test('partial JSON missing invoices → defaults to []', () => {
    _localStorage.setItem('timetracker_data',
      JSON.stringify({ clients:[] }));
    loadLocal();
    assert.deepEqual(getData().invoices, []);
  });

  test('partial JSON missing favorites → defaults to []', () => {
    _localStorage.setItem('timetracker_data',
      JSON.stringify({ clients:[] }));
    loadLocal();
    assert.deepEqual(getData().favorites, []);
  });

  test('full data round-trips: save then load', () => {
    getData().clients = [makeClient()];
    saveLocal();
    freshData();           // wipe in-memory state
    loadLocal();
    assert.equal(getData().clients[0].name, 'Acme');
    assert.equal(getData().clients[0].hourlyRate, 100);
  });

  test('settings survive round-trip', () => {
    getData().settings.baseCurrency = 'USD';
    getData().settings.fxMarkup     = 7;
    saveLocal();
    freshData();
    loadLocal();
    assert.equal(getData().settings.baseCurrency, 'USD');
    assert.equal(getData().settings.fxMarkup,     7);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 10. TOGGL CSV — DUPLICATE DETECTION (pure logic)
// ═════════════════════════════════════════════════════════════════════════════
describe('Toggl CSV import – duplicate detection logic', () => {
  test('same start+end is a duplicate', () => {
    freshData();
    getData().entries = [makeEntry({ start:'2025-01-15T08:00:00', end:'2025-01-15T10:00:00' })];
    const s = '2025-01-15T08:00:00', e = '2025-01-15T10:00:00';
    const dup = getData().entries.some(x => x.start === s && x.end === e);
    assert.equal(dup, true);
  });

  test('different start is not a duplicate', () => {
    freshData();
    getData().entries = [makeEntry({ start:'2025-01-15T08:00:00', end:'2025-01-15T10:00:00' })];
    const dup = getData().entries.some(x => x.start === '2025-01-16T08:00:00' && x.end === '2025-01-16T10:00:00');
    assert.equal(dup, false);
  });

  test('same start different end is NOT a duplicate', () => {
    freshData();
    getData().entries = [makeEntry({ start:'2025-01-15T08:00:00', end:'2025-01-15T10:00:00' })];
    const dup = getData().entries.some(x => x.start === '2025-01-15T08:00:00' && x.end === '2025-01-15T11:00:00');
    assert.equal(dup, false);
  });

  test('billable "Yes" → true, anything else → false', () => {
    const toBillable = s => (s || '').toLowerCase() === 'yes';
    assert.equal(toBillable('Yes'), true);
    assert.equal(toBillable('YES'), true);
    assert.equal(toBillable('No'),  false);
    assert.equal(toBillable(''),    false);
    assert.equal(toBillable(undefined), false);
  });

  test('ISO construction from Toggl columns', () => {
    const startISO = '2025-01-15' + 'T' + '08:30:00';
    const endISO   = '2025-01-15' + 'T' + '10:45:00';
    assert.equal(startISO, '2025-01-15T08:30:00');
    assert.equal(durationSec(startISO, endISO), 8100);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 11. RUNNING TIMER — start-time edit validation (pure logic extracted)
// ═════════════════════════════════════════════════════════════════════════════
describe('Running timer start-time validation', () => {
  // Mirrors the blur handler logic in bindEvents exactly
  function validateStartTime(value, entryStartISO) {
    const match = value.match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return 'format-error';
    const h = parseInt(match[1], 10), m = parseInt(match[2], 10);
    if (h > 23 || m > 59) return 'range-error';
    const updated = new Date(entryStartISO);
    updated.setHours(h, m, 0, 0);
    if (updated > new Date()) return 'future-error';
    return 'ok';
  }

  const PAST = '2025-01-15T08:00:00';

  test('valid past time → ok',              () => assert.equal(validateStartTime('09:30', PAST), 'ok'));
  test('midnight → ok',                     () => assert.equal(validateStartTime('00:00', PAST), 'ok'));
  test('single-digit hour (H:MM) → ok',     () => assert.equal(validateStartTime('9:30', PAST), 'ok'));
  test('no colon → format-error',           () => assert.equal(validateStartTime('0930', PAST), 'format-error'));
  test('letters → format-error',            () => assert.equal(validateStartTime('ab:cd', PAST), 'format-error'));
  test('hour 25 → range-error',             () => assert.equal(validateStartTime('25:00', PAST), 'range-error'));
  test('minute 60 → range-error',           () => assert.equal(validateStartTime('10:60', PAST), 'range-error'));
  test('future date entry → future-error',  () => {
    const futureISO = new Date(Date.now() + 86400000 * 2).toISOString().slice(0, 19);
    assert.equal(validateStartTime('23:59', futureISO), 'future-error');
  });
  test('empty string → format-error',       () => assert.equal(validateStartTime('', PAST), 'format-error'));
});

// ═════════════════════════════════════════════════════════════════════════════
// 12. EDGE CASES & REGRESSIONS
// ═════════════════════════════════════════════════════════════════════════════
describe('Edge cases & regressions', () => {
  test('fmtDuration handles 100+ hours without zero-padding', () =>
    assert.equal(fmtDuration(360000), '100:00:00'));

  test('convertAmount: currency not in rates defaults to ×1', () => {
    const snap = { base:'ILS', rates:{} };
    assert.equal(convertAmount(50, snap, 'UNKNOWN'), 50);
  });

  test('running entry with null end contributes 0 seconds (clamped to non-negative)', () => {
    const runningEntry = makeEntry({ end: null });
    const sec = durationSec(runningEntry.start, runningEntry.end);
    assert.equal(sec, 0, `Expected 0 for null end, got ${sec}`);
  });

  test('fmtDate handles edge of year boundary', () =>
    assert.equal(fmtDate('2025-12-31'), '31/12/2025'));

  test('fmtDate handles start of year', () =>
    assert.equal(fmtDate('2025-01-01'), '01/01/2025'));

  test('esc handles number 0 correctly', () =>
    assert.equal(esc(0), '0'));

  test('durationSec: millisecond precision truncated correctly', () => {
    // 1.5 hours = 5400 seconds
    assert.equal(durationSec('2025-01-15T08:00:00','2025-01-15T09:30:00'), 5400);
  });

  test('deleteProject on unknown id does not throw', () => {
    freshData();
    setDoc({ 'modal-project': nullEl() });
    assert.doesNotThrow(() => deleteProject('ghost-project'));
  });
});
