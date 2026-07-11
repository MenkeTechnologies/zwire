/* zwire HUD Extensions manager — full chrome://extensions parity on
 * chrome.developerPrivate, built entirely from zgui-core widgets (ZGui.appShell
 * shell, ZGui.card, ZGui.button, ZGui.toggle, ZGui.fzf). */
(function () {
  'use strict';
  var dp = chrome.developerPrivate;
  var FZ = window.ZGui.fzf;
  var esc = (window.ZGui.util && window.ZGui.util.escapeHtml) || function (s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
  };

  var shell, body, listEl, devToggleEl;
  var all = [], profile = { inDeveloperMode: false, canLoadUnpacked: true };
  var view = 'list', detailId = null, query = '', regexOn = false;
  var STORE_URL = 'https://chromewebstore.google.com/';

  // zwire's own HUD core — the browser IS these. Disabling hud-internal kills
  // the tiling overlay, ⌘K palette, and this very page; newtab owns the start
  // surface. These two are locked from disable/remove so the workspace can't be
  // bricked from its own manager. zpwrchrome is a power-tool, not core — it is
  // intentionally NOT here, so the user may disable/remove it like any add-on.
  // Each id is the deterministic SHA-256(DER public key) → first 16 bytes → a–p
  // of the pinned `key` in that extension's manifest (extensions/hud-internal,
  // newtab); it changes only if the manifest key changes.
  var ZWIRE_INTERNAL = {
    omcgnnjfmbmpdlofklbpddkhnfibfhgg: 1, // zwire HUD Internal
    gpoepnekoiplhkegjpocnpeijiefgieb: 1  // zwire New Tab
  };
  function isInternal(e) { return !!ZWIRE_INTERNAL[e.id]; }

  // zpwrchrome is a disable-able power-tool, but it is force-loaded via the
  // launcher's --load-extension, which re-ENABLES it on every start. So a plain
  // toggle wouldn't survive a restart; setEnabled() below also persists the
  // choice in a kv marker (zwire/zpwr_off) that background.js re-applies on
  // startup. REMOVE is pointless for it (it reappears next launch), so we offer
  // only the disable toggle.
  var HOST = 'com.zwire.hud';
  var ZPWR_ID = 'hpppdchpnphmiijdeanibpcadgknmaja';
  function isZpwr(e) { return e.id === ZPWR_ID; }

  function isExt(e) { return ['EXTENSION', 'LEGACY_PACKAGED_APP', 'HOSTED_APP', 'PLATFORM_APP'].indexOf(e.type) !== -1; }
  function enabled(e) { return e.state === 'ENABLED'; }
  function locLabel(e) { return { UNPACKED: 'Unpacked', FROM_STORE: 'Chrome Web Store', THIRD_PARTY: 'Third-party', INSTALLED_BY_DEFAULT: 'Default', UNKNOWN: 'Unknown' }[e.location] || e.location; }
  function hostAccessLabel(e) { var r = e.permissions && e.permissions.runtimeHostPermissions; return r ? ({ ON_CLICK: 'On click', ON_SPECIFIC_SITES: 'Specific sites', ON_ALL_SITES: 'All sites' }[r.hostAccess] || r.hostAccess) : null; }
  function errorCount(e) { return (e.manifestErrors || []).length + (e.runtimeErrors || []).length; }
  function disableReasons(e) {
    var d = e.disableReasons || {}, o = [];
    if (d.corruptInstall) o.push('CORRUPTED'); if (d.suspiciousInstall) o.push('SUSPICIOUS');
    if (d.updateRequired) o.push('UPDATE REQ'); if (d.blockedByPolicy) o.push('POLICY');
    if (d.unsupportedManifestVersion) o.push('MANIFEST OLD'); return o;
  }
  function viewLabel(v) {
    var m = { EXTENSION_SERVICE_WORKER_BACKGROUND: 'service worker', EXTENSION_BACKGROUND_PAGE: 'background page',
      EXTENSION_POPUP: 'popup', EXTENSION_SIDE_PANEL: 'side panel', OFFSCREEN_DOCUMENT: 'offscreen', DEVELOPER_TOOLS: 'devtools' };
    return (m[v.type] || v.type.toLowerCase()) + (v.incognito ? ' (incognito)' : '');
  }
  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }

  /* -------------------------------------------------------------- dev bar */
  function buildDevBar() {
    var bar = el('div', 'xt-devbar');
    var lbl = el('span', 'xt-switch-lbl', 'DEVELOPER MODE');
    devToggleEl = ZGui.toggle({ checked: !!profile.inDeveloperMode, onChange: function (on) {
      dp.updateProfileConfiguration({ inDeveloperMode: on }, function () { void chrome.runtime.lastError;
        loadProfile(function () { syncDevBar(bar); if (view === 'list') renderList(); }); }); } });
    bar.appendChild(lbl); bar.appendChild(devToggleEl.el);
    var group = el('span', 'xt-devbtns');
    group.appendChild(ZGui.button({ label: '▸ LOAD UNPACKED', variant: 'mini', onClick: loadUnpacked }));
    group.appendChild(ZGui.button({ label: '▸ PACK', variant: 'mini', onClick: pack }));
    group.appendChild(ZGui.button({ label: '▸ UPDATE', variant: 'mini', onClick: updateAll }));
    bar.appendChild(group);
    bar.appendChild(el('span', 'grow'));
    bar.appendChild(ZGui.button({ label: '⌘ SHORTCUTS', variant: 'mini', onClick: renderShortcuts }));
    var ws = ZGui.button({ label: '◈ WEB STORE ↗', variant: 'mini', onClick: function () { chrome.tabs.create({ url: STORE_URL }); } });
    bar.appendChild(ws);
    bar._group = group;
    syncDevBar(bar);
    return bar;
  }
  function syncDevBar(bar) {
    if (devToggleEl) devToggleEl.set(!!profile.inDeveloperMode);
    if (bar && bar._group) bar._group.style.display = profile.inDeveloperMode ? '' : 'none';
  }

  /* ---------------------------------------------------------------- list */
  function matched() {
    var q = (query || '').trim();
    if (!q) return all.filter(isExt).map(function (e) { return { e: e, idx: null }; });
    if (regexOn) {
      var re = null; try { re = new RegExp(q, 'i'); } catch (er) { re = null; }
      var rout = [];
      all.forEach(function (e) { if (!isExt(e)) return; if (re && (re.test(e.name) || re.test(e.description || ''))) rout.push({ e: e, idx: [], score: 0 }); });
      return rout;
    }
    var out = [];
    all.forEach(function (e) {
      if (!isExt(e)) return;
      var m = FZ.fzfMatch(q, e.name);
      if (!m && FZ.fzfMatch(q, e.description || '')) m = { score: -1000, indices: [] };
      if (m) out.push({ e: e, idx: m.indices, score: m.score });
    });
    out.sort(function (a, b) { return (b.score || 0) - (a.score || 0); });
    return out;
  }

  function renderList() {
    view = 'list'; detailId = null;
    body.innerHTML = '';
    body.appendChild(buildDevBar());
    listEl = el('div', 'product-grid');
    body.appendChild(listEl);
    var rows = matched();
    var foot = el('div', 'footer-docs');
    foot.innerHTML = '[ ' + rows.length + ' extensions ] · <a href="' + STORE_URL + '" target="_blank" style="color:var(--cyan)">discover more on the Chrome Web Store ↗</a>';
    if (!rows.length) { listEl.appendChild(el('div', 'footer-docs', '[ no matches ]')); body.appendChild(foot); return; }
    rows.forEach(function (row) { listEl.appendChild(buildCard(row)); });
    body.appendChild(foot);
  }

  function buildCard(row) {
    var e = row.e;
    var nameHtml = row.idx && row.idx.length ? FZ.highlightWithIndices(e.name, row.idx) : esc(e.name);
    var meta = [];
    if (hostAccessLabel(e)) meta.push('SITE · ' + hostAccessLabel(e));
    if (e.permissions && e.permissions.simplePermissions.length) meta.push('PERMS · ' + e.permissions.simplePermissions.length);
    if (e.incognitoAccess.isActive) meta.push('INCOGNITO');
    if (errorCount(e)) meta.push('ERRORS · ' + errorCount(e));
    disableReasons(e).forEach(function (r) { meta.push(r); });
    var actions = [];
    actions.push(ZGui.button({ label: 'DETAILS', variant: 'mini', onClick: function () { renderDetail(e); } }));
    actions.push(ZGui.button({ label: e.pinnedToToolbar ? '📌 PINNED' : '📌 PIN', variant: e.pinnedToToolbar ? 'primary' : 'mini',
      onClick: function () { dp.updateExtensionConfiguration({ extensionId: e.id, pinnedToToolbar: !e.pinnedToToolbar }, function () { void chrome.runtime.lastError; refresh(); }); } }));
    if (e.optionsPage) actions.push(ZGui.button({ label: 'OPTIONS', variant: 'mini', onClick: function () { openOptions(e); } }));
    if (profile.inDeveloperMode && e.location === 'UNPACKED') actions.push(ZGui.button({ label: 'RELOAD', variant: 'mini', onClick: function () { reload(e); } }));
    if (isInternal(e)) {
      actions.push(el('span', 'xt-core-lock', '🔒 CORE'));
    } else if (isZpwr(e)) {
      // Disable is allowed and persisted across restarts; REMOVE is not (it is
      // reloaded by --load-extension every launch).
      actions.push(ZGui.toggle({ checked: enabled(e), onChange: function (on) { setEnabled(e, on); } }).el);
    } else {
      if (e.userMayModify && !e.mustRemainInstalled) actions.push(ZGui.button({ label: 'REMOVE', variant: 'danger', onClick: function () { remove(e); } }));
      if (e.userMayModify) actions.push(ZGui.toggle({ checked: enabled(e), onChange: function (on) { setEnabled(e, on); } }).el);
    }
    // app-store style card (ZGui.productCard)
    var pc = ZGui.productCard({
      thumb: e.iconUrl || null,
      glyph: e.iconUrl ? null : (e.name[0] || '?').toUpperCase(),
      badge: locLabel(e),
      category: enabled(e) ? 'ENABLED' : 'DISABLED',
      nameHtml: nameHtml + ' <span class="card-chip">v' + esc(e.version) + '</span>',
      tag: e.description || '',
      meta: meta,
      actions: actions,
      off: !enabled(e)
    });
    if (profile.inDeveloperMode) {
      var b = pc.el.querySelector('.product-body');
      if (b) b.appendChild(el('div', 'xt-id', 'ID: ' + esc(e.id) + (e.path ? ' · ' + esc(e.prettifiedPath || e.path) : '')));
    }
    return pc.el;
  }

  /* -------------------------------------------------------------- detail */
  function renderDetail(e) {
    view = 'detail'; detailId = e.id;
    body.innerHTML = '';
    body.appendChild(ZGui.button({ label: '← BACK', variant: 'mini', onClick: renderList }));
    var wrap = el('div', 'xt-detail');
    body.appendChild(wrap);

    var head = el('div', 'xt-detail-head');
    head.innerHTML = (e.iconUrl ? '<img class="xt-dicon" src="' + esc(e.iconUrl) + '">' : '<div class="xt-dicon"></div>') +
      '<div class="xt-dtitle"><div class="xt-dname">' + esc(e.name) + ' <span class="card-chip">v' + esc(e.version) + '</span></div>' +
      '<div class="p-cat">' + (enabled(e) ? 'ENABLED' : 'DISABLED') + ' · ' + esc(locLabel(e)) + '</div></div>';
    head.appendChild(el('span', 'grow'));
    if (isInternal(e)) head.appendChild(el('span', 'xt-core-lock', '🔒 CORE'));
    else if (e.userMayModify) { var ht = ZGui.toggle({ checked: enabled(e), onChange: function (on) { setEnabled(e, on); } }); head.appendChild(ht.el); }
    wrap.appendChild(cardSect(null, head));

    var perms = (e.permissions && e.permissions.simplePermissions) || [];
    var permBody = perms.length
      ? '<ul class="xt-warnlist">' + perms.map(function (p) { return '<li>' + esc(p.message) +
          (p.submessages && p.submessages.length ? '<ul>' + p.submessages.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ul>' : '') + '</li>'; }).join('') + '</ul>'
      : 'No special permissions required.';
    wrap.appendChild(cardSect('PERMISSIONS · ' + perms.length, el('div', 'xt-dbody', permBody)));

    wrap.appendChild(cardSect('DESCRIPTION', el('div', 'xt-dbody', esc(e.description || '—'))));

    // site access segmented (zgui toggleGroup if present, else buttons)
    var rhp = e.permissions && e.permissions.runtimeHostPermissions;
    var saEl = el('div');
    if (rhp) {
      var seg = el('div', 'xt-seg');
      [['ON_CLICK', 'On click'], ['ON_SPECIFIC_SITES', 'Specific sites'], ['ON_ALL_SITES', 'All sites']].forEach(function (o) {
        var b = ZGui.button({ label: o[1], variant: rhp.hostAccess === o[0] ? 'primary' : 'mini',
          onClick: function () { dp.updateExtensionConfiguration({ extensionId: e.id, hostAccess: o[0] }, function () { void chrome.runtime.lastError; refresh(); }); } });
        seg.appendChild(b);
      });
      saEl.appendChild(seg);
      if (rhp.hosts && rhp.hosts.length) saEl.appendChild(el('div', 'xt-perms', rhp.hosts.map(function (h) { return (h.granted ? '● ' : '○ ') + esc(h.host); }).join(' &nbsp; ')));
    } else { saEl.appendChild(el('div', 'xt-dbody', 'This extension does not request site access.')); }
    wrap.appendChild(cardSect('SITE ACCESS', saEl));

    // options toggles
    var opts = el('div');
    // Pin to toolbar (a plain boolean, not an AccessModifier).
    var pinRow = el('label', 'xt-switch full');
    pinRow.appendChild(el('span', null, '📌 Pin to toolbar'));
    var pinT = ZGui.toggle({ checked: !!e.pinnedToToolbar, onChange: function (on) {
      dp.updateExtensionConfiguration({ extensionId: e.id, pinnedToToolbar: on }, function () { void chrome.runtime.lastError; refresh(); }); } });
    pinRow.appendChild(pinT.el);
    opts.appendChild(pinRow);
    opts.appendChild(cfgToggle(e, 'Allow in Incognito', 'incognitoAccess'));
    opts.appendChild(cfgToggle(e, 'Allow access to file URLs', 'fileAccess'));
    opts.appendChild(cfgToggle(e, 'Collect errors', 'errorCollection'));
    if (e.userScriptsAccess.isEnabled) opts.appendChild(cfgToggle(e, 'Allow user scripts', 'userScriptsAccess'));
    wrap.appendChild(cardSect('OPTIONS', opts));

    // errors
    var errs = (e.manifestErrors || []).concat(e.runtimeErrors || []);
    if (errs.length) {
      var eb = el('div');
      var list = el('div', 'xt-errs');
      errs.forEach(function (er) { list.appendChild(el('div', 'xt-err ' + String(er.severity || 'manifest').toLowerCase(),
        '<span class="lv">' + esc(er.severity || 'MANIFEST') + '</span> ' + esc(er.message) + (er.source ? '<div class="src">' + esc(er.source) + '</div>' : ''))); });
      eb.appendChild(list);
      eb.appendChild(ZGui.button({ label: 'CLEAR ERRORS', variant: 'mini', onClick: function () { dp.deleteExtensionErrors({ extensionId: e.id }, function () { void chrome.runtime.lastError; refresh(); }); } }));
      wrap.appendChild(cardSect('ERRORS · ' + errs.length, eb));
    }

    // details table
    var views = (e.views || []).filter(function (v) { return v.type !== 'TAB_CONTENTS'; });
    var viewsHtml = views.length ? views.map(function (v) {
      return '<a class="xt-chip link" data-view="' + v.renderProcessId + ':' + v.renderViewId + ':' + (v.incognito ? 1 : 0) + ':' + (v.isServiceWorker ? 1 : 0) + '" href="#">' + esc(viewLabel(v)) + ' ↗</a>';
    }).join(' ') : 'Inactive';
    var rows = [['Status', enabled(e) ? 'On' : 'Off'], ['Version', esc(e.version)], ['ID', '<span class="xt-id">' + esc(e.id) + '</span>'],
      ['Source', esc(locLabel(e))], ['Size', '<span data-size="1">…</span>'], ['Type', esc(e.type)]];
    if (e.path) rows.push(['Loaded from', '<span class="xt-id">' + esc(e.prettifiedPath || e.path) + '</span> <a href="#" data-showpath="1" style="color:var(--cyan)">show ↗</a>']);
    if (e.homePage && e.homePage.specified) rows.push(['Homepage', '<a href="' + esc(e.homePage.url) + '" style="color:var(--cyan)">' + esc(e.homePage.url) + ' ↗</a>']);
    rows.push(['Inspect views', viewsHtml]);
    if (e.updateUrl) rows.push(['Update URL', esc(e.updateUrl)]);
    var tbl = el('div', 'info-list', rows.map(function (r) { return '<div class="info-row"><span class="ik">' + esc(r[0]) + '</span><span class="iv">' + r[1] + '</span></div>'; }).join(''));
    wrap.appendChild(cardSect('DETAILS', tbl));

    tbl.querySelectorAll('[data-view]').forEach(function (a) { a.onclick = function (ev) { ev.preventDefault();
      var p = a.getAttribute('data-view').split(':'), sw = p[3] === '1';
      // For a service worker renderViewId is -1 (no view); a NaN/missing id makes openDevTools no-op.
      var opts = { renderProcessId: +p[0] || -1, renderViewId: isNaN(+p[1]) ? -1 : +p[1], incognito: p[2] === '1', isServiceWorker: sw, extensionId: e.id };
      var toNative = function () { try { location.href = 'chrome://extensions/?native&id=' + e.id; } catch (x) {} };
      try {
        dp.openDevTools(opts, function () {
          // openDevTools can't attach from a content-script reimplementation for some views (idle SW,
          // privileged attach) — fall back to Chrome's real page, whose native inspect link always works.
          if (chrome.runtime.lastError) toNative();
        });
      } catch (x) { toNative(); }
    }; });
    var sp = tbl.querySelector('[data-showpath]'); if (sp) sp.onclick = function (ev) { ev.preventDefault(); dp.showPath(e.id); };
    dp.getExtensionSize(e.id, function (sz) { void chrome.runtime.lastError; var s = tbl.querySelector('[data-size]'); if (s) s.textContent = sz || '—'; });
  }
  function cardSect(title, contentEl) {
    var inner = el('div');
    if (title) inner.appendChild(el('div', 'set-h', '// ' + title));
    inner.appendChild(contentEl);
    return ZGui.card({ body: inner }).el;
  }
  function cfgToggle(e, label, key) {
    var acc = e[key], row = el('label', 'xt-switch full' + (acc.isEnabled ? '' : ' dim'));
    row.appendChild(el('span', null, esc(label)));
    var t = ZGui.toggle({ checked: acc.isActive, onChange: function (on) {
      var u = { extensionId: e.id }; u[key] = on; dp.updateExtensionConfiguration(u, function () { void chrome.runtime.lastError; refresh(); }); } });
    if (!acc.isEnabled) t.el.style.pointerEvents = 'none';
    row.appendChild(t.el); return row;
  }

  /* ------------------------------------------------------------ shortcuts */
  function renderShortcuts() {
    view = 'shortcuts';
    body.innerHTML = '';
    body.appendChild(ZGui.button({ label: '← BACK', variant: 'mini', onClick: renderList }));
    var q = (query || '').trim();
    var m = window.ZBHUD.matcher(query, regexOn);
    function cmdMatch(e, c) {
      return m(e.name + ' ' + (c.description || '') + ' ' + (c.name || '') + ' ' + (c.keybinding || ''));
    }
    // filter to extensions that have at least one command matching the query,
    // and within each keep only the matching commands.
    var withCmds = all.filter(isExt).map(function (e) {
      var cmds = (e.commands || []).filter(function (c) { return cmdMatch(e, c); });
      return cmds.length ? { e: e, cmds: cmds } : null;
    }).filter(Boolean);
    var inner = el('div');
    inner.appendChild(el('div', 'set-h', '// KEYBOARD SHORTCUTS' + (q ? ' · "' + esc(query) + '"' : '')));
    if (withCmds.length) inner.appendChild(el('div', 'ci-hint', 'Click a shortcut to change it · press the combo · Esc cancel · ⌫ clear'));
    var listHtml = withCmds.length ? withCmds.map(function (x) {
      return '<div class="xt-scut-ext"><div class="xt-scut-name">' + esc(x.e.name) + '</div>' +
        x.cmds.map(function (c) {
          return '<div class="info-row"><span class="ik">' + esc(c.description || c.name) +
            '</span><span class="iv"><kbd class="xt-kbd xt-kbd-edit" tabindex="0" title="click to set" ' +
            'data-ext="' + esc(x.e.id) + '" data-cmd="' + esc(c.name) + '" data-scope="' + esc(c.scope || 'CHROME') + '">' +
            esc(c.keybinding || '— unset —') + '</kbd> <span class="sub">' + (c.scope === 'GLOBAL' ? 'global' : 'in browser') + '</span></span></div>';
        }).join('') + '</div>';
    }).join('') : '<div class="xt-dbody">' + (q ? 'No shortcuts match "' + esc(query) + '".' : 'No extensions define keyboard shortcuts.') + '</div>';
    var listWrap = el('div', null, listHtml);
    inner.appendChild(listWrap);
    // delegate: clicking a binding starts key capture
    listWrap.addEventListener('click', function (ev) { var k = ev.target.closest && ev.target.closest('.xt-kbd-edit'); if (k) startCapture(k); });
    listWrap.addEventListener('keydown', function (ev) { if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.closest && ev.target.closest('.xt-kbd-edit')) { ev.preventDefault(); startCapture(ev.target); } });
    body.appendChild(ZGui.card({ body: inner }).el);
  }

  /* --- editable shortcut capture (chrome.developerPrivate.updateExtensionCommand) --- */
  var capturing = null;
  var IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || '');
  function fmtCombo(e) {
    var mods = [];
    if (e.metaKey) mods.push(IS_MAC ? 'Command' : 'Ctrl');
    if (e.ctrlKey) mods.push(IS_MAC ? 'MacCtrl' : 'Ctrl');
    if (e.altKey) mods.push('Alt');
    if (e.shiftKey) mods.push('Shift');
    var key = e.key, main = '';
    var named = { ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', ' ': 'Space', Spacebar: 'Space', ',': 'Comma', '.': 'Period', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', Insert: 'Insert', Delete: 'Delete' };
    if (/^[a-zA-Z]$/.test(key)) main = key.toUpperCase();
    else if (/^[0-9]$/.test(key)) main = key;
    else if (/^F\d{1,2}$/.test(key)) main = key;
    else if (named[key]) main = named[key];
    if (!main) return null;
    var hasPrimary = mods.some(function (m) { return m !== 'Shift'; });
    if (!hasPrimary && !/^F\d{1,2}$/.test(main)) return null;   // Chrome needs Ctrl/Cmd/Alt (or a fn key)
    return mods.concat([main]).join('+');
  }
  function endCapture() { if (!capturing) return; document.removeEventListener('keydown', onCapKey, true); try { dp.setShortcutHandlingSuspended(false); } catch (e) {} capturing = null; }
  function startCapture(kbdEl) {
    endCapture();
    capturing = { ext: kbdEl.dataset.ext, cmd: kbdEl.dataset.cmd, scope: kbdEl.dataset.scope, el: kbdEl };
    kbdEl.textContent = 'press keys…'; kbdEl.classList.add('capturing');
    try { dp.setShortcutHandlingSuspended(true); } catch (e) {}
    document.addEventListener('keydown', onCapKey, true);
  }
  function onCapKey(ev) {
    if (!capturing) return;
    ev.preventDefault(); ev.stopImmediatePropagation();
    if (ev.key === 'Escape') { endCapture(); renderShortcuts(); return; }
    if (['Shift', 'Control', 'Alt', 'Meta'].indexOf(ev.key) >= 0) return;   // wait for the real key
    if (ev.key === 'Backspace' || ev.key === 'Delete') { return setBinding(''); }
    var combo = fmtCombo(ev);
    if (!combo) { capturing.el.textContent = 'need Ctrl/⌘/Alt + key…'; return; }
    setBinding(combo);
  }
  function setBinding(kb) {
    var c = capturing; endCapture(); if (!c) return;
    try {
      dp.updateExtensionCommand({ extensionId: c.ext, commandName: c.cmd, keybinding: kb, scope: c.scope || 'CHROME' }, function () {
        var err = chrome.runtime.lastError;
        if (err && window.ZGui.toast) ZGui.toast.show('Shortcut: ' + err.message);
        else if (window.ZGui.toast) ZGui.toast.show(kb ? 'Set ' + kb : 'Cleared shortcut');
        refresh();
      });
    } catch (e) { if (window.ZGui.toast) ZGui.toast.show('Shortcut error'); refresh(); }
  }

  /* -------------------------------------------------------------- actions */
  function setEnabled(e, on) {
    if (isInternal(e)) return;
    // Persist zpwrchrome's on/off across restarts (see the ZPWR_ID note): the
    // launcher re-adds it enabled every start, so background.js re-applies this
    // marker on startup. A missing marker == enabled.
    if (isZpwr(e)) {
      try {
        chrome.runtime.sendNativeMessage(HOST, on
          ? { cmd: 'kv_del', app: 'zwire', key: 'zpwr_off' }
          : { cmd: 'kv_set', app: 'zwire', key: 'zpwr_off', value: true },
          function () { void chrome.runtime.lastError; });
      } catch (x) { void x; }
    }
    chrome.management.setEnabled(e.id, on, function () { void chrome.runtime.lastError; refresh(); });
  }
  function remove(e) { if (isInternal(e)) return; chrome.management.uninstall(e.id, { showConfirmDialog: true }, function () { void chrome.runtime.lastError; refresh(); }); }
  function openOptions(e) { if (dp.showOptions) dp.showOptions(e.id); else if (e.optionsPage) chrome.tabs.create({ url: e.optionsPage.url }); }
  function reload(e) { dp.reload(e.id, { failQuietly: false, populateErrorForUnpacked: true }, function () { void chrome.runtime.lastError; refresh(); }); }
  function loadUnpacked() { dp.loadUnpacked({ failQuietly: true }, function () { void chrome.runtime.lastError; refresh(); }); }
  function updateAll() { dp.autoUpdate(function () { void chrome.runtime.lastError; if (window.ZGui.toast) ZGui.toast.show('Checking for updates…'); refresh(); }); }
  function pack() { dp.choosePath('FOLDER', 'LOAD', function (path) { void chrome.runtime.lastError; if (!path) return;
    dp.packDirectory(path, '', 0, function (resp) { void chrome.runtime.lastError; if (resp && resp.message && window.ZGui.toast) ZGui.toast.show(resp.message); }); }); }

  /* ---------------------------------------------------------------- data */
  function loadProfile(cb) { dp.getProfileConfiguration(function (p) { void chrome.runtime.lastError; if (p) profile = p; (cb || function () {})(); }); }
  function refresh() {
    dp.getExtensionsInfo({ includeDisabled: true, includeTerminated: true }, function (list) {
      void chrome.runtime.lastError;
      all = (list || []).slice().sort(function (a, b) { return a.name.localeCompare(b.name); });
      if (view === 'detail' && detailId) { var e = all.filter(function (x) { return x.id === detailId; })[0]; if (e) return renderDetail(e); }
      if (view === 'shortcuts') return renderShortcuts();
      renderList();
    });
  }

  function boot() {
    shell = ZBHUD.mount({ title: 'EXTENSIONS', current: 'extensions.html', filterPlaceholder: 'filter extensions…',
      onFilter: function (q, rx) { query = q; regexOn = rx; if (view === 'shortcuts') renderShortcuts(); else if (view === 'list') renderList(); },
      palette: [ { label: 'Load unpacked extension', run: loadUnpacked }, { label: 'Pack extension', run: pack },
        { label: 'Update all extensions', run: updateAll }, { label: 'Keyboard shortcuts', run: renderShortcuts } ] });
    body = shell.body;
    if (location.hash === '#shortcuts') view = 'shortcuts';   // deep-link from the palette
    if (dp.onItemStateChanged) dp.onItemStateChanged.addListener(refresh);
    if (dp.onProfileStateChanged) dp.onProfileStateChanged.addListener(function (p) { if (p) profile = p; if (view === 'list') renderList(); });
    loadProfile(refresh);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
