/* zwire HUD System page (replaces chrome://version): what zwire is, its version,
 * how it's built, the feature set, live native-host status, and the browser
 * environment. All UI from ZGui.* (card + info-list). */
(function () {
  'use strict';
  var Z = window.ZGui;
  var esc = (Z.util && Z.util.escapeHtml) || function (s) { return String(s == null ? '' : s); };

  // Keep in sync with package.json "version".
  var ZWIRE_VERSION = '0.5.12';
  var HOST = 'com.zwire.hud';

  var shell = window.ZBHUD.mount({ title: 'SYSTEM', current: 'version.html', filterPlaceholder: 'filter…', onFilter: function (v) { filterAll(v); } });
  var body = shell.body;

  // Live filter: show only rows (and their card) whose key/value — or the card
  // header — match the query; hide cards with nothing left.
  var curFilter = '';
  function filterAll(v) {
    curFilter = (v || '').trim().toLowerCase();
    Array.prototype.forEach.call(body.children, function (cardEl) {
      var rows = cardEl.querySelectorAll('.info-row'); if (!rows.length) return;
      var header = cardEl.querySelector('.set-h');
      var headMatch = curFilter && header && header.textContent.toLowerCase().indexOf(curFilter) >= 0;
      var anyVisible = false;
      Array.prototype.forEach.call(rows, function (row) {
        var show = !curFilter || headMatch || row.textContent.toLowerCase().indexOf(curFilter) >= 0;
        row.style.display = show ? '' : 'none'; if (show) anyVisible = true;
      });
      cardEl.style.display = anyVisible ? '' : 'none';
    });
  }

  var nav = navigator, ua = nav.userAgent;
  var chromium = (ua.match(/Chrom(?:e|ium)\/([\d.]+)/) || [])[1] || 'unknown';

  function el(t, c, h) { var e = document.createElement(t); if (c) e.className = c; if (h != null) e.innerHTML = h; return e; }
  function card(title, rows) {
    var inner = el('div');
    inner.appendChild(el('div', 'set-h', '// ' + title));
    var list = el('div', 'info-list');
    rows.forEach(function (r) {
      var row = el('div', 'info-row');
      if (r[0]) row.setAttribute('data-k', r[0]);   // so async host facts can refine a row in place
      row.appendChild(el('span', 'ik', esc(r[0])));
      row.appendChild(el('span', 'iv', r[2] ? r[1] : esc(r[1])));   // r[2]=true -> r[1] is trusted HTML
      list.appendChild(row);
    });
    inner.appendChild(list);
    var c = Z.card({ body: inner }).el;
    body.appendChild(c);
    return c;
  }

  /* ---- ZWIRE ---- */
  card('ZWIRE  v' + ZWIRE_VERSION, [
    ['What it is', 'A Chromium superset with the cyberpunk HUD — the zpwrchrome power-tool, an 8-scheme theme engine, a HUD new-tab, and a global ⌘K command palette, on a real Blink base.'],
    ['Version', ZWIRE_VERSION],
    ['HUD extension', 'v' + (chrome.runtime.getManifest ? chrome.runtime.getManifest().version : '?')],
    ['License', 'MIT'],
    ['Repo', '<a href="https://github.com/MenkeTechnologies/zwire" target="_blank">github.com/MenkeTechnologies/zwire</a>', true],
    ['Docs', '<a href="https://menketechnologies.github.io/zwire/" target="_blank">menketechnologies.github.io/zwire</a>', true]
  ]);

  /* ---- BUILD ---- */
  card('BUILD', [
    ['Base', 'Chromium ' + chromium + ' (unbranded snapshot)'],
    ['Rebrand', 'runtime — zwire name + cyberpunk icon over a pinned Chromium; optional source fork (fork/patches) takes the HUD into tab shapes / omnibox / colors'],
    ['Native host', 'zwire-host — one self-contained Rust binary (scheme bridge · system stats · PTY terminal), cross-platform, no Python'],
    ['Install', 'macOS .app · Linux ~/.local + .desktop · Windows %LOCALAPPDATA% + Start Menu'],
    // zwire stores its profile in the OS app-data dir (scripts/state-dir.sh), NOT
    // a dotdir — ~ shown here, refined to the absolute path by the host below.
    ['Profile', (/Mac|Darwin/i.test(nav.platform || ua) ? '~/Library/Application Support/com.menketechnologies.zwire/profile' : '~/.config/zwire/profile')],
    ['Scheme file', '~/.zwire/hud-scheme']
  ]);

  /* ---- NATIVE HOST (live) ---- */
  var hostCard = card('NATIVE HOST', [['Status', '<span class="sub">probing…</span>', true]]);
  function setHostRows(rows) {
    var fresh = card('NATIVE HOST', rows);
    body.replaceChild(fresh, hostCard);
    hostCard = fresh;
    if (curFilter) filterAll(curFilter);   // keep an active filter applied across the async swap
  }
  try {
    chrome.runtime.sendNativeMessage(HOST, { cmd: 'get' }, function (r) {
      if (chrome.runtime.lastError || !r) {
        setHostRows([
          ['Status', '<span style="color:var(--accent,#ff2a6d)">not connected</span>', true],
          ['Reason', esc((chrome.runtime.lastError && chrome.runtime.lastError.message) || 'no response') + ' — run scripts/setup-native-host.sh']
        ]);
        return;
      }
      setHostRows([
        ['Status', '<span style="color:var(--cyan,#05d9e8)">connected</span>', true],
        ['Manifest', HOST],
        ['Active scheme', esc((r.scheme || '—'))],
        ['Effects', r.ui ? esc(Object.keys(r.ui).filter(function (k) { return r.ui[k]; }).join(', ') || 'none') : '—']
      ]);
    });
  } catch (e) {
    setHostRows([['Status', '<span style="color:var(--accent,#ff2a6d)">unavailable</span>', true]]);
  }

  /* ---- FEATURES ---- */
  card('FEATURES', [
    ['⌘K palette', 'global command runner — pages, tabs, frecent, keyword search, package registries, + user CRUD custom commands'],
    ['Terminal', 'embedded PTY (zwire-host) — Ctrl+` popup, dockable, survives navigation'],
    ['tmux', 'panes + windows in one browser window (Ctrl-b prefix), with sync'],
    ['Statusbar', 'powerline HUD — cpu / mem / net / disk / temp / load / battery / IPs / clock'],
    ['Vim mode', 'hjkl / H M L / gg G / zz zt zb / marks / :cmd'],
    ['Schemes', '8 whole-browser color schemes, synced to the native chrome'],
    ['Find', '⌘F fuzzy in-page bar']
  ]);

  /* ---- ENVIRONMENT ---- */
  var envRows = [
    ['User agent', ua],
    ['Platform', nav.platform || (nav.userAgentData && nav.userAgentData.platform) || '—'],
    ['Language', (nav.languages && nav.languages.join(', ')) || nav.language || '—'],
    ['CPU cores', String(nav.hardwareConcurrency || '—')],
    ['Device memory', nav.deviceMemory ? nav.deviceMemory + ' GB' : '—'],
    ['Online', nav.onLine ? 'yes' : 'no'],
    ['Extension ID', chrome.runtime.id]
  ];
  var brands = nav.userAgentData && nav.userAgentData.brands;
  if (brands && brands.length) envRows.splice(1, 0, ['Brands', brands.map(function (b) { return b.brand + ' ' + b.version; }).join(' · ')]);
  card('ENVIRONMENT', envRows);

  /* Real machine facts from the native host. nav.deviceMemory is quantized and
     CAPPED at 8 GB by Chrome (so a 32 GB box reads wrong); the absolute profile
     path is only known host-side. Refine those rows in place once the host answers. */
  try {
    chrome.runtime.sendNativeMessage(HOST, { cmd: 'hostinfo' }, function (h) {
      if (chrome.runtime.lastError || !h || !h.ok) return;
      var put = function (k, v) {
        var cell = body.querySelector('.info-row[data-k="' + k + '"] .iv');
        if (cell && v != null && v !== '') cell.textContent = v;
      };
      if (h.mem_total) {                                   // bytes (sysinfo 0.33)
        var gb = h.mem_total / 1073741824;
        put('Device memory', (gb >= 10 ? Math.round(gb) : gb.toFixed(1)) + ' GB');
      }
      if (h.home) {                                        // real absolute profile path
        var st = h.os === 'macos' ? h.home + '/Library/Application Support/com.menketechnologies.zwire'
               : h.os === 'windows' ? h.home + '\\AppData\\Local\\zwire'
               : h.home + '/.config/zwire';
        put('Profile', st + (h.os === 'windows' ? '\\profile' : '/profile'));
      }
      if (h.cpus) put('CPU cores', String(h.cpus));        // authoritative core count
    });
  } catch (e) {}
})();
