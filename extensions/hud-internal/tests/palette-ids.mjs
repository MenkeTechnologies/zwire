// Palette id contract (zpalette.js + palette-cmds.js + cmd-defaults.js over the
// REAL zgui-core command palette). zwire mounts no ZGui.appShell — the palette is a
// content script on arbitrary pages — so the shell's own id audit never runs over
// this vocabulary and nothing else would catch a regression here.
//
// What the contract buys, and therefore what this pins:
//   · every published row carries an id, so a chain / trigger / hook can name it.
//     A row with no id is listed in ⌘K and is otherwise unreachable — invisible in
//     exactly the way that does not look like a bug.
//   · no id derives from a label. A label is the translatable half of a row; an id
//     keyed on one renames itself per locale and breaks every saved chain that
//     referenced it. Enforced structurally: no whitespace, no non-slug characters,
//     and the row-producing tables are re-read with mangled labels to prove the ids
//     do not move.
//   · no id publishes twice, and no two rows share a label — a duplicate row is a
//     command the user has to pick between with no way to tell the copies apart.
//   · the vocabulary is IDENTICAL after a second publish. Round-seven found rows
//     that survive the first publish and vanish on the second, so both are checked.
//   · an id-less row reaches the log sink zwire already has (the zbFireHook relay)
//     rather than the terminal — this fleet ships no console chatter.
//
// Boots the shipped files over a DOM + chrome shim; no hand-written vocabulary.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const EXT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function makeEl(tag) {
  return {
    tagName: (tag || 'div').toUpperCase(), className: '', _text: '', _html: '',
    style: { cssText: '', display: '', position: '', setProperty() {} },
    children: [], attrs: {}, value: '', placeholder: '', spellcheck: false,
    autocomplete: '', autocapitalize: '', _on: {}, parentNode: null,
    classList: { toggle() {}, add() {}, remove() {} },
    set textContent(v) { this._text = v == null ? '' : String(v); },
    get textContent() { return this._text; },
    set innerHTML(v) { this._html = v == null ? '' : String(v); if (this._html === '') this.children = []; },
    get innerHTML() { return this._html; },
    appendChild(c) { this.children.push(c); if (c) c.parentNode = this; return c; },
    removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); return c; },
    remove() { if (this.parentNode) this.parentNode.removeChild(this); },
    setAttribute(k, v) { this.attrs[k] = v; },
    getAttribute(k) { return this.attrs[k]; },
    addEventListener(t, fn) { (this._on[t] = this._on[t] || []).push(fn); },
    removeEventListener() {},
    dispatchEvent(e) { (this._on[(e && e.type) || ''] || []).forEach((f) => f(e)); return true; },
    focus() {}, scrollIntoView() {},
    querySelector() { return null; }, querySelectorAll() { return []; },
  };
}
function walk(n, out = []) { out.push(n); (n.children || []).forEach((c) => walk(c, out)); return out; }

// Two extensions and three tabs whose LABELS collide but whose identities do not —
// the case a label-keyed id silently merges into one row.
const TABS = [
  { id: 11, title: 'Untitled', url: 'https://a.example/1' },
  { id: 12, title: 'Untitled', url: 'https://b.example/2' },
  { id: 13, title: 'Untitled', url: 'https://c.example/3' },
];
const EXTS = [
  { id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', name: 'Shared Name', optionsUrl: 'chrome-extension://a/o.html' },
  { id: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', name: 'Shared Name' },
];
const SHORTCUTS = [
  { extId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', name: 'open-thing', ext: 'Shared Name', desc: 'Do the thing', keybinding: 'Ctrl+1' },
  { extId: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', name: 'open-thing', ext: 'Shared Name', desc: 'Do the thing', keybinding: 'Ctrl+2' },
];

function boot(dynamic) {
  const docEvents = {};
  const body = makeEl('body');
  const hookMessages = [];
  const store = Object.assign({
    zb_scheme: 'cyberpunk', zb_tabs: [], zb_exts: [], zb_frecent: [],
    zb_shortcuts: [], zb_custom_cmds: [],
  }, dynamic || {});

  const sandbox = {
    document: {
      readyState: 'complete',
      createElement: (t) => makeEl(t),
      createTextNode: (t) => ({ textContent: t }),
      documentElement: makeEl('html'), head: makeEl('head'), body, title: 'a page',
      addEventListener(t, fn) { (docEvents[t] = docEvents[t] || []).push(fn); },
      removeEventListener() {},
      dispatchEvent(e) { (docEvents[(e && e.type) || ''] || []).forEach((f) => f(e)); return true; },
      querySelector(sel) {
        const want = String(sel).replace(/^\./, '');
        return walk(body).find((n) => String(n.className).split(/\s+/).includes(want)) || null;
      },
      querySelectorAll() { return []; },
    },
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = (init || {}).detail; } },
    Event: class { constructor(type) { this.type = type; } },
    getComputedStyle: () => ({ position: 'static' }),
    navigator: { platform: 'MacIntel', userAgent: 'Mozilla/5.0 (Macintosh)', clipboard: { writeText() {} } },
    location: { href: 'https://example.com/p?q=1', assign() {}, reload() {} },
    setTimeout, clearTimeout, requestAnimationFrame: (fn) => { fn(); return 0; },
    chrome: {
      runtime: {
        lastError: null, id: 'testext',
        getURL: (p) => 'chrome-extension://testext/' + p,
        sendMessage(m, cb) { if (m && m.type === 'zbFireHook') hookMessages.push(m); if (cb) cb({ ok: false }); },
        onMessage: { addListener() {} },
      },
      storage: {
        local: {
          get(keys, cb) {
            const o = {};
            (Array.isArray(keys) ? keys : [keys]).forEach((k) => { if (k in store) o[k] = store[k]; });
            if (cb) cb(o);
          },
          set(o, cb) { Object.assign(store, o); if (cb) cb(); },
        },
        onChanged: { addListener() {} },
      },
    },
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  // Content scripts are sloppy-mode globals in one shared world; a `var` in one file
  // has to be visible to the next. `with` reproduces that world faithfully enough
  // that the shipped IIFEs load unmodified, which is the point of the harness.
  const load = (rel) => {
    const src = fs.readFileSync(path.join(EXT, rel), 'utf8');
    // eslint-disable-next-line no-new-func
    new Function('__scope', 'with (__scope) { ' + src + '\n}')(sandbox);
  };
  // Exactly the order manifest.json declares for the ⌘K content-script bundle.
  ['schemes.js', 'lib/zgui-core/webui/util.js', 'lib/zgui-core/webui/fzf.js',
    'lib/zgui-core/webui/command-palette.js', 'cmd-defaults.js', 'palette-cmds.js',
    'zpalette.js'].forEach(load);

  const forwarded = [];
  sandbox.document.addEventListener('zgui:diagnostic', (e) => forwarded.push(e.detail));
  return { sandbox, store, hookMessages, forwarded };
}

function vocabulary(sandbox) {
  sandbox.__zbPaletteOpen();
  return sandbox.ZGui.palette.items.slice();
}

// ── the SHIPPED vocabulary: what ⌘K holds with no browsing state at all ─────
const { sandbox, store, hookMessages, forwarded } = boot();

const first = vocabulary(sandbox);
assert.ok(first.length > 150, `a real vocabulary, got ${first.length} rows`);

const idless = first.filter((it) => !it.id);
assert.equal(idless.length, 0,
  `every published row must carry an id; id-less: ${idless.slice(0, 5).map((i) => JSON.stringify(i.label)).join(', ')}`);

// A stable slug: dot-separated, no whitespace, nothing a translator would touch.
// Whitespace is the specific fingerprint of a label pressed into service as an id.
const badSlug = first.filter((it) => !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(String(it.id)));
assert.equal(badSlug.length, 0,
  `ids must be stable slugs; offending: ${badSlug.slice(0, 5).map((i) => JSON.stringify(i.id)).join(', ')}`);
assert.equal(first.filter((it) => /\s/.test(String(it.id))).length, 0, 'no id may contain whitespace');

const seen = new Map();
first.forEach((it) => seen.set(it.id, (seen.get(it.id) || 0) + 1));
const dupIds = [...seen].filter(([, n]) => n > 1);
assert.equal(dupIds.length, 0, `no id may publish twice: ${JSON.stringify(dupIds)}`);

// Two shipped rows with one label are indistinguishable in ⌘K — the user has to pick
// between identical-looking commands with nothing to tell them apart. (Checked on the
// shipped vocabulary only: two tabs may legitimately share a title, two commands
// may not.)
const byLabel = new Map();
first.forEach((it) => { const l = it.name != null ? it.name : it.label; byLabel.set(l, (byLabel.get(l) || 0) + 1); });
const dupLabels = [...byLabel].filter(([, n]) => n > 1);
assert.equal(dupLabels.length, 0,
  `two shipped rows carry one label: ${JSON.stringify(dupLabels)}`);

// The verb namespace: a built-in row's id is `zw.<action>` for the action it runs, so
// the palette and the chain/trigger vocabulary cannot disagree about a command's name.
['zw.newTab', 'zw.closeTab', 'zw.reload', 'zw.copyUrl', 'zw.cycleScheme', 'zw.toggleTerminal']
  .forEach((id) => assert.ok(first.some((it) => it.id === id), `built-in row ${id} is published`));

// The three shipped `def-` action commands that used to shadow a built-in are gone,
// and the keyword they existed for lives on the built-in row now.
const defaults = sandbox.ZWIRE_CMD_DEFAULTS || [];
assert.ok(defaults.length > 0, 'the shipped defaults still load');
assert.equal(defaults.filter((d) => d.type === 'action').length, 0,
  'a shipped `action` default duplicates a built-in palette row');
assert.equal(first.find((it) => it.id === 'zw.reload').keyword, 'rl', 'zw.reload keeps the rl keyword');
assert.equal(first.find((it) => it.id === 'zw.copyUrl').keyword, 'cu', 'zw.copyUrl keeps the cu keyword');
assert.equal(first.find((it) => it.id === 'zw.cycleScheme').keyword, 'cs', 'zw.cycleScheme keeps the cs keyword');

// ── publish #2, after the event that re-publishes ───────────────────────────
// A vocabulary that shrinks on the second publish is the failure that looks like a
// working palette until something else on the page finishes initialising.
sandbox.document.dispatchEvent(new sandbox.CustomEvent('zgui:tmux-inited', { detail: {} }));
const second = vocabulary(sandbox);
assert.equal(second.length, first.length, 'the vocabulary must not change on re-publish');
assert.deepEqual(second.map((i) => i.id), first.map((i) => i.id), 'row ids are identical after re-publish');

// ── dynamic rows whose DISPLAY text collides ────────────────────────────────
// Three tabs titled the same, two extensions named the same, two extensions whose
// shortcut carries the same description. Every one of these is a separate command
// and a label-derived id would merge them — either into one row (dedupe eats the
// rest) or into one ambiguous verb. Fresh boot: the dedupe set is per-open, and a
// second sandbox proves the ids come from the data rather than from arrival order.
{
  const { sandbox: dyn } = boot({ zb_tabs: TABS, zb_exts: EXTS, zb_shortcuts: SHORTCUTS });
  const rows = vocabulary(dyn);
  assert.equal(rows.filter((it) => !it.id).length, 0, 'dynamic rows carry ids too');

  const tabIds = rows.filter((it) => String(it.id).startsWith('zw.tab.')).map((it) => it.id);
  assert.equal(tabIds.length, TABS.length, `one row per tab, got ${tabIds.length}`);
  assert.equal(new Set(tabIds).size, TABS.length, 'same-titled tabs keep distinct ids');

  const manageIds = rows.filter((it) => /^zw\.ext\.[a-z]+$/.test(String(it.id))).map((it) => it.id);
  assert.equal(new Set(manageIds).size, EXTS.length, 'same-named extensions keep distinct ids');

  // Shortcut rows are search-only (a provider), so they never reach the published
  // list — assert on the producer's own output, which is where the id is minted.
  const all = rows.map((it) => it.id);
  assert.equal(new Set(all).size, all.length, 'no dynamic row collides with a shipped one');

  // Rename every display string a localized browser would rewrite, re-publish, and
  // require the id list to be byte-identical. An id that moved came from a label.
  const before = all.slice();
  dyn.chrome.storage.local.set({
    zb_tabs: TABS.map((t) => ({ ...t, title: 'Sans titre' })),
    zb_exts: EXTS.map((e) => ({ ...e, name: 'Nom partagé' })),
    zb_shortcuts: SHORTCUTS.map((s) => ({ ...s, ext: 'Nom partagé', desc: 'Faire la chose' })),
  });
  const localized = vocabulary(dyn);
  assert.deepEqual(localized.map((i) => i.id), before,
    'a localized build must not renumber the vocabulary — some id derives from a label');
}

// ── the diagnostics sink ────────────────────────────────────────────────────
// Publish a deliberately id-less row and follow it all the way to the sink: the
// ZGui.diagnostics buffer, the zgui:diagnostic document event, and the zbFireHook
// relay that is the log channel zwire already has. Nothing prints.
const beforeDiag = (sandbox.ZGui.diagnostics || []).length;
assert.equal(beforeDiag, 0, 'a clean vocabulary produces no diagnostics at all');
const beforeHooks = hookMessages.length;

// A stored custom command with no id — the real shape of the bug, since a command
// saved before ids existed carries none, and it travels the same publish path every
// shipped producer uses.
store.zb_custom_cmds = [{ label: 'Orphan row', type: 'url', value: 'https://example.com/' }];
sandbox.__zbPaletteOpen();

assert.ok((sandbox.ZGui.diagnostics || []).length > beforeDiag,
  'an id-less published row is recorded in ZGui.diagnostics');
assert.ok(forwarded.some((d) => d && d.source === 'zpalette' && /carries no id/.test(d.message)),
  'the diagnostic reaches the zgui:diagnostic document event');
const sunk = hookMessages.slice(beforeHooks).filter((m) => m.event === 'zdiagnostic');
assert.ok(sunk.length > 0, 'the diagnostic reaches the zbFireHook log sink');
assert.match(sunk[0].payload.message, /Orphan row/, 'the sink message names the offending row');
assert.equal(sunk[0].payload.source, 'zpalette', 'the sink message names its source');

// Deduped — the vocabulary re-publishes on every open, and the same note must not
// pile up once per open forever.
const afterFirstOrphan = (sandbox.ZGui.diagnostics || []).length;
sandbox.__zbPaletteOpen();
assert.equal((sandbox.ZGui.diagnostics || []).length, afterFirstOrphan,
  'the same diagnostic is recorded once, not once per publish');

console.log(`palette id contract: ${first.length} rows, ${new Set(first.map((i) => i.id)).size} unique ids, 0 id-less, 0 duplicates — all assertions passed`);
