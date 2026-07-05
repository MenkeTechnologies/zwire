/* zwire HUD System page (replaces chrome://version): what zwire is, its version,
 * how it's built, the feature set, live native-host status, and the browser
 * environment. All UI from ZGui.* (card + info-list). */
(function () {
  'use strict';
  var Z = window.ZGui;
  var esc = (Z.util && Z.util.escapeHtml) || function (s) { return String(s == null ? '' : s); };

  // Keep in sync with package.json "version".
  var ZWIRE_VERSION = '0.2.1';
  var HOST = 'com.zwire.hud';

  var shell = window.ZBHUD.mount({ title: 'SYSTEM', current: 'version.html', filterPlaceholder: 'filter…', onFilter: function () {} });
  var body = shell.body;

  var nav = navigator, ua = nav.userAgent;
  var chromium = (ua.match(/Chrom(?:e|ium)\/([\d.]+)/) || [])[1] || 'unknown';

  function el(t, c, h) { var e = document.createElement(t); if (c) e.className = c; if (h != null) e.innerHTML = h; return e; }
  function card(title, rows) {
    var inner = el('div');
    inner.appendChild(el('div', 'set-h', '// ' + title));
    var list = el('div', 'info-list');
    rows.forEach(function (r) {
      var row = el('div', 'info-row');
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
    ['Profile', '~/.zwire/profile'],
    ['Scheme file', '~/.zwire/hud-scheme']
  ]);

  /* ---- NATIVE HOST (live) ---- */
  var hostCard = card('NATIVE HOST', [['Status', '<span class="sub">probing…</span>', true]]);
  function setHostRows(rows) {
    var fresh = card('NATIVE HOST', rows);
    body.replaceChild(fresh, hostCard);
    hostCard = fresh;
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
})();
