/* zwire HUD Internal — GLOBAL-THEME color for the chrome:// pages we can't
 * rewrite (flags, discards, dns, password-manager, …).
 *
 * This is NOT the old HUD skin: it deliberately drops all the HUD decoration
 * (grid lattice, CRT scanlines, neon glow, floating picker). It only maps the
 * ACTIVE scheme's palette onto Chrome's WebUI color tokens + applies the mono
 * font, so these pages simply inherit the same theme the rest of the browser
 * uses — no HUD chrome on top. Scheme = ~/.zwire/hud-scheme (native source
 * of truth), read via the background worker since content scripts can't call
 * sendNativeMessage.
 */
(function () {
  'use strict';
  var HUD = window.ZWIRE_HUD || {};
  var SCHEMES = HUD.SCHEMES || {};
  var VAR_KEYS = HUD.VAR_KEYS || [];
  var current = null;

  // Map Chrome WebUI tokens -> the scheme's HUD vars. Colors + font only.
  var MAP_CSS = [
    ':root, :host {',
    '  --color-sys-surface: var(--bg-primary) !important;',
    '  --color-sys-surface-variant: var(--bg-card) !important;',
    '  --color-sys-surface-subtle: var(--bg-secondary) !important;',
    '  --color-sys-base: var(--bg-primary) !important;',
    '  --color-sys-base-container: var(--bg-card) !important;',
    '  --color-sys-base-container-elevated: var(--bg-hover) !important;',
    '  --color-sys-header: var(--bg-secondary) !important;',
    '  --color-sys-header-container: var(--bg-secondary) !important;',
    '  --color-sys-on-surface: var(--text) !important;',
    '  --color-sys-on-surface-subtle: var(--text-dim) !important;',
    '  --color-sys-on-surface-variant: var(--text-dim) !important;',
    '  --color-sys-on-surface-secondary: var(--text-dim) !important;',
    '  --color-sys-primary: var(--cyan) !important;',
    '  --color-sys-on-primary: var(--bg-primary) !important;',
    '  --color-sys-primary-container: var(--bg-hover) !important;',
    '  --color-sys-on-primary-container: var(--accent) !important;',
    '  --color-sys-secondary: var(--accent) !important;',
    '  --color-sys-outline: var(--border) !important;',
    '  --color-sys-tonal-container: var(--bg-hover) !important;',
    '  --color-sys-tonal-outline: var(--border) !important;',
    '  --color-sys-neutral-container: var(--bg-card) !important;',
    '  --color-sys-inverse-surface: var(--text) !important;',
    '  --color-sys-state-hover-on-subtle: var(--bg-hover) !important;',
    '  --cr-fallback-color-base-container: var(--bg-card) !important;',
    '  --cr-fallback-color-surface: var(--bg-primary) !important;',
    '  --cr-fallback-color-primary: var(--cyan) !important;',
    '  --cr-fallback-color-on-surface: var(--text) !important;',
    '  --cr-fallback-color-on-surface-subtle: var(--text-dim) !important;',
    '  --cr-fallback-color-outline: var(--border) !important;',
    '  --cr-fallback-color-neutral-container: var(--bg-card) !important;',
    '  --cr-fallback-color-tonal-container: var(--bg-hover) !important;',
    '  --cr-fallback-color-divider: var(--border) !important;',
    '  --cr-card-background-color: var(--bg-card) !important;',
    '  --cr-primary-background-color: var(--bg-primary) !important;',
    '  --cr-secondary-background-color: var(--bg-secondary) !important;',
    '  --cr-primary-text-color: var(--text) !important;',
    '  --cr-secondary-text-color: var(--text-dim) !important;',
    '  --cr-toolbar-background-color: var(--bg-secondary) !important;',
    '  --cr-hover-background-color: var(--bg-hover) !important;',
    '  --cr-link-color: var(--cyan) !important;',
    '  --cr-focus-outline-color: var(--accent) !important;',
    '  --cr-toggle-color: var(--cyan) !important;',
    '  --cr-separator-line: 1px solid var(--border) !important;',
    '  --google-grey-900: var(--bg-primary) !important;',
    '  --google-grey-800: var(--bg-card) !important;',
    '  --google-grey-700: var(--bg-hover) !important;',
    '  --google-grey-500: var(--text-dim) !important;',
    '  --google-blue-300: var(--cyan) !important;',
    '  --google-blue-400: var(--cyan) !important;',
    '  --google-blue-500: var(--accent) !important;',
    '  --google-blue-600: var(--accent) !important;',
    '  color-scheme: dark;',
    '}',
    'html, body, :host { background-color: var(--bg-primary) !important; color: var(--text) !important; }',
    /* -webkit-text-fill-color overrides `color`; reset so text actually paints. */
    ':not([class*="icon"]):not(cr-icon):not(iron-icon) { -webkit-text-fill-color: currentColor !important; }',
    'a[href]:not(.cr-nav-menu-item):not([role="menuitem"]):not([role="tab"]) { color: var(--cyan) !important; }',
    /* nav/menu items: always readable, never dark-on-dark. */
    '.cr-nav-menu-item, [role="menuitem"], cr-menu-selector a, extensions-sidebar a {' +
    ' color: var(--text) !important; -webkit-text-fill-color: var(--text) !important;' +
    ' opacity: 1 !important; visibility: visible !important; }',
    '.cr-nav-menu-item.selected, [role="menuitem"][selected], .cr-nav-menu-item[selected],' +
    ' .cr-nav-menu-item[aria-selected="true"], .iron-selected, .selected {' +
    ' color: var(--cyan) !important; background: var(--bg-hover) !important;' +
    ' box-shadow: inset 3px 0 0 var(--cyan) !important; }',
    /* mono font (part of the global identity, not HUD decoration) */
    'body, div, span, p, a, h1, h2, h3, h4, h5, h6, ul, ol, li, td, th, dt, dd, label,' +
    ' button, input, textarea, select, code, pre, b, strong, em, small, cr-button, cr-input,' +
    ' .cr-title-text, .cr-secondary-text, .cr-padded-text { font-family: "Share Tech Mono","Monaco",monospace !important; }'
  ].join('\n');

  function injectInto(rootNode) {
    try {
      var host = (rootNode === document) ? (document.head || document.documentElement) : rootNode;
      if (!host || (host.querySelector && host.querySelector('style[data-zbtheme]'))) return;
      var st = document.createElement('style');
      st.setAttribute('data-zbtheme', '1');
      st.textContent = MAP_CSS;
      host.appendChild(st);
    } catch (e) {}
  }
  function walkShadows(node) {
    if (!node) return;
    if (node.shadowRoot) {
      injectInto(node.shadowRoot);
      var kids = node.shadowRoot.querySelectorAll('*');
      for (var i = 0; i < kids.length; i++) walkShadows(kids[i]);
    }
  }
  function reinject() {
    injectInto(document);
    var all = document.querySelectorAll('*');
    for (var i = 0; i < all.length; i++) walkShadows(all[i]);
  }

  // Light-mode neutral vars (from cyberpunk.css [data-theme="light"]). Applied on
  // TOP of the scheme's colored accents so content-script HUD surfaces (the ⌘K
  // palette etc.) flip to a light surface, matching the HUD pages' light mode.
  var LIGHT_VARS = {
    '--bg-primary': '#f0f2f5', '--bg-secondary': '#e4e7ec', '--bg-card': '#ffffff', '--bg-hover': '#f7f8fa',
    '--text': '#1e293b', '--text-dim': '#475569', '--text-muted': '#94a3b8',
    '--border': '#cbd5e1', '--border-glow': '#a5b4c8'
  };
  var light = false;

  function applyScheme(name) {
    var s = SCHEMES[name] || SCHEMES.cyberpunk;
    if (!s) return;
    var vars = s.vars || {}, root = document.documentElement;
    for (var i = 0; i < VAR_KEYS.length; i++) if (vars[VAR_KEYS[i]]) root.style.setProperty(VAR_KEYS[i], vars[VAR_KEYS[i]]);
    if (light) { for (var k in LIGHT_VARS) root.style.setProperty(k, LIGHT_VARS[k]); root.setAttribute('data-theme', 'light'); }
    else { root.removeAttribute('data-theme'); }
    root.setAttribute('data-hud-scheme', name);
    current = name;
  }
  function setLight(on) { on = !!on; if (on === light) return; light = on; applyScheme(current || 'cyberpunk'); }

  // Primary source: chrome.storage.local['zb_scheme']. A content script reads
  // storage directly (no need to wake the lazy MV3 worker), and the picker
  // writes it synchronously + persistently, so it survives restarts. Reading
  // storage here is instant and reliable; the worker is only a best-effort
  // refresher for the case where the scheme file was changed out-of-band.
  function fetchScheme(cb) {
    try {
      chrome.storage.local.get('zb_scheme', function (o) {
        void chrome.runtime.lastError;
        if (o && o.zb_scheme) return cb(o.zb_scheme);
        // storage not seeded yet (scheme set externally) — wake the worker to
        // read the native file and mirror it; onChanged will deliver the value.
        try { chrome.runtime.sendMessage({ type: 'zbhud-get' }, function (r) {
          void chrome.runtime.lastError; if (r && r.scheme) cb(r.scheme);
        }); } catch (e) {}
        cb('cyberpunk');
      });
    } catch (e) { cb('cyberpunk'); }
  }

  function boot() {
    applyScheme('cyberpunk');  // avoid flash of stock theme
    reinject();
    // read the persisted light flag (mirrored to chrome.storage as zb_ui.light)
    // BEFORE the first real scheme apply, so the palette opens light immediately.
    try { chrome.storage.local.get('zb_ui', function (o) { void chrome.runtime.lastError; if (o && o.zb_ui) light = !!o.zb_ui.light; fetchScheme(applyScheme); }); } catch (e) { fetchScheme(applyScheme); }
    // live updates: storage.onChanged fires the instant the picker writes.
    try {
      chrome.storage.onChanged.addListener(function (ch, area) {
        if (area !== 'local') return;
        if (ch.zb_scheme && ch.zb_scheme.newValue) applyScheme(ch.zb_scheme.newValue);
        if (ch.zb_ui) setLight(!!(ch.zb_ui.newValue && ch.zb_ui.newValue.light));
      });
    } catch (e) {}
    var obs = new MutationObserver(function () { reinject(); });
    try { obs.observe(document.documentElement, { childList: true, subtree: true }); } catch (e) {}
    // safety poll in case a write bypassed onChanged (e.g. cross-extension).
    setInterval(function () { fetchScheme(function (s) { if (s !== current) applyScheme(s); }); }, 1500);
  }

  if (document.readyState === 'loading') {
    boot();
    document.addEventListener('DOMContentLoaded', reinject);
  } else { boot(); }
})();
