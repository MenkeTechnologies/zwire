/* zbrowser HUD System (replaces chrome://version) — ZGui.appShell + card. */
(function () {
  'use strict';
  var esc = (window.ZGui.util && window.ZGui.util.escapeHtml) || function (s) { return String(s == null ? '' : s); };
  var shell = window.ZBHUD.mount({ title: 'SYSTEM', current: 'version.html', filterPlaceholder: 'filter…', onFilter: function () {} });
  var body = shell.body;

  var nav = navigator, ua = nav.userAgent;
  var chromium = (ua.match(/Chrom(?:e|ium)\/([\d.]+)/) || [])[1] || 'unknown';
  var rows = [
    ['Chromium base', chromium],
    ['User agent', ua],
    ['Platform', nav.platform || (nav.userAgentData && nav.userAgentData.platform) || '—'],
    ['Language', (nav.languages && nav.languages.join(', ')) || nav.language || '—'],
    ['CPU cores', String(nav.hardwareConcurrency || '—')],
    ['Device memory', nav.deviceMemory ? nav.deviceMemory + ' GB' : '—'],
    ['Online', nav.onLine ? 'yes' : 'no'],
    ['Extension ID', chrome.runtime.id],
    ['Profile path', '~/.zbrowser/profile'],
    ['Scheme file', '~/.zbrowser/hud-scheme']
  ];
  var brands = nav.userAgentData && nav.userAgentData.brands;
  if (brands && brands.length) rows.splice(1, 0, ['Brands', brands.map(function (b) { return b.brand + ' ' + b.version; }).join(' · ')]);

  var inner = document.createElement('div');
  inner.innerHTML = '<div class="set-h">// ZBROWSER · SYSTEM v' + esc(chromium) + '</div>' +
    '<div class="info-list">' + rows.map(function (r) {
      return '<div class="info-row"><span class="ik">' + esc(r[0]) + '</span><span class="iv">' + esc(r[1]) + '</span></div>';
    }).join('') + '</div>';
  body.appendChild(window.ZGui.card({ body: inner }).el);
})();
