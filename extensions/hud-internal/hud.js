/* zbrowser HUD Internal — cyberpunk skin + 8-scheme picker for chrome:// pages.
 *
 * Runs as a content script on chrome://*\/* (needs --extensions-on-chrome-urls).
 * Strategy:
 *   1. applyScheme() sets the ~20 strykelang HUD vars (--accent, --bg-primary…)
 *      on :root. Custom props inherit through shadow boundaries.
 *   2. A token-remap stylesheet (MAP_CSS) is injected into the main document AND
 *      into every shadow root (recursively + via MutationObserver), so Chrome's
 *      WebUI tokens (--color-sys-*, --cr-*, --google-*) resolve to our HUD vars
 *      even though cr-elements define them shadow-locally.
 *   3. A floating picker (8 schemes + LIGHT/CRT/NEON) persists via chrome.storage.
 */
(function () {
  'use strict';
  var HUD = window.ZBROWSER_HUD || {};
  var SCHEMES = HUD.SCHEMES || {};
  var ORDER = HUD.ORDER || ['cyberpunk'];
  var VAR_KEYS = HUD.VAR_KEYS || [];
  var STORE = { scheme: 'zb_hud_scheme', light: 'zb_hud_light', crt: 'zb_hud_crt_v2', neon: 'zb_hud_neon_v2' };

  // CRT scanlines + neon ON by default so internal pages match the newtab HUD.
  var state = { scheme: 'cyberpunk', light: false, crt: true, neon: true };

  // ---- token remap: Chrome WebUI tokens -> HUD vars (injected everywhere) ----
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
    /* cr-element fallback tokens */
    '  --cr-fallback-color-base-container: var(--bg-card) !important;',
    '  --cr-fallback-color-surface: var(--bg-primary) !important;',
    '  --cr-fallback-color-primary: var(--cyan) !important;',
    '  --cr-fallback-color-on-surface: var(--text) !important;',
    '  --cr-fallback-color-on-surface-subtle: var(--text-dim) !important;',
    '  --cr-fallback-color-outline: var(--border) !important;',
    '  --cr-fallback-color-neutral-container: var(--bg-card) !important;',
    '  --cr-fallback-color-tonal-container: var(--bg-hover) !important;',
    '  --cr-fallback-color-divider: var(--border) !important;',
    /* classic cr tokens */
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
    /* legacy google palette (older WebUI still references these) */
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
    /* CRITICAL: some WebUI text uses -webkit-text-fill-color which overrides',
     * `color` entirely — reset it so our colors actually paint (was the cause',
     * of "light color per devtools but black on screen" invisible text). */
    ':not([class*="icon"]):not(cr-icon):not(iron-icon) { -webkit-text-fill-color: currentColor !important; }',
    /* strykelang background grid — always on, subtle neon lattice on the page bg */
    'html, body { background-image:' +
      ' linear-gradient(var(--border) 1px, transparent 1px),' +
      ' linear-gradient(90deg, var(--border) 1px, transparent 1px) !important;' +
      ' background-size: 26px 26px !important; background-position:-1px -1px !important; }',
    /* neon on real hyperlinks only — NOT nav/menu items (they own their tokens,',
     * else selected nav goes cyan-text-on-cyan and vanishes) */
    'a[href]:not(.cr-nav-menu-item):not([role="menuitem"]):not([role="tab"]) { color: var(--cyan) !important; }',
    /* nav/menu items: ALWAYS light text (never dark-on-dark). Selected item is',
     * marked by a cyan glow + left bar, not by inverting text, so it can never',
     * vanish regardless of which selector the WebUI uses for "selected". */
    '.cr-nav-menu-item, [role="menuitem"], cr-menu-selector a, extensions-sidebar a {' +
    ' color: var(--text) !important; -webkit-text-fill-color: var(--text) !important;' +
    ' opacity: 1 !important; visibility: visible !important; filter: none !important;' +
    ' mix-blend-mode: normal !important; text-shadow: none !important; }',
    '.cr-nav-menu-item.selected, [role="menuitem"][selected], .cr-nav-menu-item[selected],' +
    ' .cr-nav-menu-item[aria-selected="true"], .iron-selected, .selected {' +
    ' color: var(--cyan) !important; background: var(--bg-hover) !important;' +
    ' box-shadow: inset 3px 0 0 var(--cyan) !important; }',
    /* mono font on text elements (explicit list avoids clobbering icon fonts) */
    'body, div, span, p, a, h1, h2, h3, h4, h5, h6, ul, ol, li, td, th, dt, dd, label,' +
    ' button, input, textarea, select, code, pre, b, strong, em, small, cr-button, cr-input,' +
    ' .cr-title-text, .cr-secondary-text, .cr-padded-text { font-family: "Share Tech Mono","Monaco",monospace !important; }',
    /* NEON mode glow, gated on a root attribute (works in shadow via host-context) */
    ':host-context([data-hud-neon]) a, [data-hud-neon] a,' +
    ' :host-context([data-hud-neon]) h1, [data-hud-neon] h1,' +
    ' :host-context([data-hud-neon]) h2, [data-hud-neon] h2,' +
    ' :host-context([data-hud-neon]) .cr-title-text, [data-hud-neon] .cr-title-text { text-shadow: 0 0 7px var(--accent-glow), 0 0 3px var(--cyan-glow); }',
    ':host-context([data-hud-neon]) button, [data-hud-neon] button,' +
    ' :host-context([data-hud-neon]) cr-button, [data-hud-neon] cr-button { box-shadow: 0 0 8px var(--cyan-dim) !important; }'
  ].join('\n');

  function injectInto(rootNode) {
    try {
      var host = (rootNode === document) ? (document.head || document.documentElement) : rootNode;
      if (!host) return;
      if (host.querySelector && host.querySelector('style[data-zbhud-map]')) return;
      var st = document.createElement('style');
      st.setAttribute('data-zbhud-map', '1');
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

  // ---- scheme application ----
  function applyScheme() {
    var s = SCHEMES[state.scheme] || SCHEMES.cyberpunk;
    if (!s) return;
    var vars = (state.light && s.lightVars) ? s.lightVars : s.vars;
    var root = document.documentElement;
    for (var i = 0; i < VAR_KEYS.length; i++) {
      var k = VAR_KEYS[i];
      if (vars[k]) root.style.setProperty(k, vars[k]);
    }
    root.setAttribute('data-hud-scheme', state.scheme);
    root.toggleAttribute('data-hud-light', !!state.light);
    root.toggleAttribute('data-hud-neon', !!state.neon);
    root.toggleAttribute('data-hud-crt', !!state.crt);
    updateCrt();
    if (pickerEl) renderPicker();
  }

  // ---- CRT scanline overlay (created once, toggled by display) ----
  var crtEl = null;
  function ensureCrt() {
    if (crtEl && crtEl.isConnected) return;
    crtEl = document.createElement('div');
    crtEl.id = 'zbhud-crt';
    crtEl.style.display = 'none';
    (document.body || document.documentElement).appendChild(crtEl);
  }
  function updateCrt() {
    ensureCrt();
    crtEl.style.display = state.crt ? 'block' : 'none';
  }

  // ---- picker UI ----
  var pickerEl = null, panelEl = null;
  function persist() {
    try {
      var o = {}; o[STORE.scheme] = state.scheme; o[STORE.light] = state.light;
      o[STORE.crt] = state.crt; o[STORE.neon] = state.neon;
      if (chrome && chrome.storage && chrome.storage.local) chrome.storage.local.set(o);
    } catch (e) {}
    // Bridge to the native color mixer: content scripts can't call
    // sendNativeMessage, so relay through the background worker, which writes
    // ~/.zbrowser/hud-scheme via the native host. The compiled mixer then
    // repaints the browser chrome (tabs/toolbar/frame/side-panel) to match.
    try {
      if (chrome && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({ type: 'zbhud-scheme', scheme: state.scheme },
          function () { void chrome.runtime.lastError; });
      }
    } catch (e) {}
  }

  function renderPicker() {
    if (!panelEl) return;
    panelEl.innerHTML = '';
    var title = document.createElement('div');
    title.className = 'zbhud-title'; title.textContent = '// COLOR SCHEME';
    panelEl.appendChild(title);
    var grid = document.createElement('div'); grid.className = 'zbhud-grid';
    ORDER.forEach(function (name) {
      var s = SCHEMES[name]; if (!s) return;
      var b = document.createElement('button');
      b.className = 'zbhud-btn' + (name === state.scheme ? ' active' : '');
      var dot = document.createElement('span'); dot.className = 'zbhud-dot';
      dot.style.background = 'linear-gradient(135deg,' + s.vars['--accent'] + ' 0 50%,' + s.vars['--cyan'] + ' 50% 100%)';
      var lbl = document.createElement('span'); lbl.textContent = (s.label || name);
      b.appendChild(dot); b.appendChild(lbl);
      b.onclick = function () { state.scheme = name; applyScheme(); persist(); };
      grid.appendChild(b);
    });
    panelEl.appendChild(grid);
    var modes = document.createElement('div'); modes.className = 'zbhud-modes';
    [['LIGHT', 'light'], ['CRT', 'crt'], ['NEON', 'neon']].forEach(function (m) {
      var b = document.createElement('button');
      b.className = 'zbhud-mode' + (state[m[1]] ? ' on' : '');
      b.textContent = m[0];
      b.onclick = function () { state[m[1]] = !state[m[1]]; applyScheme(); persist(); };
      modes.appendChild(b);
    });
    panelEl.appendChild(modes);
  }

  var inDrawer = location.href.indexOf('customize-chrome-side-panel') !== -1;

  function buildPicker() {
    if (pickerEl) return;
    pickerEl = document.createElement('div');
    pickerEl.id = 'zbhud-picker';
    panelEl = document.createElement('div'); panelEl.id = 'zbhud-panel'; panelEl.style.display = 'block';
    if (inDrawer) {
      // Render inline as a section inside the "Customize Chromium" drawer.
      pickerEl.className = 'zbhud-in-drawer';
      pickerEl.appendChild(panelEl);
      var b = document.body || document.documentElement;
      b.insertBefore(pickerEl, b.firstChild);
    } else {
      var toggle = document.createElement('button');
      toggle.id = 'zbhud-toggle'; toggle.textContent = '◨ HUD';
      toggle.onclick = function () { panelEl.style.display = panelEl.style.display === 'none' ? 'block' : 'none'; };
      pickerEl.appendChild(toggle); pickerEl.appendChild(panelEl);
      (document.body || document.documentElement).appendChild(pickerEl);
    }
    injectPickerStyle();
    renderPicker();
  }

  function injectPickerStyle() {
    var css = [
      '#zbhud-picker{position:fixed;right:14px;bottom:14px;z-index:2147483647;font-family:"Share Tech Mono",Monaco,monospace;}',
      '#zbhud-picker.zbhud-in-drawer{position:fixed;top:78px;left:8px;right:8px;bottom:auto;margin:0;z-index:2147483000;}',
      '.zbhud-in-drawer #zbhud-panel{width:auto;}',
      '.zbhud-in-drawer #zbhud-panel{margin:0;box-shadow:none;}',
      '#zbhud-toggle{background:var(--bg-card);color:var(--cyan);border:1px solid var(--cyan);border-radius:2px;padding:6px 10px;font:inherit;font-size:12px;letter-spacing:1px;cursor:pointer;box-shadow:0 0 10px var(--cyan-dim);}',
      '#zbhud-panel{margin-top:8px;background:var(--bg-secondary);border:1px solid var(--accent);border-radius:2px;padding:12px;min-width:230px;box-shadow:0 0 22px var(--accent-glow);}',
      '.zbhud-title{color:var(--accent);font-size:11px;letter-spacing:2px;margin-bottom:10px;}',
      '.zbhud-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px;}',
      '.zbhud-btn{display:flex;align-items:center;gap:7px;background:var(--bg-card);border:1px solid var(--border);border-radius:2px;color:var(--text-dim);padding:6px 8px;font:inherit;font-size:11px;cursor:pointer;text-align:left;}',
      '.zbhud-btn.active{border-color:var(--cyan);color:var(--text);box-shadow:0 0 8px var(--cyan-dim);}',
      '.zbhud-dot{width:12px;height:12px;border-radius:50%;flex:0 0 auto;box-shadow:0 0 6px var(--accent-glow);}',
      '.zbhud-modes{display:flex;gap:6px;margin-top:10px;}',
      '.zbhud-mode{flex:1;background:var(--bg-card);border:1px solid var(--border);border-radius:2px;color:var(--text-dim);padding:5px 0;font:inherit;font-size:11px;letter-spacing:1px;cursor:pointer;}',
      '.zbhud-mode.on{border-color:var(--accent);color:var(--accent);box-shadow:0 0 8px var(--accent-glow);}',
      '#zbhud-crt{position:fixed;inset:0;z-index:2147483000;pointer-events:none;' +
        'background:repeating-linear-gradient(0deg,rgba(0,0,0,0.16) 0,rgba(0,0,0,0.16) 1px,rgba(0,0,0,0) 2px,rgba(0,0,0,0) 3px);' +
        'animation:zbhud-flicker 6s infinite;}',
      '@keyframes zbhud-flicker{0%,100%{opacity:1}48%{opacity:.92}50%{opacity:.82}52%{opacity:.95}}'
    ].join('\n');
    var st = document.createElement('style'); st.id = 'zbhud-picker-style'; st.textContent = css;
    (document.head || document.documentElement).appendChild(st);
  }

  // ---- boot ----
  function boot() {
    applyScheme();     // apply default immediately (avoid flash)
    reinject();
    if (document.body) buildPicker();
    // load persisted prefs (async), then re-apply
    try {
      if (chrome && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get([STORE.scheme, STORE.light, STORE.crt, STORE.neon], function (r) {
          if (r && r[STORE.scheme]) state.scheme = r[STORE.scheme];
          if (r) {
            state.light = !!r[STORE.light];
            state.crt = (STORE.crt in r) ? !!r[STORE.crt] : true;   // default ON
            state.neon = (STORE.neon in r) ? !!r[STORE.neon] : true; // default ON
          }
          applyScheme();
        });
      }
    } catch (e) {}
  }

  // Re-inject into shadow roots as the WebUI builds itself.
  var obs = new MutationObserver(function () { reinject(); });
  function startObserver() {
    try { obs.observe(document.documentElement, { childList: true, subtree: true }); } catch (e) {}
  }

  if (document.readyState === 'loading') {
    boot(); startObserver();
    document.addEventListener('DOMContentLoaded', function () { reinject(); if (!pickerEl) buildPicker(); });
  } else {
    boot(); startObserver();
  }
})();
