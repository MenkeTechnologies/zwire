// Ctrl+` terminal test (lib/term/term-overlay.js) — the terminal on EXTENSION pages.
//
// Content scripts match http/https/file/chrome://*, so the terminal every web page gets never
// reaches a HUD page or the new-tab page. term-overlay.js loads that same terminal there on the
// first toggle. What it must get right, and what fails quietly otherwise:
//
//   1. THE KEY. Same combo as the content-script binding (zpalette.js), or the terminal is
//      "missing" on exactly the pages this file exists to serve.
//   2. THE ASSETS. The real terminal, in the order the real terminal needs: modal-drag.js
//      publishes initModalDragResize, which terminal.js calls while injecting its pane —
//      load it afterwards and the pane comes up FIXED instead of floating, draggable and
//      dockable, which is the whole difference between this and a docked panel.
//   3. STANDING DOWN. terminal.js binds Ctrl+` itself once loaded. A capture-phase listener
//      here that keeps swallowing the key would make that binding permanently unreachable.
//
// Each extension serves its own copy of the assets (a page cannot load a script from another
// extension's origin under `script-src 'self'`), so the new-tab tree carries byte-identical
// copies at the same relative paths; scripts/test.sh's SHARED-FILE PARITY gate compares them.
import fs from 'node:fs';
import assert from 'node:assert/strict';

const SRC = new URL('../lib/term/term-overlay.js', import.meta.url);

const src = fs.readFileSync(SRC, 'utf8');

// Window/document shim. Enough DOM to watch what gets injected: `injected` records every
// <link>/<script> appended to head, in order, and a script's onload is fired on demand so the
// sequential chain can be walked the way a browser would walk it. `state.pane` stands in for
// terminal.js having injected #terminalPane.
function load() {
  const listeners = {};
  const injected = [];
  const state = { pane: null };
  const win = {
    addEventListener: (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); }
  };
  const doc = {
    addEventListener: (t, fn) => { (listeners['doc:' + t] = listeners['doc:' + t] || []).push(fn); },
    getElementById: (id) => (id === 'terminalPane' ? state.pane : null),
    createElement: (tag) => ({ tag }),
    head: { appendChild: (el) => { injected.push(el); } },
    documentElement: {},
    body: null
  };
  new Function('window', 'document', 'chrome', src)(
    win, doc, { runtime: { getURL: (rel) => 'chrome-extension://self/' + rel } });
  assert.ok(win.zwireTermOverlay, 'window.zwireTermOverlay missing');
  return { api: win.zwireTermOverlay, listeners, win, state, injected };
}

let pass = 0, fail = 0;
const check = (name, cond, detail) => {
  if (cond) { pass++; return; }
  fail++;
  console.error(`  ✗ ${name}${detail ? ' — ' + detail : ''}`);
};

const { api, listeners, win, state, injected } = load();

// ---- 1. the key ----
{
  const combo = (o) => api.isTermCombo(Object.assign({ ctrlKey: false, metaKey: false, altKey: false, key: '', code: '' }, o));
  check('Ctrl+` toggles', combo({ ctrlKey: true, key: '`' }));
  check('Ctrl+Backquote by code toggles (layout-independent)', combo({ ctrlKey: true, code: 'Backquote' }));
  check('Cmd+` does not', !combo({ metaKey: true, key: '`' }));
  check('Ctrl+Alt+` does not', !combo({ ctrlKey: true, altKey: true, key: '`' }));
  check('Ctrl+Cmd+` does not', !combo({ ctrlKey: true, metaKey: true, key: '`' }));
  check('a bare backtick does not', !combo({ key: '`' }));
  check('Ctrl+k does not', !combo({ ctrlKey: true, key: 'k' }));
  check('a missing event does not throw', api.isTermCombo(undefined) === false);
  check('the key is bound on the capture phase of document',
    (listeners['doc:keydown'] || []).length === 1);
  check('toggleTerminalPopup is exposed for palette entries',
    typeof win.toggleTerminalPopup === 'function');
}

// ---- 2. the assets ----
// The floating pane is terminal.js's own (`.terminal-pane dock-br` + #termDragHandle, made
// draggable by initModalDragResize). Loading the wrong set, or the right set in the wrong
// order, is how it comes back as a fixed panel instead.
{
  const { css, js } = api.assets;
  check('xterm + terminal styling is loaded', css.join() === 'lib/term/xterm.css,lib/term/terminal.css', css.join());
  check('the scripts are the web-page set, drag helper first',
    js.join() === 'lib/zgui-core/webui/modal-drag.js,lib/term/xterm.js,lib/term/terminal.js', js.join());
  check('modal-drag.js precedes terminal.js (it publishes initModalDragResize)',
    js.indexOf('lib/zgui-core/webui/modal-drag.js') < js.indexOf('lib/term/terminal.js'));

  // Every asset must exist in BOTH trees — each extension serves its own copy, and a page
  // that 404s one of these gets a terminal with no styling, no drag, or no terminal at all.
  for (const rel of [...css, ...js]) {
    check(`the HUD ships ${rel}`, fs.existsSync(new URL('../' + rel, import.meta.url)));
    check(`the new-tab extension ships ${rel}`,
      fs.existsSync(new URL('../../../newtab/' + rel, import.meta.url)));
  }
  // terminal.css @font-face's this file; a missing copy silently falls back to a system font.
  const FONT = 'lib/term/fonts/HackNerdFontMono-Regular.woff2';
  check(`the new-tab extension ships ${FONT}`,
    fs.existsSync(new URL('../../../newtab/' + FONT, import.meta.url)));
}

// ---- 3. standing down once terminal.js owns the key ----
// Driven through the listener this file actually registered, with the shim flipped to look
// like terminal.js has injected its pane.
{
  const keydown = (listeners['doc:keydown'] || [])[0];
  const press = () => {
    let prevented = false, stopped = false;
    keydown({ ctrlKey: true, key: '`', code: 'Backquote',
      preventDefault: () => { prevented = true; }, stopImmediatePropagation: () => { stopped = true; } });
    return { prevented, stopped };
  };

  check('nothing is loaded before the first toggle', api.isLoaded() === false);
  const cold = press();
  check('while unloaded the key is claimed here', cold.prevented && cold.stopped);

  // That press starts the real injection. Walk the chain the way a browser would — each
  // script's onload pulls in the next — and check what actually landed in the document.
  for (let i = 0; i < 8 && injected.some((el) => el.tag === 'script' && el.onload); i++) {
    const next = injected.find((el) => el.tag === 'script' && el.onload);
    const fire = next.onload; next.onload = null; fire();
  }
  const hrefs = injected.filter((el) => el.tag === 'link').map((el) => el.href);
  const srcs = injected.filter((el) => el.tag === 'script').map((el) => el.src);
  check('the first press injects the stylesheets',
    hrefs.join() === api.assets.css.map((r) => 'chrome-extension://self/' + r).join(), hrefs.join());
  check('and the scripts, in dependency order',
    srcs.join() === api.assets.js.map((r) => 'chrome-extension://self/' + r).join(), srcs.join());
  check('a later caller does not pull a second copy of xterm down',
    (api.load(() => {}), injected.filter((el) => el.tag === 'script').length === api.assets.js.length),
    `${injected.filter((el) => el.tag === 'script').length} scripts injected`);

  // terminal.js has now loaded: it owns both the global and the key.
  state.pane = { id: 'terminalPane' };
  win.showTerminal = () => {};
  check('isLoaded() sees the injected pane', api.isLoaded() === true);
  const warm = press();
  check('once loaded the key is left to terminal.js',
    !warm.prevented && !warm.stopped,
    'swallowing it here would make terminal.js\'s own binding unreachable');
}

// ---- the new-tab page actually loads it ----
// (That the vendored copy matches this one is the repo-level SHARED-FILE PARITY gate in
// scripts/test.sh, which already compares every same-path duplicate between the two trees.)
{
  check('the new-tab page loads the overlay',
    fs.readFileSync(new URL('../../../newtab/newtab.html', import.meta.url), 'utf8')
      .includes('lib/term/term-overlay.js'));
}

// ---- every HUD page keeps the binding ----
// A page added later that copies an existing page's <script> block should not quietly be the
// one page where Ctrl+` does nothing. terminal.html is exempt: it IS the terminal.
{
  const dir = new URL('../pages/', import.meta.url);
  const pages = fs.readdirSync(dir).filter((f) => f.endsWith('.html') && f !== 'terminal.html');
  const missing = pages.filter((f) => !fs.readFileSync(new URL(f, dir), 'utf8').includes('term-overlay.js'));
  check(`all ${pages.length} HUD pages include the overlay`, missing.length === 0, missing.join(', '));
}

// ---- the same command on every ⌘K surface ----
// ⌘K is one command surface with three implementations: zpalette.js on web pages,
// zg-boot.js on HUD pages, newtab/palette.js on the new-tab page. A command that exists on
// one and not the others is the bug this file was opened for — the keystroke was there and
// the palette row was not, so the terminal read as missing either way. Each surface must
// publish the row with the same label and the same hint, and route it through
// toggleTerminalPopup rather than a private path that could drift.
{
  const surfaces = [
    ['web pages (zpalette.js)', new URL('../zpalette.js', import.meta.url)],
    ['HUD pages (pages/zg-boot.js)', new URL('../pages/zg-boot.js', import.meta.url)],
    ['the new-tab page (newtab/palette.js)', new URL('../../../newtab/palette.js', import.meta.url)]
  ];
  for (const [where, url] of surfaces) {
    const text = fs.readFileSync(url, 'utf8');
    const at = [...text.matchAll(/'Toggle terminal'/g)].map((m) => m.index);
    check(`${where} publishes one Toggle terminal row`, at.length === 1, `${at.length} found`);
    // The row's own object literal, which may wrap across lines: from the label back to the
    // brace that opens it, forward to the run handler's end.
    const row = at.length === 1 ? text.slice(text.lastIndexOf('{', at[0]), at[0] + 260) : '';
    check(`${where} hints the same keystroke`, row.includes('Ctrl+`'), row.trim().slice(0, 110));
    check(`${where} routes it through toggleTerminalPopup`,
      row.includes('toggleTerminalPopup'), row.trim().slice(0, 110));
  }
}

console.log(`terminal-overlay: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
