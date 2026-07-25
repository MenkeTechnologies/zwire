// HUD page accelerators (pages/hud-accel.js). Chrome's Clear-browsing-data
// shortcut is not in Chromium's reserved-shortcut table, so the focused
// renderer sees it first — and every HUD page auto-focuses its filter box, so
// the keystroke died in a text field and the browser command never ran. This
// module rebinds it; these assertions pin the combo matrix and the routing.
import fs from 'node:fs';
import assert from 'node:assert/strict';

const SRC = fs.readFileSync(new URL('../pages/hud-accel.js', import.meta.url), 'utf8');

function load({ platform = 'MacIntel', hook = null, tabs = null } = {}) {
  const listeners = [];
  const created = [];
  // Node exposes a read-only global navigator; redefine it so the module's
  // platform sniff sees the platform this case is exercising.
  Object.defineProperty(globalThis, 'navigator', {
    value: { platform, userAgent: platform }, configurable: true, writable: true
  });
  globalThis.chrome = {
    runtime: { lastError: null, getURL: (p) => 'chrome-extension://ID/' + p },
    tabs: { create(opts, cb) { created.push(opts); if (cb) cb(); } }
  };
  if (tabs === 'missing') delete globalThis.chrome.tabs;
  const win = {
    addEventListener(type, fn, capture) { listeners.push({ type, fn, capture }); },
    location: { href: 'chrome-extension://ID/pages/history.html' }
  };
  if (hook) win.__zbOpenClearData = hook;
  globalThis.window = win;
  new Function('window', SRC)(win);
  return { win, listeners, created, A: win.ZBAccel };
}

const ev = (o) => Object.assign({ key: 'Backspace', metaKey: false, ctrlKey: false, shiftKey: false, altKey: false }, o);

// --- the combo matrix --------------------------------------------------------
{
  const { A } = load();
  // macOS: Cmd+Shift+Backspace (and Delete, for full keyboards).
  assert.equal(A.isClearCombo(ev({ metaKey: true, shiftKey: true }), true), true);
  assert.equal(A.isClearCombo(ev({ key: 'Delete', metaKey: true, shiftKey: true }), true), true);
  // Missing Shift is Cmd+Backspace — "delete to start of line" in a field, not ours.
  assert.equal(A.isClearCombo(ev({ metaKey: true }), true), false);
  // Ctrl+Shift+Backspace on a Mac is a different (unbound) chord.
  assert.equal(A.isClearCombo(ev({ ctrlKey: true, shiftKey: true }), true), false);
  // Option in the mix means the user meant a word/line editing command.
  assert.equal(A.isClearCombo(ev({ metaKey: true, shiftKey: true, altKey: true }), true), false);
  // Any other key is not ours no matter the modifiers.
  assert.equal(A.isClearCombo(ev({ key: 'k', metaKey: true, shiftKey: true }), true), false);

  // Linux/Windows: Ctrl+Shift+Del, and Cmd/Meta must NOT trigger it there.
  assert.equal(A.isClearCombo(ev({ key: 'Delete', ctrlKey: true, shiftKey: true }), false), true);
  assert.equal(A.isClearCombo(ev({ ctrlKey: true, shiftKey: true }), false), true);
  assert.equal(A.isClearCombo(ev({ metaKey: true, shiftKey: true }), false), false);
  assert.equal(A.isClearCombo(null, false), false);
}

// Platform is detected from navigator when the caller doesn't pass one.
assert.equal(load({ platform: 'MacIntel' }).A.isMac, true);
assert.equal(load({ platform: 'Linux x86_64' }).A.isMac, false);
assert.equal(load({ platform: 'Win32' }).A.isMac, false);

// --- it must listen in CAPTURE phase ----------------------------------------
// The whole bug is that a focused input consumes the key first; a bubble-phase
// listener would be too late.
{
  const { listeners } = load();
  assert.equal(listeners.length, 1);
  assert.equal(listeners[0].type, 'keydown');
  assert.equal(listeners[0].capture, true, 'must be a capture-phase listener');
}

// --- routing: same page uses the in-page hook, otherwise open Settings -------
{
  let hookCalls = 0;
  const { A, created } = load({ hook: () => { hookCalls++; } });
  let prevented = 0, stopped = 0;
  A.onKeyDown(Object.assign(ev({ metaKey: true, shiftKey: true }), {
    preventDefault() { prevented++; }, stopPropagation() { stopped++; }
  }));
  assert.equal(hookCalls, 1, 'Settings handles the shortcut in place');
  assert.equal(created.length, 0, 'no second copy of the page it is already on');
  assert.equal(prevented, 1, 'the key must not also reach the focused input');
  assert.equal(stopped, 1);
}
{
  const { A, created } = load();          // no hook: any other HUD page
  A.onKeyDown(Object.assign(ev({ metaKey: true, shiftKey: true }), { preventDefault() {}, stopPropagation() {} }));
  assert.deepEqual(created, [{ url: 'chrome-extension://ID/pages/settings.html?section=clearBrowserData' }]);
}
{
  // A non-matching chord must fall through untouched — no navigation, and no
  // preventDefault stealing an editing shortcut from a focused field.
  let prevented = 0;
  const { A, created } = load();
  A.onKeyDown(Object.assign(ev({ metaKey: true }), { preventDefault() { prevented++; }, stopPropagation() {} }));
  assert.equal(created.length, 0);
  assert.equal(prevented, 0);
}

// The deep-link must be the slug settings.js routes to the wizard.
{
  const { A } = load();
  assert.match(A.CLEAR_URL, /^pages\/settings\.html\?section=clearBrowserData$/);
  const settings = fs.readFileSync(new URL('../pages/settings.js', import.meta.url), 'utf8');
  const w = {};
  new Function('window', settings)(w);
  const slug = A.CLEAR_URL.split('section=')[1];
  assert.equal(w.ZBSettings.sectionForSlug(slug), 'privacy');
  assert.equal(w.ZBSettings.isClearSlug(slug), true);
}

console.log('hud accel: ok');
