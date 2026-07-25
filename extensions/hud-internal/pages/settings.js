/* zwire HUD Settings — the chrome://settings reimplementation on
 * chrome.settingsPrivate (allowlisted for our extension). redirect.js shadows
 * every chrome://settings/* URL with this page, so this is the ONLY settings
 * surface in zwire: it has to carry the sections Chrome's own page has, not a
 * flat dump of pref keys.
 *
 * Layout is ZGui.prefsShell — a section rail (Appearance, Privacy & data,
 * Autofill, Search, On startup, Downloads, Languages, Performance,
 * Accessibility, Advanced) with a detail pane per section. Every settingsPrivate
 * pref is routed to a section by SECTION_KEYS, and anything unrecognized lands
 * in Advanced, so no pref is ever hidden. The Privacy pane hosts the Clear
 * browsing data wizard (pages/cleardata.js) — chrome://settings/clearBrowserData
 * lands directly on it.
 *
 * The routing model is pure and exposed on window.ZBSettings so
 * tests/settings-sections.mjs can check slug + key routing headless.
 * All widgets are ZGui.* per the zgui-core-only rule. */
(function () {
  'use strict';

  /* ------------------------------------------------------------ section model */
  // desc doubles as the rail subtitle. Order is the rail order.
  var SECTIONS = [
    { id: 'appearance', icon: '◐', name: 'Appearance', desc: 'Color scheme, cyberpunk effects, toolbar and fonts' },
    { id: 'privacy', icon: '⛨', name: 'Privacy & data', desc: 'Clear browsing data, Safe Browsing, cookies, DNS' },
    { id: 'autofill', icon: '⌸', name: 'Autofill & passwords', desc: 'Saved addresses, payment methods, password manager' },
    { id: 'search', icon: '⌕', name: 'Search engine', desc: 'Default provider, omnibox suggestions' },
    { id: 'startup', icon: '⏻', name: 'On startup', desc: 'Session restore and startup pages' },
    { id: 'downloads', icon: '⤓', name: 'Downloads', desc: 'Download directory and prompting' },
    { id: 'languages', icon: '⌘', name: 'Languages', desc: 'Accepted languages, translation, spellcheck' },
    { id: 'performance', icon: '⚡', name: 'Performance', desc: 'Memory saver, tab discarding, preloading' },
    { id: 'accessibility', icon: '♿', name: 'Accessibility', desc: 'Caret browsing, captions, a11y prefs' },
    { id: 'advanced', icon: '⚙', name: 'Advanced', desc: 'Every remaining settingsPrivate pref' }
  ];

  // key prefix -> section. First match wins, so put the specific ones first.
  // A prefix matches the whole key or a dotted parent of it ('download' matches
  // 'download.default_directory' but not 'downloadable_fonts'). Chromium also
  // ships flat underscore names with no dotted parent (kHttpsOnlyModeEnabled is
  // "https_only_mode_enabled"), so a third element 'raw' switches an entry to a
  // plain startsWith.
  var SECTION_KEYS = [
    ['appearance', 'appearance'], ['appearance', 'bookmark_bar'], ['appearance', 'browser.show_home_button'],
    ['appearance', 'browser.custom_chrome_frame'], ['appearance', 'homepage'], ['appearance', 'homepage_is_newtabpage'],
    ['appearance', 'webkit.webprefs'], ['appearance', 'extensions.theme'], ['appearance', 'browser.theme'],

    ['autofill', 'autofill'], ['autofill', 'payments'], ['autofill', 'credentials_enable_service'],
    ['autofill', 'credentials_enable_autosignin'], ['autofill', 'password_manager'], ['autofill', 'profile.password_manager_enabled'],
    ['autofill', 'generated.password_leak_detection'],

    ['search', 'default_search_provider'], ['search', 'default_search_provider_data'], ['search', 'search'],
    ['search', 'omnibox'],

    ['startup', 'session'], ['startup', 'restore_on_startup'], ['startup', 'browser.startup'],

    ['downloads', 'download'], ['downloads', 'savefile'], ['downloads', 'download_bubble'],

    ['languages', 'intl'], ['languages', 'translate'], ['languages', 'translate_blocked_languages'],
    ['languages', 'spellcheck'], ['languages', 'browser.enable_spellchecking'],

    ['performance', 'performance_tuning'], ['performance', 'memory_saver'], ['performance', 'high_efficiency'],
    ['performance', 'battery_saver'], ['performance', 'discard'],
    // "Preload pages" — chrome/common/pref_names.h kNetworkPredictionOptions.
    ['performance', 'net.network_prediction_options'],

    ['accessibility', 'settings.a11y'], ['accessibility', 'accessibility'], ['accessibility', 'caret_browsing'],
    ['accessibility', 'live_caption'],

    // Privacy is last of the specific sections so the narrower routes above win
    // (generated.password_leak_detection belongs with passwords, not privacy).
    ['privacy', 'safebrowsing'], ['privacy', 'privacy_sandbox'],
    // https_only_mode_enabled / https_first_balanced_mode_enabled / … — flat names.
    ['privacy', 'https_', 'raw'],
    ['privacy', 'dns_over_https'], ['privacy', 'enable_do_not_track'],
    ['privacy', 'profile.cookie_controls_mode'], ['privacy', 'profile.default_content_setting_values'],
    ['privacy', 'profile.content_settings'], ['privacy', 'profile.block_third_party_cookies'],
    ['privacy', 'alternate_error_pages'], ['privacy', 'url_keyed_anonymized_data_collection'],
    ['privacy', 'signin'], ['privacy', 'sync'], ['privacy', 'generated']
  ];

  // Native chrome://settings/<slug> -> section. Slugs Chrome ships that have no
  // pref surface of their own (content, cookies, security) still resolve to the
  // section a user means by them.
  var SLUG_SECTION = {
    clearbrowserdata: 'privacy', deletebrowsingdata: 'privacy', privacy: 'privacy',
    security: 'privacy', cookies: 'privacy', content: 'privacy', sitedata: 'privacy',
    syncsetup: 'privacy', people: 'privacy', privacysandbox: 'privacy',
    appearance: 'appearance', fonts: 'appearance', themes: 'appearance',
    autofill: 'autofill', payments: 'autofill', addresses: 'autofill', passwords: 'autofill',
    search: 'search', searchengines: 'search', defaultbrowser: 'startup', onstartup: 'startup',
    downloads: 'downloads', languages: 'languages', performance: 'performance',
    accessibility: 'accessibility', system: 'advanced', reset: 'advanced'
  };

  // The slugs that mean "clear my data now" — these open the wizard, not just
  // the section holding it.
  var CLEAR_SLUGS = { clearbrowserdata: 1, deletebrowsingdata: 1 };

  function sectionById(id) { for (var i = 0; i < SECTIONS.length; i++) if (SECTIONS[i].id === id) return SECTIONS[i]; return null; }
  function keyMatches(key, prefix, mode) {
    if (mode === 'raw') return key.indexOf(prefix) === 0;
    return key === prefix || key.indexOf(prefix + '.') === 0;
  }
  function sectionForKey(key) {
    key = String(key || '');
    for (var i = 0; i < SECTION_KEYS.length; i++) {
      if (keyMatches(key, SECTION_KEYS[i][1], SECTION_KEYS[i][2])) return SECTION_KEYS[i][0];
    }
    return 'advanced';
  }
  function sectionForSlug(slug) {
    if (!slug) return null;
    return SLUG_SECTION[String(slug).toLowerCase()] || null;
  }
  function isClearSlug(slug) { return !!CLEAR_SLUGS[String(slug || '').toLowerCase()]; }

  window.ZBSettings = {
    SECTIONS: SECTIONS, SECTION_KEYS: SECTION_KEYS, SLUG_SECTION: SLUG_SECTION,
    sectionById: sectionById, sectionForKey: sectionForKey, sectionForSlug: sectionForSlug,
    isClearSlug: isClearSlug
  };

  // Everything below needs a live page (chrome.settingsPrivate + DOM); the model
  // above is loadable headless for tests.
  if (typeof document === 'undefined' || typeof chrome === 'undefined' || !chrome.settingsPrivate) return;

  /* ------------------------------------------------------------------ page */
  var sp = chrome.settingsPrivate;
  var FZ = window.ZGui.fzf;
  var shell, body, pshell, prefs = [], query = '', regexOn = false, activeId = 'appearance';

  // Deep-link: redirect.js forwards chrome://settings/<slug> here as
  // ?section=<slug>, so land on the matching section (and pop the clear-data
  // wizard when the slug asked for it) instead of dumping at the top.
  var pendingSlug = null;
  try { pendingSlug = (new URLSearchParams(location.search)).get('section'); } catch (e) {}

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

  /* ------------------------------------------------------- clear-data card */
  // The whole reason this section exists: Chrome's Delete-browsing-data dialog
  // is unreachable under the HUD shadow, so the wizard IS the surface. Rendered
  // inline (not behind a button) — one keystroke from chrome://settings/clearBrowserData.
  function clearDataCard() {
    var inner = el('div');
    inner.appendChild(el('div', 'set-h', '// PRIVACY · CLEAR BROWSING DATA'));
    var host = el('div');
    inner.appendChild(host);
    var card = ZGui.card({ body: inner }).el;
    card.setAttribute('data-cleardata', '1');
    if (window.ZBClear) window.ZBClear.mount(host, {});
    else inner.appendChild(el('div', 'footer-docs', '[ cleardata.js not loaded ]'));
    return card;
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
  function prefRow(p, withSection) {
    var help = p.key + (p.controlledBy ? ' · controlled by ' + String(p.controlledBy).toLowerCase() : '');
    if (withSection) { var s = sectionById(sectionForKey(p.key)); if (s) help = s.name + ' · ' + help; }
    var f = ZGui.field({ label: labelOf(p.key), control: control(p), help: help });
    f.el.setAttribute('data-key', p.key);
    return f.el;
  }

  /* ------------------------------------------------------------------ panes */
  function prefsOf(id) { return prefs.filter(function (p) { return sectionForKey(p.key) === id; }); }

  function renderSection(pane, sec) {
    pane.appendChild(ZGui.prefsShell.paneHead(sec.icon, sec.name, sec.desc));
    if (sec.id === 'appearance') {
      pane.appendChild(appearanceCard());
      var fxc = effectsCard(); if (fxc) pane.appendChild(fxc);
    }
    if (sec.id === 'privacy') pane.appendChild(clearDataCard());
    var list = prefsOf(sec.id).sort(function (a, b) { return a.key.localeCompare(b.key); });
    if (!list.length) {
      pane.appendChild(el('div', 'footer-docs', prefs.length ? '[ no settingsPrivate prefs in this section ]' : '[ loading settingsPrivate… ]'));
      return;
    }
    var inner = el('div');
    inner.appendChild(el('div', 'set-h', '// ' + sec.name.toUpperCase() + ' · PREFERENCES'));
    list.forEach(function (p) { inner.appendChild(prefRow(p)); });
    pane.appendChild(ZGui.card({ body: inner }).el);
    pane.appendChild(el('div', 'footer-docs', '[ ' + list.length + ' of ' + prefs.length + ' settings · settingsPrivate ]'));
  }

  function matches(p) {
    if (!query.trim()) return true;
    if (regexOn) { try { var re = new RegExp(query, 'i'); return re.test(p.key) || re.test(labelOf(p.key)); } catch (e) { return false; } }
    return !!(FZ.fzfMatch(query, p.key) || FZ.fzfMatch(query, labelOf(p.key)));
  }

  // Filtering searches EVERY section at once — a pref you can't name the section
  // for is exactly the pref you're searching for.
  function renderSearch(pane) {
    var hits = prefs.filter(matches).sort(function (a, b) { return a.key.localeCompare(b.key); });
    pane.appendChild(ZGui.prefsShell.paneHead('⌕', 'Search results', hits.length + ' of ' + prefs.length + ' settings match “' + query + '”'));
    if (!hits.length) { pane.appendChild(el('div', 'footer-docs', '[ no settings match ]')); return; }
    var inner = el('div');
    hits.forEach(function (p) { inner.appendChild(prefRow(p, true)); });
    pane.appendChild(ZGui.card({ body: inner }).el);
  }

  function navItems() {
    if (query.trim()) return [{ id: '__search', icon: '⌕', name: 'Search results', sub: query, render: renderSearch }];
    return SECTIONS.map(function (s) {
      return { id: s.id, icon: s.icon, name: s.name, sub: s.desc,
        render: function (pane) { activeId = s.id; renderSection(pane, s); } };
    });
  }

  function render() {
    if (!pshell) {
      body.innerHTML = '';
      pshell = ZGui.prefsShell(body, { title: 'SETTINGS', items: navItems(), active: activeId });
      return;
    }
    pshell.setItems(navItems());
    if (!query.trim()) pshell.select(activeId);
  }

  // Jump to the wizard in place. pages/hud-accel.js calls this when ⌘⇧⌫ is
  // pressed while Settings is already the active page, so the shortcut doesn't
  // open a second copy of the page you're standing on.
  function openClearData() {
    activeId = 'privacy';
    if (pshell) pshell.select('privacy');
    var card = body && body.querySelector('[data-cleardata]');
    if (card) { try { card.scrollIntoView({ block: 'start' }); } catch (e) { card.scrollIntoView(); } }
  }

  // Land the chrome://settings/<slug> deep-link on a real section, and open the
  // wizard when the slug was a clear-data one.
  function applyDeepLink() {
    if (!pendingSlug) return;
    var id = sectionForSlug(pendingSlug);
    if (id) { activeId = id; if (pshell) pshell.select(id); }
    if (isClearSlug(pendingSlug)) {
      var card = body.querySelector('[data-cleardata]');
      if (card) { try { card.scrollIntoView({ block: 'start' }); } catch (e) { card.scrollIntoView(); } }
    }
    pendingSlug = null;
  }

  function mergeChanged(list) {
    (list || []).forEach(function (cp) {
      for (var i = 0; i < prefs.length; i++) if (prefs[i].key === cp.key) { prefs[i] = cp; return; }
      prefs.push(cp);
    });
  }

  function boot() {
    // Honor the deep-link before the first paint so the wizard is on screen when
    // the page settles, not one re-render later.
    var slugId = sectionForSlug(pendingSlug);
    if (slugId) activeId = slugId;
    shell = ZBHUD.mount({ title: 'SETTINGS', current: 'settings.html', filterPlaceholder: 'filter settings…',
      onFilter: function (q, rx) { query = q; regexOn = rx; render(); } });
    body = shell.body;
    window.__zbOpenClearData = openClearData;
    render();
    sp.getAllPrefs(function (list) {
      void chrome.runtime.lastError;
      prefs = (list || []).slice().sort(function (a, b) { return a.key.localeCompare(b.key); });
      render();
      applyDeepLink();
    });
    // A pref change re-renders the ACTIVE pane only — prefsShell keeps the rail,
    // so this can't yank the user out of the section they're in.
    if (sp.onPrefsChanged) sp.onPrefsChanged.addListener(function (changed) {
      mergeChanged(changed);
      if (!query.trim() && pshell) pshell.select(activeId);
    });
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
    try { chrome.storage.local.get('zb_ui', function (o) { void chrome.runtime.lastError; if (o && o.zb_ui) { reconcileUi(o.zb_ui); if (pshell && activeId === 'appearance' && !query.trim()) pshell.select(activeId); } }); } catch (e) {}
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
        if (pshell && activeId === 'appearance' && !query.trim()) pshell.select(activeId);
      });
    } catch (e) {}
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
