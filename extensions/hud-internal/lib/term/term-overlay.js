/* zwire — Ctrl+` terminal overlay for EXTENSION pages.
 *
 * The overlay every web page gets is a content script (manifest group
 * xterm.js · terminal.js · zterm-boot.js, plus the Ctrl+` binding in zpalette.js). Content
 * scripts match `http/https/file/chrome://*` — which is every URL an extension page is not.
 * So the terminal was missing on exactly the surfaces the HUD owns: its own pages
 * (Settings, Dashboard, History …) and the new-tab page. Same keystroke, nothing happened.
 *
 * This file is that keystroke for those pages. It does NOT load a second copy of xterm —
 * it frames `pages/terminal.html`, the dedicated Terminal page, which already carries the
 * terminal, its CSS and its PTY boot. One implementation of the terminal, one PTY protocol.
 *
 * The frame also solves the transport. terminal.js reaches zwire-host with
 * `chrome.runtime.connectNative`, and the host manifest's allowed_origins names ONE
 * extension — the HUD. A page in the new-tab extension calling connectNative would be
 * refused by the host, and relaying a PTY across extensions would mean a second protocol
 * to keep in step. Inside the frame the document IS the HUD, so it connects natively the
 * way the Terminal tab does, from any host page.
 *
 * The frame is built once and then only hidden, so the shell keeps running (and keeps its
 * scrollback) between toggles; it dies with the page, like the Terminal tab's does.
 *
 * SOURCE OF TRUTH — extensions/hud-internal/lib/term/term-overlay.js. newtab/lib/term/term-overlay.js
 * is a byte-identical vendored copy (same arrangement as newtab/lib/zgui-core): the new-tab
 * page is a separate extension and its CSP (`script-src 'self'`) cannot load a script from
 * the HUD's origin. Change this file, then re-vendor. */
(function () {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__zwireTermOverlay) return;
  window.__zwireTermOverlay = true;

  var HUD_ID = 'omcgnnjfmbmpdlofklbpddkhnfibfhgg';
  var TERM_PAGE = 'pages/terminal.html';
  var WRAP_ID = 'zwire-term-overlay';

  // The Terminal page's URL from wherever this runs: a relative resolve on a HUD page, an
  // absolute HUD URL from another extension's page (the new-tab page). Framing it from
  // there needs `extension_ids` on the HUD's web_accessible_resources entry — an
  // `<all_urls>` match does NOT cover a chrome-extension:// initiator.
  function terminalUrl(loc) {
    loc = loc || location;
    var onHud = loc.protocol === 'chrome-extension:' && loc.host === HUD_ID;
    if (onHud && typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
      try { return chrome.runtime.getURL(TERM_PAGE); } catch (e) {}
    }
    return 'chrome-extension://' + HUD_ID + '/' + TERM_PAGE;
  }

  // Ctrl+` — the same combo the content-script overlay binds in zpalette.js, matched the
  // same way (`code` as well as `key`, so a layout that reports the key differently, or a
  // dead-key compose, still toggles).
  function isTermCombo(e) {
    if (!e || !e.ctrlKey || e.metaKey || e.altKey) return false;
    return e.key === '`' || e.code === 'Backquote';
  }

  function build() {
    var wrap = document.createElement('div');
    wrap.id = WRAP_ID;
    wrap.setAttribute('data-zwire-ui', '');   // ztriggers.js skips zwire's own UI text
    wrap.style.cssText = [
      'position:fixed', 'left:0', 'right:0', 'bottom:0', 'height:45vh',
      'z-index:2147483646', 'display:none',
      'border-top:1px solid var(--cyan,#05d9e8)',
      'box-shadow:0 -8px 40px rgba(0,0,0,.6)',
      'background:var(--bg-primary,#0a0d16)'
    ].join(';');

    var frame = document.createElement('iframe');
    frame.src = terminalUrl();
    frame.setAttribute('title', 'zwire terminal');
    frame.style.cssText = 'display:block;width:100%;height:100%;border:0;background:transparent';
    wrap.appendChild(frame);
    document.body.appendChild(wrap);
    return wrap;
  }

  function overlay() {
    return document.getElementById(WRAP_ID) || (document.body ? build() : null);
  }
  function isOpen(w) { return !!(w && w.style.display !== 'none'); }

  function show() {
    var w = overlay(); if (!w) return;
    w.style.display = 'block';
    // Focus the frame so the first keystroke lands in the shell, not on the host page.
    try { var f = w.firstChild; if (f && f.contentWindow) f.contentWindow.focus(); } catch (e) {}
  }
  function hide() { var w = document.getElementById(WRAP_ID); if (w) w.style.display = 'none'; }
  function toggle() { var w = document.getElementById(WRAP_ID); if (isOpen(w)) hide(); else show(); }

  document.addEventListener('keydown', function (e) {
    if (!isTermCombo(e)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    toggle();
  }, true);

  // Ctrl+` pressed while the shell has focus is inside the frame, where this page's
  // listener never sees it — terminal.js would toggle its own pane instead and leave an
  // empty frame on screen. The framed Terminal page forwards the key up here
  // (terminal-boot.js), so the same keystroke closes the overlay from either side.
  window.addEventListener('message', function (e) {
    var d = e && e.data;
    if (!d || d.__zwireTerm !== 'toggle') return;
    if (String(e.origin || '') !== 'chrome-extension://' + HUD_ID) return;
    toggle();
  }, false);

  // A page (or a palette entry) can drive the same overlay. Named like the content-script
  // overlay's API so a caller does not care which surface it is on.
  window.toggleTerminalPopup = window.toggleTerminalPopup || toggle;
  window.zwireTermOverlay = { toggle: toggle, show: show, hide: hide, isTermCombo: isTermCombo, terminalUrl: terminalUrl };
})();
