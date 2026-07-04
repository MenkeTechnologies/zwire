/* zbrowser HUD system page (replaces chrome://version). */
(function () {
  'use strict';
  var ua = navigator.userAgent;
  var chromium = (ua.match(/Chrom(?:e|ium)\/([\d.]+)/) || [])[1] || 'unknown';
  document.getElementById('ver').textContent = 'v' + chromium;

  var nav = navigator;
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
  if (brands && brands.length) {
    rows.splice(1, 0, ['Brands', brands.map(function (b) { return b.brand + ' ' + b.version; }).join(' · ')]);
  }

  var el = document.getElementById('info');
  el.innerHTML = rows.map(function (r) {
    return '<div class="info-row"><span class="ik">' + esc(r[0]) + '</span><span class="iv">' + esc(r[1]) + '</span></div>';
  }).join('');

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
})();
