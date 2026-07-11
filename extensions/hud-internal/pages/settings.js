/* zwire HUD Settings — full chrome://settings reimplementation on
 * chrome.settingsPrivate (allowlisted for our extension): every real pref is
 * rendered from getAllPrefs, grouped + filterable, with a zgui-core control per
 * type. Appearance hosts the 8-scheme picker (bridged to the native palette).
 * All widgets are ZGui.* per the zgui-core-only rule. */
(function () {
  'use strict';
  var sp = chrome.settingsPrivate;
  var FZ = window.ZGui.fzf;
  var shell, body, prefs = [], query = '', regexOn = false;

  // Deep-link: redirect.js forwards chrome://settings/<slug> here as
  // ?section=<slug> so we can land on the matching group instead of the top.
  // A native settings slug isn't always the pref-group key, so alias the ones
  // that differ; anything else falls back to a substring match on the group.
  var pendingSection = null;
  try { pendingSection = (new URLSearchParams(location.search)).get('section'); } catch (e) {}
  var SECTION_ALIAS = {
    performance: 'performance_tuning', downloads: 'download',
    onstartup: 'session', search: 'default_search', languages: 'intl',
    accessibility: 'settings', autofill: 'autofill', privacy: 'profile',
    appearance: 'appearance'
  };
  if (pendingSection) {
    var st = document.createElement('style');
    st.textContent = '[data-section-focus]{outline:1px solid var(--zb-cyan,#05d9e8);' +
      'box-shadow:0 0 0 3px color-mix(in srgb,var(--zb-cyan,#05d9e8) 30%,transparent);' +
      'transition:box-shadow .3s,outline-color .3s;}';
    (document.head || document.documentElement).appendChild(st);
  }

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
      // Custom-scheme CRUD — the SAME wiring as the shared appShell settings modal
      // (lib/zgui-core/webui/app-shell.js openSettings). A <details> holding the
      // per-token color editor + saved-preset chips. buildEditor persists as
      // 'custom' and fires the zg-boot onApply native bridge, so a custom scheme
      // syncs to the host + new-tab page exactly like a built-in preset does.
      if (ZGui.colorscheme.buildEditor) {
        var cd = el('details', 'zg-shell-custom');
        cd.appendChild(el('summary', null, 'Custom scheme…'));
        var editHost = el('div');
        try { ZGui.colorscheme.buildEditor(editHost); } catch (e) {}
        cd.appendChild(editHost);
        if (ZGui.colorscheme.buildPresetChips) {
          var chips = el('div');
          try { ZGui.colorscheme.buildPresetChips(chips); } catch (e) {}
          cd.appendChild(chips);
        }
        inner.appendChild(cd);
      }
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
    // tmux/session status bar = the powerline (zstatus.js, zb_status). One flag,
    // so this Settings switch stays in sync with the ⌘K "Toggle …status bar".
    if (ZGui.toggle) {
      var tsRow = el('label', 'xt-switch full');
      tsRow.appendChild(el('span', null, 'tmux / session status bar (powerline)'));
      var tsT = ZGui.toggle({ checked: true, onChange: function (on) { try { chrome.storage.local.set({ zb_status: on }); } catch (e) {} } });
      tsRow.appendChild(tsT.el); inner.appendChild(tsRow);
      try { chrome.storage.local.get('zb_status', function (o) { void chrome.runtime.lastError; var inp = tsRow.querySelector('input[type=checkbox]'); if (inp) inp.checked = !(o && o.zb_status === false); }); } catch (e) {}
    }
    // NB: do NOT seed the host from local state here. ZGui light/fx state is
    // restored synchronously from per-origin localStorage (colorscheme.load /
    // fx.load) and only reconciled to the fleet truth (zb_ui ← ~/.zwire/global
    // .toml) ASYNCHRONOUSLY by boot()'s reconcile below. A publish on render
    // races that reconcile: when it wins, it writes the STALE local light/fx back
    // to the host, reverting a scheme/light change just made from newtab (the
    // sporadic "settings reverts my change" bug). The host is the source of
    // truth on open — we only publish in response to an actual user toggle.
    return ZGui.card({ body: inner }).el;
  }

  /* --------------------------------------------------------------- pref row */
  function setPref(p, v) {
    sp.setPref(p.key, v, '', function (ok) {
      void chrome.runtime.lastError;
      if (!ok && window.ZGui.toast) ZGui.toast.show('Could not set ' + p.key);
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
    if (regexOn) { try { var re = new RegExp(query, 'i'); return re.test(p.key) || re.test(labelOf(p.key)); } catch (e) { return false; } }
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
      var card = ZGui.card({ body: inner }).el;
      card.setAttribute('data-group', g);
      body.appendChild(card);
    });
    body.appendChild(el('div', 'footer-docs', '[ ' + prefs.length + ' settings · settingsPrivate ]'));
    // Re-apply the deep-link on every render while it's pending, so the async
    // zb_ui reconcile re-render (boot) can't bounce us back to the top.
    if (pendingSection) scrollToSection(pendingSection);
  }

  // Scroll to (and briefly highlight) the group matching a native settings slug.
  // Returns true if a section was found + focused.
  function scrollToSection(slug) {
    if (!slug) return false;
    slug = String(slug).toLowerCase();
    var want = (SECTION_ALIAS[slug] || slug).toLowerCase();
    var cards = [].slice.call(body.querySelectorAll('[data-group]'));
    var gkey = function (c) { return (c.getAttribute('data-group') || '').toLowerCase(); };
    // Prefer an exact/prefix match on the aliased group (performance_tuning) so a
    // merely performance-*containing* group (cpu_performance_tier_override) can't
    // win; fall back to a substring match on the alias, then the raw slug.
    var hit = cards.find(function (c) { return gkey(c) === want; })
      || cards.find(function (c) { return gkey(c).indexOf(want) === 0; })
      || cards.find(function (c) { return gkey(c).indexOf(want) >= 0; })
      || cards.find(function (c) { return gkey(c).indexOf(slug) >= 0; });
    if (!hit) return false;
    try { hit.scrollIntoView({ block: 'start' }); } catch (e) { hit.scrollIntoView(); }
    hit.setAttribute('data-section-focus', '1');
    setTimeout(function () { try { hit.removeAttribute('data-section-focus'); } catch (e) {} }, 1600);
    return true;
  }

  function mergeChanged(list) {
    (list || []).forEach(function (cp) {
      for (var i = 0; i < prefs.length; i++) if (prefs[i].key === cp.key) { prefs[i] = cp; return; }
      prefs.push(cp);
    });
  }

  function boot() {
    shell = ZBHUD.mount({ title: 'SETTINGS', current: 'settings.html', filterPlaceholder: 'filter settings…',
      onFilter: function (q, rx) { pendingSection = null; query = q; regexOn = rx; render(); } });
    body = shell.body;
    // The deep-link is a one-shot intent: stop forcing the section once the page
    // has settled (the reconcile re-render fires within ~100ms), so later
    // pref-change re-renders don't yank the user back.
    setTimeout(function () { pendingSection = null; }, 2000);
    sp.getAllPrefs(function (list) {
      void chrome.runtime.lastError;
      prefs = (list || []).slice().sort(function (a, b) { return a.key.localeCompare(b.key); });
      render();
    });
    if (sp.onPrefsChanged) sp.onPrefsChanged.addListener(function (changed) { mergeChanged(changed); render(); });
    // Reconcile the ZGui light/fx state to a fleet-truth ui object (zb_ui, which
    // the background bridge mirrors from ~/.zwire/global.toml). Applied under the
    // __zbApplyingExternal guard so the setLight-driven zg-boot onApply does NOT
    // republish it back to the host — that republish is both the light/dark
    // flash-loop AND, when the local value is stale, the clobber that reverted a
    // newtab change.
    function reconcileUi(ui) {
      ui = ui || {};
      window.__zbApplyingExternal = true;
      try {
        try { if (ZGui.colorscheme && ZGui.colorscheme.setLight && typeof ui.light === 'boolean' && ZGui.colorscheme.isLight() !== ui.light) ZGui.colorscheme.setLight(ui.light); } catch (e) {}
        try { if (ZGui.fx && ZGui.fx.set) ['scanlines', 'vignette', 'glow', 'anim'].forEach(function (n) { if (typeof ui[n] === 'boolean' && ZGui.fx.get(n) !== ui[n]) ZGui.fx.set(n, ui[n]); }); } catch (e) {}
      } finally { window.__zbApplyingExternal = false; }
    }
    // On OPEN, converge the switches to the host's CURRENT ui before the user sees
    // (or a toggle could publish) a stale local value. storage.onChanged only
    // fires on a *change*, so a fresh open — where zb_ui already equals the host —
    // needs this explicit read to reconcile + re-render.
    try { chrome.storage.local.get('zb_ui', function (o) { void chrome.runtime.lastError; if (o && o.zb_ui) { reconcileUi(o.zb_ui); render(); } }); } catch (e) {}
    // Keep the light/effect SWITCHES in sync when the state is changed elsewhere
    // (⌘K palette command, another surface): reconcile ZGui state to zb_ui, then
    // re-render so the toggles reflect it. Without this the switch went stale.
    try {
      chrome.storage.onChanged.addListener(function (ch, area) {
        // zb_status (tmux/session status-bar flag) also drives a switch here, so a
        // ⌘K toggle or `:set status off` must re-render this page too — otherwise
        // the Settings switch drifts out of sync with the palette / status bar.
        if (area !== 'local' || (!ch.zb_ui && !ch.zb_status)) return;
        if (ch.zb_ui) reconcileUi(ch.zb_ui.newValue || {});
        render();
      });
    } catch (e) {}
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
