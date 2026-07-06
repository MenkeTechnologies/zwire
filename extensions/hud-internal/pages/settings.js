/* zwire HUD Settings — full chrome://settings reimplementation on
 * chrome.settingsPrivate (allowlisted for our extension): every real pref is
 * rendered from getAllPrefs, grouped + filterable, with a zgui-core control per
 * type. Appearance hosts the 8-scheme picker (bridged to the native palette).
 * All widgets are ZGui.* per the zgui-core-only rule. */
(function () {
  'use strict';
  var sp = chrome.settingsPrivate;
  var FZ = window.ZGui.fzf;
  var shell, body, prefs = [], query = '', uiSeeded = false;

  function el(t, c, h) { var e = document.createElement(t); if (c) e.className = c; if (h != null) e.innerHTML = h; return e; }
  function pretty(s) { return s.replace(/[._]/g, ' ').replace(/\b\w/g, function (m) { return m.toUpperCase(); }); }

  // Push the current light + effect state to the native file so newtab (a
  // separate extension) follows it — localStorage doesn't cross origins.
  function publishUi() {
    if (!window.ZBHUD || !ZBHUD.publishUi) return;
    var ui = {};
    try { if (ZGui.colorscheme) ui.light = !!ZGui.colorscheme.isLight(); } catch (e) {}
    try { if (ZGui.fx) { var a = ZGui.fx.all(); ui.scanlines = a.scanlines; ui.vignette = a.vignette; ui.glow = a.glow; ui.anim = a.anim; } } catch (e) {}
    ZBHUD.publishUi(ui);
    // Mirror to chrome.storage so CONTENT-SCRIPT surfaces (⌘K palette, statusbar,
    // tmux on web pages) can honor light mode — localStorage doesn't cross into
    // the page origin, but chrome.storage does.
    try { chrome.storage.local.set({ zb_ui: ui }); } catch (e) {}
  }
  function labelOf(key) { var p = key.split('.'); return pretty(p.slice(-2).join(' ')); }

  /* -------------------------------------------------------- appearance card */
  function appearanceCard() {
    var inner = el('div');
    inner.appendChild(el('div', 'set-h', '// APPEARANCE · COLOR SCHEME'));
    if (window.ZGui.colorscheme) {
      // app-store style picker (added to zgui-core as ZGui.colorscheme.buildSchemeCards)
      inner.appendChild(ZGui.colorscheme.buildSchemeCards(function () { /* native bridge in zg-boot onApply */ }));
      var lrow = el('label', 'xt-switch full');
      lrow.appendChild(el('span', null, 'Light mode'));
      var lt = ZGui.toggle({ checked: ZGui.colorscheme.isLight(), onChange: function (on) { ZGui.colorscheme.setLight(on); publishUi(); } });
      lrow.appendChild(lt.el); inner.appendChild(lrow);
    }
    return ZGui.card({ body: inner }).el;
  }

  /* -------------------------------------------------------------- fx card */
  // The cyberpunk effect toggles (CRT scanlines, bezel vignette, neon glow,
  // animations) live in ZGui.fx — CSS ships on every page via all.css, but the
  // toggle UI was never mounted, so they appeared "missing". Render the built-in
  // toggle row here and bridge the CRT/glow toggles to the legacy crt.js beam +
  // neonGlow layers so flipping them off actually clears everything on screen.
  function effectsCard() {
    if (!window.ZGui.fx) return null;
    try { ZGui.fx.load(); } catch (e) {}
    var crtCtl = null; try { if (ZGui.crt) crtCtl = ZGui.crt(); } catch (e) {}
    var inner = el('div');
    inner.appendChild(el('div', 'set-h', '// APPEARANCE · EFFECTS'));
    inner.appendChild(ZGui.fx.buildToggles({ onChange: function (name, on) {
      if (name === 'scanlines' && crtCtl) { try { crtCtl.set(on); } catch (e) {} }
      if (name === 'glow' && ZGui.neonGlow) { try { ZGui.neonGlow.set(on); } catch (e) {} }
      publishUi();
    } }));
    // seed the native file from local state ONCE (render() re-runs per keystroke).
    if (!uiSeeded) { uiSeeded = true; publishUi(); }
    return ZGui.card({ body: inner }).el;
  }

  /* --------------------------------------------------------------- pref row */
  function setPref(p, v) {
    sp.setPref(p.key, v, '', function (ok) {
      void chrome.runtime.lastError;
      if (!ok && window.ZGui.toast) ZGui.toast('Could not set ' + p.key);
      else p.value = v;
    });
  }
  function control(p) {
    var disabled = !!p.controlledBy || !!p.userControlDisabled, c;
    if (p.type === 'BOOLEAN') {
      c = ZGui.toggle({ checked: !!p.value, onChange: function (v) { setPref(p, v); } }).el;
    } else if (p.userSelectableValues && p.userSelectableValues.length) {
      c = ZGui.select({ options: p.userSelectableValues.map(function (v) { return [v, String(v)]; }), value: p.value, onChange: function (v) { setPref(p, v); } }).el;
    } else if (p.type === 'NUMBER') {
      c = ZGui.textfield({ value: p.value, type: 'number', onEnter: function (v) { setPref(p, Number(v)); } }).el;
    } else if (p.type === 'STRING' || p.type === 'URL') {
      c = ZGui.textfield({ value: p.value == null ? '' : p.value, onEnter: function (v) { setPref(p, v); } }).el;
    } else { // LIST / DICTIONARY — read-only JSON
      var ta = ZGui.textarea({ value: JSON.stringify(p.value), rows: 2 }); ta.el.readOnly = true; c = ta.el;
    }
    if (disabled) { c.style.pointerEvents = 'none'; c.style.opacity = '.5'; }
    return c;
  }
  function prefRow(p) {
    var f = ZGui.field({ label: labelOf(p.key), control: control(p),
      help: p.key + (p.controlledBy ? ' · controlled by ' + String(p.controlledBy).toLowerCase() : '') });
    f.el.setAttribute('data-key', p.key);
    return f.el;
  }

  /* ------------------------------------------------------------------ render */
  function matches(p) {
    if (!query.trim()) return true;
    return !!(FZ.fzfMatch(query, p.key) || FZ.fzfMatch(query, labelOf(p.key)));
  }
  function render() {
    body.innerHTML = '';
    body.appendChild(appearanceCard());
    var fxc = effectsCard(); if (fxc) body.appendChild(fxc);
    var groups = {};
    prefs.forEach(function (p) { if (!matches(p)) return; var g = p.key.split('.')[0]; (groups[g] = groups[g] || []).push(p); });
    var keys = Object.keys(groups).sort();
    if (!keys.length) { body.appendChild(el('div', 'footer-docs', '[ no settings match ]')); return; }
    keys.forEach(function (g) {
      var inner = el('div');
      inner.appendChild(el('div', 'set-h', '// ' + pretty(g)));
      groups[g].sort(function (a, b) { return a.key.localeCompare(b.key); }).forEach(function (p) { inner.appendChild(prefRow(p)); });
      body.appendChild(ZGui.card({ body: inner }).el);
    });
    body.appendChild(el('div', 'footer-docs', '[ ' + prefs.length + ' settings · settingsPrivate ]'));
  }

  function mergeChanged(list) {
    (list || []).forEach(function (cp) {
      for (var i = 0; i < prefs.length; i++) if (prefs[i].key === cp.key) { prefs[i] = cp; return; }
      prefs.push(cp);
    });
  }

  function boot() {
    shell = ZBHUD.mount({ title: 'SETTINGS', current: 'settings.html', filterPlaceholder: 'filter settings…',
      onFilter: function (q) { query = q; render(); } });
    body = shell.body;
    sp.getAllPrefs(function (list) {
      void chrome.runtime.lastError;
      prefs = (list || []).slice().sort(function (a, b) { return a.key.localeCompare(b.key); });
      render();
    });
    if (sp.onPrefsChanged) sp.onPrefsChanged.addListener(function (changed) { mergeChanged(changed); render(); });
    // Keep the light/effect SWITCHES in sync when the state is changed elsewhere
    // (⌘K palette command, another surface): reconcile ZGui state to zb_ui, then
    // re-render so the toggles reflect it. Without this the switch went stale.
    try {
      chrome.storage.onChanged.addListener(function (ch, area) {
        if (area !== 'local' || !ch.zb_ui) return;
        var ui = ch.zb_ui.newValue || {};
        try { if (ZGui.colorscheme && ZGui.colorscheme.setLight && typeof ui.light === 'boolean' && ZGui.colorscheme.isLight() !== ui.light) ZGui.colorscheme.setLight(ui.light); } catch (e) {}
        try { if (ZGui.fx && ZGui.fx.set) ['scanlines', 'vignette', 'glow', 'anim'].forEach(function (n) { if (typeof ui[n] === 'boolean' && ZGui.fx.get(n) !== ui[n]) ZGui.fx.set(n, ui[n]); }); } catch (e) {}
        render();
      });
    } catch (e) {}
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
