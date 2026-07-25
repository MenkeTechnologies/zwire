// Settings page render smoke (pages/settings.js + pages/cleardata.js). The HUD
// shadows chrome://settings, so a render bug here means the browser has NO
// settings UI at all — which is exactly how "no way to clear browsing data"
// happened. Drives the real IIFEs against a DOM + chrome + ZGui shim and asserts
// every section builds, the clear-data wizard mounts inside Privacy, and the
// chrome://settings/clearBrowserData deep-link lands on it.
import fs from 'node:fs';
import assert from 'node:assert/strict';

function makeEl(tag) {
  return {
    tagName: (tag || 'div').toUpperCase(), className: '', _text: '', _html: '',
    style: { cssText: '', display: '', setProperty() {} },
    children: [], attrs: {}, title: '', _on: {},
    set textContent(v) { this._text = v == null ? '' : String(v); },
    get textContent() { return this._text; },
    set innerHTML(v) { this._html = v == null ? '' : String(v); if (this._html === '') this.children = []; },
    get innerHTML() { return this._html; },
    appendChild(c) { this.children.push(c); return c; },
    setAttribute(k, v) { this.attrs[k] = v; },
    getAttribute(k) { return this.attrs[k]; },
    addEventListener(t, fn) { (this._on[t] = this._on[t] || []).push(fn); },
    removeEventListener() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    scrollIntoView() {},
  };
}
function walk(node, out = []) { out.push(node); (node.children || []).forEach((c) => walk(c, out)); return out; }

function boot(search) {
  const body = makeEl('div');
  globalThis.document = {
    readyState: 'complete',
    createElement: (t) => makeEl(t),
    createTextNode: (t) => ({ textContent: t }),
    documentElement: makeEl('html'),
    head: makeEl('head'),
    body,
    addEventListener() {}, removeEventListener() {},
  };
  globalThis.location = { search: search || '' };
  globalThis.requestAnimationFrame = (fn) => { fn(); return 0; };

  const PREFS = [
    { key: 'safebrowsing.enabled', type: 'BOOLEAN', value: true },
    { key: 'download.default_directory', type: 'STRING', value: '/tmp' },
    { key: 'intl.accept_languages', type: 'STRING', value: 'en-US' },
    { key: 'autofill.profile_enabled', type: 'BOOLEAN', value: true },
    { key: 'some.future.pref', type: 'NUMBER', value: 3 }
  ];
  globalThis.chrome = {
    runtime: { lastError: null, getURL: (p) => 'chrome-extension://x/' + p },
    settingsPrivate: { getAllPrefs: (cb) => cb(PREFS), setPref() {} },
    storage: { local: { get(_k, cb) { if (cb) cb({}); }, set() {} }, onChanged: { addListener() {} } },
    browsingData: { settings(cb) { cb({ dataToRemove: { cache: true }, dataRemovalPermitted: { history: false } }); }, remove() {} }
  };

  // prefsShell stub: records the section items and renders one pane on demand,
  // which is all settings.js asks of it.
  const shellState = { items: [], selected: null, panes: {} };
  function prefsShell(host, opts) {
    shellState.items = opts.items || [];
    const api = {
      el: makeEl('div'),
      select(id) {
        const it = shellState.items.filter((x) => x.id === id)[0] || shellState.items[0];
        if (!it) return;
        shellState.selected = it.id;
        const pane = makeEl('div');
        shellState.panes[it.id] = pane;
        it.render(pane);
      },
      pane: () => makeEl('div'),
      nav: () => makeEl('div'),
      setItems(next) { shellState.items = next || []; api.select(shellState.selected); }
    };
    host.appendChild(api.el);
    api.select(opts.active);
    return api;
  }
  prefsShell.paneHead = (icon, title, desc) => { const e = makeEl('div'); e.textContent = [icon, title, desc].filter(Boolean).join(' '); return e; };
  prefsShell.section = (label) => { const e = makeEl('div'); e.textContent = label; return e; };

  const wizards = [];
  const win = {
    ZBHUD: { mount: (o) => { win._mountOpts = o; return { body }; }, publishUi() {} },
    ZGui: {
      fzf: { fzfMatch: (q, s) => String(s).toLowerCase().includes(String(q).toLowerCase()) },
      prefsShell,
      card: ({ body: b }) => { const e = makeEl('div'); e.appendChild(b); return { el: e }; },
      field: ({ label, control, help }) => { const e = makeEl('div'); e.textContent = label + ' ' + help; e.appendChild(control); return { el: e }; },
      toggle: ({ checked, onChange }) => ({ el: makeEl('input'), input: null, get: () => checked, set() {}, onChange }),
      select: () => ({ el: makeEl('select') }),
      textfield: () => ({ el: makeEl('input') }),
      textarea: () => ({ el: makeEl('textarea') }),
      radio: (host, opts) => { host.appendChild(makeEl('div')); return { el: host, get: () => opts.value, set() {} }; },
      alert: ({ text }) => { const e = makeEl('div'); e.textContent = text; return { el: e }; },
      result: (_h, o) => { const e = makeEl('div'); e.textContent = o.title; return { el: e }; },
      wizard: (host, opts) => { const w = { host, opts, cur: 0, goTo(i) { w.cur = i; }, current: () => w.cur }; wizards.push(w); return w; },
      toast: { show() {} }
    }
  };
  globalThis.window = win;
  // The page runs with ZGui/ZBHUD as page globals (script tags), not as window
  // properties only — mirror that so the module resolves them the same way.
  globalThis.ZGui = win.ZGui;
  globalThis.ZBHUD = win.ZBHUD;

  for (const f of ['../pages/cleardata.js', '../pages/settings.js']) {
    const src = fs.readFileSync(new URL(f, import.meta.url), 'utf8');
    assert.doesNotThrow(() => { new Function('window', src)(win); }, `${f} threw on load`);
  }
  return { win, body, shellState, wizards };
}

// --- every section renders ---------------------------------------------------
{
  const { win, shellState } = boot('');
  const ids = shellState.items.map((i) => i.id);
  assert.deepEqual(ids, win.ZBSettings.SECTIONS.map((s) => s.id), 'rail lists every section in order');
  assert.equal(shellState.selected, 'appearance', 'defaults to the first section');
  for (const it of shellState.items) {
    const pane = makeEl('div');
    assert.doesNotThrow(() => it.render(pane), `section ${it.id} threw while rendering`);
    assert.ok(pane.children.length > 0, `section ${it.id} rendered nothing`);
  }
  // Prefs are routed, not dumped: the download pref shows up under Downloads.
  const dl = makeEl('div');
  shellState.items.filter((i) => i.id === 'downloads')[0].render(dl);
  assert.ok(walk(dl).some((n) => (n.textContent || '').includes('download.default_directory')));
  assert.ok(!walk(dl).some((n) => (n.textContent || '').includes('safebrowsing.enabled')), 'a privacy pref must not leak into Downloads');
  // An unrecognized pref is still reachable — in Advanced.
  const adv = makeEl('div');
  shellState.items.filter((i) => i.id === 'advanced')[0].render(adv);
  assert.ok(walk(adv).some((n) => (n.textContent || '').includes('some.future.pref')), 'unknown prefs land in Advanced');
}

// --- the clear-data wizard mounts inside Privacy ------------------------------
{
  const { shellState, wizards } = boot('');
  const pane = makeEl('div');
  shellState.items.filter((i) => i.id === 'privacy')[0].render(pane);
  assert.ok(walk(pane).some((n) => n.attrs['data-cleardata'] === '1'), 'Privacy hosts the clear-data card');
  const wiz = wizards[wizards.length - 1];
  assert.ok(wiz, 'the wizard was constructed');
  assert.deepEqual(wiz.opts.steps.map((s) => s.title), ['Time range', 'Data types', 'Scope', 'Review']);
  // Each step must render standalone — a throw here is a blank wizard.
  for (const step of wiz.opts.steps) {
    const b = makeEl('div');
    assert.doesNotThrow(() => step.render(b), `wizard step "${step.title}" threw`);
    assert.ok(b.children.length > 0, `wizard step "${step.title}" rendered nothing`);
  }
  // The review step must show the actual API payload, and policy-blocked types
  // (dataRemovalPermitted.history === false) must be reported, not silently kept.
  const review = makeEl('div');
  wiz.opts.steps[3].render(review);
  assert.ok(walk(review).some((n) => (n.textContent || '').includes('"since"')), 'review shows the RemovalOptions');
  const types = makeEl('div');
  wiz.opts.steps[1].render(types);
  assert.ok(walk(types).some((n) => /blocked by policy/i.test(n.textContent || '')), 'policy-blocked types are called out');
}

// --- chrome://settings/clearBrowserData lands on Privacy ----------------------
{
  const { shellState } = boot('?section=clearBrowserData');
  assert.equal(shellState.selected, 'privacy', 'the clear-data deep-link selects Privacy');
}
{
  const { shellState } = boot('?section=performance');
  assert.equal(shellState.selected, 'performance');
}

// --- filtering searches every section at once ---------------------------------
{
  const { win, shellState } = boot('');
  win._mountOpts.onFilter('language', false);
  assert.deepEqual(shellState.items.map((i) => i.id), ['__search'], 'filtering swaps the rail for one results item');
  const pane = makeEl('div');
  shellState.items[0].render(pane);
  assert.ok(walk(pane).some((n) => (n.textContent || '').includes('intl.accept_languages')), 'the match is listed');
  win._mountOpts.onFilter('', false);
  assert.ok(shellState.items.length > 1, 'clearing the filter restores the section rail');
}

console.log('settings render smoke: passed');
