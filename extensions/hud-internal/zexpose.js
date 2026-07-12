/* zwire HUD — window/tab exposé. Ports zterm's ztmux pane exposé (ZGui.expose)
 * to the browser: a full-screen grid where each tile is ONE TAB, showing its
 * title, host + window, and a live text excerpt of the page's content (the
 * browser analog of zterm's terminal-buffer previews). Click (or arrow + Enter)
 * focuses that tab, Esc closes.
 *
 * Data comes from the worker over storage (reliable — a sendMessage response to a
 * sleeping MV3 worker is not): the tab list is zb_tabs; the per-tab content
 * excerpts are zb_tab_previews (the worker executeScript-grabs them when the
 * exposé asks via the zb_cmd `exposeCapture`). Opened from the ⌘K palette via
 * window.__zbExposeOpen(). The pure tile mapping is window.__zbTabTiles for tests. */
(function () {
  'use strict';

  // Map the flat zb_tabs list (+ per-tab content excerpts) to ZGui.expose tiles —
  // one tile PER TAB. Pure.
  function tabTiles(tabs, previews) {
    previews = previews || {};
    var winOrder = [], winIdx = {};
    (tabs || []).forEach(function (t) { var w = t.windowId != null ? t.windowId : 0; if (!(w in winIdx)) { winIdx[w] = winOrder.length; winOrder.push(w); } });
    var multiWin = winOrder.length > 1;
    return (tabs || []).map(function (t) {
      var host = ''; try { host = new URL(t.url).hostname.replace(/^www\./, ''); } catch (e) { host = t.url || ''; }
      var pv = previews[t.id]; if (pv == null) pv = previews[String(t.id)];
      var meta = host + (multiWin ? '  ·  window ' + (winIdx[t.windowId != null ? t.windowId : 0] + 1) : '');
      return {
        id: t.id,
        title: (t.pinned ? '⚲ ' : '') + (t.title || t.url || '(tab)'),
        focused: !!t.active,
        meta: meta,
        preview: (pv || t.url || ''),
        tabId: t.id, windowId: t.windowId
      };
    });
  }
  if (typeof window !== 'undefined') window.__zbTabTiles = tabTiles;

  // Headless (test) load, or a re-injection, stops here.
  if (typeof window === 'undefined' || typeof chrome === 'undefined' || !chrome.runtime) return;
  if (window.__zbExposeLoaded) return;
  window.__zbExposeLoaded = true;

  var overlay = null, api = null, storageListener = null;
  function cmd(obj) { try { obj.n = (window.__zbTick = (window.__zbTick || 0) + 1); chrome.storage.local.set({ zb_cmd: obj }); } catch (e) {} }
  function injectCss() {
    if (document.getElementById('zb-expose-css')) return;
    try { var l = document.createElement('link'); l.id = 'zb-expose-css'; l.rel = 'stylesheet'; l.href = chrome.runtime.getURL('lib/zgui-core/webui/expose.css'); (document.head || document.documentElement).appendChild(l); } catch (e) {}
    // expose.css previews are 7px `white-space:pre` (for terminal buffers); web
    // page excerpts are prose, so make them wrap + readable within the tile.
    try {
      var s = document.createElement('style'); s.id = 'zb-expose-tweaks';
      s.textContent = '.zb-expose-overlay .zg-expose-preview{white-space:pre-wrap;word-break:break-word;font-size:10px;line-height:1.35;}';
      (document.head || document.documentElement).appendChild(s);
    } catch (e) {}
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
  // Read the tab list + content excerpts from storage and build tab tiles.
  function readTiles(cb) {
    try {
      chrome.storage.local.get(['zb_tabs', 'zb_tab_previews'], function (o) {
        void chrome.runtime.lastError;
        cb(tabTiles((o && o.zb_tabs) || [], (o && o.zb_tab_previews) || {}));
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
    // Mount immediately (may be empty for a moment), then fill from zb_tabs.
    api = window.ZGui.expose(panel, {
      windows: [],
      title: 'Windows & Tabs',
      hint: 'Click a tab to focus it · Esc to close',
      onChoose: function (id) { cmd({ a: 'activate', tabId: id }); close(); },   // activate the tab + focus its window
      onClose: close
    });
    // Poke the worker: ping refreshes zb_tabs; exposeCapture grabs page excerpts.
    cmd({ a: 'ping' }); cmd({ a: 'exposeCapture' });
    var tries = 0;
    function pump() {
      if (!overlay) return;
      readTiles(function (tiles) {
        if (!overlay || !api) return;
        if (tiles && tiles.length) { api.set(tiles); return; }   // got them (previews stream in via onChanged)
        cmd({ a: 'ping' });
        if (tries++ < 10) setTimeout(pump, 300);                 // keep trying ~3s
      });
    }
    pump();
    // Live refresh while open — the worker rewrites zb_tabs on tab events and
    // zb_tab_previews as excerpts land; rebuild + patch tiles in place (expose.set
    // keeps focus/scroll), so previews appear the moment they're captured.
    storageListener = function (ch, area) {
      if (area !== 'local' || !api || !api.set) return;
      if (ch.zb_tabs || ch.zb_tab_previews) readTiles(function (tiles) { if (api && api.set) api.set(tiles); });
    };
    try { chrome.storage.onChanged.addListener(storageListener); } catch (e) {}
  }
  window.__zbExposeOpen = open;
  // Esc safety net (expose handles Esc on its own root too).
  document.addEventListener('keydown', function (e) { if (overlay && e.key === 'Escape') { e.preventDefault(); close(); } }, true);
})();
