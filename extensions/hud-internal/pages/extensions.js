/* zbrowser HUD Extensions manager — full parity with chrome://extensions, built
 * on chrome.developerPrivate (allowlisted for our extension in the fork) +
 * chrome.management for enable/uninstall. Dev mode, Load unpacked, Pack, Update,
 * per-extension toggles, inspect views, errors, size, path, keyboard shortcuts. */
(function () {
  'use strict';
  var dp = chrome.developerPrivate;
  var grid = document.getElementById('grid');
  var countEl = document.getElementById('count');
  var searchEl = document.getElementById('search');
  var devToggle = document.getElementById('devmode');
  var devBtns = document.getElementById('devbtns');
  var webstore = document.getElementById('webstore');
  var discover = document.getElementById('discover');
  var FZ = window.ZBFzf;

  var all = [];             // ExtensionInfo[]
  var profile = { inDeveloperMode: false, canLoadUnpacked: true };
  var view = 'list';        // list | detail | shortcuts
  var detailId = null;

  var STORE_URL = 'https://chromewebstore.google.com/';
  webstore.href = STORE_URL;
  discover.innerHTML = '<a href="' + STORE_URL + '" target="_blank" rel="noopener" style="color:var(--cyan)">discover more on the Chrome Web Store ↗</a>';

  function esc(s) { return FZ.esc(String(s == null ? '' : s)); }
  function isExt(e) { return e.type === 'EXTENSION' || e.type === 'LEGACY_PACKAGED_APP' || e.type === 'HOSTED_APP' || e.type === 'PLATFORM_APP'; }
  function enabled(e) { return e.state === 'ENABLED'; }
  function locLabel(e) {
    return { UNPACKED: 'Unpacked', FROM_STORE: 'Chrome Web Store', THIRD_PARTY: 'Third-party',
      INSTALLED_BY_DEFAULT: 'Default', UNKNOWN: 'Unknown' }[e.location] || e.location;
  }
  function hostAccessLabel(e) {
    var r = e.permissions && e.permissions.runtimeHostPermissions;
    if (!r) return null;
    return { ON_CLICK: 'On click', ON_SPECIFIC_SITES: 'On specific sites', ON_ALL_SITES: 'On all sites' }[r.hostAccess] || r.hostAccess;
  }
  function disableReasonText(e) {
    var d = e.disableReasons || {}, out = [];
    if (d.corruptInstall) out.push('CORRUPTED');
    if (d.suspiciousInstall) out.push('SUSPICIOUS');
    if (d.updateRequired) out.push('UPDATE REQUIRED');
    if (d.blockedByPolicy) out.push('BLOCKED BY POLICY');
    if (d.unsupportedManifestVersion) out.push('MANIFEST OUTDATED');
    if (d.unsupportedDeveloperExtension) out.push('DEV EXT DISABLED');
    return out;
  }
  function errorCount(e) { return (e.manifestErrors || []).length + (e.runtimeErrors || []).length; }

  /* ---------------------------------------------------------------- toolbar */
  function syncToolbar() {
    devToggle.classList.toggle('on', !!profile.inDeveloperMode);
    devBtns.hidden = !profile.inDeveloperMode;
    devBtns.querySelector('[data-act=load]').disabled = !profile.canLoadUnpacked;
  }

  /* ------------------------------------------------------------------- list */
  function render(filter) {
    view = 'list'; detailId = null;
    filter = (filter || '').trim();
    grid.innerHTML = '';
    var rows;
    if (!filter) {
      rows = all.filter(isExt).map(function (e) { return { e: e, idx: null }; });
    } else {
      rows = [];
      all.forEach(function (e) {
        if (!isExt(e)) return;
        var m = FZ.fzfMatch(filter, e.name);
        if (!m && FZ.fzfMatch(filter, e.description || '')) m = { score: -1000, indices: [] };
        if (m) rows.push({ e: e, idx: m.indices, score: m.score });
      });
      rows.sort(function (a, b) { return (b.score || 0) - (a.score || 0); });
    }
    countEl.textContent = rows.length;
    if (!rows.length) { grid.innerHTML = '<div class="footer-docs">[ no matches ]</div>'; return; }
    rows.forEach(function (row) {
      var e = row.e;
      var nameHtml = row.idx && row.idx.length ? FZ.highlightWithIndices(e.name, row.idx) : esc(e.name);
      var errs = errorCount(e);
      var reasons = disableReasonText(e);
      var card = document.createElement('div');
      card.className = 'product-card' + (enabled(e) ? '' : ' off');
      card.innerHTML =
        '<div class="product-thumb">' +
          '<span class="badge">' + esc(locLabel(e)) + '</span>' +
          (e.iconUrl ? '<img class="xt-icon" src="' + esc(e.iconUrl) + '">' : '') +
        '</div>' +
        '<div class="product-body">' +
          '<span class="p-cat">' + (enabled(e) ? 'ENABLED' : 'DISABLED') + '</span>' +
          '<span class="p-name">' + nameHtml + ' <span class="card-chip">v' + esc(e.version) + '</span></span>' +
          '<span class="p-tag">' + esc(e.description || '') + '</span>' +
          '<div class="xt-meta">' +
            (hostAccessLabel(e) ? '<span class="xt-chip">SITE · ' + esc(hostAccessLabel(e)) + '</span>' : '') +
            (e.permissions && e.permissions.simplePermissions.length ? '<span class="xt-chip">PERMS · ' + e.permissions.simplePermissions.length + '</span>' : '') +
            (e.optionsPage ? '<span class="xt-chip">OPTIONS</span>' : '') +
            (e.incognitoAccess.isActive ? '<span class="xt-chip">INCOGNITO</span>' : '') +
            (errs ? '<span class="xt-chip warn" data-act="details">ERRORS · ' + errs + '</span>' : '') +
            reasons.map(function (r) { return '<span class="xt-chip warn">' + esc(r) + '</span>'; }).join('') +
          '</div>' +
          (profile.inDeveloperMode ? '<div class="xt-id">ID: ' + esc(e.id) + (e.path ? ' · ' + esc(e.prettifiedPath || e.path) : '') + '</div>' : '') +
        '</div>' +
        '<div class="product-foot">' +
          '<div class="xt-foot">' +
            '<button class="xt-btn" data-act="details">DETAILS</button>' +
            (e.optionsPage ? '<button class="xt-btn" data-act="options">OPTIONS</button>' : '') +
            (profile.inDeveloperMode && e.location === 'UNPACKED' ? '<button class="xt-btn" data-act="reload">RELOAD</button>' : '') +
            (e.userMayModify && !e.mustRemainInstalled ? '<button class="xt-btn danger" data-act="remove">REMOVE</button>' : '<span class="badge">LOCKED</span>') +
            '<span class="grow"></span>' +
            (e.userMayModify ? '<div class="xt-toggle' + (enabled(e) ? ' on' : '') + '" data-act="toggle" title="enable/disable"></div>' : '') +
          '</div>' +
        '</div>';
      card.querySelectorAll('[data-act]').forEach(function (el) {
        el.onclick = function (ev) { ev.preventDefault(); ev.stopPropagation(); action(el.getAttribute('data-act'), e); };
      });
      grid.appendChild(card);
    });
  }

  /* ----------------------------------------------------------- detail view */
  function sect(title, body, extra) {
    return '<div class="xt-dsec"><div class="set-h">// ' + title + (extra || '') + '</div><div class="xt-dbody">' + body + '</div></div>';
  }
  function rowsTable(rows) {
    return '<div class="info-list">' + rows.map(function (r) {
      return '<div class="info-row"><span class="ik">' + esc(r[0]) + '</span><span class="iv">' + r[1] + '</span></div>';
    }).join('') + '</div>';
  }
  function toggleRow(label, active, act, disabled) {
    return '<label class="xt-switch full' + (disabled ? ' dim' : '') + '"><span>' + esc(label) + '</span>' +
      '<span class="xt-toggle' + (active ? ' on' : '') + '"' + (disabled ? '' : ' data-cfg="' + act + '"') + '></span></label>';
  }

  function renderDetail(e) {
    view = 'detail'; detailId = e.id;
    var perms = (e.permissions && e.permissions.simplePermissions) || [];
    var permBody = perms.length
      ? '<ul class="xt-warnlist">' + perms.map(function (p) {
          return '<li>' + esc(p.message) + (p.submessages && p.submessages.length
            ? '<ul>' + p.submessages.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ul>' : '') + '</li>';
        }).join('') + '</ul>'
      : '<div class="xt-dbody">No special permissions required.</div>';

    var rhp = e.permissions && e.permissions.runtimeHostPermissions;
    var hostBody;
    if (rhp) {
      var opts = [['ON_CLICK', 'On click'], ['ON_SPECIFIC_SITES', 'On specific sites'], ['ON_ALL_SITES', 'On all sites']];
      hostBody = '<div class="xt-seg" id="hostseg">' + opts.map(function (o) {
        return '<button class="xt-segbtn' + (rhp.hostAccess === o[0] ? ' on' : '') + '" data-host="' + o[0] + '">' + esc(o[1]) + '</button>';
      }).join('') + '</div>' +
      (rhp.hosts && rhp.hosts.length ? '<div class="xt-perms">' + rhp.hosts.map(function (h) {
        return (h.granted ? '● ' : '○ ') + esc(h.host); }).join(' &nbsp; ') + '</div>' : '');
    } else { hostBody = '<div class="xt-dbody">This extension does not request site access.</div>'; }

    var views = (e.views || []).filter(function (v) { return v.type !== 'TAB_CONTENTS'; });
    var viewsBody = views.length ? views.map(function (v) {
      var lbl = viewLabel(v);
      return '<a class="xt-chip link" data-view="' + v.renderProcessId + ':' + v.renderViewId + ':' + (v.incognito ? 1 : 0) + ':' + (v.isServiceWorker ? 1 : 0) + '" href="#">' + esc(lbl) + ' ↗</a>';
    }).join(' ') : '<span class="xt-dbody">Inactive</span>';

    var errs = (e.manifestErrors || []).concat(e.runtimeErrors || []);
    var errBody = errs.length ? '<div class="xt-errs">' + errs.map(function (er) {
      var lvl = er.severity || 'MANIFEST';
      return '<div class="xt-err ' + esc(String(lvl).toLowerCase()) + '"><span class="lv">' + esc(lvl) + '</span> ' + esc(er.message) +
        (er.source ? '<div class="src">' + esc(er.source) + '</div>' : '') + '</div>';
    }).join('') + '</div><button class="xt-btn" data-act="clearerrors" style="margin-top:8px">CLEAR ERRORS</button>' : '';

    var rows = [
      ['Status', enabled(e) ? 'On' : 'Off'],
      ['Version', esc(e.version)],
      ['ID', '<span class="xt-id">' + esc(e.id) + '</span>'],
      ['Source', esc(locLabel(e))],
      ['Size', '<span data-size="1">…</span>'],
      ['Type', esc(e.type)]
    ];
    if (e.path) rows.push(['Loaded from', '<span class="xt-id">' + esc(e.prettifiedPath || e.path) + '</span> <a href="#" data-act="showpath" style="color:var(--cyan)">show ↗</a>']);
    if (e.homePage && e.homePage.specified) rows.push(['Homepage', '<a href="' + esc(e.homePage.url) + '" style="color:var(--cyan)">' + esc(e.homePage.url) + ' ↗</a>']);
    rows.push(['Inspect views', viewsBody]);
    if (e.updateUrl) rows.push(['Update URL', esc(e.updateUrl)]);
    rows.push(['Offline', e.offlineEnabled ? 'yes' : 'no']);

    grid.innerHTML =
      '<div class="xt-detail">' +
        '<button class="xt-btn" data-back="1">← BACK</button>' +
        '<div class="xt-detail-head">' +
          (e.iconUrl ? '<img class="xt-dicon" src="' + esc(e.iconUrl) + '">' : '<div class="xt-dicon"></div>') +
          '<div class="xt-dtitle"><div class="xt-dname">' + esc(e.name) + ' <span class="card-chip">v' + esc(e.version) + '</span></div>' +
          '<div class="p-cat">' + (enabled(e) ? 'ENABLED' : 'DISABLED') + ' · ' + esc(locLabel(e)) + '</div></div>' +
          '<span class="grow"></span>' +
          (e.userMayModify ? '<div class="xt-toggle' + (enabled(e) ? ' on' : '') + '" data-act="toggle" title="enable/disable"></div>' : '') +
        '</div>' +
        sect('DESCRIPTION', esc(e.description || '—')) +
        sect('PERMISSIONS', permBody, ' · ' + perms.length) +
        sect('SITE ACCESS', hostBody) +
        sect('OPTIONS', [
          toggleRow('Allow in Incognito', e.incognitoAccess.isActive, 'incognitoAccess', !e.incognitoAccess.isEnabled),
          toggleRow('Allow access to file URLs', e.fileAccess.isActive, 'fileAccess', !e.fileAccess.isEnabled),
          toggleRow('Collect errors', e.errorCollection.isActive, 'errorCollection', !e.errorCollection.isEnabled),
          (e.userScriptsAccess.isEnabled ? toggleRow('Allow user scripts', e.userScriptsAccess.isActive, 'userScriptsAccess', false) : '')
        ].join('')) +
        (errBody ? sect('ERRORS', errBody, ' · ' + errs.length) : '') +
        '<div class="xt-dsec"><div class="set-h">// DETAILS</div>' + rowsTable(rows) + '</div>' +
        '<div class="xt-foot" style="margin-top:16px">' +
          (e.optionsPage ? '<button class="xt-btn" data-act="options">OPTIONS</button>' : '') +
          (profile.inDeveloperMode && e.location === 'UNPACKED' ? '<button class="xt-btn" data-act="reload">RELOAD</button>' : '') +
          (e.homePage && e.homePage.specified ? '<a class="xt-btn" href="' + esc(e.homePage.url) + '">HOMEPAGE ↗</a>' : '') +
          (e.userMayModify && !e.mustRemainInstalled ? '<button class="xt-btn danger" data-act="remove">REMOVE</button>' : '') +
        '</div>' +
      '</div>';

    grid.querySelector('[data-back]').onclick = function () { render(searchEl.value); };
    grid.querySelectorAll('[data-act]').forEach(function (el) {
      el.onclick = function (ev) { ev.preventDefault(); action(el.getAttribute('data-act'), e); };
    });
    grid.querySelectorAll('[data-cfg]').forEach(function (el) {
      el.onclick = function () {
        var key = el.getAttribute('data-cfg'), upd = { extensionId: e.id };
        upd[key] = !el.classList.contains('on');
        dp.updateExtensionConfiguration(upd, function () { void chrome.runtime.lastError; refresh(); });
      };
    });
    grid.querySelectorAll('[data-host]').forEach(function (el) {
      el.onclick = function () {
        dp.updateExtensionConfiguration({ extensionId: e.id, hostAccess: el.getAttribute('data-host') },
          function () { void chrome.runtime.lastError; refresh(); });
      };
    });
    grid.querySelectorAll('[data-view]').forEach(function (el) {
      el.onclick = function (ev) {
        ev.preventDefault();
        var p = el.getAttribute('data-view').split(':');
        dp.openDevTools({ renderProcessId: +p[0], renderViewId: +p[1], incognito: p[2] === '1', isServiceWorker: p[3] === '1', extensionId: e.id });
      };
    });
    // async size
    dp.getExtensionSize(e.id, function (sz) {
      void chrome.runtime.lastError;
      var el = grid.querySelector('[data-size]'); if (el) el.textContent = sz || '—';
    });
  }

  function viewLabel(v) {
    var m = { EXTENSION_SERVICE_WORKER_BACKGROUND: 'service worker', EXTENSION_BACKGROUND_PAGE: 'background page',
      EXTENSION_POPUP: 'popup', EXTENSION_SIDE_PANEL: 'side panel', OFFSCREEN_DOCUMENT: 'offscreen',
      EXTENSION_GUEST: 'guest', DEVELOPER_TOOLS: 'devtools', TAB_CONTENTS: 'tab' };
    var base = m[v.type] || v.type.toLowerCase();
    return base + (v.incognito ? ' (incognito)' : '');
  }

  /* ------------------------------------------------------------- shortcuts */
  function renderShortcuts() {
    view = 'shortcuts';
    var withCmds = all.filter(function (e) { return isExt(e) && e.commands && e.commands.length; });
    grid.innerHTML = '<div class="xt-detail">' +
      '<button class="xt-btn" data-back="1">← BACK</button>' +
      '<div class="xt-dsec"><div class="set-h">// KEYBOARD SHORTCUTS</div>' +
      (withCmds.length ? withCmds.map(function (e) {
        return '<div class="xt-scut-ext"><div class="xt-scut-name">' + esc(e.name) + '</div>' +
          e.commands.map(function (c) {
            return '<div class="info-row"><span class="ik">' + esc(c.description || c.name) + '</span>' +
              '<span class="iv"><kbd class="xt-kbd">' + esc(c.keybinding || '— unset —') + '</kbd>' +
              ' <span class="sub">' + (c.scope === 'GLOBAL' ? 'global' : 'in browser') + '</span></span></div>';
          }).join('') + '</div>';
      }).join('') : '<div class="xt-dbody">No extensions define keyboard shortcuts.</div>') +
      '</div></div>';
    grid.querySelector('[data-back]').onclick = function () { render(searchEl.value); };
  }

  /* ---------------------------------------------------------------- actions */
  function action(act, e) {
    switch (act) {
      case 'details': renderDetail(e); break;
      case 'toggle':
        chrome.management.setEnabled(e.id, !enabled(e), function () { void chrome.runtime.lastError; refresh(); });
        break;
      case 'remove':
        chrome.management.uninstall(e.id, { showConfirmDialog: true }, function () { void chrome.runtime.lastError; refresh(); });
        break;
      case 'options':
        if (e.optionsPage) dp.showOptions ? dp.showOptions(e.id) : chrome.tabs.create({ url: e.optionsPage.url });
        break;
      case 'reload':
        dp.reload(e.id, { failQuietly: false, populateErrorForUnpacked: true }, function (err) {
          void chrome.runtime.lastError; refresh();
        });
        break;
      case 'showpath': dp.showPath(e.id); break;
      case 'clearerrors':
        dp.deleteExtensionErrors({ extensionId: e.id }, function () { void chrome.runtime.lastError; refresh(); });
        break;
    }
  }

  /* toolbar actions */
  function bindToolbar() {
    devToggle.onclick = function () {
      dp.updateProfileConfiguration({ inDeveloperMode: !profile.inDeveloperMode }, function () {
        void chrome.runtime.lastError; loadProfile(function () { syncToolbar(); if (view === 'list') render(searchEl.value); });
      });
    };
    devBtns.querySelector('[data-act=load]').onclick = function () {
      dp.loadUnpacked({ failQuietly: true }, function (err) { void chrome.runtime.lastError; refresh(); });
    };
    devBtns.querySelector('[data-act=pack]').onclick = function () {
      dp.choosePath('FOLDER', 'LOAD', function (path) {
        void chrome.runtime.lastError; if (!path) return;
        dp.packDirectory(path, '', 0, function (resp) {
          void chrome.runtime.lastError;
          if (resp && resp.message) alert(resp.message);
        });
      });
    };
    devBtns.querySelector('[data-act=updateall]').onclick = function () {
      dp.autoUpdate(function () { void chrome.runtime.lastError; refresh(); });
    };
    document.querySelector('[data-act=shortcuts]').onclick = renderShortcuts;
  }

  /* ------------------------------------------------------------------ data */
  function loadProfile(cb) {
    dp.getProfileConfiguration(function (p) { void chrome.runtime.lastError; if (p) profile = p; (cb || function () {})(); });
  }
  function refresh() {
    dp.getExtensionsInfo({ includeDisabled: true, includeTerminated: true }, function (list) {
      void chrome.runtime.lastError;
      all = (list || []).slice().sort(function (a, b) { return a.name.localeCompare(b.name); });
      if (view === 'detail' && detailId) {
        var e = all.filter(function (x) { return x.id === detailId; })[0];
        if (e) { renderDetail(e); return; }
      }
      if (view === 'shortcuts') { renderShortcuts(); return; }
      render(searchEl.value);
    });
  }

  if (searchEl) searchEl.addEventListener('input', function () { if (view === 'list') render(searchEl.value); });
  bindToolbar();
  if (dp.onItemStateChanged) dp.onItemStateChanged.addListener(refresh);
  if (dp.onProfileStateChanged) dp.onProfileStateChanged.addListener(function (p) { if (p) profile = p; syncToolbar(); if (view === 'list') render(searchEl.value); });

  loadProfile(function () { syncToolbar(); refresh(); });
})();
