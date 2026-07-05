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
  var view = 'list', detailId = null, query = '';
  var STORE_URL = 'https://chromewebstore.google.com/';

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
    if (e.userMayModify && !e.mustRemainInstalled) actions.push(ZGui.button({ label: 'REMOVE', variant: 'danger', onClick: function () { remove(e); } }));
    if (e.userMayModify) actions.push(ZGui.toggle({ checked: enabled(e), onChange: function (on) { setEnabled(e, on); } }).el);
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
    if (e.userMayModify) { var ht = ZGui.toggle({ checked: enabled(e), onChange: function (on) { setEnabled(e, on); } }); head.appendChild(ht.el); }
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
      var p = a.getAttribute('data-view').split(':'); dp.openDevTools({ renderProcessId: +p[0], renderViewId: +p[1], incognito: p[2] === '1', isServiceWorker: p[3] === '1', extensionId: e.id }); }; });
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
    var withCmds = all.filter(function (e) { return isExt(e) && e.commands && e.commands.length; });
    var inner = el('div');
    inner.appendChild(el('div', 'set-h', '// KEYBOARD SHORTCUTS'));
    inner.innerHTML += withCmds.length ? withCmds.map(function (e) {
      return '<div class="xt-scut-ext"><div class="xt-scut-name">' + esc(e.name) + '</div>' +
        e.commands.map(function (c) { return '<div class="info-row"><span class="ik">' + esc(c.description || c.name) +
          '</span><span class="iv"><kbd class="xt-kbd">' + esc(c.keybinding || '— unset —') + '</kbd> <span class="sub">' + (c.scope === 'GLOBAL' ? 'global' : 'in browser') + '</span></span></div>'; }).join('') + '</div>';
    }).join('') : '<div class="xt-dbody">No extensions define keyboard shortcuts.</div>';
    body.appendChild(ZGui.card({ body: inner }).el);
  }

  /* -------------------------------------------------------------- actions */
  function setEnabled(e, on) { chrome.management.setEnabled(e.id, on, function () { void chrome.runtime.lastError; refresh(); }); }
  function remove(e) { chrome.management.uninstall(e.id, { showConfirmDialog: true }, function () { void chrome.runtime.lastError; refresh(); }); }
  function openOptions(e) { if (dp.showOptions) dp.showOptions(e.id); else if (e.optionsPage) chrome.tabs.create({ url: e.optionsPage.url }); }
  function reload(e) { dp.reload(e.id, { failQuietly: false, populateErrorForUnpacked: true }, function () { void chrome.runtime.lastError; refresh(); }); }
  function loadUnpacked() { dp.loadUnpacked({ failQuietly: true }, function () { void chrome.runtime.lastError; refresh(); }); }
  function updateAll() { dp.autoUpdate(function () { void chrome.runtime.lastError; if (window.ZGui.toast) ZGui.toast('Checking for updates…'); refresh(); }); }
  function pack() { dp.choosePath('FOLDER', 'LOAD', function (path) { void chrome.runtime.lastError; if (!path) return;
    dp.packDirectory(path, '', 0, function (resp) { void chrome.runtime.lastError; if (resp && resp.message && window.ZGui.toast) ZGui.toast(resp.message); }); }); }

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
      onFilter: function (q) { query = q; if (view === 'list') renderList(); },
      palette: [ { label: 'Load unpacked extension', run: loadUnpacked }, { label: 'Pack extension', run: pack },
        { label: 'Update all extensions', run: updateAll }, { label: 'Keyboard shortcuts', run: renderShortcuts } ] });
    body = shell.body;
    if (dp.onItemStateChanged) dp.onItemStateChanged.addListener(refresh);
    if (dp.onProfileStateChanged) dp.onProfileStateChanged.addListener(function (p) { if (p) profile = p; if (view === 'list') renderList(); });
    loadProfile(refresh);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
