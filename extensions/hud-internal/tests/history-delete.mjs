// History deletion wiring (pages/history.js). The page shadows chrome://history,
// so deleting a single entry or a day's worth of visits only works if THIS page
// calls the right history.* method with the right window — a wrong range here
// silently destroys more history than the user asked for.
//
// Drives the real IIFE against a DOM shim that records click handlers, then
// clicks the row ✕ and the header delete button and asserts the exact API calls.
import fs from 'node:fs';
import assert from 'node:assert/strict';

const SRC = fs.readFileSync(new URL('../pages/history.js', import.meta.url), 'utf8');

function makeEl(tag) {
  return {
    tagName: (tag || 'div').toUpperCase(), className: '', _text: '', _html: '',
    style: { cssText: '', _p: {}, setProperty() {} },
    children: [], attrs: {}, title: '', _on: {},
    set textContent(v) { this._text = v == null ? '' : String(v); },
    get textContent() { return this._text; },
    set innerHTML(v) { this._html = v == null ? '' : String(v); if (this._html === '') this.children = []; },
    get innerHTML() { return this._html; },
    appendChild(c) { this.children.push(c); return c; },
    removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); return c; },
    get firstChild() { return this.children[0] || null; },
    setAttribute(k, v) { this.attrs[k] = v; },
    addEventListener(type, fn) { (this._on[type] = this._on[type] || []).push(fn); },
    removeEventListener() {},
    querySelector() { return null; },
    click() { (this._on.click || []).forEach((fn) => fn({ stopPropagation() {} })); },
  };
}
function walk(node, out = []) { out.push(node); (node.children || []).forEach((c) => walk(c, out)); return out; }
const byClass = (root, cls) => walk(root).filter((n) => (n.className || '').split(/\s+/).includes(cls));
const byText = (root, s) => walk(root).filter((n) => n.textContent === s);

// One page load = one fresh IIFE. `extraZGui` lets a run supply widgets (e.g.
// popconfirm) the previous run deliberately lacked.
function loadPage(extraZGui) {
  const body = makeEl('div');
  const calls = [];
  const now = Date.now();
  globalThis.document = {
    createElement: (t) => makeEl(t),
    createElementNS: (_ns, t) => makeEl(t),
    createTextNode: (t) => ({ textContent: t }),
    documentElement: makeEl('html'),
    body,
    addEventListener() {}, removeEventListener() {},
  };
  globalThis.getComputedStyle = () => ({ getPropertyValue: () => '' });
  globalThis.setTimeout = (fn) => { try { fn(); } catch (e) {} return 0; };
  globalThis.chrome = {
    runtime: { lastError: null },
    tabs: { create() {} },
    history: {
      search(_q, cb) { cb([{ url: 'https://github.com/x', title: 'X', lastVisitTime: now, visitCount: 3 }]); },
      getVisits(_q, cb) { cb([{ visitTime: now - 3600e3, transition: 'typed' }]); },
      deleteUrl(details, cb) { calls.push(['deleteUrl', details]); if (cb) cb(); },
      deleteRange(range, cb) { calls.push(['deleteRange', range]); if (cb) cb(); },
      deleteAll(cb) { calls.push(['deleteAll', null]); if (cb) cb(); },
      onVisitRemoved: { addListener() {} },
    },
  };
  const win = {
    ZBHUD: { mount: () => ({ body }) },
    ZGui: Object.assign({ donut: () => ({ el: makeEl('div'), set() {} }), chart: () => {} }, extraZGui || {}),
  };
  globalThis.window = win;
  new Function('window', SRC)(win);
  return { body, calls, now };
}

// --- row ✕ deletes exactly that URL -----------------------------------------
{
  const { body, calls } = loadPage();
  const dels = byClass(body, 'zh-del');
  assert.ok(dels.length >= 1, 'list rows expose a delete button');
  dels[0].click();
  assert.deepEqual(calls, [['deleteUrl', { url: 'https://github.com/x' }]]);
}

// --- list view (all time) clears everything, not a range ---------------------
{
  const { body, calls } = loadPage();
  const btn = byClass(body, 'zh-del-range')[0];
  assert.ok(btn, 'entries header exposes a range-delete button');
  assert.equal(btn.textContent, 'Delete all', 'the all-time list view offers a full clear');
  btn.click();
  assert.deepEqual(calls, [['deleteAll', null]]);
}

// --- Day view deletes exactly the selected calendar day ----------------------
{
  const { body, calls } = loadPage();
  byText(body, 'Day')[0].click();                       // toolbar view switch -> re-render
  const btn = byClass(body, 'zh-del-range')[0];
  assert.equal(btn.textContent, 'Delete range', 'a scoped view offers a range delete');
  btn.click();
  assert.equal(calls.length, 1);
  const [name, range] = calls[0];
  assert.equal(name, 'deleteRange');
  const start = new Date(range.startTime), end = new Date(range.endTime);
  assert.equal(start.getHours() + start.getMinutes() + start.getSeconds(), 0, 'range starts at midnight');
  assert.equal(end - start, 24 * 3600e3, 'day range is exactly 24h');
  const today = new Date(); today.setHours(0, 0, 0, 0);
  assert.equal(range.startTime, today.getTime(), 'defaults to the selected (today) day');
}

// --- Week view deletes the Sun→Sun week ---------------------------------------
{
  const { body, calls } = loadPage();
  byText(body, 'Week')[0].click();
  byClass(body, 'zh-del-range')[0].click();
  const [name, range] = calls[0];
  assert.equal(name, 'deleteRange');
  assert.equal(new Date(range.startTime).getDay(), 0, 'week starts on Sunday');
  assert.equal(range.endTime - range.startTime, 7 * 24 * 3600e3, 'week range is exactly 7 days');
}

// --- the destructive button goes through popconfirm when it is available -----
{
  let seen = null;
  const { body, calls } = loadPage({ popconfirm: (_trigger, opts) => { seen = opts; return { open() {}, close() {} }; } });
  byClass(body, 'zh-del-range')[0].click();
  assert.deepEqual(calls, [], 'clicking must not delete while a confirmation is pending');
  assert.ok(seen && /entire browsing history/i.test(seen.title), 'popconfirm names what is being deleted');
  assert.equal(seen.danger, true);
  seen.onConfirm();
  assert.deepEqual(calls, [['deleteAll', null]], 'confirming runs the delete');
}

console.log('history delete wiring: passed');
