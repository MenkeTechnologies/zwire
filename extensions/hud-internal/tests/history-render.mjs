// History page render smoke test. Drives the full IIFE (mount -> loadMonth ->
// render -> buildBar/Calendar/Entries/Rail) against a minimal DOM + chrome.history
// + ZGui shim, asserting the page builds a non-trivial tree without throwing.
// Catches wiring bugs (bad element API use, undefined helpers) that the pure
// aggregation test can't. No jsdom — a tiny hand-rolled element shim.
import fs from 'node:fs';
import assert from 'node:assert/strict';

function makeEl(tag) {
  return {
    tagName: (tag || 'div').toUpperCase(), className: '', _text: '', _html: '',
    style: { cssText: '', _p: {}, setProperty() {} },
    children: [], attrs: {}, title: '',
    set textContent(v) { this._text = v == null ? '' : String(v); },
    get textContent() { return this._text; },
    set innerHTML(v) { this._html = v == null ? '' : String(v); if (this._html === '') this.children = []; },
    get innerHTML() { return this._html; },
    appendChild(c) { this.children.push(c); return c; },
    removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); return c; },
    get firstChild() { return this.children[0] || null; },
    setAttribute(k, v) { this.attrs[k] = v; },
    addEventListener() {}, removeEventListener() {},
    querySelector() { return null; },
  };
}

const body = makeEl('div');
globalThis.document = {
  createElement: (t) => makeEl(t),
  createElementNS: (_ns, t) => makeEl(t),
  createTextNode: (t) => ({ textContent: t }),
  documentElement: makeEl('html'),
  body,
};
globalThis.getComputedStyle = () => ({ getPropertyValue: () => '' });
globalThis.setTimeout = (fn) => { try { fn(); } catch (e) {} return 0; };

// Synchronous chrome.history: two URLs, each with a couple of visits this month.
const now = Date.now();
globalThis.chrome = {
  runtime: { lastError: null },
  tabs: { create() {} },
  history: {
    search(_q, cb) { cb([{ url: 'https://github.com/x', title: 'X' }, { url: 'https://news.ycombinator.com/', title: 'HN' }]); },
    getVisits(q, cb) { cb([{ visitTime: now - 3600e3, transition: 'typed' }, { visitTime: now - 1800e3, transition: 'link' }]); },
    onVisitRemoved: { addListener() {} },
  },
};

const win = {
  ZBHUD: { mount: () => ({ body }) },
  ZGui: {
    donut: () => ({ el: makeEl('div'), set() {} }),
    chart: () => {},
  },
};
globalThis.window = win;

const src = fs.readFileSync(new URL('../pages/history.js', import.meta.url), 'utf8');
assert.doesNotThrow(() => { new Function('window', src)(win); }, 'history page threw during mount/render');

// After a synchronous load the body should carry the toolbar + the calendar wrap.
assert.ok(body.children.length >= 2, 'render produced a toolbar + content wrap');
assert.ok(win.ZBHistory, 'helpers still exposed');

console.log('history render smoke: passed');
