/* zwire — keep the terminal overlay open across page navigation, PER TAB.
 * terminal.js persists visibility in per-origin localStorage, which does NOT
 * carry across different sites. This mirrors the open state to the background
 * worker keyed by THIS tab (sender.tab.id) so when the overlay re-injects on the
 * next page it re-opens automatically IN THE SAME TAB ONLY — the background also
 * reconnects that tab's PTY so the shell continues. The old approach used a
 * GLOBAL chrome.storage flag, which re-popped the terminal in every other tab /
 * new tab the moment it was opened anywhere. */
(function () {
  'use strict';
  function setOpen(v) { try { chrome.runtime.sendMessage({ type: 'zbTermOpen', open: !!v }, function () { void chrome.runtime.lastError; }); } catch (e) {} }
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
    // Auto-reopen ONLY if THIS TAB had it open (per-tab state from the background),
    // and not already showing — so it never pops on other tabs or new tabs.
    try { chrome.runtime.sendMessage({ type: 'zbTermState' }, function (o) { void chrome.runtime.lastError; if (o && o.open === true && !isActive() && window.showTerminal) window.showTerminal(); }); } catch (e) {}
  }
  // Authoritative snapshot right before navigating away, in case a close in the
  // same tick as navigation didn't get mirrored yet.
  try { window.addEventListener('pagehide', function () { setOpen(isActive()); }); } catch (e) {}
  watch();
})();
