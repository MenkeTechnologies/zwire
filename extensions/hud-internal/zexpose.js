/* zwire HUD — window/tab exposé. Ports zterm's ztmux window exposé (ZGui.expose)
 * to the browser: a full-screen tile grid of every window, each tile previewing
 * that window's tabs; click (or arrow + Enter) focuses the window, Esc closes.
 * A content script can't enumerate windows, so it asks the worker (zbWindows) and
 * drives focus back through the zb_cmd bus (focusWindow). Opened from the ⌘K
 * palette ("Expose all windows & tabs") via window.__zbExposeOpen(). The pure
 * window->tile mapping is exposed as window.__zbExposeModel for headless tests. */
(function () {
  'use strict';

  // Map chrome windows (each with .tabs) to ZGui.expose tile models. Pure.
  function exposeModel(windows) {
    return (windows || []).map(function (w, i) {
      var tabs = w.tabs || [];
      var act = tabs.filter(function (t) { return t.active; })[0] || tabs[0] || {};
      var lines = tabs.map(function (t) {
        return (t.active ? '▸ ' : '  ') + (t.pinned ? '⚲ ' : '') + (t.title || t.url || '(tab)');
      });
      var meta = tabs.length + ' tab' + (tabs.length === 1 ? '' : 's')
        + (w.incognito ? ' · incognito' : '')
        + (w.state && w.state !== 'normal' ? ' · ' + w.state : '');
      return { id: w.id, title: act.title || act.url || ('Window ' + (i + 1)), focused: !!w.focused, meta: meta, preview: lines.join('\n'), tabId: act.id };
    });
  }
  // Reconstruct windows+tabs from the flat zb_tabs list (grouped by windowId).
  // zb_tabs is the worker's reliably-maintained tab store (the palette switcher
  // uses it), so this is a rock-solid source when zb_windows is unavailable
  // (e.g. chrome.windows.getAll returned nothing on this build).
  function windowsFromTabs(tabs) {
    var byWin = {}, order = [];
    (tabs || []).forEach(function (t) {
      var w = t.windowId != null ? t.windowId : 0;
      if (!byWin[w]) { byWin[w] = { id: w, focused: false, tabs: [] }; order.push(w); }
      byWin[w].tabs.push({ id: t.id, title: t.title, url: t.url, active: !!t.active, pinned: !!t.pinned });
    });
    return order.map(function (w) { return byWin[w]; });
  }
  if (typeof window !== 'undefined') { window.__zbExposeModel = exposeModel; window.__zbWindowsFromTabs = windowsFromTabs; }

  // Headless (test) load, or a re-injection, stops here.
  if (typeof window === 'undefined' || typeof chrome === 'undefined' || !chrome.runtime) return;
  if (window.__zbExposeLoaded) return;
  window.__zbExposeLoaded = true;

  var overlay = null, api = null, storageListener = null;
  function cmd(obj) { try { obj.n = (window.__zbTick = (window.__zbTick || 0) + 1); chrome.storage.local.set({ zb_cmd: obj }); } catch (e) {} }
  function injectCss() {
    if (document.getElementById('zb-expose-css')) return;
    try { var l = document.createElement('link'); l.id = 'zb-expose-css'; l.rel = 'stylesheet'; l.href = chrome.runtime.getURL('lib/zgui-core/webui/expose.css'); (document.head || document.documentElement).appendChild(l); } catch (e) {}
  }
  // Match the active scheme (expose.css falls back to cyberpunk if these are absent).
  function applyScheme(rootEl) {
    try {
      var HUD = window.ZWIRE_HUD || {}, SCHEMES = HUD.SCHEMES || {}, VAR_KEYS = HUD.VAR_KEYS || [];
      chrome.storage.local.get(['zb_scheme'], function (o) {
        void chrome.runtime.lastError;
        var s = SCHEMES[(o && o.zb_scheme) || 'cyberpunk'] || SCHEMES.cyberpunk || { vars: {} };
        var sv = s.vars || {}, css = '';
        VAR_KEYS.forEach(function (k) { if (sv[k]) css += k + ':' + sv[k] + ';'; });
        if (rootEl) rootEl.style.cssText += ';' + css;
      });
    } catch (e) {}
  }
  // Read the worker-maintained window list from storage (reliable), and poke the
  // worker to refresh it (a sendMessage RESPONSE to a sleeping MV3 worker is
  // unreliable — same reason the palette reads zb_tabs from storage, not a reply).
  function readWindows(cb) {
    try {
      chrome.storage.local.get(['zb_windows', 'zb_tabs'], function (o) {
        void chrome.runtime.lastError;
        var w = (o && o.zb_windows) || [];
        if (w.length) { cb(w); return; }
        cb(windowsFromTabs((o && o.zb_tabs) || []));   // fallback: group the reliable tab list
      });
    } catch (e) { cb([]); }
  }
  function close() {
    if (storageListener) { try { chrome.storage.onChanged.removeListener(storageListener); } catch (e) {} storageListener = null; }
    if (overlay) { try { overlay.remove(); } catch (e) {} overlay = null; api = null; }
  }
  function open() {
    if (!window.ZGui || !window.ZGui.expose) return;
    if (overlay) { close(); return; }   // toggle
    injectCss();
    overlay = document.createElement('div');
    overlay.className = 'zb-expose-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483645;background:rgba(0,0,0,.72);display:flex;';
    applyScheme(overlay);
    var panel = document.createElement('div');
    panel.style.cssText = 'margin:auto;width:min(1100px,94vw);height:min(84vh,900px);background:var(--bg-primary,#05050a);border:1px solid var(--cyan,#05d9e8);border-radius:6px;overflow:hidden;box-shadow:0 0 60px var(--cyan-glow,rgba(5,217,232,.4));';
    overlay.appendChild(panel);
    (document.body || document.documentElement).appendChild(overlay);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
    // Mount immediately (may be empty for a moment), then fill from zb_windows.
    api = window.ZGui.expose(panel, {
      windows: [],
      title: 'All Windows & Tabs',
      hint: 'Click a window to focus it · Esc to close',
      onChoose: function (id) { cmd({ a: 'focusWindow', windowId: id }); close(); },
      onClose: close
    });
    // Poke the worker to (re)write zb_windows, then read it. Retry a few times: on
    // a fresh extension reload the worker may not have written it yet, and a
    // sleeping MV3 worker needs the ping to wake before the store is fresh.
    var tries = 0;
    function pump() {
      if (!overlay) return;
      cmd({ a: 'ping' });
      readWindows(function (wins) {
        if (!overlay || !api) return;
        if (wins && wins.length) { api.set(exposeModel(wins)); return; }   // got them
        if (tries++ < 10) setTimeout(pump, 300);                            // keep trying ~3s
      });
    }
    pump();
    // Live refresh while open — the worker rewrites zb_windows AND zb_tabs on
    // tab/window events (and on our pings); patch tiles in place. Prefer
    // zb_windows when it has data; else rebuild from the reliable zb_tabs list.
    storageListener = function (ch, area) {
      if (area !== 'local' || !api || !api.set) return;
      if (ch.zb_windows && (ch.zb_windows.newValue || []).length) { api.set(exposeModel(ch.zb_windows.newValue)); return; }
      if (ch.zb_tabs) api.set(exposeModel(windowsFromTabs(ch.zb_tabs.newValue || [])));
    };
    try { chrome.storage.onChanged.addListener(storageListener); } catch (e) {}
  }
  window.__zbExposeOpen = open;
  // Esc safety net (expose handles Esc on its own root too).
  document.addEventListener('keydown', function (e) { if (overlay && e.key === 'Escape') { e.preventDefault(); close(); } }, true);
})();
