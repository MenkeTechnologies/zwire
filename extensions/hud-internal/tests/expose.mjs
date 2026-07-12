// Window/tab exposé test (zexpose.js). Part 1 covers the pure tab->tile model
// (window.__zbTabTiles): one tile per tab, page excerpt as preview, host + window
// in the meta, url fallback. Part 2 drives __zbExposeOpen() against a DOM + chrome
// + ZGui.expose shim: it must read zb_tabs + zb_tab_previews, ask the worker to
// capture excerpts, mount a grid, and route a pick to activate that tab.
import fs from 'node:fs';
import assert from 'node:assert/strict';

const src = fs.readFileSync(new URL('../zexpose.js', import.meta.url), 'utf8');

// ---- part 1: pure tile model ----
{
  const win = {};
  new Function('window', src)(win);
  const tabTiles = win.__zbTabTiles;
  assert.ok(tabTiles, '__zbTabTiles not exposed');

  const tabs = [
    { id: 1, title: 'A', url: 'https://github.com/x', windowId: 100, active: false, pinned: true },
    { id: 2, title: 'B', url: 'https://www.wikipedia.org/', windowId: 100, active: true },
    { id: 3, title: 'C', url: 'https://news.ycombinator.com/', windowId: 200, active: true },
  ];
  const tiles = tabTiles(tabs, { 1: 'the readme text', 2: 'an encyclopedia' });
  assert.equal(tiles.length, 3, 'one tile per tab');
  assert.equal(tiles[0].title, '⚲ A', 'pinned tab marked');
  assert.equal(tiles[1].focused, true, 'active tab is focused');
  assert.equal(tiles[0].preview, 'the readme text', 'page excerpt is the tile preview');
  assert.equal(tiles[2].preview, 'https://news.ycombinator.com/', 'url fallback when no excerpt');
  assert.match(tiles[0].meta, /github\.com/, 'host in meta (www stripped)');
  assert.match(tiles[0].meta, /window 1/, 'window label when multiple windows');
  assert.match(tiles[2].meta, /window 2/);
  assert.equal(tiles[0].tabId, 1, 'tabId carried for focus');

  const single = tabTiles([{ id: 5, title: 'S', url: 'https://x.io/', windowId: 9, active: true }], {});
  assert.ok(single[0].meta.indexOf('window') < 0, 'single window omits the window label');
  assert.equal(tabTiles([]).length, 0);
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

  const zbTabs = [
    { id: 70, title: 'T', url: 'https://a.com', windowId: 7, active: true },
    { id: 71, title: 'U', url: 'https://b.com', windowId: 7, active: false },
  ];
  const previews = { 70: 'excerpt of A' };
  const sentCmds = [];
  let storageSub = null;
  globalThis.chrome = {
    runtime: { lastError: null, getURL: (p) => 'chrome-extension://x/' + p },
    storage: {
      local: { get: (_k, cb) => cb({ zb_tabs: zbTabs, zb_tab_previews: previews, zb_scheme: 'cyberpunk' }), set: (o) => { if (o && o.zb_cmd) sentCmds.push(o.zb_cmd); } },
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
  assert.ok(lastSet && lastSet.length === 2, 'grid filled with one tile per tab from zb_tabs');
  assert.equal(lastSet[0].preview, 'excerpt of A', 'tab excerpt shown as preview');
  assert.ok(sentCmds.some((c) => c.a === 'ping'), 'pinged worker to refresh tabs');
  assert.ok(sentCmds.some((c) => c.a === 'exposeCapture'), 'asked worker to capture page excerpts');
  assert.ok(bodyEl.children.length >= 1, 'overlay mounted to body');
  assert.ok(storageSub, 'live-refresh subscribes to storage.onChanged');
  // a live zb_tab_previews write rebuilds tiles in place.
  lastSet = null;
  storageSub({ zb_tab_previews: { newValue: previews } }, 'local');
  assert.ok(lastSet && lastSet.length === 2, 'a live preview write rebuilds + patches the grid');

  // picking a tab activates it (+ focuses its window) and closes.
  exposeOpts.onChoose(70);
  assert.equal(sentCmds[sentCmds.length - 1].a, 'activate', 'onChoose activates the picked tab');
  assert.equal(sentCmds[sentCmds.length - 1].tabId, 70);
  assert.ok(removed.length >= 1, 'overlay removed on choose');
}

console.log('tab exposé model + render smoke: passed');
