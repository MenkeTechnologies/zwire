/* zwire — Ctrl+` terminal for EXTENSION pages.
 *
 * The terminal every web page gets is a content script (manifest group modal-drag.js ·
 * xterm.js · terminal.js · zterm-boot.js, with the Ctrl+` binding in zpalette.js). Content
 * scripts match `http/https/file/chrome://*` — which is every URL an extension page is not.
 * So the terminal was missing on exactly the surfaces the HUD owns: its own pages
 * (Settings, Dashboard, History …) and the new-tab page.
 *
 * This file loads that same terminal there, and nothing else: on the first Ctrl+` (or the
 * palette's "Toggle terminal") it injects xterm.css · terminal.css · modal-drag.js ·
 * xterm.js · terminal.js, and terminal.js then does what it does on a web page — injects
 * its own FLOATING pane, dragged by its toolbar, resizable, dock-to-corner, with geometry
 * and visibility persisted. Same pane, same keys, same shell, whatever page you are on.
 *
 * Every asset resolves through chrome.runtime.getURL, so each extension serves its OWN
 * copy: a HUD page loads the HUD's, the new-tab page loads the new-tab extension's vendored
 * one. A page cannot load a script from another extension's origin (`script-src 'self'`),
 * and it does not need to — the native-host manifest allows all three zwire extensions
 * (scripts/setup-native-host.sh, scripts/localinstall.sh), so terminal.js's
 * `chrome.runtime.connectNative` reaches zwire-host from whichever one is asking.
 *
 * Loading waits for the first toggle: xterm alone is ~290KB, and a Settings page that pays
 * for a terminal nobody opened is a slower Settings page.
 *
 * SOURCE OF TRUTH — extensions/hud-internal/lib/term/term-overlay.js. newtab/lib/term/term-overlay.js
 * is a byte-identical vendored copy, kept honest by the SHARED-FILE PARITY gate in
 * scripts/test.sh, which compares the vendored terminal assets too. */
(function () {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__zwireTermOverlay) return;
  window.__zwireTermOverlay = true;

  var CSS = ['lib/term/xterm.css', 'lib/term/terminal.css'];
  // Order matters: modal-drag.js publishes initModalDragResize, which terminal.js calls as
  // it injects the pane — load it after terminal.js and the pane is not draggable.
  var JS = ['lib/zgui-core/webui/modal-drag.js', 'lib/term/xterm.js', 'lib/term/terminal.js'];

  var started = false;

  function url(rel) {
    try { return chrome.runtime.getURL(rel); } catch (e) { return rel; }
  }
  function addCss(rel) {
    var l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = url(rel);
    (document.head || document.documentElement).appendChild(l);
  }
  // Sequential: these files depend on each other in this order.
  function addJs(list, done) {
    if (!list.length) { done(); return; }
    var s = document.createElement('script');
    s.src = url(list[0]);
    s.onload = function () { addJs(list.slice(1), done); };
    s.onerror = function () { addJs(list.slice(1), done); };   // keep going — a partial load still beats a dead key
    (document.head || document.documentElement).appendChild(s);
  }

  function isLoaded() {
    return typeof window.showTerminal === 'function' && !!document.getElementById('terminalPane');
  }

  // terminal.js injects #terminalPane on DOMContentLoaded or straight away; give the late
  // case a beat rather than dropping the keystroke that asked for it.
  function whenReady(then) {
    var tries = 0;
    (function wait() {
      if (isLoaded()) { then(); return; }
      if (++tries > 40) return;                   // ~3s — the scripts failed, not a slow frame
      setTimeout(wait, 75);
    })();
  }

  // One injection per page. A second caller arriving mid-flight waits for the same load
  // instead of pulling xterm down twice, and still gets its terminal when it lands.
  function load(then) {
    if (started) { whenReady(then); return; }
    started = true;
    CSS.forEach(addCss);
    addJs(JS, function () { whenReady(then); });
  }

  // Until terminal.js is in, this is the terminal's entry point — for the ⌘K row and for the
  // key. Once it is in, terminal.js's own top-level toggleTerminalPopup takes the global and
  // owns both.
  function toggle() {
    if (isLoaded()) { try { window.toggleTerminalPopup(); } catch (e) {} return; }
    load(function () { try { window.showTerminal(); } catch (e) {} });
  }

  // Ctrl+` — the same combo the content-script binding matches (zpalette.js), matched the
  // same way (`code` as well as `key`, so a layout that reports the key differently still
  // toggles).
  function isTermCombo(e) {
    if (!e || !e.ctrlKey || e.metaKey || e.altKey) return false;
    return e.key === '`' || e.code === 'Backquote';
  }

  document.addEventListener('keydown', function (e) {
    if (!isTermCombo(e)) return;
    // Once terminal.js is loaded it binds Ctrl+` itself, on the bubble phase. Stand down
    // then: swallowing the event here would leave that binding permanently unreachable and
    // this file toggling a pane it no longer owns.
    if (isLoaded()) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    toggle();
  }, true);

  window.toggleTerminalPopup = window.toggleTerminalPopup || toggle;
  window.zwireTermOverlay = { toggle: toggle, load: load, isLoaded: isLoaded, isTermCombo: isTermCombo, assets: { css: CSS, js: JS } };
})();
