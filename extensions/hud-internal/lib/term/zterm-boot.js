/* zwire — keep the terminal overlay open across page navigation.
 * terminal.js persists visibility in per-origin localStorage, which does NOT
 * carry across different sites. This mirrors the open state into
 * chrome.storage.local ('zb_term_open') so when the overlay re-injects on the
 * next page it re-opens automatically — and the background worker reconnects the
 * same tab's PTY, so the shell session continues. */
(function () {
  'use strict';
  function setOpen(v) { try { chrome.storage.local.set({ zb_term_open: !!v }); } catch (e) {} }
  function isActive() { var p = document.getElementById('terminalPane'); return !!(p && p.classList.contains('active')); }
  function watch() {
    var pane = document.getElementById('terminalPane');
    if (!pane) { setTimeout(watch, 150); return; }
    // Mirror the pane's active-state (any close path — hide/kill/toggle — flips
    // the 'active' class), so closing the terminal is recorded and it stops
    // re-opening on the next page.
    try {
      var obs = new MutationObserver(function () { setOpen(pane.classList.contains('active')); });
      obs.observe(pane, { attributes: true, attributeFilter: ['class'] });
    } catch (e) {}
    // Auto-reopen ONLY if it was explicitly open when you left the last page —
    // strict === true (not a stale/truthy value) and not already showing. The
    // flag is reset on browser startup (background.js) so a stale "open" never
    // re-pops the terminal on every page of a fresh session.
    try { chrome.storage.local.get('zb_term_open', function (o) { if (o && o.zb_term_open === true && !isActive() && window.showTerminal) window.showTerminal(); }); } catch (e) {}
  }
  // Authoritative snapshot right before navigating away, in case a close in the
  // same tick as navigation didn't get mirrored yet.
  try { window.addEventListener('pagehide', function () { setOpen(isActive()); }); } catch (e) {}
  watch();
})();
