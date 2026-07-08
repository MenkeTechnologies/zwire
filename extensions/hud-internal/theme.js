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
    /* Modern WebUI pages (settings/extensions/history/…) are fully driven by the
       remapped --color-sys-* / --cr-* tokens above, so they theme correctly with
       NO blanket color/background override. We deliberately do NOT force
       `html,body{color}` or `-webkit-text-fill-color:currentColor` globally — that
       made legacy token-less pages (chrome://omnibox etc.) render light-on-light /
       dark-on-dark and unreadable. Legacy pages get an explicit, readable dark
       skin via PAGE_CSS[host] below instead. */
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

  // ── Per-chrome://-URL custom CSS ─────────────────────────────────────
  // The token remap (MAP_CSS) themes MODERN WebUI pages. Legacy, token-less
  // debug pages (chrome://omnibox, net-internals, tracing, …) need an explicit
  // skin or they stay Chrome-default (or, with a blanket override, become
  // unreadable). LEGACY_DARK forces a self-consistent dark theme with readable
  // contrast: containers go transparent (so the dark body shows through, never
  // light-on-light), text goes light, form controls get a dark field. Add a
  // dedicated entry to PAGE_CSS for any page that needs bespoke tweaks.
  // Restyle native, token-less debug pages in zgui-core's ACTUAL design language:
  // the values here are lifted from zgui-core's component CSS — ZGui.dataTable
  // (thead/tbody/hover/zebra), ZGui.searchBox (input + cyan focus glow), zs-btn
  // (uppercase, cyan hover glow), and the card chrome — so these pages read like
  // first-class HUD surfaces, not a crude dark override.
  var LEGACY_DARK = [
    /* page surface — the HUD backdrop + mono type */
    'html, body { background-color: var(--bg-primary) !important; color: var(--text) !important;',
    '  font-family: "Share Tech Mono","Monaco",monospace !important; }',
    /* headings — Orbitron/cyan, like a zgui card header (.set-h) */
    'h1, h2, h3, h4, h5, h6 { color: var(--cyan) !important; font-family: "Orbitron", sans-serif !important; letter-spacing: 1px !important; }',
    /* generic containers go transparent so the backdrop shows through (never light-on-light) */
    'div, span, p, article, ul, ol, li, dl, dt, dd, label, caption, small, b, strong, em, tt {',
    '  background-color: transparent !important; color: var(--text) !important; border-color: var(--border) !important; }',
    /* box-like elements → ZGui.card (bg-card, border, subtle cyan glow) */
    'fieldset, section, .widget, .box, [class*="panel"], [class*="card"], [class*="container"] {',
    '  background-color: var(--bg-card) !important; border: 1px solid var(--border) !important;',
    '  box-shadow: 0 0 0 1px var(--cyan-dim), 0 4px 18px rgba(0,0,0,.4) !important; padding: 10px !important; }',
    'legend { color: var(--cyan) !important; font-family: "Orbitron", sans-serif !important; text-transform: uppercase !important; font-size: 11px !important; letter-spacing: 1px !important; }',
    /* tables → ZGui.dataTable */
    'table { width: 100% !important; border-collapse: collapse !important; font-size: 12px !important; background: var(--bg-card) !important; }',
    'thead th, th { text-align: left !important; padding: 7px 10px !important; background: var(--bg-secondary) !important;',
    '  border-bottom: 1px solid var(--border) !important; color: var(--text-dim) !important; font-family: "Orbitron", sans-serif !important;',
    '  font-size: 10px !important; letter-spacing: 1px !important; text-transform: uppercase !important; }',
    'tbody td, td { padding: 6px 10px !important; border-bottom: 1px solid var(--border) !important; color: var(--text) !important; background-color: transparent !important; }',
    'tbody tr:hover td { background: var(--bg-hover) !important; }',
    'tbody tr:nth-child(even) td { background-color: rgba(255,255,255,0.02) !important; }',
    /* form fields → ZGui.searchBox */
    /* form fields — readability fallback ONLY where the adapter hasn't added the
       real zgui .zs-input class (dynamic pages the adapter doesn't convert). */
    'input:not(.zs-input), textarea:not(.zs-input), select:not(.zs-input) { background: var(--bg-secondary) !important; color: var(--cyan) !important; border: 1px solid var(--border) !important;',
    '  border-radius: 2px !important; padding: 7px 10px !important; font-family: inherit !important; }',
    'input:not(.zs-input):focus, textarea:not(.zs-input):focus, select:not(.zs-input):focus { outline: none !important; border-color: var(--cyan) !important; box-shadow: 0 0 15px var(--cyan-glow) !important; }',
    'input::placeholder, textarea::placeholder { color: var(--text-muted) !important; }',
    'input[type=checkbox], input[type=radio] { accent-color: var(--cyan) !important; }',
    /* buttons — fallback ONLY where the adapter hasn't added the real .zs-btn class */
    'button:not(.zs-btn), input[type=button]:not(.zs-btn), input[type=submit]:not(.zs-btn), input[type=reset]:not(.zs-btn) { background: var(--bg-secondary) !important; color: var(--text-dim) !important;',
    '  border: 1px solid var(--border) !important; border-radius: 0 !important; padding: 6px 12px !important; font-family: inherit !important;',
    '  letter-spacing: 1px !important; text-transform: uppercase !important; cursor: pointer !important; }',
    'button:not(.zs-btn):hover, input[type=button]:not(.zs-btn):hover, input[type=submit]:not(.zs-btn):hover, input[type=reset]:not(.zs-btn):hover { border-color: var(--cyan) !important;',
    '  color: var(--cyan) !important; box-shadow: 0 0 8px var(--cyan-glow) !important; }',
    /* code + links */
    'pre, code, tt { background-color: var(--bg-secondary) !important; color: var(--text) !important; border: 1px solid var(--border) !important; padding: 1px 4px !important; }',
    'a, a:link, a:visited { color: var(--cyan) !important; }'
  ].join('\n');

  // chrome://<host> that are legacy/token-less and read best with LEGACY_DARK.
  var LEGACY_HOSTS = ['omnibox', 'net-internals', 'net-export', 'net-export', 'histograms', 'tracing',
    'device-log', 'discards', 'media-internals', 'media-engagement', 'webrtc-internals', 'webrtc-logs',
    'gcm-internals', 'sync-internals', 'signin-internals', 'prefs-internals', 'quota-internals',
    'indexeddb-internals', 'blob-internals', 'serviceworker-internals', 'process-internals',
    'memory-internals', 'ukm', 'user-actions', 'autofill-internals', 'attribution-internals',
    'site-engagement', 'predictors', 'translate-internals', 'topics-internals', 'usb-internals',
    'bluetooth-internals', 'gpu', 'system', 'version', 'crashes', 'components', 'policy', 'dino',
    'interstitials', 'network-errors', 'download-internals', 'metrics-internals', 'ntp-tiles-internals',
    'app-service-internals', 'web-app-internals', 'suggest-internals', 'segmentation-internals'];
  var PAGE_CSS = {};
  LEGACY_HOSTS.forEach(function (h) { PAGE_CSS[h] = LEGACY_DARK; });

  function pageCss() { try { return PAGE_CSS[location.host] || ''; } catch (e) { return ''; } }

  function injectInto(rootNode) {
    try {
      var host = (rootNode === document) ? (document.head || document.documentElement) : rootNode;
      if (!host || (host.querySelector && host.querySelector('style[data-zbtheme]'))) return;
      var st = document.createElement('style');
      st.setAttribute('data-zbtheme', '1');
      st.textContent = MAP_CSS + '\n' + pageCss();
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
