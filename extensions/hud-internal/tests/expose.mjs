// Window/tab exposé test (zexpose.js). Part 1 covers the pure window->tile model
// (window.__zbExposeModel); part 2 drives __zbExposeOpen() against a DOM + chrome
// + ZGui.expose shim, asserting it maps windows, mounts an overlay, and routes a
// pick to the focusWindow bus. No jsdom — a tiny element shim.
import fs from 'node:fs';
import assert from 'node:assert/strict';

const src = fs.readFileSync(new URL('../zexpose.js', import.meta.url), 'utf8');

// ---- part 1: pure model (loads headless: no chrome -> helpers only) ----
{
  const win = {};
  new Function('window', src)(win);
  const model = win.__zbExposeModel;
  assert.ok(model, '__zbExposeModel not exposed');

  const tiles = model([
    { id: 11, focused: true, incognito: false, state: 'normal', tabs: [
      { id: 1, title: 'A', active: false, pinned: true }, { id: 2, title: 'B', active: true, pinned: false }] },
    { id: 12, focused: false, incognito: true, state: 'minimized', tabs: [{ id: 3, title: 'C', active: true }] },
  ]);
  assert.equal(tiles.length, 2);
  assert.equal(tiles[0].id, 11);
  assert.equal(tiles[0].title, 'B', 'tile title = active tab title');
  assert.equal(tiles[0].tabId, 2, 'tabId = active tab id');
  assert.equal(tiles[0].focused, true);
  assert.equal(tiles[0].meta, '2 tabs', 'two tabs, non-incognito, normal state');
  assert.match(tiles[0].preview, /▸ B/, 'active tab marked with ▸');
  assert.match(tiles[0].preview, /⚲ A/, 'pinned tab marked');
  assert.equal(tiles[1].meta, '1 tab · incognito · minimized', 'incognito + state in meta');
  assert.equal(model([]).length, 0);

  // windowsFromTabs: reconstruct windows from the flat zb_tabs list by windowId.
  const wft = win.__zbWindowsFromTabs;
  assert.ok(wft, '__zbWindowsFromTabs not exposed');
  const wins = wft([
    { id: 1, title: 'A', url: 'a', windowId: 100, active: false },
    { id: 2, title: 'B', url: 'b', windowId: 100, active: true },
    { id: 3, title: 'C', url: 'c', windowId: 200, active: true },
  ]);
  assert.equal(wins.length, 2, 'two windows grouped from three tabs');
  assert.equal(wins[0].id, 100);
  assert.equal(wins[0].tabs.length, 2);
  assert.equal(wins[1].id, 200);
  // and it round-trips through exposeModel into real tiles.
  const t2 = model(wft([{ id: 9, title: 'Solo', windowId: 5, active: true }]));
  assert.equal(t2.length, 1);
  assert.equal(t2[0].title, 'Solo');
  assert.equal(wft([]).length, 0);
}

// ---- part 2: render smoke ----
{
  function makeEl(tag) {
    const e = { tagName: (tag || 'div').toUpperCase(), id: '', className: '', rel: '', href: '', _text: '',
      style: { cssText: '' }, children: [], attrs: {},
      set textContent(v) { this._text = v == null ? '' : String(v); }, get textContent() { return this._text; },
      set innerHTML(v) { this._html = v; }, get innerHTML() { return this._html || ''; },
      appendChild(c) { this.children.push(c); return c; }, removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); },
      remove() { removed.push(this); }, setAttribute(k, v) { this.attrs[k] = v; }, addEventListener() {}, append() {} };
    return e;
  }
  const removed = [];
  const bodyEl = makeEl('div');
  globalThis.document = { createElement: (t) => makeEl(t), getElementById: () => null, documentElement: makeEl('html'), head: makeEl('head'), body: bodyEl, addEventListener() {} };

  // Real-world path: zb_windows EMPTY (getAll gave nothing on this build), so the
  // exposé must fall back to grouping the reliable zb_tabs list.
  const zbTabs = [
    { id: 70, title: 'T', url: 'u1', windowId: 7, active: true },
    { id: 71, title: 'U', url: 'u2', windowId: 7, active: false },
    { id: 90, title: 'V', url: 'u3', windowId: 9, active: true },
  ];
  let sentZbCmd = null, storageSub = null;
  globalThis.chrome = {
    runtime: { lastError: null, getURL: (p) => 'chrome-extension://x/' + p },
    storage: {
      local: { get: (_k, cb) => cb({ zb_windows: [], zb_tabs: zbTabs, zb_scheme: 'cyberpunk' }), set: (o) => { if (o && o.zb_cmd) sentZbCmd = o.zb_cmd; } },
      onChanged: { addListener: (fn) => { storageSub = fn; }, removeListener: () => { storageSub = null; } },
    },
  };
  let exposeOpts = null, lastSet = null;
  const win = { ZWIRE_HUD: { SCHEMES: { cyberpunk: { vars: {} } }, VAR_KEYS: [] },
    ZGui: { expose: (host, opts) => { exposeOpts = opts; return { el: makeEl('div'), set: (w) => { lastSet = w; } }; } } };
  globalThis.window = win;

  new Function('window', src)(win);
  assert.equal(typeof win.__zbExposeOpen, 'function', '__zbExposeOpen defined');
  win.__zbExposeOpen();
  assert.ok(exposeOpts, 'ZGui.expose was called (overlay mounted)');
  assert.ok(lastSet && lastSet.length === 2, 'exposé filled from zb_tabs fallback (two windows)');
  assert.equal(lastSet[0].title, 'T', 'window 7 active tab title');
  assert.ok(bodyEl.children.length >= 1, 'overlay mounted to body');
  assert.ok(storageSub, 'live-refresh subscribes to storage.onChanged');
  // a live zb_tabs write patches the exposé in place.
  storageSub({ zb_tabs: { newValue: [{ id: 70, title: 'T', windowId: 7, active: true }] } }, 'local');
  assert.equal(lastSet.length, 1, 'a live zb_tabs write rebuilds + patches the exposé');

  // picking a window routes to the focusWindow bus and closes.
  exposeOpts.onChoose(7);
  assert.ok(sentZbCmd && sentZbCmd.a === 'focusWindow' && sentZbCmd.windowId === 7, 'onChoose writes focusWindow to zb_cmd');
  assert.ok(removed.length >= 1, 'overlay removed on choose');
}

console.log('exposé model + render smoke: passed');
